# QB Practice Lab

Standalone client bookkeeping practice lab. P-000 establishes immutable fictional case templates, isolated student attempts, and a balanced double-entry ledger. It intentionally contains no P-001 or Suncoast material.

## Boundaries

- `packages/accounting-domain`: framework-independent accounting and security rules
- `apps/api`: authenticated application-service/API boundary
- `apps/web`: minimal web boundary
- `prisma`: PostgreSQL schema and migrations
- `tests`: unit, adversarial API, and PostgreSQL integration tests

Use Node 22, PostgreSQL 16+, `npm install`, `npm run db:generate`, `npm test`, and `npm run build`.
