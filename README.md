# QB Practice Lab

Standalone client bookkeeping practice lab. The P-009 local student application composes the immutable case, isolated attempt ledger, Suncoast learning services, assessment, final meeting, readiness report, and P-008A command boundary into the workflow specified by `docs/ux/UX-001.md`.

## Boundaries

- `packages/accounting-domain`: framework-independent accounting and security rules
- `apps/api`: authenticated application-service/API boundary
- `apps/student`: student-safe application composition and attempt lifecycle
- `apps/web`: accessible, responsive server-rendered student shell
- `prisma`: PostgreSQL schema and migrations
- `tests`: unit, adversarial API, and PostgreSQL integration tests

Use Node 22, PostgreSQL 16+, `pnpm install --frozen-lockfile`, `pnpm db:generate`, `pnpm test`, and `pnpm build`. Run the local shell with `pnpm start:web` after building, then open `http://localhost:3000`.
