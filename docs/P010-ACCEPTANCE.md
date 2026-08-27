# P-010 Browser Acceptance Log

Date: 2026-08-27
Baseline: `f8709290da59ab66c319b796a4027f9340feea05`
Browser: Codex in-app Chromium, default 1280 x 720 viewport
Application: compiled local web server at `http://localhost:3003`
Database validation: disposable PostgreSQL 16 at `localhost:55433` (`qb-p010-validation`)

This is an instructor/test artifact. The acceptance operator used only the student-facing browser workflow to investigate and complete the engagement. Developer diagnostics and automated tests were used only to identify defects and validate secrecy, ownership, and persistence; they were not used to post student work.

| Area | Browser step and visible outcome | Result |
| --- | --- | --- |
| Fresh entry and navigation | Opened a new attempt, met Suncoast, entered the June workspace, and located every student destination from the workspace navigation. | Pass |
| Dashboard and bank workflow | Confirmed neutral orientation, ordinary and unusual activity together, no issue count or score clues, bank-feed decisions, per-activity references, transaction detail, and return context. | Pass after correction |
| Documents | Opened onboarding, statements, receipts, loan support, and legitimately unlocked records; related-record navigation returned to authoritative bookkeeping records. Locked/private records were absent. | Pass after correction |
| Michael and Coach | Sent exact student-authored questions, received bounded client facts, unlocked only requested evidence, used HINT and WALKTHROUGH help, and confirmed Coach drafts did not send to Michael. | Pass after correction |
| Accounting investigation | Completed supported duplicate, contribution, loan, equipment, trailer, customer lifecycle/application, bank-match, transfer/card-payment, historical-integrity, personal-card, payroll, and account-consolidation work through visible controls. Legitimate unchanged records were explicitly kept. | Pass after correction |
| Reports and registers | Reviewed cash/accrual P&L, Balance Sheet, A/R, General Ledger, account registers, transaction drill-through, and return navigation. Reports reflected posted activity without clean-truth disclosure. | Pass |
| Reconciliation | Investigated statement differences, restored historical integrity, reached zero for Checking and Visa, and completed both without an adjustment/plug shortcut. | Pass |
| Close and stale close | Received bounded premature-close feedback, reached READY FOR FINAL REVIEW, invalidated the close with later activity, observed the meeting become unavailable, and closed again. | Pass |
| Final Meeting and Results | Began from Michael's neutral prompt, submitted an independent explanation, answered two grounded follow-ups, and reached a report that reflected the run's help and communication evidence. | Pass |
| History and retry | Preserved the completed attempt and report, confirmed COMPLETED history, started Attempt 2 through an explicit confirmation, and observed fresh starting state. | Pass |
| Foreign/error routes | A copied/guessed foreign attempt route returned the same bounded workspace-unavailable response. Stale action, blocked meeting, and blocked close responses were useful and secrecy-preserving. | Pass within local fixed-identity shell |
| Persistence and concurrency | Refresh/navigation preserved state. A double click advanced one revision only. A stale second tab failed boundedly and recovered after refresh. | Pass |
| Keyboard | Native links, labeled inputs/selects, and buttons were focusable; critical confirmation flows now use an accessible in-page dialog with Confirm and Cancel. The automation driver's synthetic Enter/Space did not activate buttons, so activation was completed by semantic click while keyboard semantics remain covered by markup tests. | Partial — automation limitation |
| Narrow viewport | Requested 390 x 844 through the browser's advertised viewport capability twice, including a new tab. The browser remained 1280 x 720, so a real narrow browser run could not be recorded in this environment. Responsive layout and horizontally scrollable accounting regions remain covered by P-009 markup/CSS tests. | Not executed — tooling limitation |
| Payload secrecy | Representative rendered screens and student DTO/API security tests contained no scenario IDs, clean master, expected corrections, hidden documents, instructor facts, critical hooks, scoring formulas, or reconciliation fingerprints. Direct JSON navigation was blocked by the browser client, so the complete automated secrecy suite supplies the payload-level proof. | Pass with automated payload proof |

## Defects corrected

1. Structured BBB Coach content rendered as `[object Object]`; it now renders four labeled, student-safe coaching fields.
2. A generic dated Visa question disclosed protected purpose; purpose disclosure now requires a purpose-specific clarification.
3. Numeric document counts rendered as currency; receipt quantity now renders as `1`.
4. Duplicate bank/card rows lacked usable neutral references and direct detail navigation; bank-feed references and register drill-through were added.
5. The Cape Premier deposit correction was unreachable; Sales now exposes an authorized deposit-detail action.
6. Required legitimate unchanged decisions were unreachable; register, invoice, and payment surfaces now expose `Keep as recorded` through the existing command boundary.
7. Native confirmation prompts blocked automated and assistive interaction; destructive/finalizing actions now use an accessible in-page Confirm/Cancel dialog.

## Acceptance conclusion

The desktop student journey is complete without instructor navigation or private shortcuts. P-010 cannot be marked fully complete until a real narrow viewport run is executed with a browser surface whose viewport control works. A true second authenticated browser identity is also outside the fixed local P-009 shell; route-level denial and the server-side cross-student suite passed, but multi-session authentication should be rechecked when authentication exists.
