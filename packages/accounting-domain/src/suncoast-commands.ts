import { InvalidReferenceError, InvalidStateError, NotFoundError } from './errors.js';
import { assertBalanced } from './service.js';
import { customerBalances, reconciliationResult } from './operations.js';
import type { JournalEntry, JournalLine } from './model.js';
import type { OperationalAttempt, PaymentApplication, Reconciliation } from './operations-model.js';
import { coachingStudentView, deriveSuncoastCoaching, type HelpLevel, type SuncoastCoachingAttempt } from './suncoast-coaching.js';
import { p002StudentView, recordP002Action, type P002ActionKind, type P002CriticalHook, type P002InstructorState } from './suncoast-student-start.js';

export type StudentHelpContext = 'INDEPENDENT' | HelpLevel;
export interface StudentCommandContext { readonly expectedRevision: number; readonly idempotencyKey: string; readonly help: StudentHelpContext; readonly note?: string }
interface CommandReceipt { readonly idempotencyKey: string; readonly fingerprint: string; readonly commandId: string; readonly revision: number }
export interface StudentCommandSession { readonly attemptId: string; readonly studentId: string; readonly revision: number; readonly coaching: SuncoastCoachingAttempt; readonly receipts: readonly CommandReceipt[]; readonly excludedBankActivities: readonly JournalEntry[] }

export type StudentBookkeepingCommand =
  | { readonly type: 'REVIEW'; readonly targetId: string }
  | { readonly type: 'VERIFY_UNCHANGED'; readonly targetId: string }
  | { readonly type: 'FLAG_UNRESOLVED'; readonly targetId: string }
  | { readonly type: 'MATCH'; readonly bankActivityId: string; readonly targetId: string }
  | { readonly type: 'CATEGORIZE'; readonly entryId: string; readonly accountId: string }
  | { readonly type: 'TRANSFER'; readonly entryId: string; readonly balanceSheetAccountId: string }
  | { readonly type: 'EXCLUDE'; readonly entryId: string }
  | { readonly type: 'VOID'; readonly entryId: string }
  | { readonly type: 'REAPPLY_PAYMENT'; readonly paymentId: string; readonly fromInvoiceId: string; readonly toInvoiceId: string }
  | { readonly type: 'CORRECT_OWNER_CONTRIBUTION'; readonly entryId: string }
  | { readonly type: 'CORRECT_PRESSURE_WASHER'; readonly entryId: string }
  | { readonly type: 'CORRECT_VEHICLE_LOAN'; readonly entryId: string }
  | { readonly type: 'CORRECT_PAYROLL'; readonly entryIds: readonly string[] }
  | { readonly type: 'RESOLVE_ABC'; readonly entryId: string }
  | { readonly type: 'RESOLVE_PERSONAL_CARD'; readonly entryId: string }
  | { readonly type: 'CORRECT_CARD_PAYMENT'; readonly entryId: string }
  | { readonly type: 'CORRECT_DEPOSIT_TRANSFER'; readonly entryId: string }
  | { readonly type: 'RESTORE_HISTORICAL_TRANSACTION'; readonly entryId: string }
  | { readonly type: 'CONSOLIDATE_ACCOUNTS'; readonly sourceAccountIds: readonly string[]; readonly targetAccountId: string }
  | { readonly type: 'SET_RECONCILIATION_LINE'; readonly reconciliationId: string; readonly lineId: string; readonly cleared: boolean }
  | { readonly type: 'FINISH_RECONCILIATION'; readonly reconciliationId: string };

