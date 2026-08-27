import { InvalidReferenceError, InvalidStateError, LedgerIntegrityError, NotFoundError } from './errors.js';
import type { BalanceSheet, CaseTemplate, FinancialStatementRow, JournalEntry, JournalLine, ProfitAndLoss, StudentAttempt, TrialBalanceRow } from './model.js';

export interface LabStore {
  findTemplate(id: string): Promise<CaseTemplate | null>;
  findAttemptForStudent(id: string, studentId: string): Promise<StudentAttempt | null>;
  saveAttempt(attempt: StudentAttempt): Promise<void>;
}
export interface IdClock { id(): string; now(): string }
export interface PostLine { attemptAccountId: string; debitCents?: number; creditCents?: number }

function cents(value: number | undefined): number {
  const result = value ?? 0;
  if (!Number.isSafeInteger(result) || result < 0) throw new LedgerIntegrityError('Amounts must be non-negative integer cents');
  return result;
}
export function assertBalanced(lines: readonly PostLine[]): void {
  if (lines.length < 2) throw new LedgerIntegrityError('At least two journal lines are required');
  let debit = 0, credit = 0;
  for (const line of lines) {
    const d = cents(line.debitCents), c = cents(line.creditCents);
    if ((d > 0) === (c > 0)) throw new LedgerIntegrityError('Each line must have exactly one positive side');
    debit += d; credit += c;
  }
  if (debit !== credit) throw new LedgerIntegrityError('Debits and credits must balance');
}

export class PracticeLabService {
  constructor(private readonly store: LabStore, private readonly system: IdClock) {}
  async instantiate(studentId: string, templateId: string): Promise<StudentAttempt> {
    const template = await this.store.findTemplate(templateId);
    if (!template) throw new InvalidReferenceError('Template unavailable');
    const id = this.system.id();
    const attempt: StudentAttempt = Object.freeze({ id, studentId, templateId, generation: 1, status: 'ACTIVE', entries: [], unlockedDocumentIds: [], accounts: template.accounts.map(a => Object.freeze({ ...a, id: this.system.id(), attemptId: id, sourceTemplateAccountId: a.id })), actions: [{ sequence: 1, kind: 'ATTEMPT_CREATED' as const, at: this.system.now(), detail: {} }] });
    await this.store.saveAttempt(attempt); return attempt;
  }
  private async own(studentId: string, attemptId: string): Promise<StudentAttempt> {
    const attempt = await this.store.findAttemptForStudent(attemptId, studentId);
    if (!attempt) throw new NotFoundError('Attempt not found');
    return attempt;
  }
  async post(studentId: string, attemptId: string, input: { description: string; occurredOn: string; lines: readonly PostLine[] }): Promise<JournalEntry> {
    const attempt = await this.own(studentId, attemptId);
    if (attempt.status !== 'ACTIVE') throw new InvalidStateError('Attempt is not writable');
    const accountIds = new Set(attempt.accounts.map(a => a.id));
    if (input.lines.some(l => !accountIds.has(l.attemptAccountId))) throw new InvalidReferenceError('Account is outside this attempt');
    assertBalanced(input.lines);
    const entryId = this.system.id();
    const lines: JournalLine[] = input.lines.map(l => ({ id: this.system.id(), entryId, attemptAccountId: l.attemptAccountId, debitCents: cents(l.debitCents), creditCents: cents(l.creditCents) }));
    const entry = Object.freeze({ id: entryId, attemptId, description: input.description, occurredOn: input.occurredOn, lines });
    const sequence = attempt.actions.length + 1;
    const unlocked = (await this.store.findTemplate(attempt.templateId))!.documents.filter(d => d.unlockAfterAction === sequence).map(d => d.id);
    await this.store.saveAttempt({ ...attempt, entries: [...attempt.entries, entry], unlockedDocumentIds: [...attempt.unlockedDocumentIds, ...unlocked], actions: [...attempt.actions, { sequence, kind: 'JOURNAL_POSTED', at: this.system.now(), detail: { entryId } }, ...unlocked.map((documentId, offset) => ({ sequence: sequence + offset + 1, kind: 'DOCUMENT_UNLOCKED' as const, at: this.system.now(), detail: { documentId } }))] });
    return entry;
  }
  async reset(studentId: string, attemptId: string): Promise<StudentAttempt> {
    const old = await this.own(studentId, attemptId);
    const template = await this.store.findTemplate(old.templateId);
    if (!template) throw new InvalidReferenceError('Template unavailable');
    const id = this.system.id();
    const next: StudentAttempt = { id, studentId, templateId: old.templateId, generation: old.generation + 1, status: 'ACTIVE', entries: [], unlockedDocumentIds: [], accounts: template.accounts.map(a => ({ ...a, id: this.system.id(), attemptId: id, sourceTemplateAccountId: a.id })), actions: [{ sequence: 1, kind: 'ATTEMPT_RESET', at: this.system.now(), detail: { previousAttemptId: old.id } }] };
    await this.store.saveAttempt({ ...old, status: 'RESET' }); await this.store.saveAttempt(next); return next;
  }
}
export function trialBalance(attempt: StudentAttempt): TrialBalanceRow[] {
  return attempt.accounts.map(account => { let net = 0; for (const entry of attempt.entries) for (const line of entry.lines) if (line.attemptAccountId === account.id) net += line.debitCents - line.creditCents; return { accountId: account.id, code: account.code, name: account.name, debitCents: Math.max(net, 0), creditCents: Math.max(-net, 0) }; });
}
function statementRows(attempt: StudentAttempt, kinds: readonly string[], creditNormal: boolean): FinancialStatementRow[] {
  const balances = new Map(trialBalance(attempt).map(row => [row.accountId, row.debitCents - row.creditCents]));
  return attempt.accounts.filter(account => kinds.includes(account.kind)).map(account => ({ accountId: account.id, code: account.code, name: account.name, amountCents: (balances.get(account.id) ?? 0) * (creditNormal ? -1 : 1) }));
}
export function profitAndLoss(attempt: StudentAttempt): ProfitAndLoss {
  const revenue = statementRows(attempt, ['REVENUE'], true), expenses = statementRows(attempt, ['EXPENSE'], false);
  return { revenue, expenses, netIncomeCents: revenue.reduce((sum, row) => sum + row.amountCents, 0) - expenses.reduce((sum, row) => sum + row.amountCents, 0) };
}
export function balanceSheet(attempt: StudentAttempt): BalanceSheet {
  const assets = statementRows(attempt, ['ASSET'], false), liabilities = statementRows(attempt, ['LIABILITY'], true), equity = statementRows(attempt, ['EQUITY'], true);
  const currentEarningsCents = profitAndLoss(attempt).netIncomeCents;
  return { assets, liabilities, equity, currentEarningsCents, totalAssetsCents: assets.reduce((sum, row) => sum + row.amountCents, 0), totalLiabilitiesAndEquityCents: [...liabilities, ...equity].reduce((sum, row) => sum + row.amountCents, 0) + currentEarningsCents };
}
export function studentView(attempt: StudentAttempt) { return { id: attempt.id, templateId: attempt.templateId, generation: attempt.generation, status: attempt.status, accounts: attempt.accounts.map(account => ({ id: account.id, attemptId: account.attemptId, code: account.code, name: account.name, kind: account.kind, operationalRole: account.operationalRole })), entries: attempt.entries, unlockedDocumentIds: attempt.unlockedDocumentIds }; }
