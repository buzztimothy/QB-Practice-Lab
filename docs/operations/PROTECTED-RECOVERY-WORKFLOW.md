# Protected Preview recovery workflow

This workflow is exclusively for the initial Student A operation. It does not deploy, migrate, grant permissions, or support arbitrary targets. It must be reviewed/merged separately from owner authorization to dispatch it. Do not use the old invitation while recovery is being prepared or executed.

## Fixed scope

- Repository: `buzztimothy/QB-Practice-Lab`, protected `main` only.
- Student: `d003-student-26664e0d-446f-4492-89de-f37e5d872292`.
- Original invitation: `inv_3JSadnQYTpN5k38Kcuns1OWeCQk`.
- Clerk instance: `ins_3IjC30Mkgc6IcgFSbN6n7Db0jNm`, the Production-classified instance assigned to Practice Lab Preview. Owner must verify this historical identifier against the dashboard before setup. A mismatch requires review, not replacing the pin to bypass a failed gate.
- Preview origin: `https://preview.clientpracticelabs.com`.
- Direct Neon host: `ep-lively-snow-ayhwi8xr.c-5.us-east-2.aws.neon.tech`.
- Database/role: `bbb_practice_preview` / `bbb_preview_deploy_lp`.

The approved SHA is the **new reviewed main commit containing this workflow**, not the older application-only commit. Both dispatch modes must use that same exact current main SHA; any main change invalidates the prior preflight. This workflow does not itself update the deployed application. Check compatibility and release inactivity before approval.

## Owner setup (separate authorization)

1. Review and merge the workflow PR through normal protections. Do not dispatch yet.
2. In GitHub repository Settings → Environments, create `bbb-preview-recovery`.
3. Require reviewer `buzztimothy`, restrict selected deployment branches to `main` (branch, no tags), disable administrator bypass. If the same owner dispatches and approves, leave Prevent self-review unchecked. Owner approval must be performed by the owner, never by automation. Verify these protections before any dispatch; YAML cannot create or enforce environment reviewer settings.
4. Populate only this environment's secrets and variables from the approved Preview configuration, directly through protected handling. Never paste values into chat, arguments, logs, issues or repository files. Do not change Render's runtime database connection.

Environment secrets:

| Name | Source/purpose |
| --- | --- |
| `DIRECT_DATABASE_URL` | Existing Preview direct deploy-role URL, pooling OFF, TLS required; mapped to process `DATABASE_URL` only in the guarded step |
| `CLERK_SECRET_KEY` | Existing key for the pinned Practice Lab Preview Clerk instance |
| `CLERK_JWT_KEY` | Existing Preview JWT verification key; required by the unchanged shared CLI configuration parser |
| `CLERK_WEBHOOK_SIGNING_SECRET` | Existing Preview webhook credential; required by that parser, not used for recovery calls |

Environment variables (no credentials): `PREVIEW_DATABASE_HOST`, `CANONICAL_LAB_VERSION`, `SESSION_TTL_SECONDS`, `CLERK_INSTANCE_ID`, `CLERK_ISSUER`, `CLERK_AUDIENCE`, `CLERK_SIGN_IN_URL`, `CLERK_PUBLISHABLE_KEY`.

Copy current approved values; `CLERK_SIGN_IN_URL` must be the HTTPS Account Portal `/sign-in` base without query/fragment. Runtime flags, application origin, authorized party and database confirmation are fixed in YAML. The parser's extra JWT/webhook dependencies are preserved to avoid unrelated authentication changes. No new database grants are made: the existing reviewed operator role is required. It owns schema objects and is broader than a hypothetical recovery-only role; narrower role adoption would require a separate reviewed guard/grant change. Never use an administrator credential instead.

## Two independent dispatches

1. Confirm no external deployment/migration or invitation acceptance is in progress. Select Actions → Preview invitation recovery → Run workflow, branch `main`, mode `preflight`, exact reviewed `main_sha`. Leave other inputs empty. Approve `bbb-preview-recovery` after checking the SHA/mode.
2. Preflight validates source, configuration, authenticated Clerk instance/domain/key consistency, database identity/role, applied journal migration, runtime journal permissions, Student A/B eligibility and empty recovery history. It uses the existing provider `inspect()` only; it never invokes `recover()` or the recovery CLI. Record the successful run ID and bounded result. A successful preflight is a point-in-time observation, not permanent eligibility.
3. Obtain separate owner authorization to revoke the old invitation and request one replacement notification. Start a **new dispatch**, mode `execute`, same current reviewed SHA, successful `preflight_run_id`, and `confirm_student` equal to the fixed Student A ID. Approve the environment again. Do not approve acceptance/sign-in during this operation.
4. Execute verifies the prior run belongs to this workflow, was a first-attempt manual preflight at the same SHA and completed successfully. It repeats live guards, invokes the existing guarded CLI exactly once and checks completion plus data preservation. No mode can change its own dispatch into execution.

The single invocation is:

```text
node dist/scripts/recover-preview-invitation.js --student-id d003-student-26664e0d-446f-4492-89de-f37e5d872292 --confirm d003-student-26664e0d-446f-4492-89de-f37e5d872292 --old-invitation-id inv_3JSadnQYTpN5k38Kcuns1OWeCQk
```

## Safety and evidence

GitHub read-only token permissions, commit-pinned actions, step-scoped operator credentials, no credentialed install/test hooks, and no persisted checkout token. Recovery shares the existing deployment concurrency group and database session advisory lock; the existing deployment workflow is unchanged. External tools that do not honor the lock still require owner release coordination. Do not cancel an active execute job; interrupted operations require inspection.

Clerk `instance.get()` must return the exact pinned ID and Production classification. Authenticated domain inventory must be complete and match configured issuer/Account Portal; the live publishable key must encode that issuer host. No other instance is permitted. Provider inventory must show no user, the exact pending original invitation, no other pending invitation and no previous recovery correlation.

The initial workflow refuses **any existing recovery journal row**, including completed history. Workflow reruns are rejected (`run_attempt` must be 1); automatic retries are absent. This deliberately does not provide a recovery-resume mechanism. A timeout or failure may follow provider mutation: do not rerun or delete journal history. Inspect bounded journal phase/status and provider inventory read-only, then obtain separately reviewed reconciliation instructions.

CLI output is discarded; only an allowlisted success classification or failure stage is logged. No provider responses, URLs, emails, tickets, connection strings, child output or secret values are logged or uploaded as artifacts. Failure output does not assert that nothing happened. The service's durable journal remains the reconciliation record.

Postchecks require one completed journal for the exact old/new IDs, unchanged application invitation ID, pending correlated replacement, unusable old invitation, no Clerk user, Student A still INVITED/SENT with zero mappings/sessions/attempts, and Student B absent. Database-side row fingerprints cover all public application tables except the new journal, permitting only Student A's invitation provider reference and updated timestamp to change. This protects existing audit, accounting, canonical/source and unrelated lifecycle rows; fingerprints stay in memory, not artifacts. It does not prove email delivery or invitation acceptance.

Stop after the bounded result. Student acceptance and all later lifecycle work require separate authorization. Tests must use simulated Clerk and explicitly disposable local PostgreSQL; never run this workflow as a test against Preview.
