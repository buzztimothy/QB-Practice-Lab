import { InvalidReferenceError, NotFoundError } from './errors.js';
import { p002FinancialSnapshot, type P002InstructorState } from './suncoast-student-start.js';
import { buildResolvedP002State } from './suncoast-student-start.js';
import type { HelpLevel, SuncoastCoachingAttempt } from './suncoast-coaching.js';

export const LAB1_READINESS_RUBRIC = 'LAB1_READINESS_V1' as const;
export type RubricVersion = string;
export type Competency = 'TECHNICAL_BOOKKEEPING' | 'INVESTIGATION_PROBLEM_SOLVING' | 'PROFESSIONAL_JUDGMENT' | 'CLIENT_COMMUNICATION' | 'MONTH_END_FINANCIAL_EXPLANATION';
export type AssessmentStatus = 'ASSESSED' | 'NOT_ASSESSED';
export type HelpState = 'INDEPENDENT' | 'HINT_USED' | 'DIRECTION_USED' | 'WALKTHROUGH_USED';
export type EvidenceOutcome = 'OBSERVED' | 'CORRECT' | 'INCORRECT' | 'INAPPROPRIATE' | 'LEGITIMATELY_UNCHANGED' | 'ESCALATED_FOR_EVIDENCE';
export type CriticalState = 'NOT_TRIGGERED' | 'TRIGGERED_UNRESOLVED' | 'TRIGGERED_SELF_CORRECTED' | 'TRIGGERED_AFTER_COACHING_CORRECTED';
export type CloseResult = 'NOT_READY' | 'BLOCKED' | 'READY_FOR_FINAL_REVIEW';
export type ReadinessClassification = 'CLIENT_READY' | 'CLIENT_READY_WITH_SUPPORT' | 'MORE_PRACTICE_NEEDED' | 'RETURN_TO_LAB' | 'INCOMPLETE' | 'REQUIRES_REVIEW';
export type AssessmentEvidenceType = 'ACCOUNTING_ACTION' | 'DOCUMENT_INVESTIGATION' | 'CLIENT_COMMUNICATION' | 'COACHING_USAGE' | 'RECONCILIATION' | 'SELF_CORRECTION' | 'CRITICAL_EVENT' | 'FINAL_ACCOUNTING_STATE' | 'MONTH_END_EXPLANATION';

export const competencyWeights: Readonly<Record<Competency, number>> = Object.freeze({
  TECHNICAL_BOOKKEEPING: 40,
  INVESTIGATION_PROBLEM_SOLVING: 20,
  PROFESSIONAL_JUDGMENT: 15,
  CLIENT_COMMUNICATION: 15,
  MONTH_END_FINANCIAL_EXPLANATION: 10,
});
export const totalRubricPoints = Object.values(competencyWeights).reduce((sum, points) => sum + points, 0);

export interface AssessmentEvidence {
  readonly id: string;
  readonly attemptId: string;
  readonly competency: Competency;
  readonly type: AssessmentEvidenceType;
  readonly source: { readonly kind: string; readonly id: string; readonly attemptId: string };
  readonly scenarioId?: `SUN-L1-${string}`;
  readonly criticalHook?: string;
  readonly severity: 'ROUTINE' | 'MATERIAL' | 'CRITICAL';
  readonly outcome: EvidenceOutcome;
  readonly helpState: HelpState;
  readonly selfCorrected: boolean;
  readonly resolved: boolean;
  readonly sequence: number;
  readonly at: string;
  readonly instructorExplanation: string;
  readonly awardedPoints?: number;
}

export interface AccountingCompletion {
  readonly trialBalance: boolean;
  readonly cashProfitAndLoss: boolean;
  readonly accrualProfitAndLoss: boolean;
  readonly balanceSheet: boolean;
  readonly accountsReceivable: boolean;
  readonly undepositedFunds: boolean;
  readonly checking: boolean;
  readonly visa: boolean;
  readonly payrollLiabilities: boolean;
  readonly reconciled: boolean;
  readonly historicalIntegrity: boolean;
  readonly complete: boolean;
}

