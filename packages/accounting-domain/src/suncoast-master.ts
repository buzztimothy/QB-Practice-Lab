import type { AccountKind, AttemptAccount, JournalEntry, OperationalAccountRole, StudentAttempt, TemplateAccount } from './model.js';
import type { OperationalAttempt, OperationalTemplateCustomer, Reconciliation } from './operations-model.js';
import { OperationalAccountingService, arControlDifference, customerBalances, initializeOperationalAttempt, invoiceDetails, operationalProfitAndLoss, reconciliationResult, type OperationalStore } from './operations.js';
import { assertBalanced, balanceSheet, trialBalance, type IdClock, type PostLine } from './service.js';

export const SUNCOAST_TEMPLATE_ID='suncoast-home-services-clean-master';
export const SUNCOAST_ATTEMPT_ID='suncoast-master-attempt';
export const suncoastAuthoritativeStatements=Object.freeze({checking:{beginningBalanceCents:6992500,endingBalanceCents:8467200},visa:{beginningBalanceCents:575000,endingBalanceCents:402172}});

type AccountSpec={code:string;name:string;kind:AccountKind;operationalRole?:OperationalAccountRole};
const accountSpecs:readonly AccountSpec[]=[
  {code:'1000',name:'Operating Checking',kind:'ASSET',operationalRole:'BANK'},
  {code:'1010',name:'Undeposited Funds',kind:'ASSET',operationalRole:'UNDEPOSITED_FUNDS'},
  {code:'1100',name:'Accounts Receivable',kind:'ASSET',operationalRole:'ACCOUNTS_RECEIVABLE'},
  {code:'1200',name:'Trailer Deposit',kind:'ASSET'},
  {code:'1500',name:'Tools & Equipment',kind:'ASSET'},
  {code:'1600',name:'Vehicles',kind:'ASSET'},
  {code:'2000',name:'Accounts Payable',kind:'LIABILITY'},
  {code:'2100',name:'Gulf Coast Business Visa',kind:'LIABILITY',operationalRole:'CREDIT_CARD'},
  {code:'2200',name:'Vehicle Loan Payable',kind:'LIABILITY'},
  {code:'2300',name:'Payroll Liabilities',kind:'LIABILITY'},
  {code:'3000',name:'Historical / Opening Equity',kind:'EQUITY'},
  {code:'3100',name:'Owner Contributions',kind:'EQUITY'},
  {code:'3200',name:'Owner Draws',kind:'EQUITY'},
  {code:'4000',name:'Handyman Income',kind:'REVENUE'},
  {code:'4100',name:'Painting Income',kind:'REVENUE'},
  {code:'4200',name:'Pressure Washing Income',kind:'REVENUE'},
  {code:'6000',name:'Advertising & Marketing',kind:'EXPENSE'},
  {code:'6010',name:'Bank Fees',kind:'EXPENSE'},
  {code:'6020',name:'Insurance',kind:'EXPENSE'},
  {code:'6030',name:'Interest Expense',kind:'EXPENSE'},
  {code:'6040',name:'Materials & Supplies',kind:'EXPENSE'},
  {code:'6050',name:'Meals',kind:'EXPENSE'},
  {code:'6060',name:'Office Expense',kind:'EXPENSE'},
  {code:'6070',name:'Payroll Expense',kind:'EXPENSE'},
  {code:'6080',name:'Professional Fees',kind:'EXPENSE'},
  {code:'6090',name:'Rent',kind:'EXPENSE'},
  {code:'6100',name:'Repairs & Maintenance',kind:'EXPENSE'},
  {code:'6110',name:'Software & Subscriptions',kind:'EXPENSE'},
  {code:'6120',name:'Telephone & Internet',kind:'EXPENSE'},
  {code:'6130',name:'Vehicle Expense',kind:'EXPENSE'},
] as const;

const customerNames=['Robert Jenkins','Susan Martinez','David Reynolds','Patricia Owens','James Wilson','Karen Thompson','Thomas Reed','Linda Anderson','Palm Breeze Property Management','Gulfside Rentals LLC','Cape Premier Realty'] as const;
export const suncoastVendors=['Home Depot',"Lowe's",'Sherwin-Williams','Suncoast Paint Supply','Office Depot','Comcast Business','Verizon Wireless','Gulf Coast Insurance','QuickBooks','Google','Meta','Shell','Circle K','Fort Myers Equipment Rental','Coastal Accounting & Tax','ABC Trailer & Equipment','Gulf Coast Payroll Services','Gulf Coast Auto Finance'] as const;

