import { InvalidReferenceError, NotFoundError } from './errors.js';
import {
  deriveSuncoastInteraction,
  interactionStudentView,
  resetSuncoastInteraction,
  sendStudentMessage,
  triggerClientMessage,
  type ClientTrigger,
  type ConversationMessage,
  type SuncoastInteractionAttempt,
} from './suncoast-interaction.js';

export type CoachingMode = 'STUDENT_REQUESTED' | 'SELECTIVE_POST_INTERACTION' | 'REFLECTION';
export type HelpLevel = 'HINT' | 'DIRECTION' | 'WALKTHROUGH';
export type CommunicationDimension = 'CLEAR' | 'CONFIDENT' | 'ACCURATE' | 'ACTIONABLE';
export type DimensionObservation = 'STRENGTH' | 'FOCUS';
export type CoachingSituation = 'COACH-01' | 'COACH-02' | 'COACH-03' | 'COACH-04' | 'COACH-05' | 'COACH-06' | 'COACH-07' | 'COACH-08' | 'ANSWER_BOUNDARY' | 'GENERAL';

interface AuthorizedContextSnapshot {
  readonly visibleDocumentIds: readonly string[];
  readonly visibleMessageIds: readonly string[];
  readonly disclosedFactIds: readonly string[];
}
export interface CoachingRecord {
  readonly id: string;
  readonly conversationId: string;
  readonly studentMessageId: string;
  readonly originalDraft?: string;
  readonly mode: CoachingMode;
  readonly helpLevel: HelpLevel;
  readonly situation: CoachingSituation;
  readonly dimensions: Readonly<Record<CommunicationDimension, DimensionObservation>>;
  readonly content: {
    readonly whatWorked: string;
    readonly whatToStrengthen: string;
    readonly whyItMatters: string;
    readonly tryThis?: string;
  };
  readonly createdAt: string;
  readonly requested: boolean;
  readonly viewedAt?: string;
  readonly subsequentStudentMessageId?: string;
  readonly authorizedContext: AuthorizedContextSnapshot;
}
export interface CoachingAuditEvent {
  readonly sequence: number;
  readonly at: string;
  readonly kind: 'COACHING_CREATED' | 'COACHING_VIEWED' | 'FOLLOW_UP_SENT';
  readonly coachingId: string;
  readonly studentMessageId?: string;
}
export interface SuncoastCoachingAttempt {
  readonly attemptId: string;
  readonly studentId: string;
  readonly generation: number;
  readonly interaction: SuncoastInteractionAttempt;
  readonly records: readonly CoachingRecord[];
  readonly audit: readonly CoachingAuditEvent[];
}

interface CoachingRule {
  readonly situation: Exclude<CoachingSituation, 'GENERAL'>;
  readonly mode: 'SELECTIVE_POST_INTERACTION' | 'REFLECTION';
  readonly detect: (message: string, priorClientMessage: string | undefined) => boolean;
}