export interface CriticalEventAssessment { readonly hook: string; readonly scenarioId: string; readonly state: CriticalState; readonly sourceEvidenceIds: readonly string[] }
export interface CloseAttempt { readonly id: string; readonly attemptId: string; readonly sequence: number; readonly at: string; readonly unresolvedAccountingDifferences: boolean; readonly unresolvedMaterialEvidenceRequests: boolean; readonly reconciled: boolean; readonly criticalState: CriticalState; readonly result: CloseResult }
export interface CompetencyResult { readonly competency: Competency; readonly status: AssessmentStatus; readonly earnedPoints: number | null; readonly availablePoints: number; readonly evidenceIds: readonly string[]; readonly helpDependent: boolean }
export interface AssessmentSnapshot { readonly id: string; readonly attemptId: string; readonly rubricVersion: RubricVersion; readonly sequence: number; readonly evaluatedAt: string; readonly evidenceThroughSequence: number; readonly competencies: readonly CompetencyResult[]; readonly pointsEarned: number; readonly pointsAssessed: number; readonly criticalEvents: readonly CriticalEventAssessment[]; readonly accountingCompletion: AccountingCompletion; readonly classification: ReadinessClassification; readonly requiresInstructorReview: boolean }
export interface SuncoastAssessmentAttempt { readonly attemptId: string; readonly studentId: string; readonly generation: number; readonly rubricVersion: RubricVersion; readonly evidence: readonly AssessmentEvidence[]; readonly closeAttempts: readonly CloseAttempt[]; readonly snapshots: readonly AssessmentSnapshot[] }

interface ScenarioRule { readonly competency: Exclude<Competency, 'CLIENT_COMMUNICATION' | 'MONTH_END_FINANCIAL_EXPLANATION'>; readonly points: number; readonly investigationRequired: boolean }
const scenarioRules: Readonly<Record<string, ScenarioRule>> = Object.freeze({
  'SUN-L1-01': { competency: 'TECHNICAL_BOOKKEEPING', points: 3, investigationRequired: true }, 'SUN-L1-02': { competency: 'INVESTIGATION_PROBLEM_SOLVING', points: 2, investigationRequired: true },
  'SUN-L1-03': { competency: 'TECHNICAL_BOOKKEEPING', points: 3, investigationRequired: false }, 'SUN-L1-04': { competency: 'TECHNICAL_BOOKKEEPING', points: 4, investigationRequired: true },
  'SUN-L1-05': { competency: 'TECHNICAL_BOOKKEEPING', points: 3, investigationRequired: true }, 'SUN-L1-06': { competency: 'PROFESSIONAL_JUDGMENT', points: 3, investigationRequired: true },
  'SUN-L1-07': { competency: 'TECHNICAL_BOOKKEEPING', points: 4, investigationRequired: true }, 'SUN-L1-08': { competency: 'TECHNICAL_BOOKKEEPING', points: 3, investigationRequired: true },
  'SUN-L1-09': { competency: 'PROFESSIONAL_JUDGMENT', points: 3, investigationRequired: true }, 'SUN-L1-10': { competency: 'PROFESSIONAL_JUDGMENT', points: 3, investigationRequired: true },
  'SUN-L1-11': { competency: 'TECHNICAL_BOOKKEEPING', points: 3, investigationRequired: true }, 'SUN-L1-12': { competency: 'TECHNICAL_BOOKKEEPING', points: 3, investigationRequired: true },
  'SUN-L1-13': { competency: 'INVESTIGATION_PROBLEM_SOLVING', points: 3, investigationRequired: true }, 'SUN-L1-14': { competency: 'PROFESSIONAL_JUDGMENT', points: 3, investigationRequired: true },
  'SUN-L1-15': { competency: 'TECHNICAL_BOOKKEEPING', points: 3, investigationRequired: true }, 'SUN-L1-16': { competency: 'TECHNICAL_BOOKKEEPING', points: 4, investigationRequired: true },
  'SUN-L1-17': { competency: 'PROFESSIONAL_JUDGMENT', points: 3, investigationRequired: true }, 'SUN-L1-18': { competency: 'INVESTIGATION_PROBLEM_SOLVING', points: 3, investigationRequired: true },
  'SUN-L1-19': { competency: 'INVESTIGATION_PROBLEM_SOLVING', points: 3, investigationRequired: true }, 'SUN-L1-20': { competency: 'INVESTIGATION_PROBLEM_SOLVING', points: 6, investigationRequired: true },
});

