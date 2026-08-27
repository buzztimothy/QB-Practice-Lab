import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../packages/accounting-domain/src/errors.js';
import { StudentApplication, type StudentAction } from '../apps/student/application.js';
import { renderStudentApplication } from '../apps/web/student-ui.js';
import type { StudentBookkeepingCommand } from '../packages/accounting-domain/src/suncoast-commands.js';

const auth = { studentId: 'student-a' } as const;
const amount = (entry: { lines: readonly { debit: { cents: number }; credit: { cents: number } }[] }) => entry.lines.reduce((sum, line) => sum + line.debit.cents + line.credit.cents, 0) / 2;

describe('P-009 student application shell', () => {
  it('starts/resumes an owned attempt and renders all student-safe destinations', async () => {
    const app = new StudentApplication(); const started = await app.start(auth); const resumed = await app.start(auth);
    expect(resumed.shell.attemptId).toBe(started.shell.attemptId);
    expect(started.orientation).toMatchObject({ owner: 'Michael Carter', business: expect.stringContaining('handyman') });
    const html = renderStudentApplication(await app.view(auth, { attemptId: started.shell.attemptId, screen: 'dashboard' }));
    for (const label of ['Dashboard','Bank Transactions','Sales / Customers','Expenses','Chart of Accounts','Reconcile','Reports','Documents','Client Inbox','BBB Coach','Close Books','Final Meeting','Results']) expect(html).toContain(label);
    expect(html).not.toMatch(/scenario|errors remaining|issues found|score target|clean master|answer key/i);
    await expect(app.view({ studentId: 'student-b' }, { attemptId: started.shell.attemptId })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('keeps protected evidence and instructor data out of every browser DTO', async () => {
    const app = new StudentApplication(); const start = await app.start(auth); const initial = await app.view(auth, { attemptId: start.shell.attemptId, screen: 'documents' }); const json = JSON.stringify(initial);
    expect(json).not.toMatch(/instructor|hiddenFacts|cleanMaster|provenance|criticalHooks|unlockRules|fingerprint|expected treatment|Owner Draws|abc-deposit-agreement|payroll-report-june-14|card-clarification-0624/i);
    expect(initial.data.documents.some(item => item.title.includes('Client Information'))).toBe(true);
    expect(renderStudentApplication(initial)).not.toContain('locked');
    const hidden = await app.act(auth, start.shell.attemptId, { type: 'OPEN_DOCUMENT', documentId: 'payroll-report-june-14' }); const guessed = await app.act(auth, start.shell.attemptId, { type: 'OPEN_DOCUMENT', documentId: 'not-a-document' });
    expect(hidden).toMatchObject({ ok: false }); expect(hidden.message).toBe(guessed.message);
  });

  it('uses authoritative revisions and idempotency without optimistic duplicate state', async () => {
    const app = new StudentApplication(); const start = await app.start(auth); const view = await app.view(auth, { attemptId: start.shell.attemptId, screen: 'bank' }); const target = view.data.bankEntries[0];
    const action: StudentAction = { type: 'BOOKKEEPING', command: { type: 'REVIEW', targetId: target.id }, context: { expectedRevision: 0, idempotencyKey: 'review-once', help: 'INDEPENDENT' } };
    expect((await app.act(auth, start.shell.attemptId, action)).ok).toBe(true);
    expect((await app.act(auth, start.shell.attemptId, action)).ok).toBe(true);
    const stale = await app.act(auth, start.shell.attemptId, { type: 'BOOKKEEPING', command: { type: 'REVIEW', targetId: view.data.bankEntries[1].id }, context: { expectedRevision: 0, idempotencyKey: 'stale', help: 'INDEPENDENT' } });
    expect(stale).toMatchObject({ ok: false, stale: true });
    expect((await app.view(auth, { attemptId: start.shell.attemptId })).shell.revision).toBe(1);
  });

  it('maps review, categorize, transfer, and exclusion through P-008A application commands', async () => {
    for (const kind of ['CATEGORIZE','TRANSFER','EXCLUDE'] as const) {
      const app = new StudentApplication(); let view = await app.start({ studentId: `student-${kind}` });
      const target = view.data.bankEntries.find(entry => entry.lines.length === 2 && entry.source === 'BANK_ACTIVITY')!;
      const account = kind === 'TRANSFER' ? view.data.accounts.find(item => item.kind === 'LIABILITY' && item.name !== 'Gulf Coast Business Visa')! : view.data.accounts.find(item => item.kind === 'EXPENSE')!;
      const command = kind === 'CATEGORIZE' ? { type: kind, entryId: target.id, accountId: account.id } as const : kind === 'TRANSFER' ? { type: kind, entryId: target.id, balanceSheetAccountId: account.id } as const : { type: kind, entryId: target.id } as const;
      const result = await app.act({ studentId: `student-${kind}` }, view.shell.attemptId, { type: 'BOOKKEEPING', command, context: { expectedRevision: 0, idempotencyKey: kind, help: 'INDEPENDENT' } });
      expect(result.ok).toBe(true); view = await app.view({ studentId: `student-${kind}` }, { attemptId: view.shell.attemptId }); expect(view.shell.revision).toBe(1);
    }
  });

  it('preserves document, Michael, and private Coach investigation context', async () => {
    const app = new StudentApplication(); let view = await app.start(auth); const attemptId = view.shell.attemptId;
    const document = view.data.documents.find(item => item.title.includes('Client Information'))!;
    expect((await app.act(auth, attemptId, { type: 'OPEN_DOCUMENT', documentId: document.id })).ok).toBe(true);
    const opened = renderStudentApplication(await app.view(auth, { attemptId, screen: 'documents', focusId: document.id, returnTo: 'bank' })); expect(opened).toContain('Residential handyman, painting, and pressure-washing services'); expect(opened).toContain('Return to prior work');
    view = await app.view(auth, { attemptId, screen: 'inbox', returnTo: 'bank' }); const conversationId = view.data.inbox[0].id;
    expect((await app.act(auth, attemptId, { type: 'COACH_DRAFT', conversationId, draft: 'How can I ask for payroll support clearly?', level: 'HINT' })).ok).toBe(true);
    expect((await app.act(auth, attemptId, { type: 'SEND_MESSAGE', conversationId, content: 'Please send the payroll support report.' })).ok).toBe(true);
    view = await app.view(auth, { attemptId, screen: 'coach', returnTo: 'bank' });
    expect(view.data.coaching).toHaveLength(1); expect(view.data.inbox[0].messages.map(item => item.sender)).toEqual(['STUDENT','CLIENT']);
    const html = renderStudentApplication(view); expect(html).toContain('Private — not shared with Michael'); expect(html).toContain('What worked:'); expect(html).toContain('What to strengthen:'); expect(html).toContain('Why it matters:'); expect(html).toContain('Try this:'); expect(html).not.toContain('[object Object]'); expect(html).toContain('Return to prior work');
  });

  it('renders semantic, keyboard-operable critical workflows and responsive accounting regions', async () => {
    const app = new StudentApplication(); const start = await app.start(auth);
    for (const screen of ['bank','sales','accounts','reports','reconcile','documents','inbox','coach','close'] as const) {
      const html = renderStudentApplication(await app.view(auth, { attemptId: start.shell.attemptId, screen }));
      expect(html).toContain('Skip to main content'); expect(html).toContain('<main id="main" tabindex="-1">');
      expect(html).toMatch(/<h1>|<h1 /); expect(html).not.toMatch(/onclick=|tabindex="[1-9]/);
      if (html.includes('<table')) { expect(html).toContain('<caption>'); expect(html).toContain('role="region"'); }
      if (html.includes('<textarea')) expect(html).toMatch(/<label for="[^"]+">/);
    }
    const reports = renderStudentApplication(await app.view(auth, { attemptId: start.shell.attemptId, screen: 'reports', returnTo: 'bank' })); expect(reports).toContain('General Ledger'); expect(reports).toContain('Return to prior work');
    const salesView = await app.view(auth, { attemptId: start.shell.attemptId, screen: 'sales' }); const customer = salesView.data.customers[0]; const customerDetail = renderStudentApplication(await app.view(auth, { attemptId: start.shell.attemptId, screen: 'sales', focusId: customer.id })); expect(customerDetail).toContain('Customer detail');
    const bankHtml = renderStudentApplication(await app.view(auth, { attemptId: start.shell.attemptId, screen: 'bank' })); expect(bankHtml).toContain('Checking register'); expect(bankHtml).toContain('BF-001'); expect(bankHtml).toContain('Open detail'); expect(bankHtml).toContain('Mark reviewed'); const browserJs=(await import('../apps/web/student-ui.js')).studentJs; expect(browserJs).toContain('Exclude this activity from the books?'); expect(browserJs).toContain("setAttribute('role','dialog')"); expect(browserJs).toContain("confirm.textContent='Confirm'"); expect(browserJs).toContain("cancel.textContent='Cancel'");
    const salesHtml = renderStudentApplication(await app.view(auth, { attemptId: start.shell.attemptId, screen: 'sales' })); expect(salesHtml).toContain('Edit deposit details'); expect(salesHtml).toContain('Keep as recorded');
    const bankView=await app.view(auth,{attemptId:start.shell.attemptId,screen:'bank'}); const selectedEntry=bankView.data.bankEntries[0]; const registerHtml=renderStudentApplication(await app.view(auth,{attemptId:start.shell.attemptId,screen:'register',accountId:selectedEntry.lines[0].accountId,focusId:selectedEntry.id})); expect(registerHtml).toContain('Keep as recorded');
    const documentsView = await app.view(auth, { attemptId: start.shell.attemptId, screen: 'documents' }); const receipt = documentsView.data.documents.find(item => item.title.includes('Equipment Receipt'))!; const receiptHtml = renderStudentApplication(await app.view(auth, { attemptId: start.shell.attemptId, screen: 'documents', focusId: receipt.id })); expect(receiptHtml).toContain('<dt>Quantity</dt><dd>1</dd>'); expect(receiptHtml).not.toContain('<dt>Quantity</dt><dd>$0.01</dd>');
  }, 60_000);
});

describe('P-009 protected application reachability', () => {
  it('reaches Results from the P-002 state using only student-visible application adapters', async () => {
    const app = new StudentApplication(); let model = await app.start(auth); const attemptId = model.shell.attemptId;
    const run = async (action: StudentAction) => { const result = await app.act(auth, attemptId, action); expect(result, `${action.type}: ${'command' in action ? action.command.type : ''} — ${result.message}`).toMatchObject({ ok: true }); model = await app.view(auth, { attemptId, screen: 'dashboard' }); };
    const command = async (value: StudentBookkeepingCommand) => run({ type: 'BOOKKEEPING', command: value, context: { expectedRevision: model.shell.revision, idempotencyKey: `p009-${model.shell.revision + 1}`, help: 'INDEPENDENT' } });
    const entryByAmount = (cents: number, predicate: (entry: typeof model.data.entries[number]) => boolean = () => true) => model.data.entries.find(entry => amount(entry) === cents && predicate(entry))!;
    const documentLink = (title: string) => model.data.documents.find(document => document.title.includes(title))!.links[0].recordId;

    model = await app.view(auth, { attemptId, screen: 'documents' });
    const supportedSherwin = documentLink('Sherwin-Williams'); const duplicateSherwin = model.data.entries.find(entry => amount(entry) === 48736 && entry.id !== supportedSherwin)!;
    await command({ type: 'VOID', entryId: duplicateSherwin.id });
    const owner = entryByAmount(500000, entry => entry.lines.some(line => line.account === 'Operating Checking' && line.debit.cents === 500000)); await command({ type: 'CORRECT_OWNER_CONTRIBUTION', entryId: owner.id });
    await command({ type: 'CORRECT_VEHICLE_LOAN', entryId: documentLink('Loan Statement') });
    await command({ type: 'CORRECT_PRESSURE_WASHER', entryId: documentLink('Equipment Receipt') });

    model = await app.view(auth, { attemptId, screen: 'inbox' }); const conversationId = model.data.inbox[0].id;
    for (const content of ['Please send the ABC agreement.','Please send the payroll support report.','Was the June 24 card activity personal?']) await run({ type: 'SEND_MESSAGE', conversationId, content });
    model = await app.view(auth, { attemptId, screen: 'documents' });
    await command({ type: 'RESOLVE_ABC', entryId: documentLink('Deposit Agreement') });
    const martinezPayment = model.data.payments.find(item => item.reference === 'RCPT-MARTINEZ-0612')!; const martinezBank = model.data.entries.find(entry => amount(entry) === martinezPayment.amount.cents && entry.id !== model.data.entries.find(item => item.id === model.data.payments.find(payment => payment.id === martinezPayment.id)?.id)?.id && entry.source === 'BANK_ACTIVITY')!; await command({ type: 'MATCH', bankActivityId: martinezBank.id, targetId: martinezPayment.id });
    const reynolds = model.data.payments.find(item => item.reference === 'RCPT-REYNOLDS-0615')!, reynoldsInvoices = model.data.invoices.filter(item => item.customer === reynolds.customer); await command({ type: 'REAPPLY_PAYMENT', paymentId: reynolds.id, fromInvoiceId: reynoldsInvoices.find(item => item.number === 'REY-B')!.invoiceId, toInvoiceId: reynoldsInvoices.find(item => item.number === 'REY-A')!.invoiceId });
    const rentEntries = model.data.entries.filter(entry => amount(entry) === 250000 && entry.date === '2026-06-02'); const rentDuplicate = rentEntries.find(entry => entry.source === 'BANK_ACTIVITY')!, rentOriginal = rentEntries.find(entry => entry.id !== rentDuplicate.id)!; await command({ type: 'MATCH', bankActivityId: rentDuplicate.id, targetId: rentOriginal.id });
    model = await app.view(auth, { attemptId, screen: 'sales' }); const capePayment = model.data.payments.find(item => item.reference === 'RCPT-PAINT-0628')!, capeDeposit = model.data.deposits.find(item => item.payments.some(payment => payment?.id === capePayment.id))!; await command({ type: 'CORRECT_DEPOSIT_TRANSFER', entryId: capeDeposit.journalEntryId });
    model = await app.view(auth, { attemptId, screen: 'documents' }); await command({ type: 'RESTORE_HISTORICAL_TRANSACTION', entryId: model.data.entries.find(item => item.description.includes('Office Depot'))!.id });
    await command({ type: 'RESOLVE_PERSONAL_CARD', entryId: documentLink('Card Activity Clarification') });
    model = await app.view(auth, { attemptId }); await command({ type: 'CORRECT_CARD_PAYMENT', entryId: model.data.entries.find(item => item.source === 'CARD_PAYMENT')!.id });
    model = await app.view(auth, { attemptId, screen: 'documents' }); const payrollIds = model.data.documents.find(item => item.title.includes('Payroll Report'))!.links.map(link => link.recordId); await command({ type: 'CORRECT_PAYROLL', entryIds: payrollIds });
    model = await app.view(auth, { attemptId, screen: 'accounts' }); const target = model.data.accounts.find(item => item.name === 'Advertising & Marketing')!, sources = ['Advertising','Advertising Expense','Marketing','Marketing & Advertising'].map(name => model.data.accounts.find(item => item.name === name)!.id); await command({ type: 'CONSOLIDATE_ACCOUNTS', sourceAccountIds: sources, targetAccountId: target.id });

    model = await app.view(auth, { attemptId, screen: 'reconcile' });
    for (const reconciliation of model.data.reconciliations.filter(item => item.status === 'IN_PROGRESS')) for (const line of reconciliation.lines) { await command({ type: 'SET_RECONCILIATION_LINE', reconciliationId: reconciliation.id, lineId: line.id, cleared: true }); model = await app.view(auth, { attemptId, screen: 'reconcile' }); }
    model = await app.view(auth, { attemptId, screen: 'documents' });
    for (const targetId of [documentLink('Home Depot Receipt — June 22 Morning'), model.data.invoices.find(item => item.number === 'JEN-OPEN')!.invoiceId, documentLink('Year-End Entry Support'), model.data.payments.find(item => item.reference === 'CLIENT-ADVANCE-0630')!.id, model.data.payments.find(item => item.reference === 'RCPT-PALM-0626')!.id]) await command({ type: 'VERIFY_UNCHANGED', targetId });
    model = await app.view(auth, { attemptId, screen: 'reconcile' }); for (const reconciliation of model.data.reconciliations.filter(item => item.status === 'IN_PROGRESS')) await command({ type: 'FINISH_RECONCILIATION', reconciliationId: reconciliation.id });

    await run({ type: 'CLOSE_BOOKS' }); expect((await app.view(auth, { attemptId })).dashboard.closeStatus).toBe('READY_FOR_FINAL_REVIEW');
    const postCloseTarget=model.data.entries[0].id; await command({ type: 'REVIEW', targetId: postCloseTarget }); const staleClose=await app.view(auth,{attemptId,screen:'close'}); expect(staleClose.shell.capabilities.meeting).toBe(false); expect(staleClose.dashboard.closeStatus).toBe('OPEN'); expect((await app.act(auth,attemptId,{type:'BEGIN_MEETING'})).ok).toBe(false); await run({type:'CLOSE_BOOKS'}); expect((await app.view(auth,{attemptId})).dashboard.closeStatus).toBe('READY_FOR_FINAL_REVIEW');
    await run({ type: 'BEGIN_MEETING' });
    await run({ type: 'SUBMIT_EXPLANATION', explanation: "June revenue was $43,000, up from May's $38,750 and April's $33,700. June net income was $25,365.28 after $17,634.72 of expenses. Checking is $84,422, but cash is not the same as profit. Jenkins owes $1,425 and Reynolds owes $2,275, so those receivables need follow-up. The Visa balance is $4,308.15 and the vehicle loan is $27,910; the books show those balances, but they do not establish that the debt is a problem." });
    model = await app.view(auth, { attemptId, screen: 'meeting' }); for (const followUp of model.data.meeting!.followUps ?? []) await run({ type: 'ANSWER_FOLLOW_UP', followUpId: followUp.id, response: 'The books support follow-up, but they do not justify a guarantee or unsupported conclusion.' });
    await run({ type: 'FINALIZE_RESULTS' }); const results = await app.view(auth, { attemptId, screen: 'results' }); expect(results.data.results?.header.title).toBe('Are You Really Ready for Clients?'); expect(results.shell.attemptStatus).toBe('COMPLETED');
    const reset = await app.act(auth, attemptId, { type: 'RESET_ATTEMPT' }); expect(reset.ok).toBe(true); const next = await app.view(auth, { attemptId: reset.attemptId, screen: 'history' }); expect(next.history).toHaveLength(2); expect(next.history[0]).toMatchObject({ status: 'COMPLETED', hasResults: true }); expect(next.shell.attemptNumber).toBe(2);
  }, 60_000);
});