export const suncoastInstructorFacts=Object.freeze({
  homeDepotTwinPurchases:'Both separately sourced $642.18 Home Depot purchases are legitimate: Jenkins and Palm Breeze.',
  trailerDeposit:'The $2,400 ABC Trailer & Equipment payment is a refundable/creditable deposit for an enclosed work trailer.',
  jenkinsReceivable:'Robert Jenkins owes a collectible $1,425 invoice at June 30.',
  pressureWasher:'The $6,800 commercial pressure washer is Tools & Equipment; depreciation and tax treatment are outside scope.',
  vehicleLoan:'The $925 June payment comprises $690 principal and $235 interest.',
  cpaEntry:'Coastal Accounting & Tax accrued the correct 2025 professional fee at December 31; it was closed to historical equity and paid before April 1.',
  palmBreezeReceipt:'Palm Breeze Property Management legitimately paid $9,500 against its supported painting invoice.',
  martinezLifecycle:'Susan Martinez paid the $3,850 painting invoice on June 12 through Undeposited Funds and a bank deposit, with revenue recognized once.',
  reynoldsApplication:'David Reynolds paid $1,850, correctly applied to Invoice A; Invoice B for $2,275 remains open.',
});

export interface SuncoastSourceRecord {id:string;date:string;counterparty:string;amountCents:number;purpose:string;entryId:string;documentRef:string}
export interface SuncoastStatementTruth {accountId:string;beginningBalanceCents:number;endingBalanceCents:number;clearedLineIds:readonly string[];reconciliationId:string;differenceCents:number}
export interface SuncoastMasterCase {state:OperationalAttempt;accountIds:Readonly<Record<string,string>>;customerIds:Readonly<Record<string,string>>;sourceRecords:readonly SuncoastSourceRecord[];checkingStatement:SuncoastStatementTruth;cardStatement:SuncoastStatementTruth;instructorFacts:typeof suncoastInstructorFacts;studentMetadata:readonly {id:string;title:string;date:string;counterparty:string}[]}

class MemoryOperationalStore implements OperationalStore{
  constructor(public state:OperationalAttempt){}
  async findForStudent(attemptId:string,studentId:string){return this.state.attempt.id===attemptId&&this.state.attempt.studentId===studentId?this.state:null}
  async save(state:OperationalAttempt){this.state=state}
}

function deterministicSystem():IdClock{let sequence=0;return{id:()=>`suncoast-${String(++sequence).padStart(5,'0')}`,now:()=>`2026-07-01T00:${String(sequence%60).padStart(2,'0')}:00.000Z`}}
const cents=(dollars:number)=>Math.round(dollars*100);

