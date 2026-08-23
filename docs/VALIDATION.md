# P-000 validation gates

1. Template immutability: domain instantiation tests compare source before/after; PostgreSQL update/delete triggers reject mutations.
2. Ledger integrity: integer-cent validation rejects malformed/imbalanced lines before persistence; deferred constraint trigger rejects unbalanced commits atomically; reports derive only from journal lines.
3. Isolation: authenticated identity is supplied by the API context; owned lookup hides absent vs foreign attempts; attempt-scoped account validation and composite database keys reject cross-attempt references.
4. Instructor secrecy: separate instructor columns are absent from student domain/API types; fixed errors omit source data; adversarial serialization tests reject instructor vocabulary and fixture secrets.

## Executed validation

Validated against PostgreSQL 16 on 2026-08-18:

- `prisma validate`, `prisma generate`, `prisma migrate deploy`, and `prisma migrate status` passed; the database schema is current at `202608150001_p000_foundation`.
- `pnpm run test:db` passed all 9 PostgreSQL enforcement tests.
- `pnpm run test` passed all 20 unit, API, and database integration tests, including every approval gate above.
- `pnpm run lint`, `pnpm run typecheck`, `pnpm run build`, and `git diff --check` passed.
- Compiled API and web smoke checks passed (`qb-practice-lab-api:ok` and HTTP 200 with the P-000 foundation page).

## P-000A executed validation

Validated against a fresh disposable PostgreSQL 16 database on 2026-08-21, including final-review regressions:

- Frozen pnpm installation and the approved Prisma/esbuild rebuild scripts completed successfully.
- Prisma schema validation and generation passed; both migrations deployed and status reported current.
- All 46 unit, API/security, P-000 regression, and PostgreSQL integration tests passed.
- P-000A coverage includes invoice/payment/application, A/R control detection, Undeposited Funds deposits, cash/accrual P&L, card accounting, reconciliation completion/history, duplicate/cross-attempt rejection, student serialization secrecy, operational account-role enforcement, deposit-total enforcement, and cumulative multi-line cash-allocation rounding.
- `pnpm run lint`, `pnpm run typecheck`, `pnpm run build`, and `git diff --check` passed.
- Compiled API and web smoke checks passed.

## P-001 executed validation

Validated against a fresh disposable PostgreSQL 16 database on 2026-08-22:

- Frozen pnpm installation and the approved Prisma/esbuild rebuild completed successfully.
- Prisma schema validation and generation passed; both migrations deployed and status reported current.
- All 59 P-001, P-000A, P-000, API/security, and PostgreSQL integration tests passed.
- The deterministic Suncoast master tests prove the opening position, monthly cash targets and category totals, natural accrual results, operational lifecycles, source identity, A/R control, zero Undeposited Funds, card treatment, statement reconciliations, ledger statements, and instructor-data secrecy.
- Final review fixed a statement-independence defect: checking and Visa endpoints are now fixed authoritative case facts rather than values derived from the ledger being reconciled, with fail-closed mismatch coverage.
- `pnpm run lint`, `pnpm run typecheck`, `pnpm run build`, and `git diff --check` passed.
- Compiled API and web smoke checks passed.