const deepFreeze = <T>(value: T): T => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const item of Object.values(value)) deepFreeze(item); } return value; };
const p002 = (value: StudentCommandSession) => value.coaching.interaction.evidence.p002;
const state = (value: StudentCommandSession) => p002(value).attempt.state;
const fingerprint = (command: StudentBookkeepingCommand) => JSON.stringify(command);
const visibleDocument = (value: StudentCommandSession, id: string) => value.coaching.interaction.evidence.documents.some(document => document.id === id && (document.state === 'AVAILABLE_AT_START' || document.state === 'UNLOCKED'));
const account = (value: OperationalAttempt, id: string) => { const found = value.attempt.accounts.find(item => item.id === id); if (!found) throw new InvalidReferenceError('Command unavailable'); return found; };
const accountNamed = (value: OperationalAttempt, name: string) => { const found = value.attempt.accounts.find(item => item.name === name); if (!found) throw new InvalidReferenceError('Command unavailable'); return found; };
const entry = (value: OperationalAttempt, id: string) => { const found = value.attempt.entries.find(item => item.id === id); if (!found) throw new InvalidReferenceError('Command unavailable'); return found; };
const targetExists = (value: OperationalAttempt, id: string) => value.attempt.entries.some(item => item.id === id) || value.attempt.accounts.some(item => item.id === id) || value.customers.some(item => item.id === id) || value.invoices.some(item => item.id === id) || value.payments.some(item => item.id === id) || value.deposits.some(item => item.id === id) || value.reconciliations.some(item => item.id === id);
const lineSnapshot = (value: JournalEntry) => value.lines.map(line => ({ accountId: line.attemptAccountId, debitCents: line.debitCents, creditCents: line.creditCents }));
const assertEntry = (value: JournalEntry) => assertBalanced(value.lines.map(line => ({ attemptAccountId: line.attemptAccountId, debitCents: line.debitCents, creditCents: line.creditCents })));
const inPeriod = (entryValue: JournalEntry, reconciliation: Reconciliation) => entryValue.occurredOn >= reconciliation.beginningDate && entryValue.occurredOn <= reconciliation.endingDate;
function missingHistoricalLineId(value: OperationalAttempt, accountId: string, debitCents: number, creditCents: number): string | undefined { const live = new Map(value.attempt.entries.flatMap(item => item.lines.map(line => [line.id, `${line.debitCents}:${line.creditCents}:${line.attemptAccountId}`] as const))); const expected = `${debitCents}:${creditCents}:${accountId}`; return value.reconciliations.filter(item => item.status === 'COMPLETED').flatMap(item => Object.entries(item.clearedLineFingerprints)).find(([id, stored]) => stored === expected && live.get(id) !== expected)?.[0]; }
function replaceLineId(value: OperationalAttempt, entryId: string, predicate: (line: JournalLine) => boolean, id: string | undefined): OperationalAttempt { if (!id) return value; return { ...value, attempt: { ...value.attempt, entries: value.attempt.entries.map(item => item.id === entryId ? { ...item, lines: item.lines.map((line, index) => predicate(line) ? { ...line, id } : line.id === id ? { ...line, id: `${item.id}-superseded-${index + 1}` } : line) } : item) } }; }

function replaceEntry(value: OperationalAttempt, entryId: string, specs: readonly { readonly accountId: string; readonly debitCents?: number; readonly creditCents?: number }[], description?: string, sourceKind?: string): OperationalAttempt {
  const current = entry(value, entryId); for (const spec of specs) account(value, spec.accountId);
  const lines: JournalLine[] = specs.map((spec, index) => ({ id: current.lines[index]?.id ?? `${current.id}-correction-line-${index + 1}`, entryId: current.id, attemptAccountId: spec.accountId, debitCents: spec.debitCents ?? 0, creditCents: spec.creditCents ?? 0 }));
  const next: JournalEntry = { ...current, description: description ?? current.description, source: sourceKind ? { kind: sourceKind, id: current.source?.id ?? `${current.id}-source` } : current.source, lines }; assertEntry(next);
  const entries = value.attempt.entries.map(item => item.id === entryId ? next : item); const lineAccounts = new Map(entries.flatMap(item => item.lines.map(line => [line.id, line.attemptAccountId] as const)));
  const reconciliations = value.reconciliations.map(reconciliation => reconciliation.status === 'COMPLETED' ? reconciliation : { ...reconciliation, clearedJournalLineIds: reconciliation.clearedJournalLineIds.filter(id => lineAccounts.get(id) === reconciliation.accountId), clearedLineFingerprints: Object.fromEntries(Object.entries(reconciliation.clearedLineFingerprints).filter(([id]) => lineAccounts.get(id) === reconciliation.accountId)) });
  return { ...value, attempt: { ...value.attempt, entries }, reconciliations };
}