export async function buildSuncoastMasterCase():Promise<SuncoastMasterCase>{
  const system=deterministicSystem();
  const templateAccounts:TemplateAccount[]=accountSpecs.map(spec=>({id:`template-account-${spec.code}`,...spec}));
  const accountIds=Object.fromEntries(accountSpecs.map(spec=>[spec.name,`account-${spec.code}`]));
  const accounts:AttemptAccount[]=templateAccounts.map(source=>({...source,id:accountIds[source.name],attemptId:SUNCOAST_ATTEMPT_ID,sourceTemplateAccountId:source.id}));
  const attempt:StudentAttempt={id:SUNCOAST_ATTEMPT_ID,studentId:'instructor-master',templateId:SUNCOAST_TEMPLATE_ID,generation:1,status:'ACTIVE',accounts,entries:[],actions:[{sequence:1,kind:'ATTEMPT_CREATED',at:'2026-04-01T00:00:00.000Z',detail:{}}],unlockedDocumentIds:[]};
  const templateCustomers:OperationalTemplateCustomer[]=customerNames.map((name,index)=>({id:`template-customer-${String(index+1).padStart(2,'0')}`,name,active:true}));
  const store=new MemoryOperationalStore(initializeOperationalAttempt(attempt,templateCustomers,system));
  const service=new OperationalAccountingService(store,system);
  const customerIds=Object.fromEntries(store.state.customers.map(customer=>[customer.name,customer.id]));
  const sourceRecords:SuncoastSourceRecord[]=[];
  const id=(name:string)=>{const value=accountIds[name];if(!value)throw new Error(`Missing account ${name}`);return value};
  const append=(date:string,description:string,lines:readonly PostLine[],sourceKind:string,counterparty:string,documentRef:string,purpose:string):JournalEntry=>{
    assertBalanced(lines);const entryId=system.id();const entry:JournalEntry={id:entryId,attemptId:SUNCOAST_ATTEMPT_ID,description,occurredOn:date,source:{kind:sourceKind,id:system.id()},lines:lines.map(line=>({id:system.id(),entryId,attemptAccountId:line.attemptAccountId,debitCents:line.debitCents??0,creditCents:line.creditCents??0}))};
    store.state={...store.state,attempt:{...store.state.attempt,entries:[...store.state.attempt.entries,entry],actions:[...store.state.attempt.actions,{sequence:store.state.attempt.actions.length+1,kind:'JOURNAL_POSTED',at:`${date}T12:00:00.000Z`,detail:{entryId}}]}};
    sourceRecords.push({id:entry.source!.id,date,counterparty,amountCents:lines.reduce((sum,line)=>sum+(line.debitCents??0),0),purpose,entryId,documentRef});return entry;
  };
  const bankExpense=(date:string,vendor:string,expense:string,value:number,ref:string)=>append(date,`${vendor} — ${expense}`,[{attemptAccountId:id(expense),debitCents:value},{attemptAccountId:id('Operating Checking'),creditCents:value}],'VENDOR_PAYMENT',vendor,ref,expense);
  const invoice=async(customer:string,number:string,date:string,due:string,revenue:string,value:number)=>service.postInvoice('instructor-master',SUNCOAST_ATTEMPT_ID,{customerId:customerIds[customer],number,invoiceDate:date,dueDate:due,arAccountId:id('Accounts Receivable'),lines:[{revenueAccountId:id(revenue),description:`${revenue} services`,amountCents:value}]});
  const receiveApplyDeposit=async(customer:string,invoiceId:string,date:string,value:number,ref:string)=>{const payment=await service.receivePayment('instructor-master',SUNCOAST_ATTEMPT_ID,{customerId:customerIds[customer],paymentDate:date,amountCents:value,destinationAccountId:id('Undeposited Funds'),arAccountId:id('Accounts Receivable'),method:'Check',reference:ref});await service.applyPayment('instructor-master',SUNCOAST_ATTEMPT_ID,payment.id,invoiceId,value);await service.createDeposit('instructor-master',SUNCOAST_ATTEMPT_ID,{depositDate:date,bankAccountId:id('Operating Checking'),undepositedFundsAccountId:id('Undeposited Funds'),paymentIds:[payment.id]});return payment};

  append('2025-12-31','Coastal Accounting & Tax — 2025 year-end accrual',[{attemptAccountId:id('Professional Fees'),debitCents:cents(1200)},{attemptAccountId:id('Accounts Payable'),creditCents:cents(1200)}],'CPA_ENTRY','Coastal Accounting & Tax','CPA-2025-YE','Correct year-end professional-fee accrual');
  append('2025-12-31','Close 2025 professional fee to historical equity',[{attemptAccountId:id('Historical / Opening Equity'),debitCents:cents(1200)},{attemptAccountId:id('Professional Fees'),creditCents:cents(1200)}],'PERIOD_CLOSE','Coastal Accounting & Tax','CPA-2025-CLOSE','Correct prior-period closing entry');
  append('2026-03-15','Pay 2025 CPA accrual',[{attemptAccountId:id('Accounts Payable'),debitCents:cents(1200)},{attemptAccountId:id('Operating Checking'),creditCents:cents(1200)}],'VENDOR_PAYMENT','Coastal Accounting & Tax','CPA-2025-PAID','Settlement of accrued CPA fee');
  const openingInvoices=[
    await invoice('Patricia Owens','PRE-1001','2026-03-10','2026-04-09','Handyman Income',cents(3000)),
    await invoice('Karen Thompson','PRE-1002','2026-03-18','2026-04-17','Painting Income',cents(3000)),
    await invoice('Gulfside Rentals LLC','PRE-1003','2026-03-24','2026-04-23','Pressure Washing Income',cents(2750)),
  ];
  append('2026-03-31','Close pre-April revenue to historical equity',[{attemptAccountId:id('Handyman Income'),debitCents:cents(3000)},{attemptAccountId:id('Painting Income'),debitCents:cents(3000)},{attemptAccountId:id('Pressure Washing Income'),debitCents:cents(2750)},{attemptAccountId:id('Historical / Opening Equity'),creditCents:cents(8750)}],'PERIOD_CLOSE','Coastal Accounting & Tax','OPEN-AR-CLOSE','Close historical revenue supporting opening A/R');
  append('2026-04-01','Opening balance capitalization',[{attemptAccountId:id('Operating Checking'),debitCents:cents(29650)},{attemptAccountId:id('Tools & Equipment'),debitCents:cents(18500)},{attemptAccountId:id('Vehicles'),debitCents:cents(42000)},{attemptAccountId:id('Gulf Coast Business Visa'),creditCents:cents(4850)},{attemptAccountId:id('Vehicle Loan Payable'),creditCents:cents(28600)},{attemptAccountId:id('Historical / Opening Equity'),creditCents:cents(56700)}],'OPENING_BALANCE','Suncoast Home Services LLC','OPEN-2026-04-01','Opening position after prior-period activity');

  await receiveApplyDeposit('Patricia Owens',openingInvoices[0].id,'2026-04-05',cents(3000),'RCPT-APR-001');
  await receiveApplyDeposit('Karen Thompson',openingInvoices[1].id,'2026-04-08',cents(3000),'RCPT-APR-002');
  await receiveApplyDeposit('Gulfside Rentals LLC',openingInvoices[2].id,'2026-04-10',cents(2750),'RCPT-APR-003');
  for(const [customer,number,revenue,value,date] of [
    ['James Wilson','APR-1004','Handyman Income',cents(9850),'2026-04-12'],['Cape Premier Realty','APR-1005','Painting Income',cents(11600),'2026-04-18'],['Palm Breeze Property Management','APR-1006','Pressure Washing Income',cents(3500),'2026-04-24'],
    ['Thomas Reed','MAY-1007','Handyman Income',cents(14400),'2026-05-09'],['Linda Anderson','MAY-1008','Painting Income',cents(17250),'2026-05-16'],['Gulfside Rentals LLC','MAY-1009','Pressure Washing Income',cents(7100),'2026-05-23'],
  ] as const){const created=await invoice(customer,number,date,date,revenue,value);await receiveApplyDeposit(customer,created.id,date,value,`RCPT-${number}`)}

  const martinez=await invoice('Susan Martinez','JUN-1010','2026-06-05','2026-06-20','Painting Income',cents(3850));
  await receiveApplyDeposit('Susan Martinez',martinez.id,'2026-06-12',cents(3850),'RCPT-MARTINEZ-0612');
  const palm=await invoice('Palm Breeze Property Management','JUN-1011','2026-06-20','2026-07-20','Painting Income',cents(9500));
  const palmPayment=await receiveApplyDeposit('Palm Breeze Property Management',palm.id,'2026-06-26',cents(9500),'RCPT-PALM-0626');
  const junePainting=await invoice('Cape Premier Realty','JUN-1012','2026-06-14','2026-06-30','Painting Income',cents(5550));await receiveApplyDeposit('Cape Premier Realty',junePainting.id,'2026-06-28',cents(5550),'RCPT-PAINT-0628');
  const reynoldsA=await invoice('David Reynolds','REY-A','2026-06-03','2026-06-18','Handyman Income',cents(1850));
  const reynoldsB=await invoice('David Reynolds','REY-B','2026-06-18','2026-07-18','Handyman Income',cents(2275));
  await receiveApplyDeposit('David Reynolds',reynoldsA.id,'2026-06-15',cents(1850),'RCPT-REYNOLDS-0615');
  const juneHandyman=await invoice('Thomas Reed','JUN-1013','2026-06-09','2026-06-24','Handyman Income',cents(13800));await receiveApplyDeposit('Thomas Reed',juneHandyman.id,'2026-06-24',cents(13800),'RCPT-HANDY-0624');
  const junePressure=await invoice('Gulfside Rentals LLC','JUN-1014','2026-06-11','2026-06-26','Pressure Washing Income',cents(8450));await receiveApplyDeposit('Gulfside Rentals LLC',junePressure.id,'2026-06-27',cents(8450),'RCPT-PRESSURE-0627');
  const jenkins=await invoice('Robert Jenkins','JEN-OPEN','2026-06-22','2026-07-22','Handyman Income',cents(1425));

  append('2026-05-04','Owner contribution',[{attemptAccountId:id('Operating Checking'),debitCents:cents(5000)},{attemptAccountId:id('Owner Contributions'),creditCents:cents(5000)}],'OWNER_CONTRIBUTION','Michael Carter','OWNER-2026-05-04','Owner capital contribution');
  for(const [date,vendor,expense,value,ref] of [
    ['2026-04-02','Fort Myers Commerce Center','Rent',cents(2500),'APR-RENT'],['2026-04-15','Gulf Coast Payroll Services','Payroll Expense',cents(9000),'APR-PAYROLL'],['2026-04-20','Suncoast Paint Supply','Materials & Supplies',cents(4200),'APR-MATERIALS'],['2026-04-22','Gulf Coast Insurance','Insurance',cents(950),'APR-INSURANCE'],['2026-04-25','Verizon Wireless','Telephone & Internet',cents(310),'APR-TELECOM'],['2026-04-28','Shell','Vehicle Expense',cents(780),'APR-FUEL'],
    ['2026-05-02','Fort Myers Commerce Center','Rent',cents(2500),'MAY-RENT'],['2026-05-15','Gulf Coast Payroll Services','Payroll Expense',cents(9400),'MAY-PAYROLL'],['2026-05-18',"Lowe's",'Materials & Supplies',cents(5100),'MAY-MATERIALS'],['2026-05-21','Comcast Business','Telephone & Internet',cents(295),'MAY-INTERNET'],['2026-05-24','QuickBooks','Software & Subscriptions',cents(100),'MAY-SOFTWARE'],['2026-05-27','Circle K','Vehicle Expense',cents(840),'MAY-FUEL'],
    ['2026-06-02','Fort Myers Commerce Center','Rent',cents(2500),'JUN-RENT'],['2026-06-14','Gulf Coast Payroll Services','Payroll Expense',cents(9800),'JUN-PAYROLL'],['2026-06-18','Office Depot','Office Expense',cents(318),'JUN-OFFICE'],['2026-06-20','Google','Advertising & Marketing',cents(750),'JUN-GOOGLE'],['2026-06-21','Verizon Wireless','Telephone & Internet',cents(315),'JUN-TELECOM'],['2026-06-23','Shell','Vehicle Expense',cents(910),'JUN-FUEL'],['2026-06-29','Gulf Coast Community Bank','Bank Fees',cents(35),'JUN-BANK-FEE'],
  ] as const)bankExpense(date,vendor,expense,value,ref);

  append('2026-06-08','Commercial pressure washer',[{attemptAccountId:id('Tools & Equipment'),debitCents:cents(6800)},{attemptAccountId:id('Operating Checking'),creditCents:cents(6800)}],'EQUIPMENT_PURCHASE','Fort Myers Equipment Rental','EQUIP-PW-0608','Commercial pressure washer capitalized as equipment');
  append('2026-06-17','Enclosed trailer deposit',[{attemptAccountId:id('Trailer Deposit'),debitCents:cents(2400)},{attemptAccountId:id('Operating Checking'),creditCents:cents(2400)}],'VENDOR_DEPOSIT','ABC Trailer & Equipment','ABC-TRAILER-0617','Balance-sheet deposit toward enclosed trailer');
  append('2026-06-28','Vehicle loan payment',[{attemptAccountId:id('Vehicle Loan Payable'),debitCents:cents(690)},{attemptAccountId:id('Interest Expense'),debitCents:cents(235)},{attemptAccountId:id('Operating Checking'),creditCents:cents(925)}],'LOAN_PAYMENT','Gulf Coast Auto Finance','AUTO-LOAN-0628','June vehicle loan principal and interest');

  const cardPurchases=[
    {date:'2026-04-16',vendor:'Meta',expense:'Advertising & Marketing',value:cents(600),ref:'VISA-APR-META',purpose:'April social advertising'},
    {date:'2026-05-19',vendor:'QuickBooks',expense:'Software & Subscriptions',value:cents(300),ref:'VISA-MAY-QBO',purpose:'Quarterly software subscription'},
    {date:'2026-06-22',vendor:'Home Depot',expense:'Materials & Supplies',value:64218,ref:'HD-JENKINS-0622',purpose:'Materials for Jenkins'},
    {date:'2026-06-22',vendor:'Home Depot',expense:'Materials & Supplies',value:64218,ref:'HD-PALM-0622',purpose:'Materials for Palm Breeze'},
    {date:'2026-06-25',vendor:'Sherwin-Williams',expense:'Materials & Supplies',value:48736,ref:'SW-0625',purpose:'Painting supplies'},
  ];
  for(const purchase of cardPurchases){const entry=await service.recordCardPurchase('instructor-master',SUNCOAST_ATTEMPT_ID,{date:purchase.date,cardAccountId:id('Gulf Coast Business Visa'),purchaseAccountId:id(purchase.expense),amountCents:purchase.value});sourceRecords.push({id:purchase.ref,date:purchase.date,counterparty:purchase.vendor,amountCents:purchase.value,purpose:purchase.purpose,entryId:entry.id,documentRef:purchase.ref})}
  await service.payCreditCard('instructor-master',SUNCOAST_ATTEMPT_ID,{date:'2026-06-27',bankAccountId:id('Operating Checking'),cardAccountId:id('Gulf Coast Business Visa'),amountCents:cents(3500)});

  const reconcile=async(accountId:string,statement:{beginningBalanceCents:number;endingBalanceCents:number}):Promise<{reconciliation:Reconciliation;truth:SuncoastStatementTruth}>=>{const juneLines=store.state.attempt.entries.filter(entry=>entry.occurredOn>='2026-06-01'&&entry.occurredOn<='2026-06-30').flatMap(entry=>entry.lines).filter(line=>line.attemptAccountId===accountId);const reconciliation=await service.startReconciliation('instructor-master',SUNCOAST_ATTEMPT_ID,{accountId,beginningDate:'2026-06-01',endingDate:'2026-06-30',beginningBalanceCents:statement.beginningBalanceCents,endingBalanceCents:statement.endingBalanceCents,clearedJournalLineIds:juneLines.map(line=>line.id)});await service.completeReconciliation('instructor-master',SUNCOAST_ATTEMPT_ID,reconciliation.id);const result=reconciliationResult(store.state,reconciliation);return{reconciliation,truth:{accountId,...statement,clearedLineIds:juneLines.map(line=>line.id),reconciliationId:reconciliation.id,differenceCents:result.differenceCents}}};
  const checking=await reconcile(id('Operating Checking'),suncoastAuthoritativeStatements.checking);const card=await reconcile(id('Gulf Coast Business Visa'),suncoastAuthoritativeStatements.visa);
  const studentMetadata=[...sourceRecords.map(record=>({id:record.documentRef,title:`${record.counterparty} supporting record`,date:record.date,counterparty:record.counterparty})),...store.state.invoices.map(record=>({id:`invoice-${record.number}`,title:`Invoice ${record.number}`,date:record.invoiceDate,counterparty:store.state.customers.find(customer=>customer.id===record.customerId)!.name})),...store.state.payments.map(record=>({id:`receipt-${record.reference??record.id}`,title:`Customer receipt ${record.reference??record.id}`,date:record.paymentDate,counterparty:store.state.customers.find(customer=>customer.id===record.customerId)!.name})),...store.state.deposits.map(record=>({id:`deposit-${record.id}`,title:'Bank deposit record',date:record.depositDate,counterparty:'Gulf Coast Community Bank'}))];
  void palmPayment;void reynoldsB;void jenkins;
  return{state:store.state,accountIds,customerIds,sourceRecords,checkingStatement:checking.truth,cardStatement:card.truth,instructorFacts:suncoastInstructorFacts,studentMetadata};
}

