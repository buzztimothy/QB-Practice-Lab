import { InvalidReferenceError, InvalidStateError, NotFoundError } from './errors.js';
import { balanceSheet, trialBalance } from './service.js';
import { customerBalances, operationalProfitAndLoss } from './operations.js';
import type { P002InstructorState } from './suncoast-student-start.js';
import { LAB1_READINESS_RUBRIC, appendAssessmentEvidence, compareAccountingCompletion, evaluateAssessment, type AccountingCompletion, type SuncoastAssessmentAttempt } from './suncoast-assessment.js';

export type ExplanationDimension = 'FINANCIAL_ACCURACY' | 'RELEVANCE' | 'CLARITY' | 'BUSINESS_INSIGHT' | 'PROFESSIONAL_COMMUNICATION';
export const explanationWeights: Readonly<Record<ExplanationDimension, number>> = Object.freeze({ FINANCIAL_ACCURACY: 3, RELEVANCE: 2, CLARITY: 2, BUSINESS_INSIGHT: 2, PROFESSIONAL_COMMUNICATION: 1 });
export type FollowUpKind = 'PROFIT_WITHDRAWAL' | 'RECEIVABLE_CONCERN' | 'DEBT_CONCERN';
export interface MonthEndFinancialPackage {
  readonly attemptId: string;
  readonly period: '2026-06';
  readonly cashProfitAndLoss: {
    readonly april: { readonly revenueCents: number; readonly expenseCents: number; readonly netIncomeCents: number };
    readonly may: { readonly revenueCents: number; readonly expenseCents: number; readonly netIncomeCents: number };
    readonly june: { readonly revenueCents: number; readonly expenseCents: number; readonly netIncomeCents: number };
  };
  readonly comparisons: { readonly juneVsMayRevenueChangeCents: number; readonly juneVsAprilRevenueChangeCents: number; readonly juneVsAprilRevenuePercentTenths: number };
  readonly balanceSheet: ReturnType<typeof balanceSheet>;
  readonly operatingCheckingCents: number;
  readonly receivables: readonly { readonly customer: string; readonly openCents: number; readonly unappliedCents: number; readonly netReceivableCents: number }[];
  readonly liabilities: readonly { readonly name: string; readonly balanceCents: number }[];
}
export interface ExplanationDimensionResult { readonly dimension: ExplanationDimension; readonly earnedPoints: number; readonly availablePoints: number; readonly instructorRationale: string }
export interface MonthEndFollowUp { readonly id: string; readonly kind: FollowUpKind; readonly prompt: string; readonly askedAt: string; readonly response?: string; readonly respondedAt?: string }
export interface MonthEndExplanationEvidence { readonly id: string; readonly attemptId: string; readonly meetingId: string; readonly explanation: string; readonly financialContext: MonthEndFinancialPackage; readonly followUps: readonly MonthEndFollowUp[]; readonly helpState: 'INDEPENDENT'; readonly dimensions: readonly ExplanationDimensionResult[]; readonly points: number; readonly submittedAt: string; readonly sequence: 1; readonly rubricVersion: typeof LAB1_READINESS_RUBRIC }
export interface SuncoastMonthEndMeeting { readonly id: string; readonly attemptId: string; readonly studentId: string; readonly generation: number; readonly status: 'OPEN' | 'EXPLANATION_SUBMITTED'; readonly openingPrompt: 'Okay. How did we do this month?'; readonly financialPackage: MonthEndFinancialPackage; readonly explanationEvidence?: MonthEndExplanationEvidence; readonly helpAfterExplanation: readonly { readonly level: 'HINT' | 'DIRECTION' | 'WALKTHROUGH'; readonly at: string }[] }

const freeze = <T>(value: T): T => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } return value; };
const meetingAt = (sequence: number) => `2026-07-07T14:${String(sequence).padStart(2, '0')}:00.000Z`;
const sum = (rows: readonly { amountCents: number }[]) => rows.reduce((total, row) => total + row.amountCents, 0);
const compactPnl = (report: ReturnType<typeof operationalProfitAndLoss>) => ({ revenueCents: sum(report.revenue), expenseCents: sum(report.expenses), netIncomeCents: report.netIncomeCents });