function removeEntry(value: OperationalAttempt, entryId: string): OperationalAttempt {
  entry(value, entryId); const entries = value.attempt.entries.filter(item => item.id !== entryId); const liveLines = new Set(entries.flatMap(item => item.lines.map(line => line.id)));
  const reconciliations = value.reconciliations.map(reconciliation => reconciliation.status === 'COMPLETED' ? reconciliation : { ...reconciliation, clearedJournalLineIds: reconciliation.clearedJournalLineIds.filter(id => liveLines.has(id)), clearedLineFingerprints: Object.fromEntries(Object.entries(reconciliation.clearedLineFingerprints).filter(([id]) => liveLines.has(id))) });
  return { ...value, attempt: { ...value.attempt, entries }, reconciliations };
}

const protectedHook = (value: P002InstructorState, targetId: string): P002CriticalHook | undefined => {
  const scenario = value.provenance.find(item => [...item.cleanRecordIds, ...item.studentRecordIds].includes(targetId))?.scenarioId;
  return (Object.entries(value.criticalHooks).find(([, id]) => id === scenario)?.[0]) as P002CriticalHook | undefined;
};
const wasPreviouslyChanged = (value: P002InstructorState, targetId: string) => value.attempt.auditTrail.some(event => event.targetId === targetId && ['ACCOUNT_CHANGED', 'TRANSACTION_VOIDED', 'HISTORICAL_TRANSACTION_ALTERED', 'RECONCILIATION_ADJUSTMENT_ATTEMPTED'].includes(event.action));

function withMutation(session: StudentCommandSession, nextState: OperationalAttempt, input: { readonly action: P002ActionKind; readonly targetId: string; readonly context: StudentCommandContext; readonly before: unknown; readonly after: unknown; readonly hook?: P002CriticalHook; readonly correct?: boolean }): StudentCommandSession {
  if (nextState.attempt.id !== session.attemptId || nextState.attempt.studentId !== session.studentId) throw new InvalidReferenceError('Command unavailable'); for (const item of nextState.attempt.entries) assertEntry(item);
  const revision = session.revision + 1, oldP002 = p002(session); const updated = { ...oldP002, attempt: { ...oldP002.attempt, state: nextState } };
  const audited = recordP002Action(updated, input.action, input.targetId, { hook: input.hook, selfCorrected: input.correct && wasPreviouslyChanged(oldP002, input.targetId), helpLevel: input.context.help === 'INDEPENDENT' ? undefined : input.context.help, commandId: `${session.attemptId}-command-${revision}`, revision, before: input.before, after: input.after });
  const coaching = { ...session.coaching, interaction: { ...session.coaching.interaction, evidence: { ...session.coaching.interaction.evidence, p002: audited } } };
  return deepFreeze({ ...session, revision, coaching });
}

function categorize(session: StudentCommandSession, command: Extract<StudentBookkeepingCommand, { type: 'CATEGORIZE' | 'TRANSFER' }>, context: StudentCommandContext): StudentCommandSession {
  const currentState = state(session), current = entry(currentState, command.entryId); if (current.lines.length !== 2) throw new InvalidStateError('Command unavailable');
  const targetId = command.type === 'CATEGORIZE' ? command.accountId : command.balanceSheetAccountId, target = account(currentState, targetId); const cashLine = current.lines.find(line => account(currentState, line.attemptAccountId).operationalRole === 'BANK' || account(currentState, line.attemptAccountId).operationalRole === 'CREDIT_CARD');
  if (!cashLine || target.id === cashLine.attemptAccountId || command.type === 'TRANSFER' && !['ASSET', 'LIABILITY', 'EQUITY'].includes(target.kind)) throw new InvalidReferenceError('Command unavailable');
  const other = current.lines.find(line => line.id !== cashLine.id)!; const specs = current.lines.map(line => line.id === other.id ? { accountId: target.id, debitCents: line.debitCents, creditCents: line.creditCents } : { accountId: line.attemptAccountId, debitCents: line.debitCents, creditCents: line.creditCents });
  return withMutation(session, replaceEntry(currentState, current.id, specs), { action: 'ACCOUNT_CHANGED', targetId: current.id, context, before: lineSnapshot(current), after: specs });
}

