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
- All 142 P-005, P-004, P-003, P-002, P-001A, P-001, P-000A, P-000, coaching/adversarial, API/security, and PostgreSQL integration tests passed after final-review help-escalation, cross-context, selective-frequency, and style-neutrality coverage was added.
- P-005 coverage proves student-requested sent-message and unsent-draft help, selective and reflection modes, COACH-01 through COACH-08, four non-numeric communication dimensions, all three help levels, exact original/follow-up preservation, hidden-answer resistance, Michael/coaching separation, immutable audit, ownership isolation, reset, and absence of final scoring.
- Final review corrected short-request bias, unsupported-certainty observations, and unnecessary improvement advice on already-strong communication.
- Lint, typecheck, production build, `git diff --check`, and compiled API/web smoke tests passed.

## P-006 validation

Validated against a fresh disposable PostgreSQL 16 database on 2026-08-25:

- Frozen pnpm installation and the minimum Prisma/esbuild rebuild passed without lockfile changes.
- Prisma validation and generation passed; both migrations deployed and status reported current.
- All 163 P-006, P-005, P-004, P-003, P-002, P-001A, P-001, P-000A, P-000, assessment/adversarial, API/security, and PostgreSQL integration tests passed after final-review fairness corrections.
- P-006 coverage proves immutable evidence before score, rubric versioning, four supported competency evaluations, Month-End `NOT_ASSESSED`, nuanced help/independence, chronological self-correction, legitimate unchanged controls, source-backed critical states and overrides, bounded close attempts, resolved accounting comparison, threshold overrides, deterministic reassessment/snapshot preservation, student secrecy, ownership isolation, and reset lifecycle separation.
- Final review prevented generic accounting mutations from being inferred correct, prevented post-message coaching from retroactively changing independence, rejected framework-keyword communication gaming, distinguished five self-correction/help outcomes, required investigation evidence before close readiness, and exposed assessed points separately from the 100-point rubric total.
- Lint, typecheck, production build, `git diff --check`, and compiled API/web smoke tests passed.

## P-007 validation

Validated against a fresh disposable PostgreSQL 16 database on 2026-08-25:

- Frozen pnpm installation and the minimum Prisma/esbuild rebuild passed without lockfile changes.
- Prisma generation and validation passed; both migrations deployed and status reported current.
- All 186 P-007, P-006, P-005, P-004, P-003, P-002, P-001A, P-001, P-000A, P-000, final-meeting/adversarial, API/security, and PostgreSQL integration tests passed across 13 files after final-review hardening.
- P-007 coverage proves close-gated entry, current-ledger completion revalidation, resolved financial-package truth, April–June trends, exact independent explanation preservation, 3/2/2/2/1 dimension weighting, concise and alternative strong explanations, keyword-gaming resistance, material-error and unsupported-causation handling, cash/profit distinction, deterministic bounded follow-ups, post-performance help chronology, 100-point P-006 reassessment with historical snapshots intact, overrides, secrecy, ownership isolation, and reset separation.
- Final review added post-close P-002 activity invalidation, rounded 28% and minor-rounding fairness, follow-up professional-boundary assessment, explicit critical-override regression, and complete append-only meeting/assessment audit coverage with private trigger events removed from the student projection.
- Lint, typecheck, production build, `git diff --check`, and compiled API/web smoke tests passed.

## P-008 validation

Validated against a fresh disposable PostgreSQL 16 database on 2026-08-25:

- Frozen pnpm installation and the minimum Prisma/esbuild rebuild passed without lockfile changes.
- Prisma generation and validation passed; both migrations deployed and status reported current.
- All 208 P-008 through P-000 unit, adversarial, API/security, and PostgreSQL integration tests passed across 14 files. The 17 database enforcement tests passed directly against PostgreSQL.
- P-008 coverage proves all six canonical classifications and display labels, deterministic competency interpretations, authoritative point presentation, evidence-grounded strengths and development guidance, qualitative help and self-correction summaries, bounded critical-risk language, instructor-data secrecy, immutable/versioned reports, idempotent generation, retry separation, malformed-input rejection, and server-side ownership isolation.
- Final review removed unsupported communication inferences, made help-dependence wording follow the authoritative competency result, distinguished coached from independent critical self-correction, represented all five P-007 explanation dimensions, bounded Client Ready as a Lab 1 recommendation rather than a credential or guarantee, and added fail-closed evidence/weight provenance validation.
- Lint, typecheck, production build, `git diff --check`, and compiled API/web smoke tests passed.

