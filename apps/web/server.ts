import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { StudentApplication, studentScreens, type StudentAction, type StudentScreen } from '../student/application.js';
import { studentCss, studentJs, renderStudentApplication } from './student-ui.js';

const application = new StudentApplication();
const auth = Object.freeze({ studentId: 'local-student' });
const readBody = async (request: IncomingMessage) => { const chunks: Buffer[]=[]; for await(const chunk of request) chunks.push(Buffer.from(chunk)); return new URLSearchParams(Buffer.concat(chunks).toString('utf8')); };
const string = (body: URLSearchParams, key: string) => body.get(key) ?? '';
const context = (body: URLSearchParams) => ({ expectedRevision: Number(string(body,'revision')), idempotencyKey: string(body,'key'), help: 'INDEPENDENT' as const });

async function actionFrom(body: URLSearchParams): Promise<StudentAction> {
  const intent=string(body,'intent');
  if(intent==='review')return{type:'BOOKKEEPING',command:{type:'REVIEW',targetId:string(body,'targetId')},context:context(body)};
  if(intent==='bank-decision'){
    const entryId=string(body,'entryId'),decision=string(body,'decision');
    if(decision==='MATCH')return{type:'BOOKKEEPING',command:{type:'MATCH',bankActivityId:entryId,targetId:string(body,'targetId')},context:context(body)};
    if(decision==='CATEGORIZE')return{type:'BOOKKEEPING',command:{type:'CATEGORIZE',entryId,accountId:string(body,'accountId')},context:context(body)};
    if(decision==='TRANSFER')return{type:'BOOKKEEPING',command:{type:'TRANSFER',entryId,balanceSheetAccountId:string(body,'accountId')},context:context(body)};
    if(decision==='EXCLUDE')return{type:'BOOKKEEPING',command:{type:'EXCLUDE',entryId},context:context(body)};
    if(decision==='FLAG')return{type:'BOOKKEEPING',command:{type:'FLAG_UNRESOLVED',targetId:entryId},context:context(body)};
    return{type:'SAVE_CORRECTION',entryId,context:context(body)};
  }
  if(intent==='reapply-payment')return{type:'BOOKKEEPING',command:{type:'REAPPLY_PAYMENT',paymentId:string(body,'paymentId'),fromInvoiceId:string(body,'fromInvoiceId'),toInvoiceId:string(body,'toInvoiceId')},context:context(body)};
  if(intent==='consolidate')return{type:'BOOKKEEPING',command:{type:'CONSOLIDATE_ACCOUNTS',sourceAccountIds:body.getAll('sourceAccountIds'),targetAccountId:string(body,'targetAccountId')},context:context(body)};
  if(intent==='set-reconciliation-line')return{type:'BOOKKEEPING',command:{type:'SET_RECONCILIATION_LINE',reconciliationId:string(body,'reconciliationId'),lineId:string(body,'lineId'),cleared:string(body,'cleared')==='true'},context:context(body)};
  if(intent==='finish-reconciliation')return{type:'BOOKKEEPING',command:{type:'FINISH_RECONCILIATION',reconciliationId:string(body,'reconciliationId')},context:context(body)};
  if(intent==='open-document')return{type:'OPEN_DOCUMENT',documentId:string(body,'documentId')};
  if(intent==='follow-document')return{type:'FOLLOW_DOCUMENT',documentId:string(body,'documentId'),referenceId:string(body,'referenceId')};
  if(intent==='request-document')return{type:'REQUEST_DOCUMENT',subject:string(body,'subject')};
  if(intent==='send-message')return{type:'SEND_MESSAGE',conversationId:string(body,'conversationId'),content:string(body,'content')};
  if(intent==='coach-draft')return{type:'COACH_DRAFT',conversationId:string(body,'conversationId'),draft:string(body,'draft'),level:string(body,'level') as 'HINT'|'DIRECTION'|'WALKTHROUGH'};
  if(intent==='close-books')return{type:'CLOSE_BOOKS'};
  if(intent==='begin-meeting')return{type:'BEGIN_MEETING'};
  if(intent==='submit-explanation')return{type:'SUBMIT_EXPLANATION',explanation:string(body,'explanation')};
  if(intent==='answer-followup')return{type:'ANSWER_FOLLOW_UP',followUpId:string(body,'followUpId'),response:string(body,'response')};
  if(intent==='finalize-results')return{type:'FINALIZE_RESULTS'};
  if(intent==='reset-attempt')return{type:'RESET_ATTEMPT'};
  throw new Error('Unsupported action');
}

async function page(request: IncomingMessage, response: ServerResponse) {
  const url=new URL(request.url??'/',`http://${request.headers.host??'localhost'}`);
  if(url.pathname==='/assets/student.css'){response.writeHead(200,{'content-type':'text/css; charset=utf-8','cache-control':'no-store'});response.end(studentCss);return;}
  if(url.pathname==='/assets/student.js'){response.writeHead(200,{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store'});response.end(studentJs);return;}
  if(request.method==='POST'&&url.pathname==='/action'){
    const body=await readBody(request),attemptId=string(body,'attemptId'),screen=(string(body,'screen')||'dashboard') as StudentScreen;
    const action=await actionFrom(body),result=await application.act(auth,attemptId,action); const preservedReturn=string(body,'returnTo'); const focus=action.type==='OPEN_DOCUMENT'?`&focus=${encodeURIComponent(action.documentId)}${preservedReturn?`&returnTo=${encodeURIComponent(preservedReturn)}`:''}`:''; const related=action.type==='FOLLOW_DOCUMENT'&&result.ok; const recordType=string(body,'recordType'); const destination=related?(recordType==='INVOICE'||recordType==='PAYMENT'||recordType==='DEPOSIT'?'sales':recordType==='RECONCILIATION'||recordType==='STATEMENT_TRUTH'?'reconcile':'register'):(result.attemptId!==attemptId?'meet':screen); const relatedQuery=related?`&focus=${encodeURIComponent(action.referenceId)}&returnTo=${encodeURIComponent(preservedReturn||'documents')}`:focus;
    response.writeHead(303,{location:`/?attempt=${encodeURIComponent(result.attemptId)}&screen=${destination}${relatedQuery}&notice=${encodeURIComponent(result.message)}`});response.end();return;
  }
  if(url.pathname==='/api/student'){
    const model=await application.view(auth,{attemptId:url.searchParams.get('attempt')??undefined,screen:(url.searchParams.get('screen')??'dashboard') as StudentScreen});response.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});response.end(JSON.stringify(model));return;
  }
  let model; const attempt=url.searchParams.get('attempt')??undefined;
  if(!attempt)model=await application.start(auth);else{const requested=url.searchParams.get('screen')??'dashboard';const screen=studentScreens.includes(requested as StudentScreen)?requested as StudentScreen:'dashboard';model=await application.view(auth,{attemptId:attempt,screen,basis:url.searchParams.get('basis')==='CASH'?'CASH':'ACCRUAL',accountId:url.searchParams.get('accountId')??undefined,focusId:url.searchParams.get('focus')??undefined,returnTo:url.searchParams.get('returnTo')??undefined});}
  response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",'x-content-type-options':'nosniff'});response.end(renderStudentApplication(model,url.searchParams.get('notice')??undefined));
}

export const studentWebServer=createServer((request,response)=>{page(request,response).catch(()=>{response.writeHead(404,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});response.end('<main><h1>Workspace unavailable</h1><p>The requested attempt or action is unavailable.</p></main>');});});
if(process.env.NODE_ENV!=='test')studentWebServer.listen(Number(process.env.WEB_PORT??3000));