function match(session: StudentCommandSession, command: Extract<StudentBookkeepingCommand, { type: 'MATCH' }>, context: StudentCommandContext): StudentCommandSession {
  let currentState = state(session); const bank = entry(currentState, command.bankActivityId); if (p002(session).attempt.auditTrail.some(event => event.targetId === bank.id && event.action === 'TRANSACTION_CORRECTED')) throw new InvalidStateError('Command already completed');
  const payment = currentState.payments.find(item => item.id === command.targetId); const targetEntry = currentState.attempt.entries.find(item => item.id === command.targetId);
  if (payment?.reference === 'RCPT-MARTINEZ-0612' && bank.source?.kind === 'P002_ADDED_BANK_INCOME') {
    if (currentState.deposits.some(deposit => deposit.paymentIds.includes(payment.id))) throw new InvalidStateError('Command already completed'); const bankAccount = accountNamed(currentState, 'Operating Checking'), uf = accountNamed(currentState, 'Undeposited Funds');
    currentState = replaceEntry(currentState, bank.id, [{ accountId: bankAccount.id, debitCents: payment.amountCents }, { accountId: uf.id, creditCents: payment.amountCents }], 'Bank deposit', 'BANK_DEPOSIT');
    currentState = replaceLineId(currentState, bank.id, line => line.attemptAccountId === bankAccount.id, missingHistoricalLineId(currentState, bankAccount.id, payment.amountCents, 0));
    currentState = { ...currentState, deposits: [...currentState.deposits, { id: `${session.attemptId}-matched-martinez-deposit`, attemptId: session.attemptId, depositDate: bank.occurredOn, bankAccountId: bankAccount.id, paymentIds: [payment.id], amountCents: payment.amountCents, journalEntryId: bank.id }] };
  } else if (targetEntry && bank.source?.kind === 'P002_ADDED_NOT_MATCHED' && targetEntry.id !== bank.id && targetEntry.occurredOn === bank.occurredOn && lineSnapshot(targetEntry).reduce((sum, line) => sum + line.debitCents, 0) === lineSnapshot(bank).reduce((sum, line) => sum + line.debitCents, 0)) currentState = removeEntry(currentState, bank.id);
  else throw new InvalidReferenceError('Command unavailable');
  return withMutation(session, currentState, { action: 'TRANSACTION_CORRECTED', targetId: bank.id, context, before: lineSnapshot(bank), after: currentState.attempt.entries.find(item => item.id === bank.id) ? lineSnapshot(entry(currentState, bank.id)) : { matchedTo: command.targetId }, correct: true });
}

