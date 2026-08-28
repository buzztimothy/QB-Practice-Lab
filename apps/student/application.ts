import { NotFoundError, InvalidStateError } from '../../packages/accounting-domain/src/errors.js';
import { accountRegister, arAging, customerBalances, invoiceDetails, operationalProfitAndLoss, reconciliationResult } from '../../packages/accounting-domain/src/operations.js';
import { balanceSheet, trialBalance } from '../../packages/accounting-domain/src/service.js';
import { compareAccountingCompletion, deriveSuncoastAssessment, recordCloseAttempt, type SuncoastAssessmentAttempt } from '../../packages/accounting-domain/src/suncoast-assessment.js';
import { requestCommunicationCoaching, requestDraftCoaching, sendMessageWithCoaching, type HelpLevel } from '../../packages/accounting-domain/src/suncoast-coaching.js';
import { createStudentCommandSession, executeStudentCommand, studentCommandView, type StudentBookkeepingCommand, type StudentCommandContext, type StudentCommandSession } from '../../packages/accounting-domain/src/suncoast-commands.js';
import { followEvidenceReference, listEvidence, openEvidence, requestEvidence } from '../../packages/accounting-domain/src/suncoast-evidence.js';
import { answerMonthEndFollowUp, applyMonthEndAssessment, beginMonthEndMeeting, monthEndStudentView, submitMonthEndExplanation, type SuncoastMonthEndMeeting } from '../../packages/accounting-domain/src/suncoast-month-end.js';
import { generateReadinessReport, readinessReportStudentView, type ReadinessReportHistory } from '../../packages/accounting-domain/src/suncoast-readiness-report.js';
import { InMemoryStudentAttemptRepository, type StoredAttempt, type StudentAttemptRepository } from './persistence.js';

export const studentScreens = ['meet', 'dashboard', 'bank', 'sales', 'expenses', 'accounts', 'register', 'reports', 'reconcile', 'documents', 'inbox', 'coach', 'close', 'meeting', 'results', 'history'] as const;
export type StudentScreen = typeof studentScreens[number];
export interface StudentAuth { readonly studentId: string }
export interface ViewRequest { readonly attemptId?: string; readonly screen?: StudentScreen; readonly focusId?: string; readonly returnTo?: string; readonly basis?: 'CASH' | 'ACCRUAL'; readonly accountId?: string }

export interface AttemptRecord {
  session: StudentCommandSession;
  status: 'ACTIVE' | 'COMPLETED' | 'RESET';
  assessment?: SuncoastAssessmentAttempt;
  meeting?: SuncoastMonthEndMeeting;
  report?: ReadinessReportHistory;
}

export type StudentAction =
  | { readonly type: 'BOOKKEEPING'; readonly command: StudentBookkeepingCommand; readonly context: StudentCommandContext }
  | { readonly type: 'SAVE_CORRECTION'; readonly entryId: string; readonly context: StudentCommandContext }
  | { readonly type: 'SEND_MESSAGE'; readonly conversationId: string; readonly content: string }
  | { readonly type: 'COACH_DRAFT'; readonly conversationId: string; readonly draft: string; readonly level: HelpLevel }
  | { readonly type: 'COACH_MESSAGE'; readonly messageId: string; readonly level: HelpLevel }
  | { readonly type: 'LIST_DOCUMENTS' }
  | { readonly type: 'OPEN_DOCUMENT'; readonly documentId: string }
  | { readonly type: 'FOLLOW_DOCUMENT'; readonly documentId: string; readonly referenceId: string }
  | { readonly type: 'REQUEST_DOCUMENT'; readonly subject: string }
  | { readonly type: 'CLOSE_BOOKS' }
  | { readonly type: 'BEGIN_MEETING' }
  | { readonly type: 'SUBMIT_EXPLANATION'; readonly explanation: string }
  | { readonly type: 'ANSWER_FOLLOW_UP'; readonly followUpId: string; readonly response: string }
  | { readonly type: 'FINALIZE_RESULTS' }
  | { readonly type: 'RESET_ATTEMPT' };

const money = (cents: number) => ({ cents, display: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100) });
const stateOf = (record: AttemptRecord) => record.session.coaching.interaction.evidence.p002.attempt.state;
const p002Of = (record: AttemptRecord) => record.session.coaching.interaction.evidence.p002;
const visibleEvidence = (record: AttemptRecord) => studentCommandView(record.session).coaching.interaction.evidence;
const genericFailure = (error: unknown) => error instanceof InvalidStateError && /conflict/i.test(error.message) ? 'This workspace changed. Refresh the latest attempt and try again.' : 'That action is unavailable. Your books were not changed.';