export function buildMonthEndFinancialPackage(p002: P002InstructorState): MonthEndFinancialPackage {
  const state = p002.attempt.state;
  const april = compactPnl(operationalProfitAndLoss(state, 'CASH', { from: '2026-04-01', through: '2026-04-30' }));
  const may = compactPnl(operationalProfitAndLoss(state, 'CASH', { from: '2026-05-01', through: '2026-05-31' }));
  const june = compactPnl(operationalProfitAndLoss(state, 'CASH', { from: '2026-06-01', through: '2026-06-30' }));
  const tb = trialBalance(state.attempt);
  const accountBalance = (name: string) => { const row = tb.find(item => item.name === name); return row ? row.debitCents - row.creditCents : 0; };
  const receivables = customerBalances(state).map(row => { const customer = state.customers.find(item => item.id === row.customerId)!; return { customer: customer.name, openCents: row.invoiceOpenCents, unappliedCents: row.unappliedPaymentCents, netReceivableCents: row.netReceivableCents }; }).filter(row => row.openCents !== 0 || row.unappliedCents !== 0);
  const liabilities = ['Gulf Coast Business Visa', 'Vehicle Loan Payable', 'Payroll Liabilities', 'Accounts Payable'].map(name => ({ name, balanceCents: -accountBalance(name) })).filter(row => row.balanceCents !== 0);
  return freeze({ attemptId: state.attempt.id, period: '2026-06', cashProfitAndLoss: { april, may, june }, comparisons: { juneVsMayRevenueChangeCents: june.revenueCents - may.revenueCents, juneVsAprilRevenueChangeCents: june.revenueCents - april.revenueCents, juneVsAprilRevenuePercentTenths: Math.round((june.revenueCents - april.revenueCents) * 1000 / april.revenueCents) }, balanceSheet: balanceSheet(state.attempt), operatingCheckingCents: accountBalance('Operating Checking'), receivables, liabilities });
}

export async function beginMonthEndMeeting(assessment: SuncoastAssessmentAttempt, p002: P002InstructorState): Promise<SuncoastMonthEndMeeting> {
  if (assessment.attemptId !== p002.attempt.state.attempt.id || assessment.studentId !== p002.attempt.state.attempt.studentId) throw new InvalidReferenceError('Final review unavailable');
  if (assessment.closeAttempts.at(-1)?.result !== 'READY_FOR_FINAL_REVIEW') throw new InvalidStateError('Final review unavailable');
  if (assessment.evidence.at(-1)?.type !== 'FINAL_ACCOUNTING_STATE') throw new InvalidStateError('Final review unavailable');
  const lastCriticalByHook = new Map<string, { readonly selfCorrected?: boolean }>(); for (const event of p002.attempt.auditTrail) if (event.hook) lastCriticalByHook.set(event.hook, event);
  if ([...lastCriticalByHook.values()].some(event => !event.selfCorrected)) throw new InvalidStateError('Final review unavailable');
  if (!(await compareAccountingCompletion(p002)).complete) throw new InvalidStateError('Final review unavailable');
  return freeze({ id: `${assessment.attemptId}-month-end-1`, attemptId: assessment.attemptId, studentId: assessment.studentId, generation: assessment.generation, status: 'OPEN', openingPrompt: 'Okay. How did we do this month?', financialPackage: buildMonthEndFinancialPackage(p002), helpAfterExplanation: [] });
}

