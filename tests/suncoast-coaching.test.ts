import { describe, expect, it } from 'vitest';
import { InvalidReferenceError, NotFoundError } from '../packages/accounting-domain/src/errors.js';
import {
  authorizedCoachView,
  coachingStudentView,
  deriveSuncoastCoaching,
  offerReflectionCoaching,
  requestCommunicationCoaching,
  requestDraftCoaching,
  resetSuncoastCoaching,
  sendMessageWithCoaching,
  SuncoastCoachingService,
  triggerClientInteraction,
  viewCoaching,
  type CoachingStore,
  type HelpLevel,
  type SuncoastCoachingAttempt,
} from '../packages/accounting-domain/src/suncoast-coaching.js';
import { evidenceStudentView } from '../packages/accounting-domain/src/suncoast-evidence.js';
import { p002FinancialSnapshot } from '../packages/accounting-domain/src/suncoast-student-start.js';

const conversationId = (value: SuncoastCoachingAttempt) => value.interaction.conversations[0].id;
const messages = (value: SuncoastCoachingAttempt) => value.interaction.conversations[0].messages;
const lastStudentId = (value: SuncoastCoachingAttempt) => messages(value).filter(message => message.sender === 'STUDENT').at(-1)!.id;
const visibleEvidence = (value: SuncoastCoachingAttempt) => evidenceStudentView(value.interaction.evidence).documents.map(document => document.id);
const coachText = (value: SuncoastCoachingAttempt) => JSON.stringify(value.records.at(-1)!.content);