## P-008A validation

Validated against a fresh disposable PostgreSQL 16 database on 2026-08-27:

- Frozen pnpm installation and the minimum Prisma/esbuild rebuild passed without lockfile changes. Prisma generation and validation passed; both migrations deployed and status reported current.
- All 228 P-008A through P-000 unit, integration, adversarial, API/security, and PostgreSQL tests passed across 15 files. The 17 database enforcement tests passed directly against PostgreSQL.
- The 19 command-foundation tests prove bank review/match/categorize/transfer/exclude, bounded corrections and voids, Reynolds reapplication, loan/payroll compound corrections, evidence-gated ABC/personal decisions, COA consolidation, store-level optimistic concurrency, idempotency, atomic failure, immutable assessment chronology, historical reconciliation repair, zero-difference completion, protected resolution, and command-authorized Close → Final Meeting → Results reachability.
- Student projections were hardened to omit template-account provenance as well as command fingerprints, private before/after snapshots, critical hooks, scenario identifiers, and completed-reconciliation fingerprints.
- Final review constrained every fixed-value correction to its intended attempt scenario, blocked generic ledger mutation of operationally linked records, fixed Reynolds target-open/A/R enforcement, made payroll input order deterministic, added compare-and-swap persistence semantics, preserved notes and evidence horizons in private provenance, retained critical guesses through later correction, and withheld the personal-equity account from command DTOs until clarification.
- Lint, typecheck, production build, `git diff --check`, and compiled API/web smoke tests passed.

## P-009A validation

Validated against a fresh disposable PostgreSQL 16 database on 2026-08-27:

- Frozen pnpm installation completed without dependency or lockfile changes. Prisma generation and schema validation passed; both migrations deployed and status reported current.
- All 243 P-009A through P-000 unit, integration, adversarial, API/security, and PostgreSQL tests passed across 17 files in the authoritative final-review serial run. The 17 database enforcement tests passed directly against PostgreSQL.
- P-009A coverage proves safe unauthenticated failure, two distinct opaque HttpOnly sessions and principals, refresh persistence, local session replacement and logout revocation, server-enforced expiry and replay denial, secure-cookie policy, explicit development opt-in, production disabling of the fictional selector, exact-Origin CSRF enforcement, browser-controlled spoof resistance, cross-student command/reset and copied-route denial, and identical foreign/nonexistent responses across attempt, transaction, document, conversation, coaching, meeting, and Results surfaces.
- Final review corrected two security defects before merge: state-changing cookie-authenticated requests now fail closed without an exact allowed Origin, and the fictional local provider now requires explicit opt-in rather than activating whenever `NODE_ENV` is absent.
- Lint, typecheck, production build, and `git diff --check` passed. Compiled API/web smoke checks proved API health, unauthenticated `401`, independent Student A and Student B attempts in separate cookie jars, and bounded `404` foreign access.

## D-000R validation

Validated against a fresh disposable PostgreSQL 16 database on 2026-08-28:

- Frozen pnpm installation completed without dependency or lockfile changes. Prisma schema validation and generation passed; all three committed migrations deployed from empty and status reported current.
- The authoritative serial suite passed all 253 P-000 through D-000R unit, integration, adversarial, API/security, and PostgreSQL tests across 19 files.
- Seven durable-runtime integration tests prove multi-instance restart rehydration, compare-and-swap/idempotency, cross-student denial, immutable reset history, relational ledger/subledger authority with no runtime `accounting_state`, preserved completed-reconciliation evidence, hashed sessions, immutable snapshots/audit history, and actual canonical-content tamper detection.
- The database-backed P-009 Start → Results → Reset behavioral oracle passed using only student-facing application actions. The 17 P-000/P-000A database enforcement tests remained green.
- Final review expanded the deterministic canonical digest to the actual Michael facts/responses, coaching rules and content, P-006 rubric/scenario/critical definitions, and P-008 report labels. Representative mutations change the digest, and an installed same-version prior manifest failed closed with `Canonical bootstrap conflict`.
- Lint, typecheck, production build, and `git diff --check` passed. Compiled API/web smoke checks proved liveness/readiness, unauthenticated `401`, distinct Student A/B sessions and attempts, and bounded `404` foreign access.
