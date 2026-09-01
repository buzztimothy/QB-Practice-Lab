# D-002B Preview Provisioning Contract

This runbook is an input to a separately authorized D-002B. It performs no provisioning by itself. D-002B starts only from reviewed, merged `main` containing D-002A and must stop on any material conflict with D-001.

## Fixed topology

- Authoritative Preview origin: `https://preview.clientpracticelabs.com`
- Reserved future Production origin: `https://app.clientpracticelabs.com` (do not configure)
- Root `https://clientpracticelabs.com`: reserved for a future public/product site
- Authentication: a Clerk Pro **Production** instance in restricted/invite-only mode
- Persistence: one Neon Launch project with a long-lived `preview` branch and `bbb_practice_preview` database
- Compute: one Render Starter raw-Node service sourced only from reviewed `main`
- DNS: the minimum Cloudflare record required to attach the Preview hostname to Render

The Render-provided hostname may be used for bounded infrastructure diagnostics. It is never `APP_ORIGIN`, a Clerk redirect, an authorized party, or an authenticated student origin.

## Ordered external actions

1. **Checkpoint B1 — terms and owner confirmation.** Reconfirm current Clerk Pro, Neon Launch, and Render Starter terms and D-001 requirements. The existing authority covers only those plans. Stop for new approval before any higher tier, optional paid Neon feature beyond Launch requirements, Render add-on/instance, Clerk add-on/tier, Cloudflare paid upgrade, or domain purchase. Stop rather than silently changing provider, region, recovery, or trust design.
2. **Checkpoint B2 — Neon.** After B1 is recorded, create the Neon project/branch/database and separate SQL-created `bbb_preview_deploy_lp` and `bbb_preview_runtime_lp` login roles. SQL creation is required so the roles do not inherit Neon's Console-managed `neon_superuser` membership. The deploy role owns `public` and migration-created objects; the runtime role receives `CONNECT` only from the database administrator. Run migrations as deploy; the committed deployment script then revokes runtime schema creation and applies the exact SELECT/DML/sequence grants in `preview-runtime-grants.ts`. Select the nearest compatible Neon/Render regions, record them, enable only the approved Launch recovery window, and prove both roles lack `SUPERUSER`, `CREATEDB`, `CREATEROLE`, `BYPASSRLS`, and `neon_superuser`; also prove runtime DDL, trigger-disable, template/canonical writes, role grants, and migration attempts fail. Render receives only the TLS pooled runtime URL; the protected GitHub environment receives only the direct deploy-role URL and its exact non-pooler hostname as `PREVIEW_DATABASE_HOST`. Stop for review before Render if any privilege test fails.
3. **Checkpoint B3 — Render.** After B2 review, create one Render Starter service from this repository's `main`, with PR previews and automatic deploys disabled. Apply `render.yaml` including Node 22, set its custom hostname to `preview.clientpracticelabs.com`, and keep authenticated traffic unavailable until readiness succeeds. Record the service's exact `*.onrender.com` hostname. Stop for review before DNS if the service, plan, raw-Node process, commit-ref deploy hook, or health gate differs.
4. **Checkpoint B4 — Cloudflare DNS and HTTPS.** After B3 review, create exactly one **CNAME** record: name `preview`, target the exact Render service hostname recorded in B3, TTL Auto, and set **Proxy status to DNS only (gray cloud)** initially. Do not add or alter apex, `app`, or unrelated records. Complete Render custom-domain ownership and managed HTTPS certificate verification while DNS-only. Keep DNS-only through Clerk Production domain verification; any later Cloudflare proxying is a separately reviewed change because it alters the TLS/edge path. Stop before Clerk if DNS, ownership, certificate, or `https://preview.clientpracticelabs.com/health/live` is not healthy.
5. **Checkpoint B5 — Clerk Production.** Only after B4 review, create/activate the Clerk Pro Production instance for the verified controlled Preview domain. Enable restricted/invite-only access, required email verification/recovery, exact callback and return URLs under the authoritative origin, exact authorized party/audience/issuer values, and the signed user lifecycle webhook at `/auth/webhooks/clerk`. Disable public signup and unapproved identity methods. Stop before secrets/deployment until production-domain status and a signed webhook fixture are verified.
6. Put runtime values only in Render encrypted/config variables and deployment values only in the protected `bbb-preview-deploy` GitHub environment. Configure required reviewers. Never expose Preview secrets to pull requests.
7. Manually dispatch `.github/workflows/preview-deploy.yml` from `main`, supplying the exact current 40-character lowercase `main` commit SHA. The job rejects a stale/non-main/ref-like value, rechecks `origin/main` before database mutation, migrates under the session advisory lock, applies least-privilege runtime grants, bootstraps twice, invokes Render with the immutable commit SHA as its deploy-hook `ref`, and waits for the authoritative origin's readiness endpoint.
8. Run D-002 external checkpoint tests: TLS/origin, invitation and verified exchange, unknown-user denial, webhook signature/replay/deactivation, BBB and Clerk logout/revocation, least privilege, persistence/restart, failed-readiness routing, backup/restore rehearsal, and bounded health/auth responses. Record identifiers and pass/fail evidence, never secrets or student payloads.

## Configuration ownership

Render runtime values: `NODE_ENV=production`, `DEPLOYMENT_TARGET=preview`, `DURABLE_RUNTIME_ENABLED=true`, `LOCAL_AUTH_ENABLED=false`, pooled `DATABASE_URL`, exact `APP_ORIGIN`, `CANONICAL_LAB_VERSION`, bounded `SESSION_TTL_SECONDS`, Clerk publishable/secret/JWT/issuer/audience/authorized-party/sign-in values, and the Clerk webhook signing secret. Render also supplies `PORT`.

Protected GitHub environment values: direct deploy-role `DIRECT_DATABASE_URL`, `PREVIEW_DATABASE_CONFIRMATION=bbb_practice_preview`, Render deploy hook secret, and non-secret `PREVIEW_ORIGIN=https://preview.clientpracticelabs.com`.
Also configure non-secret `PREVIEW_DATABASE_HOST` to the exact Neon direct (non-pooler) hostname. Required reviewers must approve this environment; no PR workflow receives it or any secret.

Cloudflare holds no application or provider secret. Clerk holds no database credential. Render never receives `DIRECT_DATABASE_URL`. The GitHub deployment environment never makes its secrets available to PR code.

The invitation command is an operator-only compiled CLI, not an HTTP/admin/student endpoint. Run it only from a protected administrative environment holding the deploy database URL and Clerk secret. The operator supplies the pre-approved opaque BBB student ID, fictional display name, and controlled email; never a Clerk subject. Clerk binds its immutable subject only after the invited user completes legitimate provider activation and the server verifies that session. Password creation, reset, recovery, MFA, and credential storage remain entirely Clerk responsibilities.

## Stop conditions

Stop for review if controlled-domain verification fails; production Clerk cannot enforce restricted access or the exact origin; the selected plans do not provide the D-001 recovery/non-sleep behavior; separate least-privilege Neon roles cannot be established; Render cannot run the long-lived raw Node process and readiness gate; or any provider requires an additional paid product, add-on, domain, or architectural change.
