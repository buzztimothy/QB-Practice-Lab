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

1. Reconfirm current Clerk Pro, Neon Launch, and Render Starter terms and D-001 requirements. Stop rather than silently changing provider, tier, region, recovery, or trust design.
2. Create the Neon project/branch/database and separate deploy and runtime roles. Select the nearest compatible Neon/Render regions, record them, enable the required recovery window, and prove runtime DDL and trigger-disable attempts fail. Render receives only the TLS pooled runtime URL; the protected GitHub environment receives only the direct deploy-role URL.
3. Create one Render Starter service from this repository's `main`, with PR previews and automatic deploys disabled. Apply `render.yaml`, set its custom hostname to `preview.clientpracticelabs.com`, and keep traffic unavailable until readiness succeeds.
4. In Cloudflare, add only the `preview` DNS record and target/value Render supplies for custom-domain verification. Do not add or alter apex or `app` records. Complete Render ownership and HTTPS verification before continuing.
5. Create/activate the Clerk Pro Production instance for the controlled Preview domain. Enable restricted/invite-only access, required email verification/recovery, exact callback and return URLs under the authoritative origin, the exact authorized party, and the user lifecycle webhook at `/auth/webhooks/clerk`. Disable public signup and unapproved identity methods.
6. Put runtime values only in Render encrypted/config variables and deployment values only in the protected `bbb-preview-deploy` GitHub environment. Configure required reviewers. Never expose Preview secrets to pull requests.
7. Manually dispatch `.github/workflows/preview-deploy.yml` from `main`, supplying the exact current `main` SHA. The job validates, migrates under the advisory lock, bootstraps twice, invokes Render, and waits for the authoritative origin's readiness endpoint.
8. Run D-002 external checkpoint tests: TLS/origin, invitation and verified exchange, unknown-user denial, webhook signature/replay/deactivation, BBB and Clerk logout/revocation, least privilege, persistence/restart, failed-readiness routing, backup/restore rehearsal, and bounded health/auth responses. Record identifiers and pass/fail evidence, never secrets or student payloads.

## Configuration ownership

Render runtime values: `NODE_ENV=production`, `DURABLE_RUNTIME_ENABLED=true`, `LOCAL_AUTH_ENABLED=false`, pooled `DATABASE_URL`, exact `APP_ORIGIN`, `CANONICAL_LAB_VERSION`, bounded `SESSION_TTL_SECONDS`, Clerk publishable/secret/JWT/issuer/audience/authorized-party/sign-in values, and the Clerk webhook signing secret. Render also supplies `PORT`.

Protected GitHub environment values: direct deploy-role `DIRECT_DATABASE_URL`, `PREVIEW_DATABASE_CONFIRMATION=bbb_practice_preview`, Render deploy hook secret, and non-secret `PREVIEW_ORIGIN=https://preview.clientpracticelabs.com`.

Cloudflare holds no application or provider secret. Clerk holds no database credential. Render never receives `DIRECT_DATABASE_URL`. The GitHub deployment environment never makes its secrets available to PR code.

## Stop conditions

Stop for review if controlled-domain verification fails; production Clerk cannot enforce restricted access or the exact origin; the selected plans do not provide the D-001 recovery/non-sleep behavior; separate least-privilege Neon roles cannot be established; Render cannot run the long-lived raw Node process and readiness gate; or any provider requires an additional paid product, add-on, domain, or architectural change.
