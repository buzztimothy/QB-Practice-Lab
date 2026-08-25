import { describe, expect, it } from 'vitest';
import { InvalidReferenceError, InvalidStateError, NotFoundError } from '../packages/accounting-domain/src/errors.js';
import { deriveSuncoastCoaching } from '../packages/accounting-domain/src/suncoast-coaching.js';
import { buildResolvedP002State } from '../packages/accounting-domain/src/suncoast-student-start.js';
import {
  appendAssessmentEvidence, deriveSuncoastAssessment, evaluateAssessment, recordCloseAttempt,
  type AccountingCompletion, type Competency,
} from '../packages/accounting-domain/src/suncoast-assessment.js';
import {
  SuncoastMonthEndService, answerMonthEndFollowUp, applyMonthEndAssessment, authorizedMonthEndView, beginMonthEndMeeting,
  buildMonthEndFinancialPackage, explanationWeights, monthEndStudentView, requestPostExplanationHelp, resetMonthEndMeeting,
  submitMonthEndExplanation,
} from '../packages/accounting-domain/src/suncoast-month-end.js';

const complete: AccountingCompletion = Object.freeze({ trialBalance: true, cashProfitAndLoss: true, accrualProfitAndLoss: true, balanceSheet: true, accountsReceivable: true, undepositedFunds: true, checking: true, visa: true, payrollLiabilities: true, reconciled: true, historicalIntegrity: true, complete: true });
const competencyByScenario: Readonly<Record<string, Competency>> = Object.freeze({ '01':'TECHNICAL_BOOKKEEPING','02':'INVESTIGATION_PROBLEM_SOLVING','03':'TECHNICAL_BOOKKEEPING','04':'TECHNICAL_BOOKKEEPING','05':'TECHNICAL_BOOKKEEPING','06':'PROFESSIONAL_JUDGMENT','07':'TECHNICAL_BOOKKEEPING','08':'TECHNICAL_BOOKKEEPING','09':'PROFESSIONAL_JUDGMENT','10':'PROFESSIONAL_JUDGMENT','11':'TECHNICAL_BOOKKEEPING','12':'TECHNICAL_BOOKKEEPING','13':'INVESTIGATION_PROBLEM_SOLVING','14':'PROFESSIONAL_JUDGMENT','15':'TECHNICAL_BOOKKEEPING','16':'TECHNICAL_BOOKKEEPING','17':'PROFESSIONAL_JUDGMENT','18':'INVESTIGATION_PROBLEM_SOLVING','19':'INVESTIGATION_PROBLEM_SOLVING','20':'INVESTIGATION_PROBLEM_SOLVING' });

async function fixture(id = 'month-end-a') {
  const coaching = await deriveSuncoastCoaching('student-a', id);
  const resolved = await buildResolvedP002State('student-a', id);
  const p002 = { ...coaching.interaction.evidence.p002, attempt: { ...coaching.interaction.evidence.p002.attempt, state: resolved } };
  let assessment = deriveSuncoastAssessment(coaching);
  for (const [suffix, competency] of Object.entries(competencyByScenario)) assessment = appendAssessmentEvidence(assessment, { competency, type: 'ACCOUNTING_ACTION', source: { kind: 'VERIFIED_RESOLUTION', id: `resolution-${suffix}`, attemptId: id }, scenarioId: `SUN-L1-${suffix}`, severity: 'MATERIAL', outcome: ['02','09','10','19'].includes(suffix) ? 'LEGITIMATELY_UNCHANGED' : 'CORRECT', selfCorrected: false, resolved: true, instructorExplanation: 'Verified resolution fixture.' });
  for (let index = 0; index < 4; index++) assessment = appendAssessmentEvidence(assessment, { competency: 'CLIENT_COMMUNICATION', type: 'CLIENT_COMMUNICATION', source: { kind: 'P005_OBSERVATION', id: `communication-${index}`, attemptId: id }, severity: 'ROUTINE', outcome: 'CORRECT', selfCorrected: false, resolved: true, instructorExplanation: 'Verified P-005 observation.' });
  assessment = evaluateAssessment(assessment, complete);
  assessment = recordCloseAttempt(assessment, { accountingCompletion: complete, unresolvedMaterialEvidenceRequests: false });
  return { assessment, p002, coaching };
}
const strong = "June revenue was $43,000, up from May's $38,750 and April's $33,700. June net income was $25,365.28 after $17,634.72 of expenses. Checking is $84,422, but cash is not the same as profit. Jenkins owes $1,425 and Reynolds owes $2,275, so those receivables need follow-up. The Visa balance is $4,308.15 and the vehicle loan is $27,910; the books show those balances, but they do not establish that the debt is a problem.";

