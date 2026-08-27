import { InvalidReferenceError, NotFoundError } from './errors.js';
import {
  authorizeEvidence,
  deriveSuncoastEvidence,
  evidenceStudentView,
  requestEvidence,
  type SuncoastEvidenceAttempt,
} from './suncoast-evidence.js';

export type ConversationStatus = 'OPEN' | 'WAITING_FOR_STUDENT' | 'WAITING_FOR_CLIENT' | 'RESOLVED' | 'CLOSED';
export type MessageSender = 'STUDENT' | 'CLIENT' | 'SYSTEM' | 'CPA' | 'COACH';
export type InteractionIntent =
  | 'ABC_DOCUMENT_REQUEST'
  | 'ABC_PURPOSE'
  | 'AMBIGUOUS_TRANSACTION'
  | 'JENKINS_STATUS'
  | 'UNAPPLIED_DISPOSITION'
  | 'PERSONAL_CARD'
  | 'CPA_ENTRY'
  | 'PAYROLL_DOCUMENT_REQUEST'
  | 'TAX_BOUNDARY'
  | 'UNSUPPORTED';
export type ClientTrigger = 'TAX_QUESTION' | 'PNL_URGENCY' | 'DOCUMENTATION_PUSHBACK';

export interface ConversationMessage {
  readonly id: string;
  readonly sender: MessageSender;
  readonly content: string;
  readonly at: string;
}
export interface ClientConversation {
  readonly id: string;
  readonly participant: 'MICHAEL_CARTER';
  readonly subject: string;
  readonly status: ConversationStatus;
  readonly createdAt: string;
  readonly messages: readonly ConversationMessage[];
}
interface ClientFact {
  readonly id: string;
  readonly subject: string;
  readonly content: string;
  readonly knownBy: 'MICHAEL_CARTER';
  readonly disclosureIntent: InteractionIntent;
  readonly supportingDocumentId?: string;
  readonly disclosureAloneIsSufficient: boolean;
  readonly studentShouldRequestDocumentation: boolean;
  readonly instructorInterpretation: string;
}
export interface InteractionAuditEvent {
  readonly sequence: number;
  readonly at: string;
  readonly kind: 'STUDENT_MESSAGE' | 'INTENT_RECOGNIZED' | 'FACT_AUTHORIZED' | 'CLIENT_RESPONSE' | 'EVIDENCE_UNLOCKED' | 'CLIENT_MESSAGE_TRIGGERED';
  readonly conversationId: string;
  readonly messageId?: string;
  readonly intent?: InteractionIntent;
  readonly factId?: string;
  readonly documentId?: string;
  readonly trigger?: ClientTrigger;
}
export interface SuncoastInteractionAttempt {
  readonly attemptId: string;
  readonly studentId: string;
  readonly generation: number;
  readonly evidence: SuncoastEvidenceAttempt;
  readonly conversations: readonly ClientConversation[];
  readonly audit: readonly InteractionAuditEvent[];
  readonly disclosedFactIds: readonly string[];
  readonly documentationRequestCount: number;
}