interface Claims { readonly supported: number; readonly inaccurate: number; readonly relevant: number; readonly insight: number; readonly unsupportedCausation: boolean; readonly cashProfitConfusion: boolean; readonly boundaryViolation: boolean }
function assessClaims(text: string, context: MonthEndFinancialPackage): Claims {
  const normalized = text.toLowerCase().replace(/,/g, '');
  const money = [...normalized.matchAll(/\$\s*(\d+(?:\.\d{1,2})?)/g)].map(match => Math.round(Number(match[1]) * 100));
  const supportedValues = new Set<number>([
    context.cashProfitAndLoss.april.revenueCents, context.cashProfitAndLoss.may.revenueCents, context.cashProfitAndLoss.june.revenueCents,
    context.cashProfitAndLoss.june.expenseCents, context.cashProfitAndLoss.june.netIncomeCents, context.operatingCheckingCents,
    ...context.receivables.flatMap(row => [row.openCents, row.unappliedCents, row.netReceivableCents]), ...context.liabilities.map(row => row.balanceCents),
  ].filter(value => value > 0));
  const inaccurateMoney = money.filter(value => !supportedValues.has(value) && value >= 100000).length;
  const juneRevenue = /(?:june|this month)[^.]{0,80}(?:revenue|sales)[^.]{0,30}\$?\s*43000|\$?\s*43000[^.]{0,30}(?:revenue|sales)/i.test(normalized);
  const juneProfit = /(?:june|this month)[^.]{0,80}(?:net income|profit)[^.]{0,30}\$?\s*25365\.28|\$?\s*25365\.28[^.]{0,30}(?:net income|profit)/i.test(normalized);
  const revenueTrend = /(?:revenue|sales)[^.]{0,80}(?:increase|increased|higher|grew|up)[^.]{0,60}(?:may|april|prior|last month)|(?:june|this month)[^.]{0,60}(?:increase|higher|grew|up)[^.]{0,40}(?:revenue|sales)/i.test(normalized);
  const supportedPercent = /27(?:\.6)?\s*%/.test(normalized) && /april|three.month|since/.test(normalized);
  const receivable = /(?:jenkins[^.]{0,30}(?:\$?\s*1425|owes|outstanding))|(?:reynolds[^.]{0,30}(?:\$?\s*2275|owes|outstanding))|(?:(?:receivable|customers? (?:still )?owe|outstanding invoice)[^.]{0,60}(?:\$|owe|outstanding|collect|follow.up))/i.test(normalized);
  const cash = /(?:checking|cash (?:balance|position)|available cash)[^.]{0,40}\$?\s*84422|\$?\s*84422[^.]{0,30}(?:checking|cash)/i.test(normalized);
  const debt = /(?:visa[^.]{0,45}(?:\$?\s*4308\.15|balance|owe))|(?:vehicle loan[^.]{0,45}(?:\$?\s*27910|balance|owe))|(?:(?:debt|liabilit)[^.]{0,45}(?:balance|obligation|payment|context|problem))/i.test(normalized);
  const supported = [juneRevenue, juneProfit, revenueTrend, supportedPercent, receivable, cash, debt].filter(Boolean).length;
  const unsupportedCausation = /(?:because|caused by|due to)[^.]{0,50}(?:facebook|advertising|marketing|economy|season|employee|weather)/i.test(normalized);
  const cashProfitConfusion = /(?:profit|made|earned)[^.]{0,40}\$?\s*83672|(?:everything|all)[^.]{0,30}(?:checking|cash)[^.]{0,30}(?:profit|take|withdraw)/i.test(normalized);
  const boundaryViolation = /(?:guarantee|definitely will|tax deduction|write it off|legal advice|no risk)/i.test(normalized);
  return { supported, inaccurate: inaccurateMoney + Number(cashProfitConfusion), relevant: [juneRevenue, juneProfit, revenueTrend, receivable, cash, debt].filter(Boolean).length, insight: [revenueTrend, supportedPercent, receivable, debt, cash && juneProfit].filter(Boolean).length, unsupportedCausation, cashProfitConfusion, boundaryViolation };
}

