# Preview invitation acceptance

Future invitations use Clerk's hosted Account Portal signup page, derived from
the existing `CLERK_SIGN_IN_URL` (`https://<configured-account-portal>/sign-in`).
The configuration must be an HTTPS `/sign-in` URL without credentials, query or
fragment. No new environment variable or tenant setting is required.

The invitation redirect is `/sign-up?redirect_url=<approved-origin>/auth/callback`
on that same configured portal origin. Normal `/login` uses the hosted `/sign-in`
page with the same explicit return URL. Clerk owns invitation ticket validation,
signup, verification and authentication. The application does not read or redeem
invitation tickets. Invalid/expired/revoked tickets must be rejected by Clerk.

After hosted authentication, the existing callback verifies the Clerk identity
and presents the existing POST exchange form. Exact Origin, issuer/audience,
verified primary email, application invitation preauthorization, immutable
subject mapping and session replacement checks remain unchanged. A callback
alone does not create a mapping or application session.

The operator command is unchanged:

```text
pnpm preview:invite -- --origin https://preview.clientpracticelabs.com --student-id <approved-id> --display-name <approved-name> --email <approved-email>
```

Use only an explicitly approved operator environment. Configuration is validated
before preauthorization. Do not log invitation URLs/tickets, provider error
objects, cookies or credentials. A failure may follow provider creation: inspect
bounded application/provider state before any retry. `SENT` is not proof of
mailbox delivery or acceptance.

Existing invitations retain their original redirect. This change deliberately
does not add a ticket bridge to `/auth/callback`; it cannot repair the outstanding
Student A invitation. Recovery requires a separately reviewed, owner-authorized
revocation/reissue and application-state reconciliation procedure. Simply rerunning
the CLI returns the existing SENT record and does not replace it. Do not manually
rewrite lifecycle rows or change the callback URL in the owner's browser.

Tests simulate provider authentication and use disposable PostgreSQL for real
application mapping/exchange. They do not prove live Account Portal behavior.
After review/deployment and separately approved invitation recovery, validate
hosted signup and return in the isolated Student A profile. No live invitation
mutation or deployment is part of implementation validation.

References:
- https://clerk.com/docs/guides/users/inviting
- https://clerk.com/docs/guides/account-portal/direct-links
