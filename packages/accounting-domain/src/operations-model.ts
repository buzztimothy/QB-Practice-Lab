import type { JournalEntry, StudentAttempt } from './model.js';

export type ReportBasis = 'ACCRUAL' | 'CASH';
export type InvoiceStatus = 'OPEN' | 'PAID' | 'VOID';
export type ReconciliationStatus = 'IN_PROGRESS' | 'COMPLETED';
export interface ReportPeriod { readonly from: string; readonly through: string }
export interface OperationalTemplateCustomer { readonly id: string; readonly name: string; readonly active: boolean }

export interface OperationalCustomer { readonly id: string; readonly attemptId: string; readonly sourceTemplateCustomerId?: string; readonly name: string; readonly active: boolean }
export interface InvoiceLineItem { readonly id: string; readonly revenueAccountId: string; readonly description: string; readonly amountCents: number }
export interface OperationalInvoice { readonly id: string; readonly attemptId: string; readonly customerId: string; readonly number: string; readonly invoiceDate: string; readonly dueDate: string; readonly status: InvoiceStatus; readonly arAccountId: string; readonly lineItems: readonly InvoiceLineItem[]; readonly journalEntryId: string }
export interface CustomerPayment { readonly id: string; readonly attemptId: string; readonly customerId: string; readonly paymentDate: string; readonly amountCents: number; readonly destinationAccountId: string; readonly method?: string; readonly reference?: string; readonly journalEntryId: string }
export interface PaymentApplication { readonly id: string; readonly attemptId: string; readonly paymentId: string; readonly invoiceId: string; readonly amountCents: number; readonly appliedAt: string }
export interface BankDeposit { readonly id: string; readonly attemptId: string; readonly depositDate: string; readonly bankAccountId: string; readonly paymentIds: readonly string[]; readonly amountCents: number; readonly journalEntryId: string }
export interface Reconciliation { readonly id: string; readonly attemptId: string; readonly accountId: string; readonly beginningDate: string; readonly endingDate: string; readonly beginningBalanceCents: number; readonly endingBalanceCents: number; readonly clearedJournalLineIds: readonly string[]; readonly clearedLineFingerprints: Readonly<Record<string, string>>; readonly status: ReconciliationStatus; readonly completedAt?: string }
export interface OperationalAttempt { readonly attempt: StudentAttempt; readonly customers: readonly OperationalCustomer[]; readonly invoices: readonly OperationalInvoice[]; readonly payments: readonly CustomerPayment[]; readonly applications: readonly PaymentApplication[]; readonly deposits: readonly BankDeposit[]; readonly reconciliations: readonly Reconciliation[] }
export interface CustomerBalance { readonly customerId: string; readonly invoiceOpenCents: number; readonly unappliedPaymentCents: number; readonly netReceivableCents: number }
export interface InvoiceDetail { readonly invoiceId: string; readonly customerId: string; readonly invoiceDate: string; readonly dueDate: string; readonly amountCents: number; readonly appliedCents: number; readonly openCents: number }
export interface ArAgingDetail extends InvoiceDetail { readonly daysPastDue: number }
export interface ReconciliationResult { readonly calculatedClearedBalanceCents: number; readonly differenceCents: number; readonly balanced: boolean; readonly historicalIntegrity: boolean }
export interface RegisterRow { readonly entry: JournalEntry; readonly lineId: string; readonly debitCents: number; readonly creditCents: number; readonly runningBalanceCents: number }
