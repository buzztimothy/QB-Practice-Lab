# Emergency Preview student deactivation

Operator-only containment for one explicitly approved application student. This command invokes the existing `PreviewProvisioningService.deactivate`; it performs no Clerk API action.

Build the reviewed checkout with `pnpm build`, then in the protected Preview operator environment run:

```text
pnpm preview:deactivate -- --student-id <approved-id> --confirm <same-approved-id>
```

Both arguments are required and must match exactly. Unknown, duplicate, extra, wildcard, and bulk arguments are rejected. There is no default target or dry-run mode. Obtain owner approval for the exact ID first and verify its identity with a read-only lookup. Quiesce that student's activity before comparing preservation counts; an already-authenticated in-flight request is not canceled by this command.

The environment must satisfy the existing production runtime configuration validator: `NODE_ENV=production`, `DEPLOYMENT_TARGET=preview`, `DURABLE_RUNTIME_ENABLED=true`, local auth absent/false, exact `APP_ORIGIN=https://preview.clientpracticelabs.com`, compatible `CANONICAL_LAB_VERSION`, valid `SESSION_TTL_SECONDS`, and all configured Clerk runtime values. These checks do not change any configuration. Clerk configuration is required by the existing validator/constructor, but no provider call is made.

Use the protected operator/deploy database connection as `DATABASE_URL`, not Render's runtime connection: required TLS, database `bbb_practice_preview`, role `bbb_preview_deploy_lp`, direct non-pooler hostname. Set `PREVIEW_DATABASE_CONFIRMATION=bbb_practice_preview` and `PREVIEW_DATABASE_HOST` to that exact approved hostname. The existing deployment database guard is applied. Supply credentials through the protected environment, never command arguments or logs. Do not copy deployment credentials into Render or alter Render configuration to run this command.

Expected result: student `DEACTIVATED`, active links zero, unrevoked application sessions zero; pending/sent application invitations become `REVOKED`. Attempts, accounting, audit/history, snapshots, and published source remain intact. Output contains only target ID, before/after status and counts, and `success`. Exit zero means verified postconditions; nonzero means failure and requires inspection before retry. A post-read failure can occur after deactivation committed: do not assume a failure exit means no change. Counts are evidence, not a substitute for content-integrity checks.

Deactivation is effectively terminal at the application layer without a separately reviewed reactivation procedure. Provider-side Clerk ban/deletion, invitation revocation, and session actions are separate owner actions; this command does not perform them. It does not remove any user or history.

Validation must use a local disposable test database satisfying `assertDisposableTestDatabase`. Never point integration tests at Preview. The CLI's production guard has no test bypass; integration tests exercise the same adapter and real service directly in the guarded disposable database.