function dimensions(text: string, context: MonthEndFinancialPackage): readonly ExplanationDimensionResult[] {
  const claims = assessClaims(text, context);
  const accuracy = claims.inaccurate > 0 ? 0 : claims.supported >= 2 ? 3 : claims.supported === 1 ? 2 : 0;
  const relevance = claims.relevant >= 2 ? 2 : claims.relevant === 1 ? 1 : 0;
  const sentences = text.split(/[.!?]+/).map(value => value.trim()).filter(Boolean);
  const clarity = claims.supported > 0 && sentences.some(sentence => sentence.length >= 15) ? (claims.cashProfitConfusion ? 0 : 2) : 0;
  const insight = claims.unsupportedCausation ? 0 : claims.insight >= 1 ? 2 : 0;
  const professional = claims.unsupportedCausation || claims.boundaryViolation || claims.cashProfitConfusion ? 0 : claims.supported > 0 ? 1 : 0;
  return freeze([
    { dimension: 'FINANCIAL_ACCURACY', earnedPoints: accuracy, availablePoints: 3, instructorRationale: `Supported substantive claims: ${claims.supported}; material inaccuracies: ${claims.inaccurate}.` },
    { dimension: 'RELEVANCE', earnedPoints: relevance, availablePoints: 2, instructorRationale: `Owner-relevant supported topics: ${claims.relevant}.` },
    { dimension: 'CLARITY', earnedPoints: clarity, availablePoints: 2, instructorRationale: claims.cashProfitConfusion ? 'Material cash-versus-profit confusion.' : 'Explanation contains an understandable supported statement.' },
    { dimension: 'BUSINESS_INSIGHT', earnedPoints: insight, availablePoints: 2, instructorRationale: claims.unsupportedCausation ? 'Claim invents unsupported causation.' : `Supported observations: ${claims.insight}.` },
    { dimension: 'PROFESSIONAL_COMMUNICATION', earnedPoints: professional, availablePoints: 1, instructorRationale: claims.boundaryViolation || claims.unsupportedCausation ? 'Explanation exceeds supported professional boundaries.' : 'Explanation remains within the financial evidence.' },
  ]);
}

const followUps = (meeting: SuncoastMonthEndMeeting, explanation: string): readonly MonthEndFollowUp[] => {
  const text = explanation.toLowerCase(); const kinds: FollowUpKind[] = [];
  if (/profit|net income/.test(text)) kinds.push('PROFIT_WITHDRAWAL');
  if (/receivable|owe|outstanding|jenkins|reynolds/.test(text)) kinds.push('RECEIVABLE_CONCERN');
  if (/visa|loan|debt|liabilit/.test(text)) kinds.push('DEBT_CONCERN');
  const prompts: Record<FollowUpKind, string> = { PROFIT_WITHDRAWAL: 'So does that mean I can take all of that money out?', RECEIVABLE_CONCERN: 'Should I be worried about those customers who still owe me?', DEBT_CONCERN: 'Is that debt a problem?' };
  return freeze(kinds.slice(0, 2).map((kind, index) => ({ id: `${meeting.id}-follow-up-${index + 1}`, kind, prompt: prompts[kind], askedAt: meetingAt(index + 2) })));
};