const criticalHooks: Readonly<Record<string, string>> = Object.freeze({
  HOME_DEPOT_SUPPORTED_REMOVED: 'SUN-L1-02', CPA_HISTORY_ALTERED: 'SUN-L1-10', ABC_CLASSIFICATION_GUESSED: 'SUN-L1-06', JENKINS_RECEIVABLE_REMOVED: 'SUN-L1-09', UNAPPLIED_AMOUNT_DISPOSED: 'SUN-L1-18', RECONCILIATION_ADJUSTMENT_FORCED: 'SUN-L1-20', PALM_BREEZE_RECEIPT_REMOVED: 'SUN-L1-19', UNVERIFIED_STATEMENTS_PRESENTED_FINAL: 'SUN-L1-20',
});

const helpState = (level?: HelpLevel): HelpState => level === 'HINT' ? 'HINT_USED' : level === 'DIRECTION' ? 'DIRECTION_USED' : level === 'WALKTHROUGH' ? 'WALKTHROUGH_USED' : 'INDEPENDENT';
const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const item of Object.values(value)) deepFreeze(item); }
  return value;
};
const at = (sequence: number) => `2026-07-06T12:${String(sequence).padStart(2, '0')}:00.000Z`;
const baseAttempt = (studentId: string, attemptId: string, generation: number): SuncoastAssessmentAttempt => deepFreeze({ attemptId, studentId, generation, rubricVersion: LAB1_READINESS_RUBRIC, evidence: [], closeAttempts: [], snapshots: [] });