export class StudentApplication {
  constructor(private readonly repository:StudentAttemptRepository=new InMemoryStudentAttemptRepository()){}
  async isReady(){return this.repository.readiness();}

  async start(auth: StudentAuth): Promise<ReturnType<StudentApplication['view']>> {
    const history=await this.repository.listForStudent(auth.studentId);
    const active=history.find(item=>item.record.status==='ACTIVE');
    const attemptId=active?.record.session.attemptId??await this.create(auth.studentId,history.length+1);
    return this.view(auth, { attemptId, screen: 'meet' });
  }

  async view(auth: StudentAuth, request: ViewRequest = {}) {
    const stored=await this.resolve(auth,request.attemptId),record=stored.record;
    const screen = request.screen ?? 'dashboard';
    const state = stateOf(record);
    const safe = studentCommandView(record.session);
    const accounts = safe.bookkeeping.attempt.accounts.map(account => ({ id: account.id, code: account.code, name: account.name, kind: account.kind, role: account.operationalRole, balance: money(trialBalance(state.attempt).find(row => row.accountId === account.id)!.debitCents - trialBalance(state.attempt).find(row => row.accountId === account.id)!.creditCents) }));
    const accountNames = new Map(accounts.map(account => [account.id, account.name]));
    const entries = safe.bookkeeping.attempt.entries.map(entry => ({ id: entry.id, date: entry.occurredOn, description: entry.description, source: entry.source?.kind ?? 'JOURNAL_ENTRY', lines: entry.lines.filter(line => accountNames.has(line.attemptAccountId)).map(line => ({ id: line.id, accountId: line.attemptAccountId, account: accountNames.get(line.attemptAccountId) ?? 'Account', debit: money(line.debitCents), credit: money(line.creditCents) })) }));
    const bankEntries = entries.filter(entry => entry.lines.some(line => ['BANK', 'CREDIT_CARD'].includes(state.attempt.accounts.find(account => account.id === line.accountId)?.operationalRole ?? '')));
    const customers = state.customers.map(customer => {
      const balance = customerBalances(state).find(item => item.customerId === customer.id)!;
      return { id: customer.id, name: customer.name, active: customer.active, open: money(balance.invoiceOpenCents), unapplied: money(balance.unappliedPaymentCents), net: money(balance.netReceivableCents) };
    });
    const invoices = invoiceDetails(state).map(invoice => ({ ...invoice, number: state.invoices.find(item => item.id === invoice.invoiceId)!.number, customer: customers.find(item => item.id === invoice.customerId)?.name ?? 'Customer', amount: money(invoice.amountCents), applied: money(invoice.appliedCents), open: money(invoice.openCents) }));
    const payments = state.payments.map(payment => ({ id: payment.id, date: payment.paymentDate, customer: customers.find(item => item.id === payment.customerId)?.name ?? 'Customer', amount: money(payment.amountCents), method: payment.method, reference: payment.reference, applications: state.applications.filter(item => item.paymentId === payment.id).map(item => ({ id: item.id, invoiceId: item.invoiceId, invoice: state.invoices.find(invoice => invoice.id === item.invoiceId)?.number ?? 'Invoice', amount: money(item.amountCents) })) }));
    const deposits = state.deposits.map(deposit => ({ id: deposit.id, journalEntryId: deposit.journalEntryId, date: deposit.depositDate, reference: safe.bookkeeping.attempt.entries.find(entry => entry.id === deposit.journalEntryId)?.description ?? 'Bank deposit', amount: money(deposit.amountCents), payments: deposit.paymentIds.map(id => payments.find(payment => payment.id === id)).filter(Boolean) }));
    const reconciliations = state.reconciliations.map(reconciliation => {
      const result = reconciliationResult(state, reconciliation);
      const eligible = entries.filter(entry => entry.date >= reconciliation.beginningDate && entry.date <= reconciliation.endingDate).flatMap(entry => entry.lines.filter(line => line.accountId === reconciliation.accountId).map(line => ({ ...line, entryId: entry.id, date: entry.date, description: entry.description, cleared: reconciliation.clearedJournalLineIds.includes(line.id) })));
      return { id: reconciliation.id, accountId: reconciliation.accountId, account: accountNames.get(reconciliation.accountId) ?? 'Account', beginningDate: reconciliation.beginningDate, endingDate: reconciliation.endingDate, beginning: money(reconciliation.beginningBalanceCents), ending: money(reconciliation.endingBalanceCents), cleared: money(result.calculatedClearedBalanceCents), difference: money(result.differenceCents), balanced: result.balanced, historicalIntegrity: result.historicalIntegrity, status: reconciliation.status, lines: eligible };
    });
    const basis = request.basis ?? 'ACCRUAL';
    const pnl = operationalProfitAndLoss(state, basis, { from: '2026-06-01', through: '2026-06-30' });
    const bs = balanceSheet(state.attempt);
    const selectedAccount = request.accountId && state.attempt.accounts.some(account => account.id === request.accountId) ? request.accountId : state.attempt.accounts.find(account => account.name === 'Operating Checking')?.id;
    const register = selectedAccount ? accountRegister(state, selectedAccount).map(row => ({ date: row.entry.occurredOn, description: row.entry.description, lineId: row.lineId, debit: money(row.debitCents), credit: money(row.creditCents), running: money(row.runningBalanceCents) })) : [];
    const evidence = visibleEvidence(record);
    const assessmentActionCount = record.assessment?.evidence.filter(item => item.source.kind === 'P002_ACTION').length;
    const closeCurrent = assessmentActionCount !== undefined && assessmentActionCount === p002Of(record).attempt.auditTrail.length && record.assessment?.evidence.at(-1)?.type === 'FINAL_ACCOUNTING_STATE';
    const close = closeCurrent ? record.assessment?.closeAttempts.at(-1)?.result : undefined;
    const data = {
      entries, bankEntries, customers, invoices, payments, deposits, accounts, reconciliations,
      register: { accountId: selectedAccount, account: accountNames.get(selectedAccount ?? '') ?? '', rows: register },
      reports: { basis, profitAndLoss: { revenue: pnl.revenue.filter(row => accountNames.has(row.accountId)).map(row => ({ name: row.name, amount: money(row.amountCents), accountId: row.accountId })), expenses: pnl.expenses.filter(row => accountNames.has(row.accountId)).map(row => ({ name: row.name, amount: money(row.amountCents), accountId: row.accountId })), netIncome: money(pnl.netIncomeCents) }, balanceSheet: { assets: bs.assets.filter(row => accountNames.has(row.accountId)).map(row => ({ name: row.name, amount: money(row.amountCents), accountId: row.accountId })), liabilities: bs.liabilities.filter(row => accountNames.has(row.accountId)).map(row => ({ name: row.name, amount: money(row.amountCents), accountId: row.accountId })), equity: bs.equity.filter(row => accountNames.has(row.accountId)).map(row => ({ name: row.name, amount: money(row.amountCents), accountId: row.accountId })), currentEarnings: money(bs.currentEarningsCents), totalAssets: money(bs.totalAssetsCents), totalLiabilitiesAndEquity: money(bs.totalLiabilitiesAndEquityCents) }, arAging: arAging(state, '2026-06-30').map(row => ({ customerId: row.customerId, customer: customers.find(item => item.id === row.customerId)?.name ?? 'Customer', invoice: state.invoices.find(item => item.id === row.invoiceId)?.number ?? 'Invoice', dueDate: row.dueDate, amount: money(row.amountCents), applied: money(row.appliedCents), open: money(row.openCents), daysPastDue: row.daysPastDue })), generalLedger: entries.flatMap(entry => entry.lines.map(line => ({ accountId: line.accountId, account: line.account, entryId: entry.id, date: entry.date, description: entry.description, debit: line.debit, credit: line.credit }))).sort((left, right) => left.account.localeCompare(right.account) || left.date.localeCompare(right.date) || left.entryId.localeCompare(right.entryId)) },
      documents: evidence.documents,
      inbox: studentCommandView(record.session).coaching.interaction.conversations,
      coaching: studentCommandView(record.session).coaching.coaching,
      meeting: record.meeting ? monthEndStudentView(record.meeting) : null,
      results: record.report ? readinessReportStudentView(record.report) : null,
    };
    return Object.freeze({
      shell: { product: 'BBB Client Practice Lab', company: 'Suncoast Home Services LLC', period: 'June 2026', attemptId: record.session.attemptId, attemptNumber: record.session.coaching.generation, attemptStatus: record.status, revision: record.session.revision, screen, focusId: request.focusId, returnTo: request.returnTo, capabilities: { meeting: close === 'READY_FOR_FINAL_REVIEW' || !!record.meeting && closeCurrent, results: !!record.report } },
      orientation: { owner: 'Michael Carter', business: 'Residential handyman, painting, and pressure-washing services', scope: 'Review and close the June 2026 books using the records, client context, and professional judgment available in this workspace.' },
      dashboard: { checking: accounts.find(account => account.name === 'Operating Checking')?.balance, visa: accounts.find(account => account.name === 'Gulf Coast Business Visa')?.balance, receivables: money(customers.reduce((sum, customer) => sum + customer.net.cents, 0)), checkingReconciliation: reconciliations.find(item => item.account === 'Operating Checking')?.status ?? 'NOT_STARTED', visaReconciliation: reconciliations.find(item => item.account === 'Gulf Coast Business Visa')?.status ?? 'NOT_STARTED', closeStatus: close ?? 'OPEN', clientFollowUps: data.inbox.flatMap(item => item.messages).filter(item => item.sender === 'CLIENT').length },
      data,
      history: (await this.repository.listForStudent(auth.studentId)).map(item=>({attemptId:item.record.session.attemptId,attemptNumber:item.record.session.coaching.generation,status:item.record.status,hasResults:!!item.record.report})),
    });
  }

