import { randomUUID } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { count, eq } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import * as schema from "../../src/infra/db/schema";
import { applyIssueEvent, type IssueEvent } from "../../src/sync/inbound/apply-issue-event";

async function countRows(db: ReturnType<typeof drizzle<typeof schema>>, table: PgTable) {
  const [row] = await db.select({ value: count() }).from(table);
  return row?.value ?? 0;
}

/**
 * These tests exercise directly against a
 * real, throwaway Postgres started by Testcontainers -- not a mock. Mocking
 * the database here would hide the exact thing we're testing: real
 * transaction/constraint behavior under concurrency.
 */
describe("applyIssueEvent idempotency", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let projectId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16").start();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  beforeEach(async () => {
    // Clean slate per test: truncate rather than recreate the container, for speed.
    await pool.query(
      "TRUNCATE TABLE processed_events, external_mappings, issues, projects RESTART IDENTITY CASCADE",
    );
    const [project] = await db
      .insert(schema.projects)
      .values({ identifier: "SYNC", name: "SyncBridge" })
      .returning({ id: schema.projects.id });
    projectId = project!.id;
  });

  function makeEvent(overrides: Partial<IssueEvent> = {}): IssueEvent {
    return {
      idempotencyKey: `github:${randomUUID()}`,
      connectionId: randomUUID(),
      externalId: "gh-issue-42",
      projectId,
      sequenceId: 42,
      title: "Original title",
      body: "Original body",
      ...overrides,
    };
  }

  it("the same event fired 10x concurrently produces exactly one issue and one processed key", async () => {
    const event = makeEvent();

    // All 10 "deliveries" race to apply the SAME idempotencyKey at once --
    // this is what a real webhook retry storm plus 2 worker replicas looks like.
    const results = await Promise.all(Array.from({ length: 10 }, () => applyIssueEvent(db, event)));

    const applied = results.filter((r) => r.outcome === "applied");
    const skipped = results.filter((r) => r.outcome === "duplicate_skipped");
    expect(applied).toHaveLength(1);
    expect(skipped).toHaveLength(9);

    expect(await countRows(db, schema.issues)).toBe(1);
    expect(await countRows(db, schema.processedEvents)).toBe(1);
  });

  it("crash A: a failure before commit leaves nothing behind, so a retry applies cleanly", async () => {
    const event = makeEvent();

    // Simulate "the worker died mid-transaction" by rolling back ourselves:
    // this is the exact shape of a real process crash before COMMIT.
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(schema.processedEvents).values({ idempotencyKey: event.idempotencyKey });
        throw new Error("simulated crash before commit");
      }),
    ).rejects.toThrow("simulated crash before commit");

    // The retry is a completely fresh attempt -- nothing was left half-applied.
    const result = await applyIssueEvent(db, event);
    expect(result.outcome).toBe("applied");

    expect(await countRows(db, schema.issues)).toBe(1);
  });

  it("crash B: a successful commit followed by redelivery is skipped, not duplicated", async () => {
    const event = makeEvent();

    const first = await applyIssueEvent(db, event);
    expect(first.outcome).toBe("applied");

    // GitHub (or our own consumer, after an ack that never reached the broker)
    // redelivers the exact same event.
    const redelivered = await applyIssueEvent(db, event);
    expect(redelivered.outcome).toBe("duplicate_skipped");

    expect(await countRows(db, schema.issues)).toBe(1);

    const [issue] = await db.select().from(schema.issues).where(eq(schema.issues.sequenceId, 42));
    expect(issue?.title).toBe("Original title");
  });
});