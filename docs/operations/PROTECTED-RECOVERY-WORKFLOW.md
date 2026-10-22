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

## Required coordination rollout (not performed by this PR)

Migration `202610220001_preview_release_fence` adds one operator-only singleton metadata table and its initial unheld row. It does not change students, invitations, accounting or canonical data, and grants no new privileges. Both the corrected deployment script and recovery runner require this table and **fail closed when it is missing**. The recovery workflow never installs it. The corrected deployment script intentionally cannot bootstrap its own missing fence through its normal entrypoint.

Before enabling either corrected operator, obtain separate rollout authorization: quiesce all older deployment/operator processes; install the reviewed metadata migration through a separately reviewed direct deploy-role migration procedure; verify the singleton is unheld and runtime has no write permissions; then adopt both corrected entrypoints together. Do not use the old deployment script concurrently with recovery: an old binary does not consult the durable fence. This bootstrap/rollout is an explicit readiness gate, not permission to run ad hoc SQL or weaken a guard. No live migration or rollout is authorized by opening this PR.

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
4. Execute queries authenticated GitHub run, workflow and attempt-specific job metadata. It requires the requested run ID, repository/head repository, exact workflow ID/path, first manual attempt, same SHA/main branch, and a successful `recovery preflight` job whose guarded step and preflight-only completion marker both succeeded. Display titles are not used as proof. It repeats live guards, invokes the existing guarded CLI exactly once and checks completion plus data preservation. No mode can change its own dispatch into execution.

The single invocation is:

```text
node dist/scripts/recover-preview-invitation.js --student-id d003-student-26664e0d-446f-4492-89de-f37e5d872292 --confirm d003-student-26664e0d-446f-4492-89de-f37e5d872292 --old-invitation-id inv_3JSadnQYTpN5k38Kcuns1OWeCQk
```

## Safety and evidence

GitHub read-only token permissions, commit-pinned actions, step-scoped operator credentials, no credentialed install/test hooks, and no persisted checkout token. Recovery shares the existing deployment concurrency group. Both database operator entrypoints now use `withPreviewReleaseLock`; the deployment workflow YAML is unchanged.

The shared helper uses session advisory key `6982806162030449104` inside an interactive transaction on a dedicated Prisma client. Acquire, PID verification and unlock use that transaction's connection; the dedicated client is disconnected even if a timeout makes transactional unlock impossible. Session locks do not disappear on rollback alone, so transaction scope by itself was insufficient.

Before any mutating work, a separate database connection commits the singleton HELD fence. It survives transaction timeout, lock-session termination, runner/process failure and potentially outstanding child/provider work. Only fully awaited successful work (child `close`, not merely `exit`), followed by a valid same-session transaction probe, can clear the fence. Failure never clears it. No timeout, expiry or new dispatch can steal a HELD fence. Preflight only reads this metadata and takes the transient advisory lock; it does not write a fence.

A provider request already sent cannot be canceled transactionally. The guarantee is therefore fail-closed exclusion of subsequent **corrected** recovery/deployment operators, not rollback/cancellation of that request. A stopped job with a HELD fence requires read-only process/provider/journal/migration reconciliation and separate owner-reviewed release instructions; no reset command is provided. External tools or old binaries that ignore the fence cannot be constrained by it. Owner release coordination remains necessary. The database fence covers database/operator work, not the later Render build; GitHub concurrency and owner verification cover that release boundary.

Clerk `instance.get()` must return the exact pinned ID and Production classification. Authenticated domain inventory must be complete and match configured issuer/Account Portal; the live publishable key must encode that issuer host. No other instance is permitted. Provider inventory must show no user, the exact pending original invitation, no other pending invitation and no previous recovery correlation.

The initial workflow refuses **any existing recovery journal row**, including completed history. Workflow reruns are rejected (`run_attempt` must be 1); automatic retries are absent. This deliberately does not provide a recovery-resume mechanism. A timeout or failure may follow provider mutation: do not rerun or delete journal history. Inspect bounded journal phase/status and provider inventory read-only, then obtain separately reviewed reconciliation instructions.

CLI output is discarded; only an allowlisted success classification or failure stage is logged. No provider responses, URLs, emails, tickets, connection strings, child output or secret values are logged or uploaded as artifacts. Failure output does not assert that nothing happened. The service's durable journal remains the reconciliation record.

Postchecks require one completed journal for the exact old/new IDs, unchanged application invitation ID, pending correlated replacement, unusable old invitation, no Clerk user, Student A still INVITED/SENT with zero mappings/sessions/attempts, and Student B absent. Database-side row fingerprints cover all public application tables except migration/operator-fence metadata and the new journal, permitting only Student A's invitation provider reference and updated timestamp to change. This protects existing audit, accounting, canonical/source and unrelated lifecycle rows; fingerprints stay in memory, not artifacts. It does not prove email delivery or invitation acceptance.

Stop after the bounded result. Student acceptance and all later lifecycle work require separate authorization. Tests must use simulated Clerk and explicitly disposable local PostgreSQL; never run this workflow as a test against Preview.