describe('P-007 final meeting entry and financial truth', () => {
  it('blocks entry without an authorized ready close and hides the reason', async () => {
    const { assessment, p002 } = await fixture();
    await expect(beginMonthEndMeeting({ ...assessment, closeAttempts: [] }, p002)).rejects.toEqual(expect.objectContaining({ message: 'Final review unavailable' }));
    const starting = await deriveSuncoastCoaching('student-a', 'starting-meeting');
    await expect(beginMonthEndMeeting({ ...assessment, attemptId: 'starting-meeting' }, starting.interaction.evidence.p002)).rejects.toBeInstanceOf(InvalidStateError);
    const afterCloseCritical = appendAssessmentEvidence(assessment,{competency:'PROFESSIONAL_JUDGMENT',type:'CRITICAL_EVENT',source:{kind:'P002_ACTION',id:'late-critical',attemptId:assessment.attemptId},scenarioId:'SUN-L1-10',criticalHook:'CPA_HISTORY_ALTERED',severity:'CRITICAL',outcome:'INAPPROPRIATE',selfCorrected:false,resolved:false,instructorExplanation:'Late critical action.'});
    await expect(beginMonthEndMeeting(afterCloseCritical,p002)).rejects.toBeInstanceOf(InvalidStateError);
  });

  it('allows entry only after legitimate readiness and presents a neutral opening', async () => {
    const { assessment, p002 } = await fixture();
    const meeting = await beginMonthEndMeeting(assessment, p002);
    expect(meeting.openingPrompt).toBe('Okay. How did we do this month?');
    expect(JSON.stringify(monthEndStudentView(meeting))).not.toMatch(/explain revenue|mention|scenario|expected insight|instructor/i);
  });

  it('derives and locks April, May, June and authoritative resolved June truth from the attempt ledger', async () => {
    const { p002 } = await fixture(); const financial = buildMonthEndFinancialPackage(p002);
    expect(financial.cashProfitAndLoss).toEqual({ april: { revenueCents:3370000,expenseCents:1834000,netIncomeCents:1536000 }, may: { revenueCents:3875000,expenseCents:1853500,netIncomeCents:2021500 }, june: { revenueCents:4300000,expenseCents:1763472,netIncomeCents:2536528 } });
    expect(financial.comparisons).toEqual({ juneVsMayRevenueChangeCents:425000,juneVsAprilRevenueChangeCents:930000,juneVsAprilRevenuePercentTenths:276 });
    expect(financial.operatingCheckingCents).toBe(8442200);
    expect(financial.receivables).toEqual(expect.arrayContaining([{customer:'Robert Jenkins',openCents:142500,unappliedCents:0,netReceivableCents:142500},{customer:'David Reynolds',openCents:227500,unappliedCents:0,netReceivableCents:227500},{customer:'Cape Premier Realty',openCents:0,unappliedCents:75000,netReceivableCents:-75000}]));
    expect(financial.liabilities).toEqual([{name:'Gulf Coast Business Visa',balanceCents:430815},{name:'Vehicle Loan Payable',balanceCents:2791000}]);
    expect(financial.balanceSheet).toMatchObject({ totalAssetsCents:15707200,totalLiabilitiesAndEquityCents:15707200,currentEarningsCents:5589028 });
    expect(Object.isFrozen(financial)).toBe(true);
  });
});

