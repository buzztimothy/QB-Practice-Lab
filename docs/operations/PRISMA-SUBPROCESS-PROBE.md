# Protected read-only Prisma subprocess probe

This manual diagnostic tests the launcher, minimal child environment, pinned Prisma schema-engine TLS connection and exact Preview identity. It cannot establish that a future migration will succeed. The historical cause of installer run 44563637263 remains unresolved.

## Approval procedure

Review and merge the probe PR through normal main protection and require hosted CI to pass. Obtain separate owner authorization for one execution at the resulting full protected-main SHA. Keep Render and external operators idle and preserve the release/operator freeze.

Before dispatch, verify that existing environment `bbb-preview-deploy` has `buzztimothy` as required reviewer, a main-only branch restriction and disabled administrator bypass. YAML references this environment; GitHub enforces its configured approval rules.

Select **Read-only Preview Prisma subprocess probe** in Actions, choose main, enter the exact reviewed SHA and `ALL_OPERATORS_IDLE_FREEZE_UNTIL_VERIFIED`. The owner then approves only this pending environment job. Reruns are rejected. Any failure requires diagnosis and separate authorization; there is no retry or repair path.

## Execution and output

The workflow builds without Preview credentials. Its sole credentialed step validates source, protected main, exact SHA, first manual attempt, freeze input, and all non-completed Actions runs. A competing or truncated inventory fails closed. These checks run again after the subprocess.

The original URL passes the shared `strictPreviewDatabaseUrl` guard before deriving `sslmode=require&sslaccept=strict`. The child receives only PATH, HOME and this derived DATABASE_URL. It runs exactly `pnpm exec prisma db execute --schema prisma/schema.prisma --stdin`, with this fixed stdin.

```sql
SELECT 1 / CASE
  WHEN current_database() = 'bbb_practice_preview'
   AND current_user = 'bbb_preview_deploy_lp'
  THEN 1 ELSE 0
END;
```

The expression succeeds only for the exact live database and deploy role. Other identities raise a SQL error. The statement has no mutable functions, arbitrary input, migration command, DDL, grants, record writes or ledger access. The probe entry point calls only the read-only command wrapper; it never calls the migration wrapper.

Output is capped at 32 KiB per stream, kept only in memory, and discarded after classification. Missing/failed stdin, truncated or unreadable output, nonzero exit, signal, timeout, unsupported connector, target drift or release-guard failure blocks PASS. Raw Node and provider output are suppressed by the workflow. Fixed `PRISMA_PROBE_*` labels cover these categories. Native SQL errors without a recognized Prisma code, including the tested division-by-zero identity failure, produce `PRISMA_PROBE_UNKNOWN_FAILED`. `PRISMA_PROBE_SQL_OR_IDENTITY_FAILED` does not assert that every SQL failure is an identity mismatch.

Existing credentials and system certificate roots are reused. No secret, environment configuration, migration history or application data changes are part of this probe. Passing verifies only this SELECT-only connection on that runner at that time. Future installation still requires fresh gates, baselines and separate authorization.

## Validation

Unit tests assert exact command/stdin/environment and reject unexpected dispatch, source, run-inventory and URL inputs. Disposable tests generate local certificates and verify success, untrusted-certificate rejection, authentication failure and incorrect identity. The fixed Preview database name exists only in a newly created loopback-bound Docker fixture for this exact SQL test; no general disposable-target guard is changed. GitHub/Linux tests invoke pnpm itself. Windows tests invoke the same pinned Prisma CLI through Node because pnpm uses a Windows command shim.
