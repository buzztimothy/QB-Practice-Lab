import { describe, expect, it } from 'vitest';
import { InvalidReferenceError, InvalidStateError } from '../packages/accounting-domain/src/errors.js';
import { reconciliationResult } from '../packages/accounting-domain/src/operations.js';
import { compareAccountingCompletion, deriveSuncoastAssessment } from '../packages/accounting-domain/src/suncoast-assessment.js';
import { sendMessageWithCoaching } from '../packages/accounting-domain/src/suncoast-coaching.js';
import { StudentBookkeepingCommandService, createStudentCommandSession, executeStudentCommand, studentCommandView, type StudentBookkeepingCommand, type StudentCommandSession } from '../packages/accounting-domain/src/suncoast-commands.js';

const p002 = (value: StudentCommandSession) => value.coaching.interaction.evidence.p002;
const state = (value: StudentCommandSession) => p002(value).attempt.state;
const byDescription = (value: StudentCommandSession, text: string) => state(value).attempt.entries.find(item => item.description.includes(text))!;
const bySource = (value: StudentCommandSession, kind: string) => state(value).attempt.entries.filter(item => item.source?.kind === kind);
const account = (value: StudentCommandSession, name: string) => state(value).attempt.accounts.find(item => item.name === name)!;
const run = (value: StudentCommandSession, command: StudentBookkeepingCommand, options: { key?: string; revision?: number; help?: 'INDEPENDENT' | 'HINT' | 'DIRECTION' | 'WALKTHROUGH' } = {}) => executeStudentCommand(value, command, { expectedRevision: options.revision ?? value.revision, idempotencyKey: options.key ?? `key-${value.revision + 1}`, help: options.help ?? 'INDEPENDENT' });
const unlock = (value: StudentCommandSession, message: string) => ({ ...value, coaching: sendMessageWithCoaching(value.coaching, value.coaching.interaction.conversations[0].id, message) });