  async act(auth: StudentAuth, attemptId: string, action: StudentAction) {
    const stored=await this.resolve(auth,attemptId),record=stored.record;
    if (record.status !== 'ACTIVE' && action.type !== 'RESET_ATTEMPT') throw new InvalidStateError('Attempt is read-only');
    try {
      let message='Saved to your attempt.';
      if (action.type === 'BOOKKEEPING') record.session = executeStudentCommand(record.session, action.command, action.context);
      else if (action.type === 'SAVE_CORRECTION') {
        const state = stateOf(record), entry = state.attempt.entries.find(item => item.id === action.entryId);
        if (!entry) throw new InvalidStateError('Command unavailable');
        const command: StudentBookkeepingCommand = entry.description.includes('Owner contribution') ? { type: 'CORRECT_OWNER_CONTRIBUTION', entryId: entry.id }
          : entry.description.includes('Commercial pressure washer') ? { type: 'CORRECT_PRESSURE_WASHER', entryId: entry.id }
          : entry.description.includes('Vehicle loan payment') ? { type: 'CORRECT_VEHICLE_LOAN', entryId: entry.id }
          : entry.description.includes('Enclosed trailer deposit') ? { type: 'RESOLVE_ABC', entryId: entry.id }
          : entry.source?.kind === 'P002_CARD_ACTIVITY' ? { type: 'RESOLVE_PERSONAL_CARD', entryId: entry.id }
          : entry.source?.kind === 'CARD_PAYMENT' ? { type: 'CORRECT_CARD_PAYMENT', entryId: entry.id }
          : entry.source?.kind === 'P002_SIMPLIFIED_PAYROLL' ? { type: 'CORRECT_PAYROLL', entryIds: state.attempt.entries.filter(item => item.source?.kind === 'P002_SIMPLIFIED_PAYROLL').map(item => item.id) }
          : state.deposits.some(item => item.journalEntryId === entry.id) ? { type: 'CORRECT_DEPOSIT_TRANSFER', entryId: entry.id }
          : { type: 'RESTORE_HISTORICAL_TRANSACTION', entryId: entry.id };
        record.session = executeStudentCommand(record.session, command, action.context);
      }
      else if (action.type === 'SEND_MESSAGE') record.session = { ...record.session, coaching: sendMessageWithCoaching(record.session.coaching, action.conversationId, action.content) };
      else if (action.type === 'COACH_DRAFT') record.session = { ...record.session, coaching: requestDraftCoaching(record.session.coaching, action.conversationId, action.draft, action.level) };
      else if (action.type === 'COACH_MESSAGE') record.session = { ...record.session, coaching: requestCommunicationCoaching(record.session.coaching, action.messageId, action.level) };
      else if (action.type === 'LIST_DOCUMENTS') this.replaceEvidence(record, listEvidence(record.session.coaching.interaction.evidence));
      else if (action.type === 'OPEN_DOCUMENT') this.replaceEvidence(record, openEvidence(record.session.coaching.interaction.evidence, action.documentId));
      else if (action.type === 'FOLLOW_DOCUMENT') this.replaceEvidence(record, followEvidenceReference(record.session.coaching.interaction.evidence, action.documentId, action.referenceId));
      else if (action.type === 'REQUEST_DOCUMENT') this.replaceEvidence(record, requestEvidence(record.session.coaching.interaction.evidence, action.subject));
      else if (action.type === 'CLOSE_BOOKS') { const completion = await compareAccountingCompletion(p002Of(record)); const evidence = record.session.coaching.interaction.evidence; const unresolvedMaterialEvidenceRequests = evidence.audit.filter(item => item.kind === 'DOCUMENT_REQUESTED').some(item => evidence.unlockRules.some(rule => rule.requestSubject === item.referenceId && !evidence.documents.some(document => document.id === rule.documentId && document.state === 'UNLOCKED'))); record.assessment = recordCloseAttempt(deriveSuncoastAssessment(record.session.coaching), { accountingCompletion: completion, unresolvedMaterialEvidenceRequests }); const result = record.assessment.closeAttempts.at(-1)!.result; message=result === 'READY_FOR_FINAL_REVIEW' ? 'Ready for final review.' : result === 'BLOCKED' ? 'Close is blocked. Review your current books, evidence, and reconciliations.' : 'Not ready yet. Review your current books, evidence, and reconciliations.'; }
      else if (action.type === 'BEGIN_MEETING') { if (!record.assessment) throw new InvalidStateError('Final review unavailable'); record.meeting = await beginMonthEndMeeting(record.assessment, p002Of(record)); }
      else if (action.type === 'SUBMIT_EXPLANATION') { if (!record.meeting) throw new InvalidStateError('Final review unavailable'); record.meeting = submitMonthEndExplanation(record.meeting, action.explanation); }
      else if (action.type === 'ANSWER_FOLLOW_UP') { if (!record.meeting) throw new InvalidStateError('Final review unavailable'); record.meeting = answerMonthEndFollowUp(record.meeting, action.followUpId, action.response); }
      else if (action.type === 'FINALIZE_RESULTS') { if (!record.meeting || !record.assessment) throw new InvalidStateError('Report unavailable'); const completion = await compareAccountingCompletion(p002Of(record)); const result = applyMonthEndAssessment(record.assessment, record.meeting, completion); record.assessment = result.assessment; record.meeting = result.meeting; record.report = generateReadinessReport(record.report ?? null, record.assessment, record.meeting); record.status = 'COMPLETED'; }
      else if (action.type === 'RESET_ATTEMPT') { if (record.status !== 'COMPLETED') record.status = 'RESET'; const nextRecord:AttemptRecord={session:await createStudentCommandSession(auth.studentId,`${auth.studentId}-suncoast-${record.session.coaching.generation+1}`,record.session.coaching.generation+1),status:'ACTIVE'};const next=await this.repository.reset(stored,nextRecord);if(!next)return{ok:false as const,attemptId,message:'This workspace changed. Refresh the latest attempt and try again.',stale:true};return { ok: true as const, attemptId:next.record.session.attemptId, message: 'Your prior attempt remains in history. A new attempt is ready.' }; }
      const saved=await this.repository.save(stored);
      if(!saved)return{ok:false as const,attemptId,message:'This workspace changed. Refresh the latest attempt and try again.',stale:true};
      return { ok: true as const, attemptId, message };
    } catch (error) {
      return { ok: false as const, attemptId, message: genericFailure(error), stale: error instanceof InvalidStateError && /conflict/i.test(error.message) };
    }
  }

  private async create(studentId: string, generation: number) {
    const attemptId = `${studentId}-suncoast-${generation}`;
    const record: AttemptRecord = { session: await createStudentCommandSession(studentId, attemptId, generation), status: 'ACTIVE' };
    await this.repository.create(record);
    return attemptId;
  }

  private async resolve(auth: StudentAuth, requested?: string):Promise<StoredAttempt> {
    const id=requested??(await this.repository.listForStudent(auth.studentId)).at(-1)?.record.session.attemptId;
    const record=id?await this.repository.findOwned(id,auth.studentId):null;
    if(!record)throw new NotFoundError('Attempt not found');
    return record;
  }

  private replaceEvidence(record: AttemptRecord, evidence: StudentCommandSession['coaching']['interaction']['evidence']) {
    record.session = { ...record.session, coaching: { ...record.session.coaching, interaction: { ...record.session.coaching.interaction, evidence } } };
  }
}
