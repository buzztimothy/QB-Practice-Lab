# Guarded Preview invitation recovery

This operator workflow replaces one unusable invitation for an existing, approved, still-INVITED student. It is separate from normal `preview:invite` idempotency. It revokes the specified old provider invitation and requests one replacement notification using the existing hosted Clerk signup target, returning to `/auth/callback`. It does not activate/deactivate a student, create a Clerk user, mapping, session or attempt, or change accounting/source records.

## Preconditions and command

Obtain separate owner approval for the exact student and old provider invitation before execution. Pause invitation acceptance during recovery. Build the reviewed checkout, then use the protected Preview operator environment:

```text
pnpm preview:recover-invitation -- --student-id <approved-id> --confirm <same-approved-id> --old-invitation-id <expected-provider-id>
```

All three arguments are required exactly once. Confirmation must exactly match the student ID. Unknown/extra arguments, wildcard/bulk targets and default targets are rejected. There is no dry-run flag: this command can send an invitation. Never use it for read-only inspection.

The environment uses the same runtime and direct operator-database guards as [emergency deactivation](PREVIEW-DEACTIVATION.md): production Preview runtime, exact application origin, durable runtime enabled, local authentication disabled, compatible canonical version, valid session TTL and configured Clerk values. `CLERK_SIGN_IN_URL` must be the configured HTTPS `/sign-in` base with no query/fragment; the existing portal helper derives hosted signup. `DATABASE_URL` must be the TLS-required direct connection for database `bbb_practice_preview`, role `bbb_preview_deploy_lp`, matching `PREVIEW_DATABASE_HOST`, with `PREVIEW_DATABASE_CONFIRMATION=bbb_practice_preview`. Supply credentials only through the protected environment; never arguments, logs, or repository files. Do not replace Render's runtime credentials to run this command.

The service requires the same normalized approved email and Clerk application invitation, status SENT, exact old provider ID, no consumed identity, no identity links, no application sessions (including revoked/expired history), and no runtime or ledger attempts. ACTIVE/DEACTIVATED students are rejected. Provider inventory must show no user, a pending/revoked/expired old invitation, no unrelated pending invitation, and at most one valid correlated replacement. Incomplete inventory or unrecognized state blocks recovery.

## Durable journal and exchange coordination

`InvitationRecovery` retains operation UUID, student, approved email, provider, application invitation ID, old/replacement provider IDs, phase, status, bounded failure and timestamps. The email stays in the protected database and is omitted from CLI output. Only the opaque operation UUID is sent as Clerk `publicMetadata.recoveryOperationId`; public metadata may later appear on the Clerk user. No identity, ticket or credential is included in that metadata.

Phases:

| Phase | Meaning / restart behavior |
| --- | --- |
| CLAIMED | Intent exists before any provider mutation; inspect old invitation. |
| OLD_REVOCATION_PENDING | A worker reserved the sole revoke attempt. Query provider; continue only once old invitation is revoked/expired. |
| OLD_REVOKED | Old invitation is non-usable; reserve the sole create attempt. |
| REPLACEMENT_CREATE_PENDING | Creation may have happened; adopt exactly one correlated pending replacement, otherwise block. |
| REPLACEMENT_IDENTIFIED | Replacement ID is durably recorded and cannot be changed. Revalidate provider evidence. |
| LOCAL_RECONCILIATION_PENDING | Revalidate local guards, then atomically update current invitation reference and complete the journal. |
| COMPLETED | Historical success; repeated invocation returns that result without provider mutation. |

Status is ACTIVE, BLOCKED or COMPLETED. BLOCKED preserves the precise phase and bounded failure. PostgreSQL enforces one unresolved operation per invitation, unique provider/old ID, unique replacement ID, immutable journal identity and write-once replacement ID. Deletes and updates to completed journal rows are rejected; foreign keys restrict deletion/update of referenced identities. Completion requires a replacement and completion timestamp. Existing application invitation ID and preauthorization are preserved; only its current provider reference changes at completion.