export function deriveSuncoastAssessment(coaching: SuncoastCoachingAttempt): SuncoastAssessmentAttempt {
  let result = baseAttempt(coaching.studentId, coaching.attemptId, coaching.generation);
  for (const event of coaching.interaction.evidence.p002.attempt.auditTrail) {
    const provenance = coaching.interaction.evidence.p002.provenance.find(item => [...item.cleanRecordIds, ...item.studentRecordIds].includes(event.targetId));
    const scenarioId = event.hook ? coaching.interaction.evidence.p002.criticalHooks[event.hook] : provenance?.scenarioId;
    const rule = scenarioId ? scenarioRules[scenarioId] : undefined;
    const verifiedCorrect = event.action === 'TRANSACTION_CORRECTED' || event.action === 'ACCOUNT_CONSOLIDATED' || event.action === 'SELF_CORRECTION' || event.selfCorrected === true;
    const supportedEscalation = event.action === 'ISSUE_FLAGGED';
    const outcome: EvidenceOutcome = event.hook ? 'INAPPROPRIATE' : verifiedCorrect ? 'CORRECT' : supportedEscalation ? 'ESCALATED_FOR_EVIDENCE' : 'OBSERVED';
    result = appendAssessmentEvidence(result, { competency: rule?.competency ?? (event.action.includes('RECONCILIATION') ? 'INVESTIGATION_PROBLEM_SOLVING' : 'TECHNICAL_BOOKKEEPING'), type: event.action.includes('RECONCILIATION') ? 'RECONCILIATION' : event.selfCorrected ? 'SELF_CORRECTION' : 'ACCOUNTING_ACTION', source: { kind: 'P002_ACTION', id: `${event.sequence}:${event.targetId}`, attemptId: coaching.attemptId }, scenarioId: scenarioId as `SUN-L1-${string}` | undefined, criticalHook: event.hook, severity: event.hook ? 'CRITICAL' : 'ROUTINE', outcome, selfCorrected: event.selfCorrected ?? false, resolved: event.hook ? event.selfCorrected ?? false : verifiedCorrect || supportedEscalation, instructorExplanation: event.hook ? `Critical action hook ${event.hook}.` : `Recorded student bookkeeping action: ${event.action}; correctness is ${verifiedCorrect ? 'verified by the action contract' : 'not inferred'}.` });
  }
  for (const conversation of coaching.interaction.conversations) for (const message of conversation.messages.filter(item => item.sender === 'STUDENT')) {
    result = appendAssessmentEvidence(result, { competency: 'CLIENT_COMMUNICATION', type: 'CLIENT_COMMUNICATION', source: { kind: 'CONVERSATION_MESSAGE', id: message.id, attemptId: coaching.attemptId }, severity: 'ROUTINE', outcome: 'OBSERVED', selfCorrected: false, resolved: true, instructorExplanation: 'Student communication preserved for observable-behavior review; no competence inferred without an observation.' });
  }
  for (const event of coaching.interaction.evidence.audit) {
    result = appendAssessmentEvidence(result, { competency: 'INVESTIGATION_PROBLEM_SOLVING', type: 'DOCUMENT_INVESTIGATION', source: { kind: 'EVIDENCE_AUDIT', id: `${event.sequence}`, attemptId: coaching.attemptId }, severity: 'ROUTINE', outcome: event.kind === 'DOCUMENT_REQUESTED' ? 'ESCALATED_FOR_EVIDENCE' : 'CORRECT', selfCorrected: false, resolved: true, instructorExplanation: `Document behavior: ${event.kind}.` });
  }
  for (const record of coaching.records) {
    const positive = Object.values(record.dimensions).filter(value => value === 'STRENGTH').length;
    const message = coaching.interaction.conversations.flatMap(conversation => conversation.messages).find(item => item.id === record.studentMessageId);
    const concreteContext = /\b(transaction|receipt|invoice|agreement|report|document(?:ation)?|support|abc|payroll|cpa|statement|p&l|home depot|jenkins|palm breeze|reconcil)/i.test(message?.content ?? '');
    const positiveSituation = record.situation === 'COACH-05' || record.situation === 'COACH-08' && concreteContext;
    const weaknessSituation = ['COACH-01', 'COACH-02', 'COACH-03', 'COACH-04', 'COACH-06', 'COACH-07'].includes(record.situation);
    if (!record.originalDraft && (positiveSituation || weaknessSituation)) result = appendAssessmentEvidence(result, { competency: 'CLIENT_COMMUNICATION', type: 'CLIENT_COMMUNICATION', source: { kind: 'COACHING_OBSERVATION', id: record.id, attemptId: coaching.attemptId }, severity: 'ROUTINE', outcome: positiveSituation && positive >= 3 ? 'CORRECT' : 'INCORRECT', selfCorrected: false, resolved: positiveSituation && positive >= 3, instructorExplanation: `Situation-grounded communication observation on the already-sent message: ${positive}/4 dimensions; ${record.situation}; concrete task context ${concreteContext ? 'present' : 'absent'}. Later coaching does not retroactively change independence.` });
    result = appendAssessmentEvidence(result, { competency: 'CLIENT_COMMUNICATION', type: 'COACHING_USAGE', source: { kind: 'COACHING_RECORD', id: record.id, attemptId: coaching.attemptId }, severity: 'ROUTINE', outcome: 'OBSERVED', helpLevel: record.helpLevel, selfCorrected: false, resolved: true, instructorExplanation: record.originalDraft ? 'Help was used on a draft before any student performance was observed.' : 'Help was requested or offered after the referenced student message.' });
  }
  return result;
}

export function appendAssessmentEvidence(value: SuncoastAssessmentAttempt, input: Omit<AssessmentEvidence, 'id' | 'attemptId' | 'sequence' | 'at' | 'helpState'> & { readonly helpLevel?: HelpLevel }): SuncoastAssessmentAttempt {
  if (input.source.attemptId !== value.attemptId) throw new InvalidReferenceError('Assessment source unavailable');
  if (input.scenarioId && !scenarioRules[input.scenarioId]) throw new InvalidReferenceError('Assessment source unavailable');
  const sequence = value.evidence.length + 1;
  const evidence: AssessmentEvidence = { ...input, id: `${value.attemptId}-assessment-evidence-${sequence}`, attemptId: value.attemptId, sequence, at: at(sequence), helpState: helpState(input.helpLevel) };
  return deepFreeze({ ...value, evidence: [...value.evidence, evidence] });
}

