import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../packages/accounting-domain/src/errors.js';
import { deriveSuncoastCoaching, type SuncoastCoachingAttempt } from '../packages/accounting-domain/src/suncoast-coaching.js';
import { buildResolvedP002State } from '../packages/accounting-domain/src/suncoast-student-start.js';
import {
  LAB1_READINESS_RUBRIC,
  SuncoastAssessmentService,
  appendAssessmentEvidence,
  assessmentStudentView,
  authorizedAssessmentView,
  compareAccountingCompletion,
  deriveSuncoastAssessment,
  evaluateAssessment,
  recordCloseAttempt,
  resetSuncoastAssessment,
  type AccountingCompletion,
  type AssessmentEvidence,
  type Competency,
  type SuncoastAssessmentAttempt,
} from '../packages/accounting-domain/src/suncoast-assessment.js';

const complete: AccountingCompletion = Object.freeze({ trialBalance: true, cashProfitAndLoss: true, accrualProfitAndLoss: true, balanceSheet: true, accountsReceivable: true, undepositedFunds: true, checking: true, visa: true, payrollLiabilities: true, reconciled: true, historicalIntegrity: true, complete: true });
const incomplete: AccountingCompletion = Object.freeze({ ...complete, checking: false, reconciled: false, complete: false });
const add = (value: SuncoastAssessmentAttempt, competency: Competency, scenarioId: `SUN-L1-${string}` | undefined, outcome: AssessmentEvidence['outcome'] = 'CORRECT', options: { helpLevel?: 'HINT' | 'DIRECTION' | 'WALKTHROUGH'; selfCorrected?: boolean; resolved?: boolean; criticalHook?: string } = {}) => appendAssessmentEvidence(value, {
  competency, type: options.selfCorrected ? 'SELF_CORRECTION' : options.criticalHook ? 'CRITICAL_EVENT' : 'ACCOUNTING_ACTION', source: { kind: 'TEST_ACTION', id: `${scenarioId ?? competency}-${value.evidence.length}`, attemptId: value.attemptId }, scenarioId, criticalHook: options.criticalHook, severity: options.criticalHook ? 'CRITICAL' : 'MATERIAL', outcome, helpLevel: options.helpLevel, selfCorrected: options.selfCorrected ?? false, resolved: options.resolved ?? (outcome !== 'INCORRECT' && outcome !== 'INAPPROPRIATE'), instructorExplanation: options.criticalHook ? `Critical action hook ${options.criticalHook}.` : 'Supported test observation.',
});
async function blank(id = 'attempt-a') { return deriveSuncoastAssessment(await deriveSuncoastCoaching('student-a', id)); }
function addSuccessfulControls(value: SuncoastAssessmentAttempt) {
  const technical = ['01', '03', '04', '05', '07', '08', '11', '12', '15', '16'];
  const investigation = ['02', '13', '18', '19', '20'];
  const judgment = ['06', '09', '10', '14', '17'];
  for (const id of technical) value = add(value, 'TECHNICAL_BOOKKEEPING', `SUN-L1-${id}`);
  for (const id of investigation) value = add(value, 'INVESTIGATION_PROBLEM_SOLVING', `SUN-L1-${id}`, ['02', '09', '10', '19'].includes(id) ? 'LEGITIMATELY_UNCHANGED' : 'CORRECT');
  for (const id of judgment) value = add(value, 'PROFESSIONAL_JUDGMENT', `SUN-L1-${id}`, ['09', '10'].includes(id) ? 'LEGITIMATELY_UNCHANGED' : id === '06' ? 'ESCALATED_FOR_EVIDENCE' : 'CORRECT');
  for (let index = 0; index < 4; index++) value = add(value, 'CLIENT_COMMUNICATION', undefined);
  return value;
}