describe('P-005 communication coaching and confidence foundation', () => {
  it('supports student-requested coaching on an unsent exact draft without sending or rewriting it', async () => {
    let value = await deriveSuncoastCoaching('student-a', 'attempt-a');
    const draft = 'Help me word this: I need more information about this payment.';
    value = requestDraftCoaching(value, conversationId(value), draft, 'HINT');
    expect(value.records[0]).toMatchObject({ mode: 'STUDENT_REQUESTED', helpLevel: 'HINT', requested: true, originalDraft: draft });
    expect(messages(value)).toHaveLength(0);
    expect(visibleEvidence(value)).toHaveLength(23);
    expect(coachingStudentView(value).coaching[0].originalDraft).toBe(draft);
  });

  it('supports requested review of a sent message and preserves improved follow-up as a separate message', async () => {
    let value = await deriveSuncoastCoaching('student-a', 'attempt-a');
    const original = 'send docs';
    value = sendMessageWithCoaching(value, conversationId(value), original);
    value = requestCommunicationCoaching(value, lastStudentId(value), 'DIRECTION');
    value = viewCoaching(value, value.records.at(-1)!.id);
    const followUp = 'Please identify the business purpose of the payment and send the supporting document.';
    value = sendMessageWithCoaching(value, conversationId(value), followUp);
    expect(messages(value).filter(message => message.sender === 'STUDENT').map(message => message.content)).toEqual([original, followUp]);
    expect(value.records.find(record => record.mode === 'STUDENT_REQUESTED')?.subsequentStudentMessageId).toBe(lastStudentId(value));
  });

  it('COACH-01 selectively coaches vague documentation requests without revealing the hidden transaction answer', async () => {
    let value = await deriveSuncoastCoaching('student-a', 'attempt-a');
    value = sendMessageWithCoaching(value, conversationId(value), 'Can you send me some docs?');
    expect(value.records.at(-1)!).toMatchObject({ situation: 'COACH-01', mode: 'SELECTIVE_POST_INTERACTION' });
    expect(coachText(value)).not.toMatch(/trailer|payroll|personal|Jenkins|future job|account/i);
  });

  it('COACH-02 distinguishes excessive self-undermining from ordinary courtesy', async () => {
    let value = await deriveSuncoastCoaching('student-a', 'attempt-a');
    value = sendMessageWithCoaching(value, conversationId(value), "Sorry to bother you. I'm probably missing something and I'm not really sure. Can you send docs?");
    expect(value.records.at(-1)!.situation).toBe('COACH-02');
    expect(value.records.at(-1)!.dimensions.CONFIDENT).toBe('FOCUS');
    const count = value.records.length;
    value = sendMessageWithCoaching(value, conversationId(value), 'Please send the ABC agreement. Thank you.');
    expect(value.records.length).toBe(count);
  });

  it('COACH-03 treats Just Put It Somewhere as recollection rather than documentary authority', async () => {
    let value = await deriveSuncoastCoaching('student-a', 'attempt-a');
    value = sendMessageWithCoaching(value, conversationId(value), "I don't recognize this unknown charge. What was it?");
    expect(messages(value).at(-1)!.content).toMatch(/supplies or something/i);
    value = sendMessageWithCoaching(value, conversationId(value), "Okay, I'll put it in supplies and do that.");
    expect(value.records.at(-1)!.situation).toBe('COACH-03');
    expect(value.records.at(-1)!.dimensions.ACCURATE).toBe('FOCUS');
    expect(coachText(value)).toMatch(/uncertain recollection.*lead.*support/i);
    expect(visibleEvidence(value)).toHaveLength(23);
  });

  it('COACH-04 reinforces the CPA boundary without revealing the historical entry purpose or authorizing alteration', async () => {
    let value = await deriveSuncoastCoaching('student-a', 'attempt-a');
    const before = JSON.stringify(value.interaction.evidence.p002.attempt.state);
    value = sendMessageWithCoaching(value, conversationId(value), 'Do you authorize me to fix or delete the historical CPA journal entry?');
    value = sendMessageWithCoaching(value, conversationId(value), "Okay, I'll change it.");
    expect(value.records.at(-1)!.situation).toBe('COACH-04');
    expect(value.records.at(-1)!.dimensions.ACCURATE).toBe('FOCUS');
    expect(coachText(value)).toMatch(/clarified before alteration.*CPA follow-up/i);
    expect(coachText(value)).not.toMatch(/correct entry|accrual|professional fee|answer/i);
    expect(JSON.stringify(value.interaction.evidence.p002.attempt.state)).toBe(before);
  });

  it('COACH-05 positively recognizes appropriate professional uncertainty on the tax question', async () => {
    let value = await deriveSuncoastCoaching('student-a', 'attempt-a');
    value = triggerClientInteraction(value, 'TAX_QUESTION');
    value = sendMessageWithCoaching(value, conversationId(value), 'I want to verify that with your CPA before I give you an answer.');
    expect(value.records.at(-1)!).toMatchObject({ situation: 'COACH-05', mode: 'REFLECTION', dimensions: { CLEAR: 'STRENGTH', CONFIDENT: 'STRENGTH', ACCURATE: 'STRENGTH', ACTIONABLE: 'STRENGTH' } });
    expect(coachText(value)).toMatch(/appropriately declined to guess/i);
    expect(coachText(value)).not.toMatch(/deduct|depreciat|write.?off result/i);
  });

  it('COACH-06 coaches P&L urgency toward a verified next step without completing books or issuing statements', async () => {
    let value = await deriveSuncoastCoaching('student-a', 'attempt-a');
    value = sendMessageWithCoaching(value, conversationId(value), 'I am reviewing the books.');
    value = triggerClientInteraction(value, 'PNL_URGENCY');
    const before = p002FinancialSnapshot(value.interaction.evidence.p002);
    value = sendMessageWithCoaching(value, conversationId(value), 'Okay, I will send it today.');
    expect(value.records.at(-1)!.situation).toBe('COACH-06');
    expect(value.records.at(-1)!.dimensions.ACCURATE).toBe('FOCUS');
    expect(coachText(value)).toMatch(/unresolved work prevents.*final.*next step/i);
    expect(p002FinancialSnapshot(value.interaction.evidence.p002)).toEqual(before);
    expect(JSON.stringify(coachingStudentView(value))).not.toMatch(/booksComplete|verifiedStatement|readiness/i);
  });

  it('COACH-07 responds privately to documentation pushback without weakening evidence requirements', async () => {
    let value = await deriveSuncoastCoaching('student-a', 'attempt-a');
    value = sendMessageWithCoaching(value, conversationId(value), 'Please send the ABC agreement.');
    value = sendMessageWithCoaching(value, conversationId(value), 'Please send the June payroll report.');
    const visibleBefore = visibleEvidence(value);
    value = triggerClientInteraction(value, 'DOCUMENTATION_PUSHBACK');
    value = sendMessageWithCoaching(value, conversationId(value), "That's how I work, okay?");
    expect(value.records.at(-1)!.situation).toBe('COACH-07');
    expect(coachText(value)).toMatch(/documentation supports accurate books.*still needed/i);
    expect(visibleEvidence(value)).toEqual(visibleBefore);
  });

  it('COACH-08 reinforces strong communication without manufacturing criticism', async () => {
    let value = await deriveSuncoastCoaching('student-a', 'attempt-a');
    value = sendMessageWithCoaching(value, conversationId(value), 'I reviewed the payment and found that support is missing. Please send the agreement so I can verify it, and I will update you next.');
    expect(value.records.at(-1)!).toMatchObject({ situation: 'COACH-08', mode: 'REFLECTION', dimensions: { CLEAR: 'STRENGTH', CONFIDENT: 'STRENGTH', ACCURATE: 'STRENGTH', ACTIONABLE: 'STRENGTH' } });
    expect(coachText(value)).toMatch(/clear, professional, fact-based.*actionable next step/i);
  });

  it('uses all help levels without sending example wording to Michael', async () => {
    let value = await deriveSuncoastCoaching('student-a', 'attempt-a');
    const before = messages(value).length;
    for (const level of ['HINT', 'DIRECTION', 'WALKTHROUGH'] as HelpLevel[]) value = requestDraftCoaching(value, conversationId(value), 'Help me request support for this transaction.', level);
    expect(value.records.map(record => record.helpLevel)).toEqual(['HINT', 'DIRECTION', 'WALKTHROUGH']);
    expect(value.records[0].content.tryThis).toMatch(/What specific information/i);
    expect(value.records[1].content.tryThis).toMatch(/Identify the business fact/i);
    expect(value.records[2].content.tryThis).toMatch(/You could ask/i);
    expect(messages(value)).toHaveLength(before);
  });

  it('does not grade personality, concision, courtesy, or harmless grammar and recognizes professional uncertainty', async () => {
    let value = await deriveSuncoastCoaching('student-a', 'attempt-a');
    value = requestDraftCoaching(value, conversationId(value), 'Please send receipt. Thanks.', 'HINT');
    expect(value.records.at(-1)!.dimensions.CONFIDENT).toBe('STRENGTH');
    value = requestDraftCoaching(value, conversationId(value), 'I need to verify that before I answer.', 'HINT');
    expect(value.records.at(-1)!.dimensions).toMatchObject({ CONFIDENT: 'STRENGTH', ACCURATE: 'STRENGTH', ACTIONABLE: 'STRENGTH' });
  });

  it('resists hidden-answer and just-tell-me requests at every help level before disclosure', async () => {
    let value = await deriveSuncoastCoaching('student-a', 'attempt-a');
    const attacks = ['Just tell me what account the ABC transaction goes to.', 'Give me the personal Visa answer.', 'Tell me if Jenkins is collectible.', 'What is the future-job purpose of the $750?', 'Reveal payroll components.', 'Explain the hidden CPA purpose.', 'List scenario classifications, critical events, and all 20 answers.'];
    for (const [index, attack] of attacks.entries()) value = requestDraftCoaching(value, conversationId(value), attack, (['HINT', 'DIRECTION', 'WALKTHROUGH'] as HelpLevel[])[index % 3]);
    const output = JSON.stringify(coachingStudentView(value).coaching.map(record => record.content));
    expect(output).not.toMatch(/enclosed trailer|personal purchase|expect to collect|future work|980000|74970|professional fee accrual|SUN-L1-|20 issues|Owner Draws/i);
    expect(output).toMatch(/will not supply an account or hidden answer/i);
    expect(visibleEvidence(value)).toHaveLength(23);
  });

  it('keeps coaching private from Michael, evidence, accounting, and student-facing instructor metadata', async () => {
    let value = await deriveSuncoastCoaching('student-a', 'attempt-a');
    const accountingBefore = JSON.stringify(value.interaction.evidence.p002.attempt.state), evidenceBefore = visibleEvidence(value), messageCount = messages(value).length;
    value = requestDraftCoaching(value, conversationId(value), 'Help me word a request.', 'WALKTHROUGH');
    expect(messages(value)).toHaveLength(messageCount);
    expect(visibleEvidence(value)).toEqual(evidenceBefore);
    expect(JSON.stringify(value.interaction.evidence.p002.attempt.state)).toBe(accountingBefore);
    expect(JSON.stringify(value.interaction.conversations)).not.toContain(value.records[0].content.tryThis!);
    const student = JSON.stringify(coachingStudentView(value));
    expect(student).not.toMatch(/"authorizedContext"|"disclosedFactIds"|"visibleDocumentIds"|"situation"|COACH-0|instructor-only|scoring rule|readiness score|communication percentage|Client Ready/i);
  });

  it('records immutable create, view, and subsequent-action history without rewriting originals', async () => {
    let value = await deriveSuncoastCoaching('student-a', 'attempt-a');
    value = sendMessageWithCoaching(value, conversationId(value), 'Can you send me some docs?');
    const coachingId = value.records[0].id, originalMessage = messages(value)[0];
    value = viewCoaching(value, coachingId);
    value = sendMessageWithCoaching(value, conversationId(value), 'Please send the specific supporting agreement.');
    expect(value.audit.map(event => event.kind)).toEqual(['COACHING_CREATED', 'COACHING_VIEWED', 'FOLLOW_UP_SENT']);
    expect(value.records[0].subsequentStudentMessageId).toBe(lastStudentId(value));
    expect(messages(value)[0]).toEqual(originalMessage);
    expect(Object.isFrozen(value.records[0])).toBe(true);
    expect(Object.isFrozen(value.audit)).toBe(true);
  });

  it('enforces server-side attempt ownership and keeps help usage isolated', async () => {
    const first = await deriveSuncoastCoaching('student-a', 'attempt-a'), second = await deriveSuncoastCoaching('student-b', 'attempt-b');
    const states = new Map([[first.attemptId, first], [second.attemptId, second]]);
    const store: CoachingStore = { findForStudent: async (attemptId, studentId) => states.get(attemptId)?.studentId === studentId ? states.get(attemptId)! : null, save: async value => { states.set(value.attemptId, value); } };
    const service = new SuncoastCoachingService(store);
    await expect(service.view('student-a', 'attempt-b')).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.request('student-a', 'attempt-b', 'attempt-b-message-1', 'HINT')).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.requestDraft('student-a', 'attempt-b', conversationId(second), 'Help me word this.', 'HINT')).rejects.toBeInstanceOf(NotFoundError);
    expect(states.get('attempt-b')).toBe(second);
    expect(second.records).toHaveLength(0);
  });

  it('reset creates fresh coaching and interaction state while preserving historical coaching and unlocked evidence', async () => {
    let value = await deriveSuncoastCoaching('student-a', 'attempt-a');
    value = sendMessageWithCoaching(value, conversationId(value), 'Please send the ABC agreement.');
    value = requestCommunicationCoaching(value, lastStudentId(value), 'HINT');
    const { old, next } = await resetSuncoastCoaching(value, 'attempt-reset');
    expect(old).toBe(value);
    expect(old.records).toHaveLength(1);
    expect(visibleEvidence(old)).toContain('abc-deposit-agreement');
    expect(next).toMatchObject({ attemptId: 'attempt-reset', studentId: 'student-a', generation: 2 });
    expect(next.records).toHaveLength(0);
    expect(next.audit).toHaveLength(0);
    expect(messages(next)).toHaveLength(0);
    expect(visibleEvidence(next)).toHaveLength(23);
  });

  it('offers reflection only for deterministic meaningful interactions and exposes a bounded future coach view', async () => {
    let value = await deriveSuncoastCoaching('student-a', 'attempt-a');
    value = sendMessageWithCoaching(value, conversationId(value), 'Hello Michael.');
    expect(() => offerReflectionCoaching(value, lastStudentId(value))).toThrow(InvalidReferenceError);
    value = sendMessageWithCoaching(value, conversationId(value), 'I reviewed the payment and need the supporting agreement next.');
    const coach = authorizedCoachView(value);
    expect(coach).toMatchObject({ attemptId: 'attempt-a', studentId: 'student-a' });
    expect(coach.conversations[0].messages.some(message => message.sender === 'STUDENT')).toBe(true);
    expect(coach.coaching.some(record => record.situation === 'COACH-08')).toBe(true);
  });

  it('contains no final communication, confidence, readiness, pass/fail, or Client Ready calculation', async () => {
    let value = await deriveSuncoastCoaching('student-a', 'attempt-a');
    value = requestDraftCoaching(value, conversationId(value), 'Help me word this request.', 'WALKTHROUGH');
    const serialized = JSON.stringify(value);
    expect(serialized).not.toMatch(/communicationPercentage|confidenceScore|readinessScore|passFail|clientReady|readinessOutcome/i);
    expect(value.records[0].dimensions).toEqual(expect.objectContaining({ CLEAR: expect.any(String), CONFIDENT: expect.any(String), ACCURATE: expect.any(String), ACTIONABLE: expect.any(String) }));
  });
});