const financialJson = (value: unknown) => JSON.stringify(value, (key, item: unknown) => key.endsWith('Id') || key.endsWith('Ids') ? undefined : item);
export async function compareAccountingCompletion(p002: P002InstructorState): Promise<AccountingCompletion> {
  const actual = p002FinancialSnapshot(p002);
  const resolvedState = await buildResolvedP002State(p002.attempt.state.attempt.studentId, `${p002.attempt.state.attempt.id}-comparison`, p002.attempt.state.attempt.generation);
  const expected = p002FinancialSnapshot({ ...p002, attempt: { ...p002.attempt, state: resolvedState } });
  const names = (value: typeof actual.trialBalance) => Object.fromEntries(value.map(row => [row.name, [row.debitCents, row.creditCents]]));
  const trialBalance = JSON.stringify(names(actual.trialBalance)) === JSON.stringify(names(expected.trialBalance));
  const cashProfitAndLoss = financialJson(actual.cashJune) === financialJson(expected.cashJune);
  const accrualProfitAndLoss = financialJson(actual.accrualJune) === financialJson(expected.accrualJune);
  const balanceSheet = financialJson(actual.balanceSheet) === financialJson(expected.balanceSheet);
  const receivableAmounts = (rows: typeof actual.ar.customers) => rows.map(row => [row.invoiceOpenCents, row.unappliedPaymentCents, row.netReceivableCents]).sort((a, b) => a.join(':').localeCompare(b.join(':')));
  const accountsReceivable = actual.ar.controlDifferenceCents === 0 && JSON.stringify(receivableAmounts(actual.ar.customers)) === JSON.stringify(receivableAmounts(expected.ar.customers));
  const undepositedFunds = actual.undepositedFundsCents === expected.undepositedFundsCents;
  const checking = actual.checking.differenceCents === 0;
  const visa = actual.visa.differenceCents === 0;
  const payrollLiabilities = names(actual.trialBalance)['Payroll Liabilities']?.join(':') === names(expected.trialBalance)['Payroll Liabilities']?.join(':');
  const reconciled = checking && visa;
  const historicalIntegrity = actual.historical.every(item => item.historicalIntegrity);
  return deepFreeze({ trialBalance, cashProfitAndLoss, accrualProfitAndLoss, balanceSheet, accountsReceivable, undepositedFunds, checking, visa, payrollLiabilities, reconciled, historicalIntegrity, complete: trialBalance && cashProfitAndLoss && accrualProfitAndLoss && balanceSheet && accountsReceivable && undepositedFunds && checking && visa && payrollLiabilities && historicalIntegrity });
}

function criticalEvents(evidence: readonly AssessmentEvidence[]): readonly CriticalEventAssessment[] {
  return Object.entries(criticalHooks).map(([hook, scenarioId]) => {
    const sources = evidence.filter(item => item.severity === 'CRITICAL' && item.criticalHook === hook);
    const last = sources.at(-1);
    const state: CriticalState = !last ? 'NOT_TRIGGERED' : !last.resolved ? 'TRIGGERED_UNRESOLVED' : last.selfCorrected && last.helpState === 'INDEPENDENT' ? 'TRIGGERED_SELF_CORRECTED' : 'TRIGGERED_AFTER_COACHING_CORRECTED';
    return deepFreeze({ hook, scenarioId, state, sourceEvidenceIds: sources.map(item => item.id) });
  });
}

