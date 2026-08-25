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

## P-001A executed validation

Validated against a fresh disposable PostgreSQL 16 database on 2026-08-24:

- Frozen pnpm installation and the minimum Prisma/esbuild rebuild completed without changing the lockfile.
- Prisma schema validation and generation passed; both migrations deployed and status reported current.
- All 65 P-001A, P-001, P-000A, P-000, API/security, and PostgreSQL integration tests passed. P-001A coverage proves component identities, balanced payroll journals, exact provider withdrawals, intentional zero ending payroll liability, updated June cash/accrual statements and June 30 Balance Sheet, independent zero-difference checking reconciliation, absence of duplicate expense or plugs, and protection of structured payroll answers from student-facing operational/document serialization.
- Lint, typecheck, production build, and `git diff --check` passed.
- Compiled API and web smoke checks passed.

## P-002 validation

Validated against a fresh disposable PostgreSQL 16 database on 2026-08-25:

- Frozen pnpm installation and the minimum Prisma/esbuild rebuild passed without changing the lockfile.
- Prisma validation and generation passed; both migrations deployed and status reported current.
- All 94 P-002, P-001A, P-001, P-000A, P-000, scenario/adversarial, API/security, and PostgreSQL integration tests passed.
- P-002 coverage includes all twenty controls, protected transformation provenance, natural financial/reconciliation consequences, critical-evidence hooks without scoring, adversarial serialization, deterministic derivation, reset/history preservation, attempt isolation, and clean resolution without plugs.
- Lint, typecheck, production build, `git diff --check`, and compiled API/web smoke tests passed.

## P-003 validation

Validated against a fresh disposable PostgreSQL 16 database on 2026-08-25:

- Prisma schema validation and generation passed; both migrations deployed and status reported current.
- All 102 P-003, P-002, P-001A, P-001, P-000A, P-000, API/security, and PostgreSQL integration tests passed after final-review deep-immutability coverage was added.
- P-003 coverage proves the exact Day 1 inventory, independent checking/card statement truth, attempt-owned evidence references, source distinctions, protected payroll/ABC/personal-card unlock flows, fail-closed hidden-document access, append-only audit history, cross-attempt isolation, reset relocking, clean-master preservation, and unchanged P-002 financial state.
- Lint, typecheck, production build, `git diff --check`, and compiled API/web smoke tests passed.

## P-004 validation

Validated against a fresh disposable PostgreSQL 16 database on 2026-08-25:

- Frozen pnpm installation and the minimum Prisma/esbuild rebuild passed without lockfile changes.
- Prisma validation and generation passed; both migrations deployed and status reported current.
- All 121 P-004, P-003, P-002, P-001A, P-001, P-000A, P-000, conversation/adversarial, API/security, and PostgreSQL integration tests passed after final-review manipulation and repeated-question coverage was added.
- P-004 coverage proves INT-01 through INT-10, exact student-authored history, bounded intent recognition, authorized disclosure, safe unsupported behavior, allowlisted evidence unlocks, private deterministic client triggers, append-only audit, server-side ownership, cross-attempt rejection, reset, instructor secrecy, and unchanged accounting/evidence state.
- Integration review removed an answer-key leak from the P-003 personal-card clarification: the document retains the authoritative personal-purpose fact but no longer tells the student to use `Owner Draws`.
- Final review replaced unbounded intent substrings with bounded patterns after proving that `for` inside a word such as `information` could misauthorize an ABC purpose disclosure.
- Lint, typecheck, production build, `git diff --check`, and compiled API/web smoke tests passed.

## P-005 validation

Validated against a fresh disposable PostgreSQL 16 database on 2026-08-25:

- Frozen pnpm installation and the minimum Prisma/esbuild rebuild passed without lockfile changes.
- Prisma validation and generation passed; both migrations deployed and status reported current.
- All 140 P-005, P-004, P-003, P-002, P-001A, P-001, P-000A, P-000, coaching/adversarial, API/security, and PostgreSQL integration tests passed.
- P-005 coverage proves student-requested sent-message and unsent-draft help, selective and reflection modes, COACH-01 through COACH-08, four non-numeric communication dimensions, all three help levels, exact original/follow-up preservation, hidden-answer resistance, Michael/coaching separation, immutable audit, ownership isolation, reset, and absence of final scoring.
- Lint, typecheck, production build, `git diff --check`, and compiled API/web smoke tests passed.
