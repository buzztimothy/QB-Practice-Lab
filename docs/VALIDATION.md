# P-000 validation gates

1. Template immutability: domain instantiation tests compare source before/after; PostgreSQL update/delete triggers reject mutations.
2. Ledger integrity: integer-cent validation rejects malformed/imbalanced lines before persistence; deferred constraint trigger rejects unbalanced commits atomically; reports derive only from journal lines.
3. Isolation: authenticated identity is supplied by the API context; owned lookup hides absent vs foreign attempts; attempt-scoped account validation and composite database keys reject cross-attempt references.
4. Instructor secrecy: separate instructor columns are absent from student domain/API types; fixed errors omit source data; adversarial serialization tests reject instructor vocabulary and fixture secrets.

## Executed validation

Validated against PostgreSQL 16 on 2026-08-18:

- `prisma validate`, `prisma generate`, `prisma migrate deploy`, and `prisma migrate status` passed; the database schema is current at `202608150001_p000_foundation`.
- `pnpm run test:db` passed all 5 PostgreSQL enforcement tests.
- `pnpm run test` passed all 16 unit, API, and database integration tests, including every approval gate above.
- `pnpm run lint`, `pnpm run typecheck`, `pnpm run build`, and `git diff --check` passed.
- Compiled API and web smoke checks passed (`qb-practice-lab-api:ok` and HTTP 200 with the P-000 foundation page).