function competencyResult(competency: Competency, evidence: readonly AssessmentEvidence[]): CompetencyResult {
  const relevant = evidence.filter(item => item.competency === competency);
  const availablePoints = competencyWeights[competency];
  if (competency === 'MONTH_END_FINANCIAL_EXPLANATION' && !relevant.some(item => item.type === 'MONTH_END_EXPLANATION')) return deepFreeze({ competency, status: 'NOT_ASSESSED', earnedPoints: null, availablePoints, evidenceIds: [], helpDependent: false });
  if (competency === 'MONTH_END_FINANCIAL_EXPLANATION') {
    const authoritative = relevant.filter(item => item.type === 'MONTH_END_EXPLANATION').at(-1)!;
    return deepFreeze({ competency, status: 'ASSESSED', earnedPoints: Math.max(0, Math.min(availablePoints, authoritative.awardedPoints ?? 0)), availablePoints, evidenceIds: relevant.map(item => item.id), helpDependent: authoritative.helpState !== 'INDEPENDENT' });
  }
  const latestByScenario = new Map<string, AssessmentEvidence>();
  for (const item of relevant) latestByScenario.set(item.scenarioId ?? item.id, item);
  const latest = [...latestByScenario.values()];
  const assessable = latest.filter(item => item.outcome !== 'OBSERVED');
  const positive = assessable.filter(item => ['CORRECT', 'LEGITIMATELY_UNCHANGED', 'ESCALATED_FOR_EVIDENCE'].includes(item.outcome) && item.resolved);
  const helpFactor = (item: AssessmentEvidence) => item.helpState === 'INDEPENDENT' ? 1 : item.helpState === 'HINT_USED' ? 0.9 : item.helpState === 'DIRECTION_USED' ? 0.75 : 0.55;
  const performanceFactor = (item: AssessmentEvidence) => helpFactor(item) * (item.selfCorrected ? 0.8 : 1);
  let earnedPoints: number;
  if (competency === 'CLIENT_COMMUNICATION') earnedPoints = assessable.length === 0 ? 0 : Math.round(availablePoints * positive.reduce((sum, item) => sum + performanceFactor(item), 0) / assessable.length);
  else {
    const applicable = Object.entries(scenarioRules).filter(([, rule]) => rule.competency === competency);
    const rawMax = applicable.reduce((sum, [, rule]) => sum + rule.points, 0);
    const rawEarned = applicable.reduce((sum, [scenarioId, rule]) => { const item = latestByScenario.get(scenarioId); return sum + (item && positive.includes(item) ? rule.points * performanceFactor(item) : 0); }, 0);
    earnedPoints = rawMax === 0 ? 0 : Math.round(availablePoints * rawEarned / rawMax);
  }
  return deepFreeze({ competency, status: 'ASSESSED', earnedPoints: Math.min(availablePoints, earnedPoints), availablePoints, evidenceIds: relevant.map(item => item.id), helpDependent: assessable.length > 0 && assessable.filter(item => item.helpState !== 'INDEPENDENT').length / assessable.length > 0.5 });
}

export function evaluateAssessment(value: SuncoastAssessmentAttempt, accountingCompletion: AccountingCompletion): SuncoastAssessmentAttempt {
  const competencies = (Object.keys(competencyWeights) as Competency[]).map(item => competencyResult(item, value.evidence));
  const events = criticalEvents(value.evidence);
  const pointsEarned = competencies.reduce((sum, item) => sum + (item.earnedPoints ?? 0), 0);
  const pointsAssessed = competencies.filter(item => item.status === 'ASSESSED').reduce((sum, item) => sum + item.availablePoints, 0);
  const incomplete = competencies.some(item => item.status === 'NOT_ASSESSED');
  const unresolvedCritical = events.some(item => item.state === 'TRIGGERED_UNRESOLVED');
  const correctedCritical = events.some(item => item.state === 'TRIGGERED_SELF_CORRECTED' || item.state === 'TRIGGERED_AFTER_COACHING_CORRECTED');
  const helpDependent = competencies.some(item => item.helpDependent);
  const percent = pointsAssessed === 0 ? 0 : Math.round(pointsEarned * 100 / pointsAssessed);
  let classification: ReadinessClassification = percent >= 90 ? 'CLIENT_READY' : percent >= 80 ? 'CLIENT_READY_WITH_SUPPORT' : percent >= 70 ? 'MORE_PRACTICE_NEEDED' : 'RETURN_TO_LAB';
  if (incomplete) classification = 'INCOMPLETE';
  else if (unresolvedCritical || !accountingCompletion.complete) classification = 'RETURN_TO_LAB';
  else if (correctedCritical) classification = 'REQUIRES_REVIEW';
  else if (helpDependent && classification === 'CLIENT_READY') classification = 'CLIENT_READY_WITH_SUPPORT';
  const sequence = value.snapshots.length + 1;
  const snapshot: AssessmentSnapshot = { id: `${value.attemptId}-assessment-${sequence}`, attemptId: value.attemptId, rubricVersion: value.rubricVersion, sequence, evaluatedAt: at(value.evidence.length + sequence), evidenceThroughSequence: value.evidence.length, competencies, pointsEarned, pointsAssessed, criticalEvents: events, accountingCompletion, classification, requiresInstructorReview: correctedCritical };
  return deepFreeze({ ...value, snapshots: [...value.snapshots, snapshot] });
}