Recovery and authentication exchange use the same per-student transaction advisory lock. Exchange checks for any unresolved recovery before modifying mappings/status/sessions, and returns the existing bounded authentication failure. If exchange wins first and activates the student, recovery preconditions fail. If recovery wins first, exchange stays blocked until completion. Normal students without recovery remain on the existing exchange path. Normal invite idempotency is unchanged.

## Failures and reconciliation

PostgreSQL and Clerk are not one transaction. Compare-and-set phase transitions reserve external calls before they execute; concurrent/restarted commands do not blindly repeat them. Provider errors are reduced to fixed classifications; URLs, tokens and raw errors never enter the journal or output.

| Failure | Safe outcome |
| --- | --- |
| Revoke fails or response is lost | Remain pending/blocked; a subsequent invocation queries provider. Pending old invitation is insufficient to retry revocation. |
| Create fails or response is lost | Remain pending/blocked; resume only by finding exactly one correlated pending replacement. Zero candidates is not proof that creation never happened. |
| Provider succeeds but local persistence fails | Durable intent and opaque correlation allow adoption on restart without another creation. |
| Final local transaction fails | Invitation reference and journal completion both roll back; resume using the recorded replacement. |
| Multiple candidates, missing metadata, accepted identity, conflicting state, unavailable/incomplete inventory | Block and require read-only operator/provider reconciliation. Exchange remains closed. |
| Journal write/read fails | Return bounded failure. Do not assume no provider action occurred; inspect the durable phase after database recovery. |

Re-running the **same exact command**, only when authorized, reconciles the existing operation; it does not reset a pending call. The implementation intentionally has no force/reset/resend override. Even an explicit provider error is treated conservatively because the API does not supply a transactional creation guarantee. A crash after reserving intent but before sending the request can therefore require a separately reviewed remediation. Never delete a journal row, rewrite provider IDs, or use normal invite to bypass this block.

Exit zero means journal COMPLETED. Output contains only student/operation/provider invitation IDs, phase/status, bounded failure and success. A historical completed result does not certify current invitation acceptance or email delivery. Exit nonzero requires inspection; do not infer that no provider effect occurred. Do not copy complete provider responses, invitation URLs or tickets into incident reports.

## Migration and rollout boundaries

Migration `202609210001_invitation_recovery_journal` adds three enum types, one table, its primary key, two restrictive foreign keys, two checks, three unique indexes (one partial), one lookup index, and the history-protection function/trigger. It does not update existing invitations, students, accounting or canonical/source rows. No manual transformation of existing Preview lifecycle data is required.

Future adoption must apply the reviewed migration before starting code that queries the journal, regenerate Prisma/build, and verify runtime SELECT access to the new table. The existing Preview grants/default-privileges process provides runtime reads; journal writes remain operator-only. Validate actual grants during separately authorized deployment. No production grants are changed by this migration.

For disposable role validation, provision the two named login roles without superuser, database/role creation, bypass-RLS or inherited role memberships; migrate as `bbb_preview_deploy_lp`. Run the recovery database test with its guarded local `DATABASE_URL`, `DATABASE_LIFECYCLE_MARKER=disposable-test` and `RECOVERY_ROLE_VALIDATION=true`. That case applies the existing grant mechanism as deploy, proves operator recovery/final reconciliation, proves runtime exchange reads the block and resumes after completion, and rejects runtime journal writes/deletion/truncation, source writes, DDL and role/database creation. It grants no new runtime accounting permissions and requires no sequence for the UUID journal.

Do not roll back to exchange code without the recovery block while any operation is unresolved. Retain journal history on rollback; dropping the table loses reconciliation evidence and is not a safe rollback procedure. Prefer a reviewed forward fix. Restore from backup only under a separately reviewed plan that reconciles external Clerk effects; a database restore cannot undo sent invitations or revocation.

Tests use fake provider calls and explicitly marked local disposable PostgreSQL only. Live recovery, provider acceptance behavior and notification delivery require a separate owner-approved checkpoint after review/deployment. This implementation run does not authorize those actions.