const clientKnowledge: readonly ClientFact[] = Object.freeze(([
  { id: 'abc-purpose', subject: 'ABC Trailer payment', content: "That was the deposit on the enclosed trailer we're getting for the crews.", knownBy: 'MICHAEL_CARTER', disclosureIntent: 'ABC_PURPOSE', supportingDocumentId: 'abc-deposit-agreement', disclosureAloneIsSufficient: false, studentShouldRequestDocumentation: true, instructorInterpretation: 'Business purpose only; the student determines classification.' },
  { id: 'jenkins-status', subject: 'Robert Jenkins invoice', content: "Jenkins hasn't paid the $1,425 invoice. I've contacted him, and I still expect to collect it.", knownBy: 'MICHAEL_CARTER', disclosureIntent: 'JENKINS_STATUS', disclosureAloneIsSufficient: true, studentShouldRequestDocumentation: false, instructorInterpretation: 'Client intent supports continued collection without directing accounting treatment.' },
  { id: 'unapplied-intent', subject: '$750 customer payment', content: 'They have another job planned, and the $750 is meant to go toward that future work.', knownBy: 'MICHAEL_CARTER', disclosureIntent: 'UNAPPLIED_DISPOSITION', disclosureAloneIsSufficient: true, studentShouldRequestDocumentation: false, instructorInterpretation: 'Future-job intent only; no application command is authorized.' },
  { id: 'personal-card-purpose', subject: 'June 24 Visa activity', content: 'That $286.43 charge was personal. It was not for Suncoast work.', knownBy: 'MICHAEL_CARTER', disclosureIntent: 'PERSONAL_CARD', supportingDocumentId: 'card-clarification-0624', disclosureAloneIsSufficient: true, studentShouldRequestDocumentation: false, instructorInterpretation: 'Personal fact only; the response must not name Owner Draws.' },
  { id: 'cpa-provenance', subject: 'Historical CPA entry', content: "The CPA put that in during the prior-year tax work. I don't know why they made that specific entry.", knownBy: 'MICHAEL_CARTER', disclosureIntent: 'CPA_ENTRY', disclosureAloneIsSufficient: true, studentShouldRequestDocumentation: false, instructorInterpretation: 'Michael is not authority for the accounting conclusion.' },
  { id: 'payroll-provider', subject: 'June payroll support', content: "Gulf Coast Payroll Services handles payroll. I've sent the June 1–14 report.", knownBy: 'MICHAEL_CARTER', disclosureIntent: 'PAYROLL_DOCUMENT_REQUEST', supportingDocumentId: 'payroll-report-june-14', disclosureAloneIsSufficient: false, studentShouldRequestDocumentation: true, instructorInterpretation: 'Components remain in the unlocked report, not the message.' },
] satisfies ClientFact[]).map(value => Object.freeze(value)));

const messageAt = (sequence: number) => `2026-07-04T10:${String(sequence).padStart(2, '0')}:00.000Z`;
const freezeMessage = (message: ConversationMessage) => Object.freeze({ ...message });
const freezeConversation = (conversation: ClientConversation) => Object.freeze({ ...conversation, messages: Object.freeze(conversation.messages.map(freezeMessage)) });
const freezeAudit = (event: InteractionAuditEvent) => Object.freeze({ ...event });
const freezeAttempt = (value: SuncoastInteractionAttempt): SuncoastInteractionAttempt => Object.freeze({
  ...value,
  conversations: Object.freeze(value.conversations.map(freezeConversation)),
  audit: Object.freeze(value.audit.map(freezeAudit)),
  disclosedFactIds: Object.freeze([...value.disclosedFactIds]),
});

