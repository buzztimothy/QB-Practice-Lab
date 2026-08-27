# P-010R final browser acceptance

Validated locally on 2026-08-27 against real Google Chrome 151.0.7922.174 and the compiled application with local development authentication enabled.

## Acceptance result

- Desktop Start → Results: passed with a trusted Student A session. The journey used the visible evidence, transaction, customer, chart, reconciliation, Close Books, Final Meeting, and Results workflows. Both reconciliations reached zero without an adjustment, Close Books returned `READY_FOR_FINAL_REVIEW`, and Results rendered the Client Readiness Report.
- Representative narrow viewport: passed at exactly 390 × 844. Navigation, all primary workflow screens, critical actions, reconciliation context, and accounting tables remained usable. Wide tables scroll inside their labeled regions without page-wide horizontal overflow.
- Genuine two-session isolation: passed with separate Chrome browser contexts and distinct HttpOnly session cookies for Student A and Student B. Student B's copied Student A routes and copied mutation returned the same bounded 404 response as nonexistent resources across attempts, books, documents, conversations, coaching, Final Meeting, and Results.
- Keyboard activation: passed for navigation, Client Inbox, BBB Coach, transaction/detail work, reconciliation clearing and completion, confirmation dialogs, Close Books, Final Meeting responses, and Results. No mouse-only blocker was found.
- Authenticated payload secrecy: passed across 16 Student A/Student B JSON payloads covering dashboard, bank, sales, documents, inbox, coaching, meeting, and results. No instructor notes, hidden facts, scenario inventory, scoring rules, critical hooks, clean-master state, authoritative statements, unlock rules, instructor explanations, awarded-point internals, or foreign-student identity appeared.

Session refresh preserved the authenticated attempt. Logout cleared access and the next `/api/student` request returned 401; signing into the same browser context as the other fictional profile replaced the principal. Browser-controlled identity fields did not override the session principal. Idempotent replay changed the revision once, while a distinct stale command failed with bounded refresh guidance.

## In-scope correction

The first 390 × 844 run found that the grid item's intrinsic table width expanded the document to 720px even though each table region declared horizontal scrolling. `main` now permits grid shrinkage and `.table-scroll` is bounded to its container. A repeat real-Chrome sweep confirmed a 390px document width and 319–356px table-region viewports with contained 720px scroll content on Bank, Sales, Reports, Reconcile, and Documents.

The protected application reachability test now follows the actual browser adapters: Exclude rather than the domain-only Void synonym, Save Correction routing, clearing only visibly uncleared reconciliation rows, and then finishing both reconciliations. This preserves the existing immutable-history reset assertion and Start → Results regression.

P-011, deployment, Neon, Vercel, QuickBooks integration, Booked integration, and production authentication were not started.