function correctNamed(session: StudentCommandSession, command: Exclude<StudentBookkeepingCommand, { type: 'REVIEW' | 'VERIFY_UNCHANGED' | 'FLAG_UNRESOLVED' | 'MATCH' | 'CATEGORIZE' | 'TRANSFER' | 'EXCLUDE' | 'VOID' | 'REAPPLY_PAYMENT' | 'CORRECT_PAYROLL' | 'CONSOLIDATE_ACCOUNTS' | 'SET_RECONCILIATION_LINE' | 'FINISH_RECONCILIATION' }>, context: StudentCommandContext): StudentCommandSession {
  const currentState = state(session), current = entry(currentState, command.entryId); let specs: readonly { accountId: string; debitCents?: number; creditCents?: number }[];
  if (command.type === 'CORRECT_OWNER_CONTRIBUTION') specs = [{ accountId: accountNamed(currentState, 'Operating Checking').id, debitCents: 500000 }, { accountId: accountNamed(currentState, 'Owner Contributions').id, creditCents: 500000 }];
  else if (command.type === 'CORRECT_PRESSURE_WASHER') specs = [{ accountId: accountNamed(currentState, 'Tools & Equipment').id, debitCents: 680000 }, { accountId: accountNamed(currentState, 'Operating Checking').id, creditCents: 680000 }];
  else if (command.type === 'CORRECT_VEHICLE_LOAN') { if (!visibleDocument(session, 'vehicle-loan-june')) throw new InvalidReferenceError('Command unavailable'); specs = [{ accountId: accountNamed(currentState, 'Vehicle Loan Payable').id, debitCents: 69000 }, { accountId: accountNamed(currentState, 'Interest Expense').id, debitCents: 23500 }, { accountId: accountNamed(currentState, 'Operating Checking').id, creditCents: 92500 }]; }
  else if (command.type === 'RESOLVE_ABC') { if (!visibleDocument(session, 'abc-deposit-agreement')) throw new InvalidReferenceError('Command unavailable'); specs = [{ accountId: accountNamed(currentState, 'Trailer Deposit').id, debitCents: 240000 }, { accountId: accountNamed(currentState, 'Operating Checking').id, creditCents: 240000 }]; }
  else if (command.type === 'RESOLVE_PERSONAL_CARD') { if (!visibleDocument(session, 'card-clarification-0624')) throw new InvalidReferenceError('Command unavailable'); specs = [{ accountId: accountNamed(currentState, 'Owner Draws').id, debitCents: 28643 }, { accountId: accountNamed(currentState, 'Gulf Coast Business Visa').id, creditCents: 28643 }]; }
  else if (command.type === 'CORRECT_CARD_PAYMENT') specs = [{ accountId: accountNamed(currentState, 'Gulf Coast Business Visa').id, debitCents: 350000 }, { accountId: accountNamed(currentState, 'Operating Checking').id, creditCents: 350000 }];
  else if (command.type === 'CORRECT_DEPOSIT_TRANSFER') { const amount = current.lines.reduce((sum, line) => sum + line.debitCents, 0); specs = [{ accountId: accountNamed(currentState, 'Operating Checking').id, debitCents: amount }, { accountId: accountNamed(currentState, 'Undeposited Funds').id, creditCents: amount }]; }
  else { const completed = currentState.reconciliations.filter(item => item.status === 'COMPLETED' && item.clearedJournalLineIds.some(id => current.lines.some(line => line.id === id))); const prior = new Map<string, string>(); for (const reconciliation of completed) for (const line of current.lines) if (reconciliation.clearedLineFingerprints[line.id]) prior.set(line.id, reconciliation.clearedLineFingerprints[line.id]); if (prior.size === 0) throw new InvalidReferenceError('Command unavailable'); const known = [...prior.values()].map(value => value.split(':')).reduce((sum, [debit, credit]) => sum + Number(debit) + Number(credit), 0); specs = current.lines.map(line => { const stored = prior.get(line.id); if (stored) { const [debit, credit, accountId] = stored.split(':'); return { accountId, debitCents: Number(debit), creditCents: Number(credit) }; } return line.debitCents > 0 ? { accountId: line.attemptAccountId, debitCents: known } : { accountId: line.attemptAccountId, creditCents: known }; }); }
  let next = replaceEntry(currentState, current.id, specs); for (const spec of specs) { const debitCents = spec.debitCents ?? 0, creditCents = spec.creditCents ?? 0; next = replaceLineId(next, current.id, line => line.attemptAccountId === spec.accountId && line.debitCents === debitCents && line.creditCents === creditCents, missingHistoricalLineId(next, spec.accountId, debitCents, creditCents)); } return withMutation(session, next, { action: 'TRANSACTION_CORRECTED', targetId: current.id, context, before: lineSnapshot(current), after: specs, correct: true });
}