export function recognizeInteractionIntent(content: string): InteractionIntent {
  const normalized = content.toLowerCase();
  const requestsDocument = /\b(send|provide|need|request|have|share|get)\b/.test(normalized) && /\b(receipt|invoice|agreement|document|report|support|paperwork)\b/.test(normalized);
  if (/\b(abc|trailer)\b/.test(normalized) && requestsDocument) return 'ABC_DOCUMENT_REQUEST';
  if (/\b(abc|trailer)\b/.test(normalized) && /\b(what|why|purpose|for)\b/.test(normalized)) return 'ABC_PURPOSE';
  if (/\bpayroll\b|june 1.?14|june 14/.test(normalized) && requestsDocument) return 'PAYROLL_DOCUMENT_REQUEST';
  if (/\bjenkins\b|1,?425/.test(normalized) && /\b(owe|paid|collect|invoice|status)\b/.test(normalized)) return 'JENKINS_STATUS';
  if (/\b750\b|\bunapplied\b|\bfuture job\b|\badvance\b/.test(normalized)) return 'UNAPPLIED_DISPOSITION';
  const identifiesPersonalCardActivity = /286\.43|june 24/.test(normalized) && /\b(personal|business|suncoast|work|purpose|for)\b/.test(normalized);
  if (identifiesPersonalCardActivity || (/\b(visa|card)\b/.test(normalized) && /\bpersonal\b/.test(normalized))) return 'PERSONAL_CARD';
  if (/\b(tax|deduct|write.?off)\b|\btax return\b|\btax advice\b/.test(normalized)) return 'TAX_BOUNDARY';
  if (/\b(cpa|historical)\b|\bprior.year\b|\bjournal entry\b/.test(normalized)) return 'CPA_ENTRY';
  if (/\bwhat was\b|\bwhat is\b|\bdon't recognize\b|\bdo not recognize\b|\bunknown\b|\bunclear\b/.test(normalized) && /\b(charge|transaction|payment)\b/.test(normalized)) return 'AMBIGUOUS_TRANSACTION';
  return 'UNSUPPORTED';
}

function appendAudit(value: SuncoastInteractionAttempt, event: Omit<InteractionAuditEvent, 'sequence' | 'at'>): SuncoastInteractionAttempt {
  return freezeAttempt({ ...value, audit: [...value.audit, { sequence: value.audit.length + 1, at: messageAt(value.audit.length), ...event }] });
}
function replaceConversation(value: SuncoastInteractionAttempt, conversation: ClientConversation): SuncoastInteractionAttempt {
  return freezeAttempt({ ...value, conversations: value.conversations.map(item => item.id === conversation.id ? conversation : item) });
}
function conversationFor(value: SuncoastInteractionAttempt, conversationId: string): ClientConversation {
  const conversation = value.conversations.find(item => item.id === conversationId);
  if (!conversation || conversation.status === 'CLOSED') throw new InvalidReferenceError('Conversation unavailable');
  return conversation;
}
function addMessage(value: SuncoastInteractionAttempt, conversationId: string, sender: MessageSender, content: string): { value: SuncoastInteractionAttempt; message: ConversationMessage } {
  const conversation = conversationFor(value, conversationId);
  const message = freezeMessage({ id: `${conversationId}-message-${conversation.messages.length + 1}`, sender, content, at: messageAt(conversation.messages.length) });
  const updated = freezeConversation({ ...conversation, status: sender === 'STUDENT' ? 'WAITING_FOR_CLIENT' : 'WAITING_FOR_STUDENT', messages: [...conversation.messages, message] });
  return { value: replaceConversation(value, updated), message };
}
function factFor(intent: InteractionIntent): ClientFact | undefined { return clientKnowledge.find(fact => fact.disclosureIntent === intent); }
function evidenceIsVisible(value: SuncoastEvidenceAttempt, documentId: string): boolean { return evidenceStudentView(value).documents.some(document => document.id === documentId); }

function renderResponse(intent: InteractionIntent, content: string): string {
  const fact = factFor(intent);
  if (fact) {
    if (intent === 'CPA_ENTRY' && /change|fix|delete|void|authorize/.test(content.toLowerCase())) return `${fact.content} If it's wrong, can't you just fix it?`;
    return fact.content;
  }
  if (intent === 'ABC_DOCUMENT_REQUEST') return "Yes, I have the ABC agreement. I've sent it over.";
  if (intent === 'AMBIGUOUS_TRANSACTION') return "I don't remember. Just put it in supplies or something. That's probably what it was. I can check for better support.";
  if (intent === 'TAX_BOUNDARY') return "I don't know the tax answer. We should ask the CPA.";
  return "I don't know based on what I have. I can check, or we may need to ask the CPA.";
}

export async function deriveSuncoastInteraction(studentId: string, attemptId: string, generation = 1): Promise<SuncoastInteractionAttempt> {
  const evidence = await deriveSuncoastEvidence(studentId, attemptId, generation);
  const conversation = freezeConversation({ id: `${attemptId}-michael`, participant: 'MICHAEL_CARTER', subject: 'Suncoast bookkeeping questions', status: 'OPEN', createdAt: '2026-07-04T10:00:00.000Z', messages: [] });
  return freezeAttempt({ attemptId, studentId, generation, evidence, conversations: [conversation], audit: [], disclosedFactIds: [], documentationRequestCount: 0 });
}

export function interactionStudentView(value: SuncoastInteractionAttempt) {
  return {
    attemptId: value.attemptId,
    generation: value.generation,
    conversations: value.conversations.map(conversation => ({ id: conversation.id, participant: conversation.participant, subject: conversation.subject, status: conversation.status, createdAt: conversation.createdAt, messages: conversation.messages.map(message => ({ ...message })) })),
    evidence: evidenceStudentView(value.evidence),
  };
}

export function sendStudentMessage(value: SuncoastInteractionAttempt, conversationId: string, content: string): SuncoastInteractionAttempt {
  if (content.trim().length === 0 || content.length > 4000) throw new InvalidReferenceError('Message content is invalid');
  const intent = recognizeInteractionIntent(content);
  let result = addMessage(value, conversationId, 'STUDENT', content);
  let next = appendAudit(result.value, { kind: 'STUDENT_MESSAGE', conversationId, messageId: result.message.id });
  next = appendAudit(next, { kind: 'INTENT_RECOGNIZED', conversationId, intent });

  const fact = factFor(intent);
  if (fact) {
    next = freezeAttempt({ ...next, disclosedFactIds: [...new Set([...next.disclosedFactIds, fact.id])] });
    next = appendAudit(next, { kind: 'FACT_AUTHORIZED', conversationId, factId: fact.id });
  }

  let evidence = next.evidence;
  let unlockedDocumentId: string | undefined;
  if (intent === 'ABC_DOCUMENT_REQUEST' && !evidenceIsVisible(evidence, 'abc-deposit-agreement')) {
    evidence = requestEvidence(evidence, 'ABC transaction support');
    evidence = authorizeEvidence(evidence, 'abc-deposit-agreement', 'DOCUMENT_REQUESTED');
    unlockedDocumentId = 'abc-deposit-agreement';
  } else if (intent === 'PAYROLL_DOCUMENT_REQUEST' && !evidenceIsVisible(evidence, 'payroll-report-june-14')) {
    evidence = requestEvidence(evidence, 'payroll support');
    evidence = authorizeEvidence(evidence, 'payroll-report-june-14', 'DOCUMENT_REQUESTED');
    unlockedDocumentId = 'payroll-report-june-14';
  } else if (intent === 'PERSONAL_CARD' && !evidenceIsVisible(evidence, 'card-clarification-0624')) {
    evidence = authorizeEvidence(evidence, 'card-clarification-0624', 'CLIENT_CLARIFICATION_COMPLETED');
    unlockedDocumentId = 'card-clarification-0624';
  }
  next = freezeAttempt({ ...next, evidence, documentationRequestCount: next.documentationRequestCount + (intent === 'ABC_DOCUMENT_REQUEST' || intent === 'PAYROLL_DOCUMENT_REQUEST' ? 1 : 0) });
  if (unlockedDocumentId) next = appendAudit(next, { kind: 'EVIDENCE_UNLOCKED', conversationId, documentId: unlockedDocumentId });

  result = addMessage(next, conversationId, 'CLIENT', renderResponse(intent, content));
  return appendAudit(result.value, { kind: 'CLIENT_RESPONSE', conversationId, messageId: result.message.id });
}

export function triggerClientMessage(value: SuncoastInteractionAttempt, conversationId: string, trigger: ClientTrigger): SuncoastInteractionAttempt {
  const conversation = conversationFor(value, conversationId);
  if (trigger === 'PNL_URGENCY' && !conversation.messages.some(message => message.sender === 'STUDENT')) throw new InvalidReferenceError('Interaction unavailable');
  if (trigger === 'DOCUMENTATION_PUSHBACK' && value.documentationRequestCount < 2) throw new InvalidReferenceError('Interaction unavailable');
  const content = trigger === 'TAX_QUESTION'
    ? 'Can I write that whole pressure washer off on my taxes?'
    : trigger === 'PNL_URGENCY'
      ? 'I need the P&L for the bank today. Are the books done yet?'
      : 'My last bookkeeper never asked me for all this stuff.';
  const result = addMessage(value, conversationId, 'CLIENT', content);
  return appendAudit(result.value, { kind: 'CLIENT_MESSAGE_TRIGGERED', conversationId, messageId: result.message.id, trigger });
}

export async function resetSuncoastInteraction(value: SuncoastInteractionAttempt, newAttemptId: string): Promise<{ old: SuncoastInteractionAttempt; next: SuncoastInteractionAttempt }> {
  return { old: value, next: await deriveSuncoastInteraction(value.studentId, newAttemptId, value.generation + 1) };
}

export interface InteractionStore {
  findForStudent(attemptId: string, studentId: string): Promise<SuncoastInteractionAttempt | null>;
  save(value: SuncoastInteractionAttempt): Promise<void>;
}
export class SuncoastInteractionService {
  constructor(private readonly store: InteractionStore) {}
  async view(studentId: string, attemptId: string) {
    const value = await this.owned(studentId, attemptId);
    return interactionStudentView(value);
  }
  async send(studentId: string, attemptId: string, conversationId: string, content: string) {
    const value = sendStudentMessage(await this.owned(studentId, attemptId), conversationId, content);
    await this.store.save(value);
    return interactionStudentView(value);
  }
  private async owned(studentId: string, attemptId: string) {
    const value = await this.store.findForStudent(attemptId, studentId);
    if (!value) throw new NotFoundError('Attempt not found');
    return value;
  }
}