export function recordCloseAttempt(value: SuncoastAssessmentAttempt, input: { readonly accountingCompletion: AccountingCompletion; readonly unresolvedMaterialEvidenceRequests: boolean }): SuncoastAssessmentAttempt {
  const withEvidence = appendAssessmentEvidence(value, { competency: 'TECHNICAL_BOOKKEEPING', type: 'FINAL_ACCOUNTING_STATE', source: { kind: 'CLOSE_ATTEMPT', id: `${value.attemptId}-close-${value.closeAttempts.length + 1}`, attemptId: value.attemptId }, severity: 'MATERIAL', outcome: input.accountingCompletion.complete ? 'CORRECT' : 'INCORRECT', selfCorrected: false, resolved: input.accountingCompletion.complete, instructorExplanation: 'Accounting completion state captured at close attempt.' });
  const events = criticalEvents(withEvidence.evidence);
  const criticalState = events.find(item => item.state === 'TRIGGERED_UNRESOLVED')?.state ?? events.find(item => item.state !== 'NOT_TRIGGERED')?.state ?? 'NOT_TRIGGERED';
  const requiredInvestigations = Object.entries(scenarioRules).filter(([, rule]) => rule.investigationRequired).map(([scenarioId]) => scenarioId);
  const investigated = new Set<string>(withEvidence.evidence.filter(item => item.scenarioId && item.resolved && ['CORRECT', 'LEGITIMATELY_UNCHANGED', 'ESCALATED_FOR_EVIDENCE'].includes(item.outcome)).map(item => item.scenarioId!));
  const requiredInvestigationComplete = requiredInvestigations.every(scenarioId => investigated.has(scenarioId));
  const result: CloseResult = criticalState === 'TRIGGERED_UNRESOLVED' ? 'BLOCKED' : input.accountingCompletion.complete && !input.unresolvedMaterialEvidenceRequests && requiredInvestigationComplete ? 'READY_FOR_FINAL_REVIEW' : 'NOT_READY';
  const sequence = withEvidence.closeAttempts.length + 1;
  const close: CloseAttempt = deepFreeze({ id: `${withEvidence.attemptId}-close-${sequence}`, attemptId: withEvidence.attemptId, sequence, at: at(withEvidence.evidence.length + sequence), unresolvedAccountingDifferences: !input.accountingCompletion.complete, unresolvedMaterialEvidenceRequests: input.unresolvedMaterialEvidenceRequests, reconciled: input.accountingCompletion.reconciled, criticalState, result });
  return deepFreeze({ ...withEvidence, closeAttempts: [...withEvidence.closeAttempts, close] });
}

export function assessmentStudentView(value: SuncoastAssessmentAttempt) {
  const latest = value.snapshots.at(-1);
  return deepFreeze({ attemptId: value.attemptId, generation: value.generation, rubricVersion: value.rubricVersion, assessment: latest ? { competencies: latest.competencies.map(item => ({ competency: item.competency, status: item.status, earnedPoints: item.earnedPoints, availablePoints: item.availablePoints })), pointsEarned: latest.pointsEarned, pointsAssessed: latest.pointsAssessed, totalRubricPoints, classification: latest.classification, incomplete: latest.competencies.some(item => item.status === 'NOT_ASSESSED') } : null, closeAttempts: value.closeAttempts.map(item => ({ sequence: item.sequence, at: item.at, result: item.result })) });
}
export function authorizedAssessmentView(value: SuncoastAssessmentAttempt) { return value; }
export function resetSuncoastAssessment(value: SuncoastAssessmentAttempt, newAttemptId: string): { old: SuncoastAssessmentAttempt; next: SuncoastAssessmentAttempt } { return { old: value, next: baseAttempt(value.studentId, newAttemptId, value.generation + 1) }; }

export interface AssessmentStore { findForStudent(attemptId: string, studentId: string): Promise<SuncoastAssessmentAttempt | null>; save(value: SuncoastAssessmentAttempt): Promise<void> }
export class SuncoastAssessmentService {
  constructor(private readonly store: AssessmentStore) {}
  async view(studentId: string, attemptId: string) { return assessmentStudentView(await this.owned(studentId, attemptId)); }
  async close(studentId: string, attemptId: string, input: { accountingCompletion: AccountingCompletion; unresolvedMaterialEvidenceRequests: boolean }) { const value = recordCloseAttempt(await this.owned(studentId, attemptId), input); await this.store.save(value); return assessmentStudentView(value); }
  private async owned(studentId: string, attemptId: string) { const value = await this.store.findForStudent(attemptId, studentId); if (!value) throw new NotFoundError('Attempt not found'); return value; }
}
