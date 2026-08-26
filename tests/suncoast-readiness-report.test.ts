import { describe, expect, it } from 'vitest';
import { InvalidReferenceError, InvalidStateError, NotFoundError } from '../packages/accounting-domain/src/errors.js';
import { competencyWeights, type AssessmentEvidence, type Competency, type ReadinessClassification, type SuncoastAssessmentAttempt } from '../packages/accounting-domain/src/suncoast-assessment.js';
import { ReadinessReportService, authorizedReadinessReportView, competencyLabel, generateReadinessReport, readinessReportStudentView } from '../packages/accounting-domain/src/suncoast-readiness-report.js';

const competencies = Object.keys(competencyWeights) as Competency[];
const complete = Object.freeze({ trialBalance: true, cashProfitAndLoss: true, accrualProfitAndLoss: true, balanceSheet: true, accountsReceivable: true, undepositedFunds: true, checking: true, visa: true, payrollLiabilities: true, reconciled: true, historicalIntegrity: true, complete: true });

function assessment(classification: ReadinessClassification = 'CLIENT_READY', options: { id?: string; studentId?: string; generation?: number; points?: readonly number[]; notAssessed?: Competency; helped?: Competency; selfCorrected?: boolean; critical?: 'TRIGGERED_UNRESOLVED' | 'TRIGGERED_SELF_CORRECTED' | 'TRIGGERED_AFTER_COACHING_CORRECTED' } = {}): SuncoastAssessmentAttempt {
  const attemptId = options.id ?? 'attempt-a', studentId = options.studentId ?? 'student-a';
  const results = competencies.map((competency, index) => {
    const notAssessed = competency === options.notAssessed;
    return { competency, status: notAssessed ? 'NOT_ASSESSED' as const : 'ASSESSED' as const, earnedPoints: notAssessed ? null : options.points?.[index] ?? competencyWeights[competency], availablePoints: competencyWeights[competency], evidenceIds: notAssessed ? [] : [`${attemptId}-evidence-${index + 1}`], helpDependent: competency === options.helped };
  });
  const evidence: AssessmentEvidence[] = results.filter(item => item.evidenceIds.length).map((item, index) => ({ id: item.evidenceIds[0], attemptId, competency: item.competency, type: item.competency === 'MONTH_END_FINANCIAL_EXPLANATION' ? 'MONTH_END_EXPLANATION' : 'ACCOUNTING_ACTION', source: { kind: 'TEST', id: `source-${index + 1}`, attemptId }, severity: 'ROUTINE', outcome: 'CORRECT', helpState: item.helpDependent ? 'WALKTHROUGH_USED' : 'INDEPENDENT', selfCorrected: options.selfCorrected === true && index === 0, resolved: true, sequence: index + 1, at: `2026-07-08T14:0${index}:00.000Z`, instructorExplanation: `SECRET_SOLUTION_${index}` }));
  const criticalEvents = options.critical ? [{ hook: 'SECRET_CRITICAL_HOOK', scenarioId: 'SUN-L1-20', state: options.critical, sourceEvidenceIds: [evidence[0]?.id ?? `${attemptId}-snapshot-1`] }] : [];
  const pointsEarned = results.reduce((sum, item) => sum + (item.earnedPoints ?? 0), 0);
  const pointsAssessed = results.filter(item => item.status === 'ASSESSED').reduce((sum, item) => sum + item.availablePoints, 0);
  return Object.freeze({ attemptId, studentId, generation: options.generation ?? 1, rubricVersion: 'LAB1_READINESS_V1', evidence: Object.freeze(evidence), closeAttempts: [], snapshots: [Object.freeze({ id: `${attemptId}-snapshot-1`, attemptId, rubricVersion: 'LAB1_READINESS_V1', sequence: 1, evaluatedAt: '2026-07-08T14:30:00.000Z', evidenceThroughSequence: evidence.length, competencies: Object.freeze(results), pointsEarned, pointsAssessed, criticalEvents: Object.freeze(criticalEvents), accountingCompletion: complete, classification, requiresInstructorReview: classification === 'REQUIRES_REVIEW' })] });
}