export async function suncoastCanonicalSummary(){const master=await buildSuncoastMasterCase();const state=master.state;return{openingBalanceSheet:balanceSheet({...state.attempt,entries:state.attempt.entries.filter(entry=>entry.occurredOn<='2026-04-01')}),cash:{april:operationalProfitAndLoss(state,'CASH',{from:'2026-04-01',through:'2026-04-30'}),may:operationalProfitAndLoss(state,'CASH',{from:'2026-05-01',through:'2026-05-31'}),june:operationalProfitAndLoss(state,'CASH',{from:'2026-06-01',through:'2026-06-30'})},accrual:{april:operationalProfitAndLoss(state,'ACCRUAL',{from:'2026-04-01',through:'2026-04-30'}),may:operationalProfitAndLoss(state,'ACCRUAL',{from:'2026-05-01',through:'2026-05-31'}),june:operationalProfitAndLoss(state,'ACCRUAL',{from:'2026-06-01',through:'2026-06-30'})},endingBalanceSheet:balanceSheet(state.attempt),trialBalance:trialBalance(state.attempt),ar:{details:invoiceDetails(state).filter(row=>row.openCents!==0),customers:customerBalances(state).filter(row=>row.netReceivableCents!==0),controlDifferenceCents:arControlDifference(state,master.accountIds['Accounts Receivable'])},master};}
