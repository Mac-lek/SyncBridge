import {
  pgTable,
  text,
  uuid,
  integer,
  timestamp,
  jsonb,
  unique,
} from "drizzle-orm/pg-core";

// --- Domain: the tiny internal tracker we're syncing GitHub into ---

export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  identifier: text("identifier").notNull().unique(), // e.g. "SYNC"
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const issues = pgTable(
  "issues",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    sequenceId: integer("sequence_id").notNull(), // per-project human-readable number, e.g. SYNC-42
    title: text("title").notNull(),
    body: text("body"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.projectId, table.sequenceId)],
);

/**
 * external_mappings is the join between "a thing on GitHub" and "a thing in our DB".
 *
 * Both UNIQUE constraints together are what stop duplicate imports/syncs, no matter
 * how many times a webhook or import batch is replayed:
 *   - (connectionId, entityType, externalId) -> at most one internal row per GitHub entity
 *   - (connectionId, entityType, internalId) -> at most one GitHub entity per internal row
 */
export const externalMappings = pgTable(
  "external_mappings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    connectionId: uuid("connection_id").notNull(), // FK added once `connections` exists
    entityType: text("entity_type").notNull(), // 'issue' | 'comment' | ...
    externalId: text("external_id").notNull(), // GitHub's node_id or numeric id, as a string
    internalId: uuid("internal_id").notNull(),
  },
  (table) => [
    unique("uq_mapping_external").on(table.connectionId, table.entityType, table.externalId),
    unique("uq_mapping_internal").on(table.connectionId, table.entityType, table.internalId),
  ],
);

/**
 * processed_events is the idempotency ledger. The primary key IS the guarantee:
 * inserting the same key twice fails the second insert (or, with
 * ON CONFLICT DO NOTHING, inserts zero rows) at the database level, even if two
 * workers race to process the same event at the exact same instant.
 *
 * Crucially, the row is inserted in the SAME transaction as the domain write it
 * guards. That's what makes "duplicate detected" and "data written" atomic:
 * either both happen or neither does. See docs/topic-1-idempotency.md.
 */
export const processedEvents = pgTable("processed_events", {
  idempotencyKey: text("idempotency_key").primaryKey(), // e.g. "github:<delivery-id>"
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  result: jsonb("result"), // small debugging breadcrumb: what entity this event touched
});