function payroll(session: StudentCommandSession, command: Extract<StudentBookkeepingCommand, { type: 'CORRECT_PAYROLL' }>, context: StudentCommandContext): StudentCommandSession {
  if (!visibleDocument(session, 'payroll-report-june-14') || command.entryIds.length !== 3) throw new InvalidReferenceError('Command unavailable'); let next = state(session); const originals = command.entryIds.map(id => entry(next, id)); if (originals.some(item => item.source?.kind !== 'P002_SIMPLIFIED_PAYROLL')) throw new InvalidReferenceError('Command unavailable');
  const checking = accountNamed(next, 'Operating Checking').id, liability = accountNamed(next, 'Payroll Liabilities').id;
  next = replaceEntry(next, originals[0].id, [{ accountId: accountNamed(next, 'Payroll Expense').id, debitCents: 980000 }, { accountId: accountNamed(next, 'Employer Payroll Tax Expense').id, debitCents: 90000 }, { accountId: liability, creditCents: 269970 }, { accountId: checking, creditCents: 800030 }], 'June payroll — recognize wages, taxes, and net-pay withdrawal', 'PAYROLL_CYCLE');
  next = replaceLineId(next, originals[0].id, line => line.attemptAccountId === checking, missingHistoricalLineId(next, checking, 0, 800030));
  next = replaceEntry(next, originals[1].id, [{ accountId: liability, debitCents: 269970 }, { accountId: checking, creditCents: 269970 }], 'June payroll — tax funding and remittance', 'PAYROLL_TAX_REMITTANCE');
  next = replaceLineId(next, originals[1].id, line => line.attemptAccountId === checking, missingHistoricalLineId(next, checking, 0, 269970));
  next = replaceEntry(next, originals[2].id, [{ accountId: accountNamed(next, 'Professional Fees').id, debitCents: 10000 }, { accountId: checking, creditCents: 10000 }], 'June payroll — provider fee', 'PAYROLL_PROVIDER_FEE');
  next = replaceLineId(next, originals[2].id, line => line.attemptAccountId === checking, missingHistoricalLineId(next, checking, 0, 10000));
  return withMutation(session, next, { action: 'TRANSACTION_CORRECTED', targetId: originals[0].id, context, before: originals.map(lineSnapshot), after: command.entryIds.map(id => lineSnapshot(entry(next, id))), correct: true });
}

function reapply(session: StudentCommandSession, command: Extract<StudentBookkeepingCommand, { type: 'REAPPLY_PAYMENT' }>, context: StudentCommandContext): StudentCommandSession {
  const currentState = state(session), payment = currentState.payments.find(item => item.id === command.paymentId), from = currentState.invoices.find(item => item.id === command.fromInvoiceId), to = currentState.invoices.find(item => item.id === command.toInvoiceId); if (!payment || !from || !to || payment.customerId !== from.customerId || payment.customerId !== to.customerId) throw new InvalidReferenceError('Command unavailable');
  const applications = currentState.applications.filter(item => item.paymentId === payment.id), moving = applications.find(item => item.invoiceId === from.id); if (!moving || moving.amountCents > to.lineItems.reduce((sum, item) => sum + item.amountCents, 0)) throw new InvalidStateError('Command unavailable');
  const updated: PaymentApplication = { ...moving, invoiceId: to.id, appliedAt: `2026-07-02T11:${String(session.revision).padStart(2, '0')}:00.000Z` }; const nextApplications = currentState.applications.map(item => item.id === moving.id ? updated : item);
  const invoiceOpen = (invoiceId: string) => currentState.invoices.find(item => item.id === invoiceId)!.lineItems.reduce((sum, item) => sum + item.amountCents, 0) - nextApplications.filter(item => item.invoiceId === invoiceId).reduce((sum, item) => sum + item.amountCents, 0);
  const next = { ...currentState, applications: nextApplications, invoices: currentState.invoices.map(item => item.id === from.id || item.id === to.id ? { ...item, status: invoiceOpen(item.id) === 0 ? 'PAID' as const : 'OPEN' as const } : item) }; if (customerBalances(next).some(() => false)) throw new InvalidStateError('Command unavailable');
  return withMutation(session, next, { action: 'TRANSACTION_CORRECTED', targetId: moving.id, context, before: moving, after: updated, correct: true });
}