const rules: readonly CoachingRule[] = Object.freeze(([
  { situation: 'COACH-02', mode: 'SELECTIVE_POST_INTERACTION', detect: message => /\bsorry\b/i.test(message) && /\b(probably|not sure|bother|missing something|don't know|do not know)\b/i.test(message) },
  { situation: 'COACH-01', mode: 'SELECTIVE_POST_INTERACTION', detect: message => /\b(send|need|get|provide)\b.*\b(stuff|docs|documents|support)\b/i.test(message) && !/\b(abc|payroll|receipt|invoice|agreement|report|transaction|payment)\b/i.test(message) },
  { situation: 'COACH-03', mode: 'SELECTIVE_POST_INTERACTION', detect: (message, prior) => /supplies or something/i.test(prior ?? '') && /\b(ok|okay|fine|do that|put it|sounds good)\b/i.test(message) },
  { situation: 'COACH-04', mode: 'SELECTIVE_POST_INTERACTION', detect: (message, prior) => /can't you just fix it/i.test(prior ?? '') && /\b(change|fix|delete|void|okay|ok)\b/i.test(message) },
  { situation: 'COACH-05', mode: 'REFLECTION', detect: (message, prior) => /write that whole pressure washer off/i.test(prior ?? '') && /\b(verify|confirm|check|cpa|tax professional|tax advice)\b/i.test(message) },
  { situation: 'COACH-06', mode: 'SELECTIVE_POST_INTERACTION', detect: (_message, prior) => /need the p&l for the bank today/i.test(prior ?? '') },
  { situation: 'COACH-07', mode: 'SELECTIVE_POST_INTERACTION', detect: (_message, prior) => /last bookkeeper never asked/i.test(prior ?? '') },
  { situation: 'COACH-08', mode: 'REFLECTION', detect: message => /\b(found|reviewed|noticed)\b/i.test(message) && /\b(need|please|send|provide|confirm|next)\b/i.test(message) && !/\b(definitely|obviously|i know|must be|certainly|no doubt|will classify|put it in)\b/i.test(message) },
] satisfies CoachingRule[]).map(rule => Object.freeze(rule)));

const coachAt = (sequence: number) => `2026-07-05T11:${String(sequence).padStart(2, '0')}:00.000Z`;
const freezeRecord = (record: CoachingRecord): CoachingRecord => Object.freeze({
  ...record,
  dimensions: Object.freeze({ ...record.dimensions }),
  content: Object.freeze({ ...record.content }),
  authorizedContext: Object.freeze({
    visibleDocumentIds: Object.freeze([...record.authorizedContext.visibleDocumentIds]),
    visibleMessageIds: Object.freeze([...record.authorizedContext.visibleMessageIds]),
    disclosedFactIds: Object.freeze([...record.authorizedContext.disclosedFactIds]),
  }),
});
const freezeAttempt = (value: SuncoastCoachingAttempt): SuncoastCoachingAttempt => Object.freeze({
  ...value,
  records: Object.freeze(value.records.map(freezeRecord)),
  audit: Object.freeze(value.audit.map(event => Object.freeze({ ...event }))),
});

function studentMessage(value: SuncoastCoachingAttempt, messageId: string): { message: ConversationMessage; conversationId: string; priorClientMessage?: string } {
  for (const conversation of value.interaction.conversations) {
    const index = conversation.messages.findIndex(message => message.id === messageId && message.sender === 'STUDENT');
    if (index >= 0) return { message: conversation.messages[index], conversationId: conversation.id, priorClientMessage: [...conversation.messages.slice(0, index)].reverse().find(message => message.sender === 'CLIENT')?.content };
  }
  throw new InvalidReferenceError('Coaching context unavailable');
}
function contextSnapshot(value: SuncoastCoachingAttempt): AuthorizedContextSnapshot {
  const view = interactionStudentView(value.interaction);
  return {
    visibleDocumentIds: view.evidence.documents.map(document => document.id),
    visibleMessageIds: view.conversations.flatMap(conversation => conversation.messages.map(message => message.id)),
    disclosedFactIds: [...value.interaction.disclosedFactIds],
  };
}
function dimensionsFor(situation: CoachingSituation, message: string): Readonly<Record<CommunicationDimension, DimensionObservation>> {
  const professionalUncertainty = /\b(verify|confirm|check|supporting documentation|before i (classify|answer|change)|cpa|tax professional)\b/i.test(message);
  const selfUndermining = /\bsorry\b/i.test(message) && /\b(probably|not sure|bother|missing)\b/i.test(message);
  const unsupportedCertainty = /\b(definitely|obviously|i know|must be|certainly|no doubt|will classify|put it in)\b/i.test(message);
  const allStrength = situation === 'COACH-08' || (situation === 'COACH-05' && !unsupportedCertainty);
  const specificRequest = /\b(send|provide|need|get|request)\b.*\b(receipt|invoice|agreement|report|document|support)\b|\b(receipt|invoice|agreement|report|document|support)\b.*\b(please|needed|required)\b/i.test(message);
  const clear = allStrength || message.trim().split(/\s+/).length >= 4 || specificRequest;
  const confident = allStrength || (!unsupportedCertainty && (professionalUncertainty || !selfUndermining));
  const accurate = allStrength || (!unsupportedCertainty && !['COACH-03', 'COACH-04', 'COACH-06', 'ANSWER_BOUNDARY'].includes(situation));
  const actionable = allStrength || professionalUncertainty || specificRequest || /\b(send|provide|confirm|check|verify|need|next)\b/i.test(message);
  return Object.freeze({ CLEAR: clear ? 'STRENGTH' : 'FOCUS', CONFIDENT: confident ? 'STRENGTH' : 'FOCUS', ACCURATE: accurate ? 'STRENGTH' : 'FOCUS', ACTIONABLE: actionable ? 'STRENGTH' : 'FOCUS' });
}
function genericHelp(level: HelpLevel) {
  if (level === 'HINT') return 'What specific information do you need before you can proceed confidently?';
  if (level === 'DIRECTION') return 'Identify the business fact you need and ask for the specific supporting documentation that would establish it.';
  return "You could ask: ‘Can you explain the business purpose of this transaction and send the supporting receipt, invoice, or agreement?’";
}
function coachingContent(situation: CoachingSituation, level: HelpLevel) {
  const base = {
    'COACH-01': { worked: 'You recognized that more information is needed.', strengthen: 'Name the transaction and the specific information or document you need.', why: 'A specific request helps the client respond accurately and keeps the books supportable.' },
    'COACH-02': { worked: 'Your message was courteous.', strengthen: 'State the request directly without suggesting that normal documentation work is a burden or your mistake.', why: 'Professional confidence helps the client understand that verification is part of accurate bookkeeping.' },
    'COACH-03': { worked: 'You kept the client conversation moving.', strengthen: "Treat uncertain recollection as a lead, not as support. Ask what reliable documentation can confirm the transaction.", why: 'Client recollection, documentary support, and your bookkeeping judgment serve different purposes.' },
    'COACH-04': { worked: 'You acknowledged Michael’s concern.', strengthen: 'Explain that prior-year CPA work should be clarified before alteration and identify the CPA follow-up as the next step.', why: 'A clear professional boundary protects historical accounting without pretending to know the CPA’s reasoning.' },
    'COACH-05': { worked: 'You appropriately declined to guess and identified the CPA as the right source for tax guidance.', strengthen: 'Keep the boundary concise and state the next step.', why: 'Professional confidence includes verifying matters outside your authority.' },
    'COACH-06': { worked: 'You responded to the client’s deadline.', strengthen: 'Acknowledge the timing, state that unresolved work prevents calling the statements final, and explain the immediate next step.', why: 'The client needs a realistic path forward without receiving unfinished reports as verified.' },
    'COACH-07': { worked: 'You stayed engaged despite the pushback.', strengthen: 'Explain calmly that documentation supports accurate books and state exactly what is still needed.', why: 'A non-defensive boundary protects both accuracy and client trust.' },
    'COACH-08': { worked: 'Your message was clear, professional, fact-based, and gave Michael an actionable next step.', strengthen: 'No material change is needed for this interaction.', why: 'Clear next steps reduce delays and support accurate bookkeeping.' },
    ANSWER_BOUNDARY: { worked: 'You identified that you need help moving the investigation forward.', strengthen: 'BBB coaching will not supply an account or hidden answer. Use the available facts and identify what support or clarification is still needed.', why: 'The bookkeeping conclusion must remain grounded in evidence you have legitimately obtained.' },
    GENERAL: { worked: 'You identified a communication point worth improving.', strengthen: 'Use the BBB framework where useful: what you found, why it matters, what you need, and what happens next.', why: 'Clear, confident, accurate, and actionable communication helps the client respond without replacing your judgment.' },
  }[situation];
  return Object.freeze({ whatWorked: base.worked, whatToStrengthen: base.strengthen, whyItMatters: base.why, tryThis: genericHelp(level) });
}

function createRecord(value: SuncoastCoachingAttempt, messageId: string, mode: CoachingMode, level: HelpLevel, situation: CoachingSituation): SuncoastCoachingAttempt {
  const context = studentMessage(value, messageId);
  const record = freezeRecord({
    id: `${value.attemptId}-coaching-${value.records.length + 1}`,
    conversationId: context.conversationId,
    studentMessageId: messageId,
    mode,
    helpLevel: level,
    situation,
    dimensions: dimensionsFor(situation, context.message.content),
    content: coachingContent(situation, level),
    createdAt: coachAt(value.records.length),
    requested: mode === 'STUDENT_REQUESTED',
    authorizedContext: contextSnapshot(value),
  });
  const audit = { sequence: value.audit.length + 1, at: coachAt(value.audit.length), kind: 'COACHING_CREATED' as const, coachingId: record.id };
  return freezeAttempt({ ...value, records: [...value.records, record], audit: [...value.audit, audit] });
}

export function canonicalCoachingDefinition() {
  const situations: readonly CoachingSituation[] = ['COACH-01','COACH-02','COACH-03','COACH-04','COACH-05','COACH-06','COACH-07','COACH-08','ANSWER_BOUNDARY','GENERAL'];
  const levels: readonly HelpLevel[] = ['HINT','DIRECTION','WALKTHROUGH'];
  return Object.freeze({rules:Object.freeze(rules.map(rule=>Object.freeze({situation:rule.situation,mode:rule.mode}))),content:Object.freeze(situations.flatMap(situation=>levels.map(level=>Object.freeze({situation,level,content:coachingContent(situation,level)})))),dimensionProbes:Object.freeze(situations.map(situation=>Object.freeze({situation,dimensions:dimensionsFor(situation,'Please confirm the supporting documentation before I classify this transaction.')})))});
}

export async function deriveSuncoastCoaching(studentId: string, attemptId: string, generation = 1): Promise<SuncoastCoachingAttempt> {
  return freezeAttempt({ attemptId, studentId, generation, interaction: await deriveSuncoastInteraction(studentId, attemptId, generation), records: [], audit: [] });
}

export function coachingStudentView(value: SuncoastCoachingAttempt) {
  return {
    attemptId: value.attemptId,
    generation: value.generation,
    interaction: interactionStudentView(value.interaction),
    coaching: value.records.map(record => ({ id: record.id, conversationId: record.conversationId, studentMessageId: record.studentMessageId, originalDraft: record.originalDraft, mode: record.mode, helpLevel: record.helpLevel, dimensions: record.dimensions, content: record.content, createdAt: record.createdAt, requested: record.requested, viewedAt: record.viewedAt, subsequentStudentMessageId: record.subsequentStudentMessageId })),
  };
}

export function requestCommunicationCoaching(value: SuncoastCoachingAttempt, studentMessageId: string, level: HelpLevel): SuncoastCoachingAttempt {
  const context = studentMessage(value, studentMessageId);
  const asksForAnswer = /\b(just tell|give me|what account|which account|correct answer|answer key)\b/i.test(context.message.content);
  return createRecord(value, studentMessageId, 'STUDENT_REQUESTED', level, asksForAnswer ? 'ANSWER_BOUNDARY' : 'GENERAL');
}

export function requestDraftCoaching(value: SuncoastCoachingAttempt, conversationId: string, draft: string, level: HelpLevel): SuncoastCoachingAttempt {
  if (!value.interaction.conversations.some(conversation => conversation.id === conversationId) || draft.trim().length === 0 || draft.length > 4000) throw new InvalidReferenceError('Coaching context unavailable');
  const situation: CoachingSituation = /\b(just tell|give me|what account|which account|correct answer|answer key)\b/i.test(draft) ? 'ANSWER_BOUNDARY' : 'GENERAL';
  const record = freezeRecord({
    id: `${value.attemptId}-coaching-${value.records.length + 1}`,
    conversationId,
    studentMessageId: `${value.attemptId}-coaching-draft-${value.records.length + 1}`,
    originalDraft: draft,
    mode: 'STUDENT_REQUESTED',
    helpLevel: level,
    situation,
    dimensions: dimensionsFor(situation, draft),
    content: coachingContent(situation, level),
    createdAt: coachAt(value.records.length),
    requested: true,
    authorizedContext: contextSnapshot(value),
  });
  return freezeAttempt({ ...value, records: [...value.records, record], audit: [...value.audit, { sequence: value.audit.length + 1, at: coachAt(value.audit.length), kind: 'COACHING_CREATED', coachingId: record.id }] });
}

export function sendMessageWithCoaching(value: SuncoastCoachingAttempt, conversationId: string, content: string): SuncoastCoachingAttempt {
  const priorMessages = value.interaction.conversations.find(conversation => conversation.id === conversationId)?.messages ?? [];
  const priorClientMessage = [...priorMessages].reverse().find(message => message.sender === 'CLIENT')?.content;
  const interaction = sendStudentMessage(value.interaction, conversationId, content);
  const student = interaction.conversations.find(conversation => conversation.id === conversationId)!.messages.filter(message => message.sender === 'STUDENT').at(-1)!;
  let next = freezeAttempt({
    ...value,
    interaction,
    records: value.records.map(record => record.subsequentStudentMessageId ? record : freezeRecord({ ...record, subsequentStudentMessageId: student.id })),
    audit: [...value.audit, ...value.records.filter(record => !record.subsequentStudentMessageId).map((record, index) => ({ sequence: value.audit.length + index + 1, at: coachAt(value.audit.length + index), kind: 'FOLLOW_UP_SENT' as const, coachingId: record.id, studentMessageId: student.id }))],
  });
  const rule = rules.find(candidate => candidate.detect(content, priorClientMessage));
  if (rule) next = createRecord(next, student.id, rule.mode, 'HINT', rule.situation);
  return next;
}

export function offerReflectionCoaching(value: SuncoastCoachingAttempt, studentMessageId: string): SuncoastCoachingAttempt {
  const context = studentMessage(value, studentMessageId);
  const rule = rules.find(candidate => candidate.mode === 'REFLECTION' && candidate.detect(context.message.content, context.priorClientMessage));
  if (!rule) throw new InvalidReferenceError('Coaching unavailable');
  return createRecord(value, studentMessageId, 'REFLECTION', 'HINT', rule.situation);
}

export function triggerClientInteraction(value: SuncoastCoachingAttempt, trigger: ClientTrigger): SuncoastCoachingAttempt {
  const conversationId = value.interaction.conversations[0]?.id;
  if (!conversationId) throw new InvalidReferenceError('Conversation unavailable');
  return freezeAttempt({ ...value, interaction: triggerClientMessage(value.interaction, conversationId, trigger) });
}

export function viewCoaching(value: SuncoastCoachingAttempt, coachingId: string): SuncoastCoachingAttempt {
  const record = value.records.find(item => item.id === coachingId);
  if (!record) throw new InvalidReferenceError('Coaching unavailable');
  if (record.viewedAt) return value;
  const viewedAt = coachAt(value.audit.length);
  return freezeAttempt({ ...value, records: value.records.map(item => item.id === coachingId ? freezeRecord({ ...item, viewedAt }) : item), audit: [...value.audit, { sequence: value.audit.length + 1, at: viewedAt, kind: 'COACHING_VIEWED', coachingId }] });
}

export function authorizedCoachView(value: SuncoastCoachingAttempt) {
  return { attemptId: value.attemptId, studentId: value.studentId, conversations: value.interaction.conversations, coaching: value.records };
}

export async function resetSuncoastCoaching(value: SuncoastCoachingAttempt, newAttemptId: string): Promise<{ old: SuncoastCoachingAttempt; next: SuncoastCoachingAttempt }> {
  const reset = await resetSuncoastInteraction(value.interaction, newAttemptId);
  return { old: value, next: freezeAttempt({ attemptId: newAttemptId, studentId: value.studentId, generation: value.generation + 1, interaction: reset.next, records: [], audit: [] }) };
}

export interface CoachingStore {
  findForStudent(attemptId: string, studentId: string): Promise<SuncoastCoachingAttempt | null>;
  save(value: SuncoastCoachingAttempt): Promise<void>;
}
export class SuncoastCoachingService {
  constructor(private readonly store: CoachingStore) {}
  async view(studentId: string, attemptId: string) { return coachingStudentView(await this.owned(studentId, attemptId)); }
  async request(studentId: string, attemptId: string, messageId: string, level: HelpLevel) {
    const value = requestCommunicationCoaching(await this.owned(studentId, attemptId), messageId, level);
    await this.store.save(value);
    return coachingStudentView(value);
  }
  async requestDraft(studentId: string, attemptId: string, conversationId: string, draft: string, level: HelpLevel) {
    const value = requestDraftCoaching(await this.owned(studentId, attemptId), conversationId, draft, level);
    await this.store.save(value);
    return coachingStudentView(value);
  }
  private async owned(studentId: string, attemptId: string) {
    const value = await this.store.findForStudent(attemptId, studentId);
    if (!value) throw new NotFoundError('Attempt not found');
    return value;
  }
}