describe('P-006 assessment evidence and scoring', () => {
  it('creates immutable evidence before any score and retains the rubric version', async () => {
    const value = add(await blank(), 'TECHNICAL_BOOKKEEPING', 'SUN-L1-01');
    expect(value.rubricVersion).toBe(LAB1_READINESS_RUBRIC);
    expect(value.snapshots).toHaveLength(0);
    expect(value.evidence[0]).toMatchObject({ attemptId: 'attempt-a', sequence: 1, scenarioId: 'SUN-L1-01' });
    expect(Object.isFrozen(value.evidence[0])).toBe(true);
  });

  it('evaluates all four supported competencies from evidence and leaves Month-End NOT_ASSESSED', async () => {
    const result = evaluateAssessment(addSuccessfulControls(await blank()), complete).snapshots[0];
    expect(result.competencies.slice(0, 4).map(item => [item.competency, item.earnedPoints])).toEqual([['TECHNICAL_BOOKKEEPING', 40], ['INVESTIGATION_PROBLEM_SOLVING', 20], ['PROFESSIONAL_JUDGMENT', 15], ['CLIENT_COMMUNICATION', 15]]);
    expect(result.competencies[4]).toMatchObject({ competency: 'MONTH_END_FINANCIAL_EXPLANATION', status: 'NOT_ASSESSED', earnedPoints: null, availablePoints: 10 });
    expect(result.classification).toBe('INCOMPLETE');
  });

  it('treats legitimate unchanged and evidence escalation as demonstrated behavior, not passive final state', async () => {
    let value = await blank();
    value = add(value, 'INVESTIGATION_PROBLEM_SOLVING', 'SUN-L1-02', 'LEGITIMATELY_UNCHANGED');
    value = add(value, 'PROFESSIONAL_JUDGMENT', 'SUN-L1-06', 'ESCALATED_FOR_EVIDENCE');
    const results = evaluateAssessment(value, incomplete).snapshots[0].competencies;
    expect(results.find(item => item.competency === 'INVESTIGATION_PROBLEM_SOLVING')?.earnedPoints).toBeGreaterThan(0);
    expect(results.find(item => item.competency === 'PROFESSIONAL_JUDGMENT')?.earnedPoints).toBeGreaterThan(0);
  });

  it('preserves help state without making help automatic failure', async () => {
    let hint = add(await blank(), 'TECHNICAL_BOOKKEEPING', 'SUN-L1-01', 'CORRECT', { helpLevel: 'HINT' });
    let walkthrough = add(await blank('attempt-b'), 'TECHNICAL_BOOKKEEPING', 'SUN-L1-01', 'CORRECT', { helpLevel: 'WALKTHROUGH' });
    hint = evaluateAssessment(hint, incomplete); walkthrough = evaluateAssessment(walkthrough, incomplete);
    expect(hint.snapshots[0].competencies[0].earnedPoints).toBeGreaterThan(walkthrough.snapshots[0].competencies[0].earnedPoints!);
    expect(walkthrough.snapshots[0].competencies[0].earnedPoints).toBeGreaterThan(0);
  });

  it('uses later evidence while preserving the initial mistake and self-correction chronology', async () => {
    let value = add(await blank(), 'TECHNICAL_BOOKKEEPING', 'SUN-L1-04', 'INCORRECT', { resolved: false });
    value = add(value, 'TECHNICAL_BOOKKEEPING', 'SUN-L1-04', 'CORRECT', { selfCorrected: true });
    expect(value.evidence).toHaveLength(2);
    expect(value.evidence.map(item => item.selfCorrected)).toEqual([false, true]);
    expect(evaluateAssessment(value, incomplete).snapshots[0].competencies[0].earnedPoints).toBeGreaterThan(0);
  });

  it('detects repeated help dependence and can cap a numerically strong readiness candidate', async () => {
    let value = await blank();
    for (const id of ['01', '03', '04', '05', '07', '08', '11', '12', '15', '16']) value = add(value, 'TECHNICAL_BOOKKEEPING', `SUN-L1-${id}`, 'CORRECT', { helpLevel: 'HINT' });
    expect(evaluateAssessment(value, complete).snapshots[0].competencies[0].helpDependent).toBe(true);
  });

  it('keeps corrected critical history and fail-closes unresolved critical behavior', async () => {
    let unresolved = add(await blank(), 'PROFESSIONAL_JUDGMENT', 'SUN-L1-10', 'INAPPROPRIATE', { criticalHook: 'CPA_HISTORY_ALTERED', resolved: false });
    unresolved = evaluateAssessment(unresolved, complete);
    expect(unresolved.snapshots[0].criticalEvents.find(item => item.hook === 'CPA_HISTORY_ALTERED')?.state).toBe('TRIGGERED_UNRESOLVED');
    expect(unresolved.snapshots[0].classification).toBe('INCOMPLETE');
    expect(recordCloseAttempt(unresolved, { accountingCompletion: complete, unresolvedMaterialEvidenceRequests: false }).closeAttempts[0].result).toBe('BLOCKED');
    let corrected = add(unresolved, 'PROFESSIONAL_JUDGMENT', 'SUN-L1-10', 'CORRECT', { criticalHook: 'CPA_HISTORY_ALTERED', selfCorrected: true, resolved: true });
    corrected = evaluateAssessment(corrected, complete);
    expect(corrected.snapshots[1].criticalEvents.find(item => item.hook === 'CPA_HISTORY_ALTERED')).toMatchObject({ state: 'TRIGGERED_SELF_CORRECTED', sourceEvidenceIds: [unresolved.evidence[0].id, corrected.evidence[1].id] });
  });

  it('uses numerical bands only after completion and applies critical/accounting overrides', async () => {
    let value = addSuccessfulControls(await blank());
    value = appendAssessmentEvidence(value, { competency: 'MONTH_END_FINANCIAL_EXPLANATION', type: 'MONTH_END_EXPLANATION', source: { kind: 'FUTURE_AUTHORIZED_INTERACTION', id: 'month-end-1', attemptId: value.attemptId }, severity: 'MATERIAL', outcome: 'CORRECT', selfCorrected: false, resolved: true, instructorExplanation: 'Authorized extension-point evidence used only by this policy test.' });
    expect(evaluateAssessment(value, complete).snapshots[0].classification).toBe('CLIENT_READY');
    expect(evaluateAssessment(value, incomplete).snapshots[0].classification).toBe('RETURN_TO_LAB');
    value = add(value, 'INVESTIGATION_PROBLEM_SOLVING', 'SUN-L1-20', 'INAPPROPRIATE', { criticalHook: 'RECONCILIATION_ADJUSTMENT_FORCED', resolved: false });
    expect(evaluateAssessment(value, complete).snapshots[0].classification).toBe('RETURN_TO_LAB');
  });

  it('records immutable close evidence and bounded close results without hidden counts', async () => {
    let value = recordCloseAttempt(await blank(), { accountingCompletion: incomplete, unresolvedMaterialEvidenceRequests: true });
    value = recordCloseAttempt(value, { accountingCompletion: complete, unresolvedMaterialEvidenceRequests: false });
    expect(value.closeAttempts.map(item => item.result)).toEqual(['NOT_READY', 'READY_FOR_FINAL_REVIEW']);
    expect(value.evidence.map(item => item.type)).toEqual(['FINAL_ACCOUNTING_STATE', 'FINAL_ACCOUNTING_STATE']);
    expect(assessmentStudentView(value).closeAttempts).toEqual([{ sequence: 1, at: value.closeAttempts[0].at, result: 'NOT_READY' }, { sequence: 2, at: value.closeAttempts[1].at, result: 'READY_FOR_FINAL_REVIEW' }]);
  });

  it('compares all required accounting surfaces and accepts intentional resolved-state differences', async () => {
    const coaching = await deriveSuncoastCoaching('student-a', 'resolved');
    const resolved = await buildResolvedP002State('student-a', 'resolved');
    const p002 = { ...coaching.interaction.evidence.p002, attempt: { ...coaching.interaction.evidence.p002.attempt, state: resolved } };
    const result = await compareAccountingCompletion(p002);
    expect(result).toEqual(complete);
    expect(resolved.attempt.entries.some(entry => entry.description === 'Card purchase clarified')).toBe(true);
    expect(resolved.payments.some(payment => payment.amountCents === 75000)).toBe(true);
  });

  it('finds the inherited starting state incomplete', async () => {
    const coaching = await deriveSuncoastCoaching('student-a', 'starting');
    expect((await compareAccountingCompletion(coaching.interaction.evidence.p002)).complete).toBe(false);
  });

  it('is deterministic and preserves prior assessment snapshots during reassessment', async () => {
    const value = addSuccessfulControls(await blank());
    const first = evaluateAssessment(value, complete);
    const repeat = evaluateAssessment(value, complete);
    expect({ ...first.snapshots[0], id: '', evaluatedAt: '' }).toEqual({ ...repeat.snapshots[0], id: '', evaluatedAt: '' });
    const later = evaluateAssessment(add(first, 'CLIENT_COMMUNICATION', undefined, 'CORRECT'), complete);
    expect(later.snapshots).toHaveLength(2);
    expect(later.snapshots[0]).toEqual(first.snapshots[0]);
  });
});

