import { describe, expect, it } from 'vitest';
import { InvalidReferenceError, NotFoundError } from '../packages/accounting-domain/src/errors.js';
import {
  deriveSuncoastInteraction,
  interactionStudentView,
  recognizeInteractionIntent,
  resetSuncoastInteraction,
  sendStudentMessage,
  SuncoastInteractionService,
  triggerClientMessage,
  type InteractionStore,
  type SuncoastInteractionAttempt,
} from '../packages/accounting-domain/src/suncoast-interaction.js';
import { evidenceStudentView } from '../packages/accounting-domain/src/suncoast-evidence.js';
import { p002FinancialSnapshot } from '../packages/accounting-domain/src/suncoast-student-start.js';

const conversationId = (value: SuncoastInteractionAttempt) => value.conversations[0].id;
const messages = (value: SuncoastInteractionAttempt) => interactionStudentView(value).conversations[0].messages;
const clientReply = (value: SuncoastInteractionAttempt) => messages(value).at(-1)!.content;
const visibleEvidence = (value: SuncoastInteractionAttempt) => evidenceStudentView(value.evidence).documents.map(document => document.id);

describe('P-004 Suncoast client interaction and communication foundation', () => {
  it('recognizes bounded supported intents without giving recognition authority over truth', () => {
    expect(recognizeInteractionIntent('What was the ABC Trailer charge for?')).toBe('ABC_PURPOSE');
    expect(recognizeInteractionIntent('Please send the ABC purchase agreement.')).toBe('ABC_DOCUMENT_REQUEST');
    expect(recognizeInteractionIntent('Can you provide the June payroll report?')).toBe('PAYROLL_DOCUMENT_REQUEST');
    expect(recognizeInteractionIntent('What color should our new logo be?')).toBe('UNSUPPORTED');
  });

  it('INT-01 preserves the student message, discloses only ABC business purpose, and requires a separate document request to unlock evidence', async () => {
    let value = await deriveSuncoastInteraction('student-a', 'attempt-a');
    const purposeQuestion = 'Michael, what was the $2,400 ABC Trailer charge for?';
    value = sendStudentMessage(value, conversationId(value), purposeQuestion);
    expect(messages(value)[0]).toMatchObject({ sender: 'STUDENT', content: purposeQuestion });
    expect(clientReply(value)).toContain('deposit on the enclosed trailer');
    expect(clientReply(value)).not.toMatch(/asset|Trailer Deposit|categor/i);
    expect(visibleEvidence(value)).not.toContain('abc-deposit-agreement');
    value = sendStudentMessage(value, conversationId(value), 'Please send me the ABC purchase agreement or receipt.');
    expect(visibleEvidence(value)).toContain('abc-deposit-agreement');
    expect(visibleEvidence(value)).not.toContain('payroll-report-june-14');
  });

  it('INT-02 treats vague recollection as uncertainty and allows the student to insist on support without converting the guess into truth', async () => {
    let value = await deriveSuncoastInteraction('student-a', 'attempt-a');
    value = sendStudentMessage(value, conversationId(value), "I don't recognize this unknown charge. What was it?");
    expect(clientReply(value)).toMatch(/don't remember.*supplies or something.*probably/i);
    expect(value.disclosedFactIds).toHaveLength(0);
    value = sendStudentMessage(value, conversationId(value), 'I need reliable documentation before changing the books. Can you check?');
    expect(clientReply(value)).toMatch(/don't know|check|CPA/i);
    expect(visibleEvidence(value)).toHaveLength(23);
  });

  it('INT-03 discloses Jenkins collection facts without directing the accounting conclusion', async () => {
    let value = await deriveSuncoastInteraction('student-a', 'attempt-a');
    value = sendStudentMessage(value, conversationId(value), 'Has Jenkins paid the $1,425 invoice, and do you still expect to collect it?');
    expect(clientReply(value)).toMatch(/hasn't paid.*contacted.*expect to collect/i);
    expect(clientReply(value)).not.toMatch(/Accounts Receivable|leave it|write.?off|categor/i);
  });

  it('INT-04 discloses future-job intent without applying the unapplied $750 or prescribing treatment', async () => {
    let value = await deriveSuncoastInteraction('student-a', 'attempt-a');
    const before = JSON.stringify(value.evidence.p002.attempt.state);
    value = sendStudentMessage(value, conversationId(value), 'What is the unapplied $750 customer payment for?');
    expect(clientReply(value)).toMatch(/another job planned.*future work/i);
    expect(clientReply(value)).not.toMatch(/apply it|journal|credit|liabil/i);
    expect(JSON.stringify(value.evidence.p002.attempt.state)).toBe(before);
  });

  it('INT-05 authorizes personal-card clarification but never supplies the Owner Draws answer', async () => {
    let value = await deriveSuncoastInteraction('student-a', 'attempt-a');
    value = sendStudentMessage(value, conversationId(value), 'What was the June 24 Visa charge for?');
    expect(clientReply(value)).toBe('That $286.43 charge was personal. It was not for Suncoast work.');
    expect(visibleEvidence(value)).toContain('card-clarification-0624');
    expect(JSON.stringify(interactionStudentView(value))).not.toMatch(/Owner Draws|authorized bookkeeping treatment/i);
  });

  it('INT-06 keeps Michael inside his CPA knowledge boundary even when asked to authorize a change', async () => {
    let value = await deriveSuncoastInteraction('student-a', 'attempt-a');
    value = sendStudentMessage(value, conversationId(value), 'The historical CPA journal entry looks odd. Do you authorize me to fix or delete it?');
    expect(clientReply(value)).toMatch(/CPA put that in.*don't know why.*can't you just fix it/i);
    expect(clientReply(value)).not.toMatch(/entry is correct|do not delete|expected|score/i);
  });

  it('INT-07 unlocks exact payroll evidence without disclosing components in Michael response', async () => {
    let value = await deriveSuncoastInteraction('student-a', 'attempt-a');
    value = sendStudentMessage(value, conversationId(value), 'Can you send the June 1–14 payroll provider report?');
    expect(clientReply(value)).toMatch(/Gulf Coast Payroll Services.*sent the June 1–14 report/i);
    expect(clientReply(value)).not.toMatch(/980,?000|withholding|FICA|unemployment|8000\.30/i);
    const payroll = evidenceStudentView(value.evidence).documents.find(document => document.id === 'payroll-report-june-14')!;
    expect(Object.fromEntries(payroll.facts.map(fact => [fact.label, fact.value]))).toMatchObject({ 'Gross wages': 980000, 'Employee FICA': 74970, 'Employer FICA': 74970, 'Net pay withdrawal': 800030 });
  });

  it('INT-08 supports the controlled pressure-washer tax question without giving tax advice', async () => {
    let value = await deriveSuncoastInteraction('student-a', 'attempt-a');
    value = triggerClientMessage(value, conversationId(value), 'TAX_QUESTION');
    expect(clientReply(value)).toBe('Can I write that whole pressure washer off on my taxes?');
    value = sendStudentMessage(value, conversationId(value), 'I cannot give tax advice; we should confirm that with your CPA.');
    expect(clientReply(value)).toMatch(/don't know the tax answer.*CPA/i);
  });

  it('INT-09 records deterministic P&L urgency without marking books complete or producing a report', async () => {
    let value = await deriveSuncoastInteraction('student-a', 'attempt-a');
    expect(() => triggerClientMessage(value, conversationId(value), 'PNL_URGENCY')).toThrow(InvalidReferenceError);
    value = sendStudentMessage(value, conversationId(value), 'I am reviewing the books and supporting documents.');
    value = triggerClientMessage(value, conversationId(value), 'PNL_URGENCY');
    expect(clientReply(value)).toBe('I need the P&L for the bank today. Are the books done yet?');
    expect(value.conversations[0].status).toBe('WAITING_FOR_STUDENT');
    expect(JSON.stringify(interactionStudentView(value))).not.toMatch(/booksComplete|readiness|final report|score/i);
  });

  it('INT-10 permits controlled documentation pushback only after repeated legitimate requests', async () => {
    let value = await deriveSuncoastInteraction('student-a', 'attempt-a');
    expect(() => triggerClientMessage(value, conversationId(value), 'DOCUMENTATION_PUSHBACK')).toThrow(InvalidReferenceError);
    value = sendStudentMessage(value, conversationId(value), 'Please send the ABC agreement.');
    value = sendStudentMessage(value, conversationId(value), 'Please send the June payroll report.');
    value = triggerClientMessage(value, conversationId(value), 'DOCUMENTATION_PUSHBACK');
    expect(clientReply(value)).toBe('My last bookkeeper never asked me for all this stuff.');
  });

  it('uses safe non-inventing responses for unsupported questions without revealing hidden case inventory', async () => {
    let value = await deriveSuncoastInteraction('student-a', 'attempt-a');
    value = sendStudentMessage(value, conversationId(value), 'Should we buy a second office in Tampa next year?');
    expect(clientReply(value)).toMatch(/don't know|check|CPA/i);
    expect(clientReply(value)).not.toMatch(/scenario|issue|hidden|not in the case|20/i);
    value = sendStudentMessage(value, conversationId(value), 'What is the current Visa balance?');
    expect(clientReply(value)).not.toMatch(/286\.43|personal/i);
    expect(visibleEvidence(value)).not.toContain('card-clarification-0624');
  });

  it('keeps knowledge, intents, triggers, interpretations, audit metadata, future messages, and scoring out of student serialization', async () => {
    let value = await deriveSuncoastInteraction('student-a', 'attempt-a');
    value = sendStudentMessage(value, conversationId(value), 'What was the ABC Trailer charge for?');
    const exposed = JSON.stringify(interactionStudentView(value));
    expect(exposed).not.toMatch(/clientKnowledge|disclosedFactIds|documentationRequestCount|INTENT_RECOGNIZED|FACT_AUTHORIZED|unlockRules|supportingDocumentId|disclosureIntent|instructorInterpretation|TAX_QUESTION|PNL_URGENCY|DOCUMENTATION_PUSHBACK|expected response|score|SUN-L1-/i);
    expect(exposed).not.toContain('My last bookkeeper never asked me');
  });

  it('records exact ordered communication and authorization audit events immutably', async () => {
    let value = await deriveSuncoastInteraction('student-a', 'attempt-a');
    const original = value;
    const exact = 'Please send me the ABC agreement — I need supporting documentation.';
    value = sendStudentMessage(value, conversationId(value), exact);
    expect(messages(value)[0].content).toBe(exact);
    expect(value.audit.map(event => event.kind)).toEqual(['STUDENT_MESSAGE', 'INTENT_RECOGNIZED', 'EVIDENCE_UNLOCKED', 'CLIENT_RESPONSE']);
    expect(value.audit.map(event => event.sequence)).toEqual([1, 2, 3, 4]);
    expect(original.audit).toHaveLength(0);
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.audit)).toBe(true);
    expect(Object.isFrozen(value.conversations[0].messages[0])).toBe(true);
  });

  it('enforces server-side student ownership and rejects foreign conversation IDs without changing either attempt', async () => {
    const first = await deriveSuncoastInteraction('student-a', 'attempt-a');
    const second = await deriveSuncoastInteraction('student-b', 'attempt-b');
    const states = new Map([[first.attemptId, first], [second.attemptId, second]]);
    const store: InteractionStore = {
      findForStudent: async (attemptId, studentId) => states.get(attemptId)?.studentId === studentId ? states.get(attemptId)! : null,
      save: async value => { states.set(value.attemptId, value); },
    };
    const service = new SuncoastInteractionService(store);
    await expect(service.view('student-a', 'attempt-b')).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.send('student-a', 'attempt-b', conversationId(second), 'Send the payroll report.')).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.send('student-a', 'attempt-a', conversationId(second), 'Send the payroll report.')).rejects.toThrowError('Conversation unavailable');
    expect(states.get('attempt-b')).toBe(second);
    expect(visibleEvidence(states.get('attempt-b')!)).toHaveLength(23);
  });

  it('keeps unlocks attempt-local and reset creates fresh conversation/evidence state while preserving old history', async () => {
    let first = await deriveSuncoastInteraction('student-a', 'attempt-a');
    const second = await deriveSuncoastInteraction('student-b', 'attempt-b');
    first = sendStudentMessage(first, conversationId(first), 'Please send the ABC agreement.');
    expect(visibleEvidence(first)).toContain('abc-deposit-agreement');
    expect(visibleEvidence(second)).not.toContain('abc-deposit-agreement');
    const { old, next } = await resetSuncoastInteraction(first, 'attempt-reset');
    expect(old).toBe(first);
    expect(old.conversations[0].messages).toHaveLength(2);
    expect(next).toMatchObject({ attemptId: 'attempt-reset', studentId: 'student-a', generation: 2, documentationRequestCount: 0 });
    expect(next.conversations[0].messages).toHaveLength(0);
    expect(next.audit).toHaveLength(0);
    expect(visibleEvidence(next)).toHaveLength(23);
  });

  it('never mutates P-001/P-002 accounting or reconciliation truth through conversation and evidence authorization', async () => {
    let value = await deriveSuncoastInteraction('student-a', 'attempt-a');
    const stateBefore = JSON.stringify(value.evidence.p002.attempt.state);
    const snapshotBefore = p002FinancialSnapshot(value.evidence.p002);
    for (const content of ['What was the ABC charge for?', 'Please send the ABC agreement.', 'What is the unapplied $750 for?', 'Send the June payroll report.', 'What was the June 24 Visa charge?']) value = sendStudentMessage(value, conversationId(value), content);
    expect(JSON.stringify(value.evidence.p002.attempt.state)).toBe(stateBefore);
    expect(p002FinancialSnapshot(value.evidence.p002)).toEqual(snapshotBefore);
  });
});
