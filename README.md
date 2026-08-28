# QB Practice Lab

Standalone client bookkeeping practice lab. The P-009 local student application composes the immutable case, isolated attempt ledger, Suncoast learning services, assessment, final meeting, readiness report, and P-008A command boundary into the workflow specified by `docs/ux/UX-001.md`.

## Boundaries

- `packages/accounting-domain`: framework-independent accounting and security rules
- `apps/api`: authenticated application-service/API boundary
- `apps/student`: student-safe application composition and attempt lifecycle
- `apps/web`: accessible, responsive server-rendered student shell
- `prisma`: PostgreSQL schema and migrations
- `tests`: unit, adversarial API, and PostgreSQL integration tests

Use Node 22, PostgreSQL 16+, `pnpm install --frozen-lockfile`, `pnpm db:generate`, `pnpm test`, and `pnpm build`. To run the local shell after building, explicitly set `LOCAL_AUTH_ENABLED=true`, run `pnpm start:web`, and open `http://localhost:3000`. Select the predefined fictional Student A or Student B profile; the server creates an opaque HttpOnly session. Without explicit opt-in—and always when `NODE_ENV=production`—the local selector is disabled and the application fails closed without a configured provider. This is not a production authentication provider.

For the D-000 durable runtime, apply committed migrations, build, run `pnpm db:bootstrap`, and set `DURABLE_RUNTIME_ENABLED=true`. The process then uses PostgreSQL for attempts, audit-bearing aggregates, immutable snapshots, idempotency, and hashed sessions. Production refuses to start without durable mode. See `docs/architecture/D000.md`.

D-001 selects the future Preview topology without creating infrastructure: Clerk invite-only authentication exchanged for BBB durable sessions, one same-origin Render Node service, and an isolated persistent Neon PostgreSQL database. See `docs/architecture/D001.md`; implementation remains deferred to D-002.