describe('P-006 secrecy, ownership and reset', () => {
  it('student serialization excludes mappings, evidence, rationale, critical internals and hidden issue counts', async () => {
    let value = add(await blank(), 'PROFESSIONAL_JUDGMENT', 'SUN-L1-10', 'INAPPROPRIATE', { criticalHook: 'CPA_HISTORY_ALTERED', resolved: false });
    value = evaluateAssessment(value, incomplete);
    const serialized = JSON.stringify(assessmentStudentView(value));
    expect(serialized).not.toMatch(/SUN-L1|CPA_HISTORY|instructor|sourceEvidence|critical|unresolvedAccounting|evidenceIds|helpDependent/i);
    expect(JSON.stringify(authorizedAssessmentView(value))).toContain('CPA_HISTORY_ALTERED');
  });

  it('rejects cross-attempt evidence references', async () => {
    const value = await blank();
    expect(() => appendAssessmentEvidence(value, { competency: 'TECHNICAL_BOOKKEEPING', type: 'ACCOUNTING_ACTION', source: { kind: 'ACTION', id: 'x', attemptId: 'attempt-b' }, severity: 'ROUTINE', outcome: 'CORRECT', selfCorrected: false, resolved: true, instructorExplanation: 'No.' })).toThrow('Assessment source unavailable');
  });

  it('service ownership fails closed for cross-student reads and client IDs', async () => {
    const value = await blank();
    const service = new SuncoastAssessmentService({ findForStudent: async (attemptId, studentId) => attemptId === value.attemptId && studentId === value.studentId ? value : null, save: async () => undefined });
    await expect(service.view('student-b', value.attemptId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.view(value.studentId, 'attempt-b')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('reset starts a new isolated lifecycle and preserves historical assessment', async () => {
    const old = evaluateAssessment(add(await blank(), 'TECHNICAL_BOOKKEEPING', 'SUN-L1-01'), incomplete);
    const reset = resetSuncoastAssessment(old, 'attempt-new');
    expect(reset.old).toBe(old);
    expect(reset.next).toMatchObject({ attemptId: 'attempt-new', studentId: old.studentId, generation: 2, evidence: [], closeAttempts: [], snapshots: [] });
  });

  it('derives only same-attempt P-002/P-003/P-005 evidence and does not fabricate month-end evidence', async () => {
    const coaching: SuncoastCoachingAttempt = await deriveSuncoastCoaching('student-a', 'derived');
    const value = deriveSuncoastAssessment(coaching);
    expect(value.evidence.every(item => item.attemptId === 'derived' && item.source.attemptId === 'derived')).toBe(true);
    expect(value.evidence.some(item => item.type === 'MONTH_END_EXPLANATION')).toBe(false);
  });
});
