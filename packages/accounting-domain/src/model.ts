export type AccountKind = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
export type AttemptStatus = 'ACTIVE' | 'SUBMITTED' | 'RESET';
export interface TemplateAccount { readonly id: string; readonly code: string; readonly name: string; readonly kind: AccountKind }
export interface CaseTemplate { readonly id: string; readonly slug: string; readonly title: string; readonly scenario: Readonly<Record<string, unknown>>; readonly accounts: readonly TemplateAccount[]; readonly documents: readonly { id: string; title: string; unlockAfterAction: number }[] }
export interface AttemptAccount { readonly id: string; readonly attemptId: string; readonly sourceTemplateAccountId: string; readonly code: string; readonly name: string; readonly kind: AccountKind }
export interface JournalLine { readonly id: string; readonly entryId: string; readonly attemptAccountId: string; readonly debitCents: number; readonly creditCents: number }
export interface JournalEntry { readonly id: string; readonly attemptId: string; readonly description: string; readonly occurredOn: string; readonly lines: readonly JournalLine[] }
export interface AttemptAction { readonly sequence: number; readonly kind: 'ATTEMPT_CREATED' | 'JOURNAL_POSTED' | 'DOCUMENT_UNLOCKED' | 'ATTEMPT_RESET'; readonly at: string; readonly detail: Readonly<Record<string, unknown>> }
export interface StudentAttempt { readonly id: string; readonly studentId: string; readonly templateId: string; readonly generation: number; readonly status: AttemptStatus; readonly accounts: readonly AttemptAccount[]; readonly entries: readonly JournalEntry[]; readonly actions: readonly AttemptAction[]; readonly unlockedDocumentIds: readonly string[] }
export interface TrialBalanceRow { accountId: string; code: string; name: string; debitCents: number; creditCents: number }
export interface FinancialStatementRow { accountId: string; code: string; name: string; amountCents: number }
export interface ProfitAndLoss { revenue: FinancialStatementRow[]; expenses: FinancialStatementRow[]; netIncomeCents: number }
export interface BalanceSheet { assets: FinancialStatementRow[]; liabilities: FinancialStatementRow[]; equity: FinancialStatementRow[]; currentEarningsCents: number; totalAssetsCents: number; totalLiabilitiesAndEquityCents: number }