function consolidate(session: StudentCommandSession, command: Extract<StudentBookkeepingCommand, { type: 'CONSOLIDATE_ACCOUNTS' }>, context: StudentCommandContext): StudentCommandSession {
  const currentState = state(session), target = account(currentState, command.targetAccountId), sources = command.sourceAccountIds.map(id => account(currentState, id)); if (!sources.length || new Set(command.sourceAccountIds).size !== sources.length || sources.some(item => item.id === target.id || item.kind !== target.kind || !item.sourceTemplateAccountId.startsWith('attempt-only-'))) throw new InvalidReferenceError('Command unavailable');
  const sourceIds = new Set(sources.map(item => item.id)); const entries = currentState.attempt.entries.map(item => ({ ...item, lines: item.lines.map(line => sourceIds.has(line.attemptAccountId) ? { ...line, attemptAccountId: target.id } : line) })); const next = { ...currentState, attempt: { ...currentState.attempt, accounts: currentState.attempt.accounts.filter(item => !sourceIds.has(item.id)), entries } };
  return withMutation(session, next, { action: 'ACCOUNT_CONSOLIDATED', targetId: sources[0].id, context, before: sources, after: target, correct: true });
}

function reconciliation(session: StudentCommandSession, command: Extract<StudentBookkeepingCommand, { type: 'SET_RECONCILIATION_LINE' | 'FINISH_RECONCILIATION' }>, context: StudentCommandContext): StudentCommandSession {
  const currentState = state(session), current = currentState.reconciliations.find(item => item.id === command.reconciliationId); if (!current || current.status !== 'IN_PROGRESS') throw new InvalidReferenceError('Command unavailable'); let updated: Reconciliation;
  if (command.type === 'SET_RECONCILIATION_LINE') { const targetEntry = currentState.attempt.entries.find(item => item.lines.some(line => line.id === command.lineId)); const targetLine = targetEntry?.lines.find(line => line.id === command.lineId); if (!targetEntry || !targetLine || targetLine.attemptAccountId !== current.accountId || !inPeriod(targetEntry, current)) throw new InvalidReferenceError('Command unavailable'); const eligibleLines = new Map(currentState.attempt.entries.filter(item => inPeriod(item, current)).flatMap(item => item.lines).filter(line => line.attemptAccountId === current.accountId).map(line => [line.id, line] as const)); const selected = new Set(current.clearedJournalLineIds.filter(id => eligibleLines.has(id))); if (command.cleared) selected.add(targetLine.id); else selected.delete(targetLine.id); updated = { ...current, clearedJournalLineIds: [...selected], clearedLineFingerprints: Object.fromEntries([...selected].map(id => { const line = eligibleLines.get(id)!; return [id, `${line.debitCents}:${line.creditCents}:${line.attemptAccountId}`]; })) }; }
  else { const result = reconciliationResult(currentState, current); if (!result.balanced || !result.historicalIntegrity || currentState.reconciliations.filter(item => item.status === 'COMPLETED').some(item => !reconciliationResult(currentState, item).historicalIntegrity)) throw new InvalidStateError('Reconciliation is not ready'); updated = { ...current, status: 'COMPLETED', completedAt: `2026-07-02T12:${String(session.revision).padStart(2, '0')}:00.000Z` }; }
  const next = { ...currentState, reconciliations: currentState.reconciliations.map(item => item.id === current.id ? updated : item) }; return withMutation(session, next, { action: 'RECONCILIATION_ACTIVITY', targetId: current.id, context, before: current, after: updated, correct: command.type === 'FINISH_RECONCILIATION' });
}

export async function createStudentCommandSession(studentId: string, attemptId: string, generation = 1): Promise<StudentCommandSession> { return deepFreeze({ attemptId, studentId, revision: 0, coaching: await deriveSuncoastCoaching(studentId, attemptId, generation), receipts: [], excludedBankActivities: [] }); }