export function submitMonthEndExplanation(meeting: SuncoastMonthEndMeeting, explanation: string): SuncoastMonthEndMeeting {
  if (meeting.status !== 'OPEN' || explanation.trim().length === 0 || explanation.length > 8000) throw new InvalidStateError('Explanation unavailable');
  const results = dimensions(explanation, meeting.financialPackage);
  const evidence: MonthEndExplanationEvidence = freeze({ id: `${meeting.id}-evidence-1`, attemptId: meeting.attemptId, meetingId: meeting.id, explanation, financialContext: meeting.financialPackage, followUps: followUps(meeting, explanation), helpState: 'INDEPENDENT', dimensions: results, points: results.reduce((sum, result) => sum + result.earnedPoints, 0), submittedAt: meetingAt(1), sequence: 1, rubricVersion: LAB1_READINESS_RUBRIC });
  return freeze({ ...meeting, status: 'EXPLANATION_SUBMITTED', explanationEvidence: evidence });
}
export function answerMonthEndFollowUp(meeting: SuncoastMonthEndMeeting, followUpId: string, response: string): SuncoastMonthEndMeeting {
  if (!meeting.explanationEvidence || response.trim().length === 0 || response.length > 4000) throw new InvalidReferenceError('Follow-up unavailable');
  const target = meeting.explanationEvidence.followUps.find(item => item.id === followUpId && !item.response); if (!target) throw new InvalidReferenceError('Follow-up unavailable');
  const followUps = meeting.explanationEvidence.followUps.map((item, index) => item.id === followUpId ? freeze({ ...item, response, respondedAt: meetingAt(index + 4) }) : item);
  return freeze({ ...meeting, explanationEvidence: { ...meeting.explanationEvidence, followUps } });
}
export function requestPostExplanationHelp(meeting: SuncoastMonthEndMeeting, level: 'HINT' | 'DIRECTION' | 'WALKTHROUGH'): SuncoastMonthEndMeeting {
  if (!meeting.explanationEvidence) throw new InvalidStateError('Help unavailable');
  return freeze({ ...meeting, helpAfterExplanation: [...meeting.helpAfterExplanation, { level, at: meetingAt(meeting.helpAfterExplanation.length + 10) }] });
}
export function applyMonthEndAssessment(assessment: SuncoastAssessmentAttempt, meeting: SuncoastMonthEndMeeting, completion: AccountingCompletion): SuncoastAssessmentAttempt {
  if (assessment.attemptId !== meeting.attemptId || !meeting.explanationEvidence) throw new InvalidReferenceError('Final review unavailable');
  const evidence = meeting.explanationEvidence;
  const withEvidence = appendAssessmentEvidence(assessment, { competency: 'MONTH_END_FINANCIAL_EXPLANATION', type: 'MONTH_END_EXPLANATION', source: { kind: 'MONTH_END_MEETING', id: evidence.id, attemptId: assessment.attemptId }, severity: 'MATERIAL', outcome: evidence.points >= 7 ? 'CORRECT' : 'INCORRECT', selfCorrected: false, resolved: true, awardedPoints: evidence.points, instructorExplanation: evidence.dimensions.map(item => `${item.dimension}: ${item.instructorRationale}`).join(' ') });
  return evaluateAssessment(withEvidence, completion);
}
export function monthEndStudentView(meeting: SuncoastMonthEndMeeting) { return freeze({ id: meeting.id, attemptId: meeting.attemptId, generation: meeting.generation, status: meeting.status, openingPrompt: meeting.openingPrompt, financialPackage: meeting.financialPackage, explanation: meeting.explanationEvidence?.explanation, followUps: meeting.explanationEvidence?.followUps.map(item => ({ id: item.id, prompt: item.prompt, response: item.response })), helpAfterExplanation: meeting.helpAfterExplanation }); }
export function authorizedMonthEndView(meeting: SuncoastMonthEndMeeting) { return meeting; }
export function resetMonthEndMeeting(meeting: SuncoastMonthEndMeeting, newAttemptId: string): { old: SuncoastMonthEndMeeting; next: null } { if (newAttemptId === meeting.attemptId) throw new InvalidReferenceError('New attempt required'); return { old: meeting, next: null }; }

export interface MonthEndStore { findForStudent(attemptId: string, studentId: string): Promise<SuncoastMonthEndMeeting | null>; save(value: SuncoastMonthEndMeeting): Promise<void> }
export class SuncoastMonthEndService {
  constructor(private readonly store: MonthEndStore) {}
  async view(studentId: string, attemptId: string) { return monthEndStudentView(await this.owned(studentId, attemptId)); }
  async submit(studentId: string, attemptId: string, explanation: string) { const value = submitMonthEndExplanation(await this.owned(studentId, attemptId), explanation); await this.store.save(value); return monthEndStudentView(value); }
  async answer(studentId: string, attemptId: string, followUpId: string, response: string) { const value = answerMonthEndFollowUp(await this.owned(studentId, attemptId), followUpId, response); await this.store.save(value); return monthEndStudentView(value); }
  async help(studentId: string, attemptId: string, level: 'HINT' | 'DIRECTION' | 'WALKTHROUGH') { const value = requestPostExplanationHelp(await this.owned(studentId, attemptId), level); await this.store.save(value); return monthEndStudentView(value); }
  private async owned(studentId: string, attemptId: string) { const value = await this.store.findForStudent(attemptId, studentId); if (!value) throw new NotFoundError('Attempt not found'); return value; }
}