describe('P-008A student bookkeeping command foundation', () => {
  it('reviews, categorizes, transfers, and preserves balanced journal mechanics', async () => {
    let value = await createStudentCommandSession('student-a', 'attempt-a'); const owner = byDescription(value, 'Owner contribution');
    value = run(value, { type: 'REVIEW', targetId: owner.id });
    value = run(value, { type: 'CATEGORIZE', entryId: owner.id, accountId: account(value, 'Owner Contributions').id });
    const cardPayment = bySource(value, 'CARD_PAYMENT')[0]; value = run(value, { type: 'TRANSFER', entryId: cardPayment.id, balanceSheetAccountId: account(value, 'Gulf Coast Business Visa').id });
    expect(state(value).attempt.entries.every(item => item.lines.reduce((sum, line) => sum + line.debitCents - line.creditCents, 0) === 0)).toBe(true);
    expect(p002(value).attempt.auditTrail.map(item => item.action)).toEqual(['TRANSACTION_REVIEWED', 'ACCOUNT_CHANGED', 'ACCOUNT_CHANGED']);
  });

  it('matches Susan without duplicate revenue and rejects duplicate/incompatible matches', async () => {
    let value = await createStudentCommandSession('student-a', 'attempt-a'); const bank = bySource(value, 'P002_ADDED_BANK_INCOME')[0], payment = state(value).payments.find(item => item.reference === 'RCPT-MARTINEZ-0612')!;
    value = run(value, { type: 'MATCH', bankActivityId: bank.id, targetId: payment.id }, { key: 'match' });
    expect(state(value).deposits.find(item => item.paymentIds.includes(payment.id))?.journalEntryId).toBe(bank.id);
    expect(bySource(value, 'P002_ADDED_BANK_INCOME')).toHaveLength(0);
    expect(run(value, { type: 'MATCH', bankActivityId: bank.id, targetId: payment.id }, { key: 'match' })).toBe(value);
    expect(() => run(value, { type: 'MATCH', bankActivityId: bank.id, targetId: payment.id })).toThrow();
    const other = await createStudentCommandSession('student-a', 'attempt-b'); const badBank = bySource(other, 'P002_ADDED_NOT_MATCHED')[0];
    expect(() => run(other, { type: 'MATCH', bankActivityId: badBank.id, targetId: payment.id })).toThrow(InvalidReferenceError);
  });

  it('voids/excludes attempt records idempotently and captures protected critical actions', async () => {
    let value = await createStudentCommandSession('student-a', 'attempt-a'); const duplicate = bySource(value, 'P002_UNSUPPORTED_DUPLICATE')[0];
    value = run(value, { type: 'VOID', entryId: duplicate.id }, { key: 'void' }); expect(state(value).attempt.entries.some(item => item.id === duplicate.id)).toBe(false);
    expect(run(value, { type: 'VOID', entryId: duplicate.id }, { key: 'void' })).toBe(value);
    let protectedValue = await createStudentCommandSession('student-a', 'protected'); const homeDepot = state(protectedValue).attempt.entries.find(item => item.occurredOn === '2026-06-22' && item.source?.kind === 'CARD_PURCHASE')!;
    protectedValue = run(protectedValue, { type: 'EXCLUDE', entryId: homeDepot.id });
    expect(p002(protectedValue).attempt.auditTrail.at(-1)?.hook).toBe('HOME_DEPOT_SUPPORTED_REMOVED');
    expect(protectedValue.excludedBankActivities).toContainEqual(homeDepot);
    const owner = byDescription(protectedValue, 'Owner contribution'); protectedValue = run(protectedValue, { type: 'CORRECT_OWNER_CONTRIBUTION', entryId: owner.id });
    const assessment = deriveSuncoastAssessment(protectedValue.coaching); expect(assessment.evidence.some(item => item.criticalHook === 'HOME_DEPOT_SUPPORTED_REMOVED' && !item.resolved)).toBe(true); expect(assessment.evidence.at(-1)?.outcome).toBe('CORRECT');
    expect(JSON.stringify(studentCommandView(protectedValue))).not.toContain('HOME_DEPOT_SUPPORTED_REMOVED');
  });

  it('corrects owner contribution, pressure washer, loan split, transfer, card payment, and rent duplicate', async () => {
    let value = await createStudentCommandSession('student-a', 'attempt-a');
    value = run(value, { type: 'CORRECT_OWNER_CONTRIBUTION', entryId: byDescription(value, 'Owner contribution').id });
    value = run(value, { type: 'CORRECT_PRESSURE_WASHER', entryId: byDescription(value, 'Commercial pressure washer').id });
    value = run(value, { type: 'CORRECT_VEHICLE_LOAN', entryId: byDescription(value, 'Vehicle loan payment').id });
    value = run(value, { type: 'CORRECT_DEPOSIT_TRANSFER', entryId: state(value).deposits.find(item => item.paymentIds.some(id => state(value).payments.find(payment => payment.id === id)?.reference === 'RCPT-PAINT-0628'))!.journalEntryId });
    value = run(value, { type: 'CORRECT_CARD_PAYMENT', entryId: bySource(value, 'CARD_PAYMENT')[0].id });
    const duplicate = bySource(value, 'P002_ADDED_NOT_MATCHED')[0], original = state(value).attempt.entries.find(item => item.occurredOn === duplicate.occurredOn && item.id !== duplicate.id && item.description.includes('Rent'))!;
    value = run(value, { type: 'MATCH', bankActivityId: duplicate.id, targetId: original.id });
    expect(byDescription(value, 'Vehicle loan payment').lines).toHaveLength(3);
    expect(state(value).attempt.entries.some(item => item.id === duplicate.id)).toBe(false);
  });

  it('reapplies Reynolds atomically and preserves customer/A/R totals', async () => {
    let value = await createStudentCommandSession('student-a', 'attempt-a'); const payment = state(value).payments.find(item => item.reference === 'RCPT-REYNOLDS-0615')!, invoices = state(value).invoices.filter(item => item.customerId === payment.customerId), from = invoices.find(item => item.number === 'REY-B')!, to = invoices.find(item => item.number === 'REY-A')!;
    const before = state(value).payments.find(item => item.id === payment.id)!.amountCents; value = run(value, { type: 'REAPPLY_PAYMENT', paymentId: payment.id, fromInvoiceId: from.id, toInvoiceId: to.id });
    expect(state(value).applications.find(item => item.paymentId === payment.id)?.invoiceId).toBe(to.id);
    expect(state(value).payments.find(item => item.id === payment.id)?.amountCents).toBe(before);
    expect(state(value).invoices.find(item => item.id === to.id)?.status).toBe('PAID');
  });

  it('blocks ABC, payroll, and personal correction until the student-visible evidence horizon authorizes each', async () => {
    let value = await createStudentCommandSession('student-a', 'attempt-a'); const abc = byDescription(value, 'Enclosed trailer deposit').id, personal = bySource(value, 'P002_CARD_ACTIVITY')[0].id, payroll = bySource(value, 'P002_SIMPLIFIED_PAYROLL').map(item => item.id);
    value = run(value, { type: 'FLAG_UNRESOLVED', targetId: abc });
    expect(() => run(value, { type: 'RESOLVE_ABC', entryId: abc })).toThrow(InvalidReferenceError);
    expect(() => run(value, { type: 'CORRECT_PAYROLL', entryIds: payroll })).toThrow(InvalidReferenceError);
    expect(() => run(value, { type: 'RESOLVE_PERSONAL_CARD', entryId: personal })).toThrow(InvalidReferenceError);
    value = unlock(value, 'Please send the ABC agreement.'); value = unlock(value, 'Please send the payroll support report.'); value = unlock(value, 'Was the June 24 Visa charge personal?');
    value = run(value, { type: 'RESOLVE_ABC', entryId: abc }); value = run(value, { type: 'CORRECT_PAYROLL', entryIds: payroll }); value = run(value, { type: 'RESOLVE_PERSONAL_CARD', entryId: personal });
    expect(bySource(value, 'PAYROLL_CYCLE')).toHaveLength(1); expect(bySource(value, 'PAYROLL_TAX_REMITTANCE')).toHaveLength(1); expect(bySource(value, 'PAYROLL_PROVIDER_FEE')).toHaveLength(1);
  });

  it('leaves failed compound payroll unchanged and writes no success audit', async () => {
    let value = await createStudentCommandSession('student-a', 'attempt-a'); value = unlock(value, 'Please provide payroll support.'); const before = state(value), audit = p002(value).attempt.auditTrail.length;
    expect(() => run(value, { type: 'CORRECT_PAYROLL', entryIds: [bySource(value, 'P002_SIMPLIFIED_PAYROLL')[0].id, 'missing', 'missing-2'] })).toThrow(InvalidReferenceError);
    expect(state(value)).toBe(before); expect(p002(value).attempt.auditTrail).toHaveLength(audit);
  });

  it('consolidates only compatible attempt-created accounts and preserves balanced history', async () => {
    let value = await createStudentCommandSession('student-a', 'attempt-a'); const target = account(value, 'Advertising & Marketing'), sources = ['Advertising', 'Advertising Expense', 'Marketing', 'Marketing & Advertising'].map(name => account(value, name));
    expect(() => run(value, { type: 'CONSOLIDATE_ACCOUNTS', sourceAccountIds: [account(value, 'Operating Checking').id], targetAccountId: target.id })).toThrow(InvalidReferenceError);
    expect(() => run(value, { type: 'CONSOLIDATE_ACCOUNTS', sourceAccountIds: [sources[0].id], targetAccountId: account(value, 'Operating Checking').id })).toThrow(InvalidReferenceError);
    value = run(value, { type: 'CONSOLIDATE_ACCOUNTS', sourceAccountIds: sources.map(item => item.id), targetAccountId: target.id });
    expect(state(value).attempt.accounts.some(item => sources.some(source => source.id === item.id))).toBe(false);
    expect(state(value).attempt.entries.every(item => item.lines.reduce((sum, line) => sum + line.debitCents - line.creditCents, 0) === 0)).toBe(true);
  });

  it('updates reconciliation selections with stale protection and fails closed on nonzero finish', async () => {
    let value = await createStudentCommandSession('student-a', 'attempt-a'); const reconciliation = state(value).reconciliations.find(item => item.id.endsWith('current-checking'))!, line = state(value).attempt.entries.filter(item => item.occurredOn >= reconciliation.beginningDate && item.occurredOn <= reconciliation.endingDate).flatMap(item => item.lines).find(item => item.attemptAccountId === reconciliation.accountId)!;
    value = run(value, { type: 'SET_RECONCILIATION_LINE', reconciliationId: reconciliation.id, lineId: line.id, cleared: false });
    expect(() => run(value, { type: 'SET_RECONCILIATION_LINE', reconciliationId: reconciliation.id, lineId: line.id, cleared: true }, { revision: 0 })).toThrow(InvalidStateError);
    expect(() => run(value, { type: 'FINISH_RECONCILIATION', reconciliationId: reconciliation.id })).toThrow(InvalidStateError);
  });

  it('restores a historically reconciled transaction without exposing fingerprints', async () => {
    let value = await createStudentCommandSession('student-a', 'attempt-a'); const office = byDescription(value, 'Office Depot'); expect(state(value).reconciliations.filter(item => item.status === 'COMPLETED').some(item => !reconciliationResult(state(value), item).historicalIntegrity)).toBe(true);
    value = run(value, { type: 'RESTORE_HISTORICAL_TRANSACTION', entryId: office.id });
    const historical = state(value).reconciliations.find(item => item.status === 'COMPLETED' && item.clearedJournalLineIds.some(id => office.lines.some(line => line.id === id)))!; expect(office.lines.some(line => historical.clearedLineFingerprints[line.id] !== `${line.debitCents}:${line.creditCents}:${line.attemptAccountId}`)).toBe(true); const corrected = state(value).attempt.entries.find(item => item.id === office.id)!; expect(corrected.lines.filter(line => historical.clearedLineFingerprints[line.id]).every(line => historical.clearedLineFingerprints[line.id] === `${line.debitCents}:${line.creditCents}:${line.attemptAccountId}`)).toBe(true);
    expect(JSON.stringify(studentCommandView(value))).not.toMatch(/clearedLineFingerprints|"before"|"after"|"receipts"/);
  });

  it('rejects stale/idempotency conflicts and preserves help/self-correction chronology for assessment', async () => {
    let value = await createStudentCommandSession('student-a', 'attempt-a'); const owner = byDescription(value, 'Owner contribution'); value = run(value, { type: 'CATEGORIZE', entryId: owner.id, accountId: account(value, 'Advertising').id }, { key: 'wrong', help: 'HINT' });
    expect(() => run(value, { type: 'REVIEW', targetId: owner.id }, { revision: 0 })).toThrow(InvalidStateError);
    expect(() => run(value, { type: 'REVIEW', targetId: owner.id }, { key: 'wrong' })).toThrow(InvalidStateError);
    value = run(value, { type: 'CORRECT_OWNER_CONTRIBUTION', entryId: owner.id }, { help: 'DIRECTION' }); const assessment = deriveSuncoastAssessment(value.coaching);
    expect(assessment.evidence.at(-1)).toMatchObject({ selfCorrected: true, helpState: 'DIRECTION_USED' });
    expect(p002(value).attempt.auditTrail[0]).toMatchObject({ helpLevel: 'HINT' });
  });

  it('enforces cross-student/attempt ownership and guessed IDs in the service', async () => {
    const value = await createStudentCommandSession('student-a', 'attempt-a'); const store = { current: value, findForStudent: async (attemptId: string, studentId: string) => attemptId === value.attemptId && studentId === value.studentId ? store.current : null, save: async (next: StudentCommandSession) => { store.current = next; } }; const service = new StudentBookkeepingCommandService(store);
    await expect(service.view('student-b', 'attempt-a')).rejects.toBeInstanceOf(Error); await expect(service.view('student-a', 'attempt-b')).rejects.toBeInstanceOf(Error);
    await expect(service.execute('student-a', 'attempt-a', { type: 'REVIEW', targetId: 'guessed' }, { expectedRevision: 0, idempotencyKey: 'x', help: 'INDEPENDENT' })).rejects.toBeInstanceOf(InvalidReferenceError);
  });

  it('resolves the protected starting state and reaches balanced reconciliations using only student commands', async () => {
    let value = await createStudentCommandSession('student-a', 'reachability');
    value = run(value, { type: 'VOID', entryId: bySource(value, 'P002_UNSUPPORTED_DUPLICATE')[0].id });
    value = run(value, { type: 'CORRECT_OWNER_CONTRIBUTION', entryId: byDescription(value, 'Owner contribution').id });
    value = run(value, { type: 'CORRECT_VEHICLE_LOAN', entryId: byDescription(value, 'Vehicle loan payment').id });
    value = run(value, { type: 'CORRECT_PRESSURE_WASHER', entryId: byDescription(value, 'Commercial pressure washer').id });
    value = unlock(value, 'Please send the ABC agreement.'); value = unlock(value, 'Please send the payroll support report.'); value = unlock(value, 'Was the June 24 card activity personal?');
    value = run(value, { type: 'RESOLVE_ABC', entryId: byDescription(value, 'Enclosed trailer deposit').id });
    const martinez = state(value).payments.find(item => item.reference === 'RCPT-MARTINEZ-0612')!; value = run(value, { type: 'MATCH', bankActivityId: bySource(value, 'P002_ADDED_BANK_INCOME')[0].id, targetId: martinez.id });
    const reynolds = state(value).payments.find(item => item.reference === 'RCPT-REYNOLDS-0615')!, reynoldsInvoices = state(value).invoices.filter(item => item.customerId === reynolds.customerId); value = run(value, { type: 'REAPPLY_PAYMENT', paymentId: reynolds.id, fromInvoiceId: reynoldsInvoices.find(item => item.number === 'REY-B')!.id, toInvoiceId: reynoldsInvoices.find(item => item.number === 'REY-A')!.id });
    const rentDuplicate = bySource(value, 'P002_ADDED_NOT_MATCHED')[0], rent = state(value).attempt.entries.find(item => item.id !== rentDuplicate.id && item.occurredOn === rentDuplicate.occurredOn && item.description.includes('Rent'))!; value = run(value, { type: 'MATCH', bankActivityId: rentDuplicate.id, targetId: rent.id });
    const capeDeposit = state(value).deposits.find(item => item.paymentIds.some(id => state(value).payments.find(payment => payment.id === id)?.reference === 'RCPT-PAINT-0628'))!; value = run(value, { type: 'CORRECT_DEPOSIT_TRANSFER', entryId: capeDeposit.journalEntryId });
    value = run(value, { type: 'RESTORE_HISTORICAL_TRANSACTION', entryId: byDescription(value, 'Office Depot').id });
    value = run(value, { type: 'RESOLVE_PERSONAL_CARD', entryId: bySource(value, 'P002_CARD_ACTIVITY')[0].id });
    value = run(value, { type: 'CORRECT_CARD_PAYMENT', entryId: bySource(value, 'CARD_PAYMENT')[0].id });
    value = run(value, { type: 'CORRECT_PAYROLL', entryIds: bySource(value, 'P002_SIMPLIFIED_PAYROLL').map(item => item.id) });
    const coaTarget = account(value, 'Advertising & Marketing'), redundant = ['Advertising', 'Advertising Expense', 'Marketing', 'Marketing & Advertising'].map(name => account(value, name).id); value = run(value, { type: 'CONSOLIDATE_ACCOUNTS', sourceAccountIds: redundant, targetAccountId: coaTarget.id });
    for (const reconciliation of state(value).reconciliations.filter(item => item.status === 'IN_PROGRESS')) for (const targetEntry of state(value).attempt.entries.filter(item => item.occurredOn >= reconciliation.beginningDate && item.occurredOn <= reconciliation.endingDate)) for (const line of targetEntry.lines.filter(item => item.attemptAccountId === reconciliation.accountId)) value = run(value, { type: 'SET_RECONCILIATION_LINE', reconciliationId: reconciliation.id, lineId: line.id, cleared: true });
    const completion = await compareAccountingCompletion(p002(value)); expect(completion).toMatchObject({ trialBalance: true, accountsReceivable: true, checking: true, visa: true, payrollLiabilities: true, historicalIntegrity: true, complete: true });
    for (const reconciliation of state(value).reconciliations.filter(item => item.status === 'IN_PROGRESS')) value = run(value, { type: 'FINISH_RECONCILIATION', reconciliationId: reconciliation.id });
    expect(state(value).reconciliations.filter(item => item.id.includes('-current-')).every(item => item.status === 'COMPLETED')).toBe(true);
  });
});