describe('P-008 client readiness report', () => {
  it.each([
    ['CLIENT_READY', 'Client Ready'], ['CLIENT_READY_WITH_SUPPORT', 'Client Ready With Support'], ['MORE_PRACTICE_NEEDED', 'More Practice Recommended'], ['RETURN_TO_LAB', 'Return to the Practice Lab'], ['INCOMPLETE', 'Assessment Incomplete'], ['REQUIRES_REVIEW', 'BBB Review Required'],
  ] as const)('presents canonical %s without reclassifying it', (classification, label) => {
    const report = readinessReportStudentView(generateReadinessReport(null, assessment(classification)));
    expect(report.header).toMatchObject({ result: label, canonicalClassification: classification });
  });

  it('maps competency percentages deterministically and documents NOT_ASSESSED behavior in code', () => {
    const result = (earnedPoints: number | null, status: 'ASSESSED' | 'NOT_ASSESSED' = 'ASSESSED') => ({ competency: 'TECHNICAL_BOOKKEEPING' as const, status, earnedPoints, availablePoints: 40, evidenceIds: [], helpDependent: false });
    expect([competencyLabel(result(36)), competencyLabel(result(32)), competencyLabel(result(28)), competencyLabel(result(27)), competencyLabel(result(null, 'NOT_ASSESSED'))]).toEqual(['STRONG', 'PROFICIENT', 'DEVELOPING', 'NEEDS_PRACTICE', 'NOT_ASSESSED']);
  });

  it('shows authoritative points and honest strengths/development without inventing accomplishments', () => {
    const view = readinessReportStudentView(generateReadinessReport(null, assessment('MORE_PRACTICE_NEEDED', { points: [40, 15, 10, 9, 7] })));
    expect(view.points).toEqual({ earned: 81, assessed: 100, total: 100 });
    expect(view.whatYouDidWell).toHaveLength(1);
    expect(view.whatToKeepPracticing).toHaveLength(4);
    expect(view.competencies.map(item => item.label)).toEqual(['STRONG', 'DEVELOPING', 'NEEDS_PRACTICE', 'NEEDS_PRACTICE', 'DEVELOPING']);
  });

  it('keeps NOT_ASSESSED explicit and grounded in the immutable snapshot', () => {
    const history = generateReadinessReport(null, assessment('INCOMPLETE', { notAssessed: 'MONTH_END_FINANCIAL_EXPLANATION' }));
    const competency = history.reports[0].competencies[4];
    expect(competency).toMatchObject({ earnedPoints: null, label: 'NOT_ASSESSED' });
    expect(competency.interpretation.sourceRefs).toEqual(['attempt-a-snapshot-1']);
  });

  it('describes help qualitatively, preserves self-correction nuance, and never exposes counts', () => {
    const view = readinessReportStudentView(generateReadinessReport(null, assessment('CLIENT_READY_WITH_SUPPORT', { helped: 'TECHNICAL_BOOKKEEPING', selfCorrected: true })));
    expect(view.independenceSummary).toContain('walkthrough assistance');
    expect(view.selfCorrectionSummary).toContain('substantial assistance');
    expect(view.independenceSummary).not.toMatch(/\b\d+\b/);
  });

  it.each(['TRIGGERED_UNRESOLVED', 'TRIGGERED_SELF_CORRECTED', 'TRIGGERED_AFTER_COACHING_CORRECTED'] as const)('translates %s critical history into bounded student-safe language', critical => {
    const view = readinessReportStudentView(generateReadinessReport(null, assessment(critical === 'TRIGGERED_UNRESOLVED' ? 'RETURN_TO_LAB' : 'REQUIRES_REVIEW', { critical })));
    expect(view.criticalSummary).toBeTruthy();
    expect(JSON.stringify(view)).not.toContain('SECRET_CRITICAL_HOOK');
  });

  it('does not leak instructor explanations, source references, scenario solutions, or hidden grading metadata', () => {
    const history = generateReadinessReport(null, assessment());
    expect(JSON.stringify(authorizedReadinessReportView(history))).toContain('sourceRefs');
    const studentJson = JSON.stringify(readinessReportStudentView(history));
    expect(studentJson).not.toMatch(/SECRET_|sourceRefs|instructorExplanation|scenarioId|criticalHook|source-/);
  });

  it('is deterministic and returns the same immutable snapshot for the same assessment', () => {
    const source = assessment();
    const first = generateReadinessReport(null, source);
    expect(generateReadinessReport(first, source)).toBe(first);
    expect(generateReadinessReport(null, source)).toEqual(first);
    expect(Object.isFrozen(first.reports[0].competencies[0])).toBe(true);
  });

  it('appends a new version for a later authoritative assessment while preserving history', () => {
    const firstAssessment = assessment();
    const first = generateReadinessReport(null, firstAssessment);
    const secondSnapshot = { ...firstAssessment.snapshots[0], id: 'attempt-a-snapshot-2', sequence: 2, evaluatedAt: '2026-07-08T15:00:00.000Z' };
    const secondAssessment = { ...firstAssessment, snapshots: [...firstAssessment.snapshots, secondSnapshot] };
    const history = generateReadinessReport(first, secondAssessment);
    expect(history.reports.map(report => [report.version, report.assessmentSnapshotId])).toEqual([[1, 'attempt-a-snapshot-1'], [2, 'attempt-a-snapshot-2']]);
    expect(history.reports[0]).toBe(first.reports[0]);
  });

  it('fails closed on cross-attempt histories and malformed authoritative totals', () => {
    const history = generateReadinessReport(null, assessment());
    expect(() => generateReadinessReport(history, assessment('CLIENT_READY', { id: 'attempt-b' }))).toThrow(InvalidReferenceError);
    const malformed = assessment();
    const bad = { ...malformed, snapshots: [{ ...malformed.snapshots[0], pointsEarned: 99 }] };
    expect(() => generateReadinessReport(null, bad)).toThrow(InvalidStateError);
  });

  it('enforces student ownership in the report service without exposing existence', async () => {
    const history = generateReadinessReport(null, assessment());
    const service = new ReadinessReportService({ findForStudent: async (attemptId, studentId) => attemptId === history.attemptId && studentId === history.studentId ? history : null, save: async () => undefined });
    await expect(service.view('student-a', 'attempt-a')).resolves.toMatchObject({ attemptNumber: 1 });
    await expect(service.view('student-b', 'attempt-a')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('keeps retries in separate attempt histories', () => {
    const first = generateReadinessReport(null, assessment('RETURN_TO_LAB'));
    const retry = generateReadinessReport(null, assessment('CLIENT_READY', { id: 'attempt-retry', generation: 2 }));
    expect(first).toMatchObject({ attemptId: 'attempt-a', attemptNumber: 1 });
    expect(retry).toMatchObject({ attemptId: 'attempt-retry', attemptNumber: 2 });
    expect(first.reports[0].canonicalClassification).toBe('RETURN_TO_LAB');
  });
});