export function executeStudentCommand(session: StudentCommandSession, command: StudentBookkeepingCommand, context: StudentCommandContext): StudentCommandSession {
  if (!context.idempotencyKey || context.idempotencyKey.length > 100) throw new InvalidReferenceError('Command unavailable'); const inputFingerprint = fingerprint(command), receipt = session.receipts.find(item => item.idempotencyKey === context.idempotencyKey); if (receipt) { if (receipt.fingerprint !== inputFingerprint) throw new InvalidStateError('Command conflict'); return session; }
  if (context.expectedRevision !== session.revision) throw new InvalidStateError('Command conflict'); let result: StudentCommandSession;
  if (command.type === 'REVIEW' || command.type === 'VERIFY_UNCHANGED' || command.type === 'FLAG_UNRESOLVED') { if (!targetExists(state(session), command.targetId)) throw new InvalidReferenceError('Command unavailable'); result = withMutation(session, state(session), { action: command.type === 'REVIEW' ? 'TRANSACTION_REVIEWED' : command.type === 'VERIFY_UNCHANGED' ? 'CONTROL_VERIFIED' : 'ISSUE_FLAGGED', targetId: command.targetId, context, before: null, after: { reviewed: true }, correct: command.type === 'VERIFY_UNCHANGED' }); }
  else if (command.type === 'MATCH') result = match(session, command, context);
  else if (command.type === 'CATEGORIZE' || command.type === 'TRANSFER') result = categorize(session, command, context);
  else if (command.type === 'EXCLUDE' || command.type === 'VOID') { const current = entry(state(session), command.entryId), hook = protectedHook(p002(session), current.id); result = withMutation(session, removeEntry(state(session), current.id), { action: 'TRANSACTION_VOIDED', targetId: current.id, context, before: lineSnapshot(current), after: { excluded: command.type === 'EXCLUDE' }, hook, correct: !hook }); if (command.type === 'EXCLUDE') result = deepFreeze({ ...result, excludedBankActivities: [...session.excludedBankActivities, current] }); }
  else if (command.type === 'REAPPLY_PAYMENT') result = reapply(session, command, context);
  else if (command.type === 'CORRECT_PAYROLL') result = payroll(session, command, context);
  else if (command.type === 'CONSOLIDATE_ACCOUNTS') result = consolidate(session, command, context);
  else if (command.type === 'SET_RECONCILIATION_LINE' || command.type === 'FINISH_RECONCILIATION') result = reconciliation(session, command, context);
  else result = correctNamed(session, command, context);
  const nextReceipt: CommandReceipt = { idempotencyKey: context.idempotencyKey, fingerprint: inputFingerprint, commandId: `${session.attemptId}-command-${result.revision}`, revision: result.revision }; return deepFreeze({ ...result, receipts: [...result.receipts, nextReceipt] });
}

export function studentCommandView(value: StudentCommandSession) { return deepFreeze({ attemptNumber: value.coaching.generation, revision: value.revision, bookkeeping: p002StudentView(p002(value)), excludedBankActivities: value.excludedBankActivities.map(item => ({ id: item.id, occurredOn: item.occurredOn, description: 'Excluded bank activity', status: 'EXCLUDED' as const })), coaching: coachingStudentView(value.coaching), commands: value.receipts.map(item => ({ commandId: item.commandId, revision: item.revision })) }); }

export interface StudentCommandStore { findForStudent(attemptId: string, studentId: string): Promise<StudentCommandSession | null>; save(value: StudentCommandSession): Promise<void> }
export class StudentBookkeepingCommandService {
  constructor(private readonly store: StudentCommandStore) {}
  async view(studentId: string, attemptId: string) { return studentCommandView(await this.owned(studentId, attemptId)); }
  async execute(studentId: string, attemptId: string, command: StudentBookkeepingCommand, context: StudentCommandContext) { const current = await this.owned(studentId, attemptId), updated = executeStudentCommand(current, command, context); await this.store.save(updated); return studentCommandView(updated); }
  private async owned(studentId: string, attemptId: string) { const value = await this.store.findForStudent(attemptId, studentId); if (!value) throw new NotFoundError('Attempt not found'); return value; }
}