describe('P-007 explanation evidence and assessment', () => {
  it('preserves the exact first explanation and the 3/2/2/2/1 ten-point evidence', async () => {
    const { assessment, p002 } = await fixture(); const meeting = submitMonthEndExplanation(await beginMonthEndMeeting(assessment,p002), strong);
    expect(meeting.explanationEvidence?.explanation).toBe(strong);
    expect(explanationWeights).toEqual({FINANCIAL_ACCURACY:3,RELEVANCE:2,CLARITY:2,BUSINESS_INSIGHT:2,PROFESSIONAL_COMMUNICATION:1});
    expect(meeting.explanationEvidence?.dimensions.map(item=>[item.dimension,item.earnedPoints,item.availablePoints])).toEqual([['FINANCIAL_ACCURACY',3,3],['RELEVANCE',2,2],['CLARITY',2,2],['BUSINESS_INSIGHT',2,2],['PROFESSIONAL_COMMUNICATION',1,1]]);
    expect(meeting.explanationEvidence?.points).toBe(10); expect(Object.isFrozen(meeting.explanationEvidence)).toBe(true);
    expect(()=>submitMonthEndExplanation(meeting,'replacement')).toThrow(InvalidStateError);
  });

  it.each([
    ['concise strong',"June revenue was $43,000, up from May's $38,750, and June net income was $25,365.28.",10],
    ['longer strong',strong,10],
    ['keyword stuffed','Revenue profit cash receivables growth expenses.',0],
    ['materially incorrect','June revenue was $99,000 and profit was $88,000.',0],
    ['unsupported cause','June revenue was $43,000, up from May because Facebook advertising worked, and net income was $25,365.28.',7],
    ['cash profit confusion','You made $84,422 in profit because that is what is in checking.',0],
    ['alternative supported insight','Robert Jenkins owes $1,425 and David Reynolds owes $2,275. Those outstanding receivables deserve follow-up even though the books do not tell us they are uncollectible.',8],
  ])('scores %s by supported substance rather than required wording',async(_name,text,expected)=>{const{assessment,p002}=await fixture(`case-${_name}`);const evidence=submitMonthEndExplanation(await beginMonthEndMeeting(assessment,p002),text).explanationEvidence!;expect(evidence.points).toBe(expected)});

  it('uses deterministic content-grounded follow-ups and preserves bounded responses',async()=>{const{assessment,p002}=await fixture();let meeting=submitMonthEndExplanation(await beginMonthEndMeeting(assessment,p002),strong);expect(meeting.explanationEvidence?.followUps.map(item=>item.prompt)).toEqual(['So does that mean I can take all of that money out?','Should I be worried about those customers who still owe me?']);const id=meeting.explanationEvidence!.followUps[0].id;meeting=answerMonthEndFollowUp(meeting,id,'No. Profit is not the same as available cash, and owner distributions also require considering obligations and professional tax advice where needed.');expect(meeting.explanationEvidence?.followUps[0].response).toContain('Profit is not the same');expect(()=>answerMonthEndFollowUp(meeting,id,'replace')).toThrow(InvalidReferenceError)});

  it('keeps first performance independent when help is requested afterward',async()=>{const{assessment,p002}=await fixture();const submitted=submitMonthEndExplanation(await beginMonthEndMeeting(assessment,p002),strong);const helped=requestPostExplanationHelp(submitted,'WALKTHROUGH');expect(helped.explanationEvidence).toBe(submitted.explanationEvidence);expect(helped.explanationEvidence?.helpState).toBe('INDEPENDENT');expect(helped.helpAfterExplanation).toHaveLength(1)});

  it('changes Month-End from NOT_ASSESSED to assessed 100-point evaluation without mutating history',async()=>{const{assessment,p002}=await fixture();expect(assessment.snapshots[0].competencies.at(-1)?.status).toBe('NOT_ASSESSED');const historical=assessment.snapshots[0];const meeting=submitMonthEndExplanation(await beginMonthEndMeeting(assessment,p002),strong);const result=applyMonthEndAssessment(assessment,meeting,complete);expect(result.snapshots[0]).toEqual(historical);expect(result.snapshots.at(-1)).toMatchObject({pointsEarned:100,pointsAssessed:100,classification:'CLIENT_READY'});expect(result.snapshots.at(-1)?.competencies.at(-1)).toMatchObject({status:'ASSESSED',earnedPoints:10,availablePoints:10})});

  it('keeps readiness overrides authoritative after all 100 points are assessed',async()=>{const{assessment,p002}=await fixture();const meeting=submitMonthEndExplanation(await beginMonthEndMeeting(assessment,p002),strong);const unresolved={...complete,checking:false,reconciled:false,complete:false};expect(applyMonthEndAssessment(assessment,meeting,unresolved).snapshots.at(-1)?.classification).toBe('RETURN_TO_LAB')});
});

describe('P-007 secrecy, isolation and reset',()=>{
  it('student view excludes subpoints, rationale, trigger kinds, rubric mechanics and answer scripts',async()=>{const{assessment,p002}=await fixture();const meeting=submitMonthEndExplanation(await beginMonthEndMeeting(assessment,p002),strong);const student=JSON.stringify(monthEndStudentView(meeting));expect(student).not.toMatch(/earnedPoints|availablePoints|instructorRationale|FINANCIAL_ACCURACY|PROFIT_WITHDRAWAL|trigger|ideal|keyword/i);expect(JSON.stringify(authorizedMonthEndView(meeting))).toContain('FINANCIAL_ACCURACY')});
  it('rejects cross-attempt context and evidence integration',async()=>{const left=await fixture('left'),right=await fixture('right');await expect(beginMonthEndMeeting(left.assessment,right.p002)).rejects.toBeInstanceOf(InvalidReferenceError);const meeting=submitMonthEndExplanation(await beginMonthEndMeeting(left.assessment,left.p002),strong);expect(()=>applyMonthEndAssessment(right.assessment,meeting,complete)).toThrow(InvalidReferenceError)});
  it('service ownership fails closed for student and client-supplied attempt IDs',async()=>{const{assessment,p002}=await fixture();const meeting=await beginMonthEndMeeting(assessment,p002);const service=new SuncoastMonthEndService({findForStudent:async(id,student)=>id===meeting.attemptId&&student===meeting.studentId?meeting:null,save:async()=>undefined});await expect(service.view('student-b',meeting.attemptId)).rejects.toBeInstanceOf(NotFoundError);await expect(service.view(meeting.studentId,'foreign')).rejects.toBeInstanceOf(NotFoundError)});
  it('reset preserves historical meeting and starts with no meeting in the new lifecycle',async()=>{const{assessment,p002}=await fixture();const meeting=submitMonthEndExplanation(await beginMonthEndMeeting(assessment,p002),strong);const reset=resetMonthEndMeeting(meeting,'new-attempt');expect(reset.old).toBe(meeting);expect(reset.next).toBeNull()});
});
