# SyncBridge

A resilient, event-driven data migration and bi-directional sync engine
between GitHub Issues and an internal issue tracker. Built around the
failure modes that matter in production integrations: partial failures,
third-party rate limits, duplicate/out-of-order events, crash recovery, and
a durable audit trail of actions taken by both humans and external agents.

**Guiding principle:** Postgres is the source of truth for correctness.
Redis and RabbitMQ make things faster and spread the work, but every
"exactly once" claim is backed by a unique constraint and a transaction,
not by a lock or a queue guarantee.

## Tooling

Node 24, npm, NestJS, Drizzle ORM + drizzle-kit, PostgreSQL 16, Redis,
RabbitMQ, Jest + Testcontainers for integration tests against real services.

## Commands

- `docker compose up -d` — start Postgres/Redis/RabbitMQ
- `npm run db:generate` — generate a Drizzle migration from `src/infra/db/schema.ts`
- `npm run db:migrate` — apply migrations
- `npm test` — run the test suite
