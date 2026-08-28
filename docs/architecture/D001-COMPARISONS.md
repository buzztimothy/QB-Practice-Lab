# D-001 Provider and Hosting Comparisons

Verified against official documentation on 2026-08-28. Features and prices are volatile; D-002 must recheck them before provisioning.

## Authentication

| Criterion | Clerk | Auth0 | Supabase Auth |
|---|---|---|---|
| Email/password, verification, reset | Managed account flows | Mature database connection and Universal Login | Managed email/password and reset flows |
| Controlled onboarding | First-class application access mode: invite-only (`restricted`) and invitations | Signup can be disabled, but documented application invitations use a customized password-reset/metadata flow | Server-side admin invitations; global new-user signup can be disabled |
| Raw Node/server trust | Backend SDK validates request/session tokens, issuer/audience and authorized parties | Standards-based OIDC/JWT and Node support | JS/server APIs and JWT validation |
| Session fit | Good Model A handoff; BBB need not use Clerk session as domain authority | Good but more tenant/application configuration | Good, but adds refresh-token/session conventions alongside BBB sessions |
| Lifecycle | Dashboard/API invitations and backend users/sessions | Management API/Actions; powerful but more moving pieces | Admin API and auth hooks |
| Coupling/migration | Moderate; isolated adapter and provider-link | Moderate; standards reduce token coupling, tenant Actions increase ops | Higher conceptual coupling to a separate Supabase project while data is on Neon |
| Preview operations | Lowest for invite-only pilot | Highest of these choices for a polished invitation lifecycle | Moderate |
| Current entry cost | Hobby is free within published retained-user allowance; Pro starts at a published low monthly base | Free allowance is generous; paid Essentials starts above Clerk's base and invitation work remains | Free allowance; Pro platform starts at a published monthly minimum |
| Decision | **Selected on Pro for Preview** | Viable fallback if enterprise policy later prefers OIDC breadth | Viable fallback if BBB later consolidates on Supabase rather than Neon |

Clerk is not selected for popularity or prebuilt UI alone. Its decisive advantage is an enforceable invite-only mode plus a simple backend validation boundary that maps cleanly into BBB's existing durable session.

## Hosting

| Criterion | Render | Railway | Fly.io | Vercel |
|---|---|---|---|---|
| Existing raw Node listener | Native long-running web service | Native service/container fit | Native Machine/container fit | Requires adaptation to request-scoped Functions |
| Readiness traffic gate | Explicit HTTP health path gates new traffic and restarts unhealthy instances | Health checks available; topology is viable | Strong service checks prevent routing | Function health/readiness is not the current process contract |
| Same-origin | One web service | One service | One app/service | Possible after adapter, but function routing changes execution model |
| GitHub/secrets/logs | Native | Native | Supported, more CLI/image operations | Native |
| Rollback | Previous successful artifacts documented | Deployment rollback/redeploy available | Release/Machine rollback patterns | Deployment promotion/rollback, but schema job remains separate |
| Pilot complexity | **Low; selected** | Low-to-moderate | Moderate | Moderate-to-high because of adaptation |

Render is selected. Railway is the first alternative if D-002 uncovers a Render limitation. Fly is technically capable but unnecessarily operational for this pilot. Vercel is rejected because it would optimize for a framework/function architecture the repository does not have.

## Official sources

Authentication:

- Clerk invite-only access modes: https://clerk.com/docs/guides/secure/restricting-access
- Clerk invitations: https://clerk.com/docs/guides/users/inviting
- Clerk raw backend request validation and authorized parties: https://clerk.com/docs/reference/backend/authenticate-request
- Clerk same-origin session request behavior: https://clerk.com/docs/guides/development/making-requests
- Clerk email/password verification: https://clerk.com/docs/guides/development/custom-flows/authentication/email-password
- Clerk backend user ID/status: https://clerk.com/docs/reference/backend/types/backend-user
- Clerk webhook verification/retries: https://clerk.com/docs/guides/development/webhooks/overview
- Clerk pricing: https://clerk.com/pricing
- Auth0 database connections: https://auth0.com/docs/authenticate/database-connections
- Auth0 connection/signup guidance: https://auth0.com/docs/authenticate/connection-settings-best-practices
- Auth0 invitation pattern: https://auth0.com/docs/customize/email/send-email-invitations-for-application-signup
- Auth0 pricing: https://auth0.com/pricing
- Supabase Auth: https://supabase.com/docs/guides/auth
- Supabase access configuration: https://supabase.com/docs/guides/auth/general-configuration
- Supabase invitations: https://supabase.com/docs/guides/auth/users#inviting-users
- Supabase pricing: https://supabase.com/pricing

Neon:

- Prisma and Neon: https://neon.com/docs/guides/prisma
- Connection pooling: https://neon.com/docs/connect/connection-pooling
- Branching: https://neon.com/docs/introduction/branching
- Restore/PITR: https://neon.com/docs/introduction/branch-restore
- Scale to zero: https://neon.com/docs/introduction/scale-to-zero
- Pricing and restore windows: https://neon.com/pricing

Hosting:

- Render Node web services: https://render.com/docs/web-services
- Render health checks and traffic gating: https://render.com/docs/health-checks
- Render deployments: https://render.com/docs/deploys
- Render rollback: https://render.com/docs/rollbacks
- Render free-instance sleep limitation: https://render.com/docs/free
- Render logging and retention: https://render.com/docs/logging
- Render pricing: https://render.com/pricing
- Fly health checks: https://fly.io/docs/reference/health-checks/
- Fly pricing: https://fly.io/docs/about/pricing/
- Vercel Functions and pricing: https://vercel.com/docs/functions and https://vercel.com/docs/pricing

Official sources support capability and relative-cost decisions; quoted plan numbers are intentionally not made deployment constants.
