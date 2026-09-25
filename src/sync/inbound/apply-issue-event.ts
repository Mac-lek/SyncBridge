import { eq, and } from "drizzle-orm";
import type { Database } from "../../infra/db/client";
import { withTransaction } from "../../infra/db/client";
import { externalMappings, issues, processedEvents } from "../../infra/db/schema";

export interface IssueEvent {
  idempotencyKey: string; // e.g. "github:<X-GitHub-Delivery>"
  connectionId: string;
  externalId: string; // GitHub's node_id for the issue
  projectId: string;
  sequenceId: number;
  title: string;
  body: string | null;
}

export type ApplyResult = { outcome: "applied"; issueId: string } | { outcome: "duplicate_skipped" };

/**
 * Applies one inbound GitHub issue event exactly once, no matter how many
 * times the caller retries delivery of the same event.
 *
 * The two moves that make this safe:
 *
 * 1. The idempotency-key insert and the domain write happen in ONE transaction.
 *    If the process crashes between them, Postgres rolls the whole thing back,
 *    so a retry sees a clean slate and simply does the work (no half-applied
 *    state, no "duplicate" false positive).
 *
 * 2. The key insert uses ON CONFLICT DO NOTHING against processedEvents'
 *    primary key. If two workers race on the exact same event, only one
 *    INSERT can win -- Postgres serializes it for us. The loser sees 0 rows
 *    inserted and bails out *before* touching any domain table, so there's
 *    no duplicate issue and no lost update.
 */
export async function applyIssueEvent(db: Database, event: IssueEvent): Promise<ApplyResult> {
  return withTransaction(db, async (tx) => {
    const inserted = await tx
      .insert(processedEvents)
      .values({ idempotencyKey: event.idempotencyKey, result: { entityType: "issue", externalId: event.externalId } })
      .onConflictDoNothing()
      .returning({ idempotencyKey: processedEvents.idempotencyKey });

    if (inserted.length === 0) {
      // Someone (maybe us, on a previous attempt; maybe a concurrent worker)
      // already committed this exact event. Nothing left to do.
      return { outcome: "duplicate_skipped" };
    }

    const [mapping] = await tx
      .select()
      .from(externalMappings)
      .where(
        and(
          eq(externalMappings.connectionId, event.connectionId),
          eq(externalMappings.entityType, "issue"),
          eq(externalMappings.externalId, event.externalId),
        ),
      );

    if (mapping) {
      await tx
        .update(issues)
        .set({ title: event.title, body: event.body, updatedAt: new Date() })
        .where(eq(issues.id, mapping.internalId));
      return { outcome: "applied", issueId: mapping.internalId };
    }

    const [issue] = await tx
      .insert(issues)
      .values({
        projectId: event.projectId,
        sequenceId: event.sequenceId,
        title: event.title,
        body: event.body,
      })
      .returning({ id: issues.id });

    if (!issue) {
      throw new Error("Insert into issues returned no row");
    }

    await tx.insert(externalMappings).values({
      connectionId: event.connectionId,
      entityType: "issue",
      externalId: event.externalId,
      internalId: issue.id,
    });

    return { outcome: "applied", issueId: issue.id };
  });
}
