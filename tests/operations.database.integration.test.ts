import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

const enabled=Boolean(process.env.DATABASE_URL);
const prisma=new PrismaClient();
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function balancedEntry(attemptId:string,debitAccountId:string,creditAccountId:string,value:number,sourceType:string){return prisma.$transaction(async tx=>{const entry=await tx.journalEntry.create({data:{attemptId,description:sourceType,occurredOn:new Date('2026-01-10'),sourceType,sourceId:crypto.randomUUID()}});await tx.journalLine.createMany({data:[{entryId:entry.id,attemptId,attemptAccountId:debitAccountId,debitCents:value},{entryId:entry.id,attemptId,attemptAccountId:creditAccountId,creditCents:value}]});return entry;});}
async function fixture(){
  const suffix=crypto.randomUUID().slice(0,8);
  const template=await prisma.caseTemplate.create({data:{slug:`operations-${suffix}`,title:'Fictional operations proof',studentScenario:{},instructorData:{proof:'private'}}});
  const templateCustomer=await prisma.templateCustomer.create({data:{templateId:template.id,name:'Fictional Customer'}});
  const sourceAccounts=await Promise.all([
    prisma.templateAccount.create({data:{templateId:template.id,code:`10${suffix}`,name:'Bank',kind:'ASSET'}}),
    prisma.templateAccount.create({data:{templateId:template.id,code:`11${suffix}`,name:'Undeposited Funds',kind:'ASSET'}}),
    prisma.templateAccount.create({data:{templateId:template.id,code:`12${suffix}`,name:'Accounts Receivable',kind:'ASSET'}}),
    prisma.templateAccount.create({data:{templateId:template.id,code:`40${suffix}`,name:'Revenue',kind:'REVENUE'}}),
  ]);
  const attempt=await prisma.studentAttempt.create({data:{studentId:`student-${suffix}`,templateId:template.id}});
  const [bank,uf,ar,revenue]=await Promise.all(sourceAccounts.map((source,index)=>prisma.attemptAccount.create({data:{attemptId:attempt.id,sourceTemplateAccountId:source.id,code:source.code,name:source.name,kind:source.kind,operationalRole:index===0?'BANK':index===1?'UNDEPOSITED_FUNDS':index===2?'ACCOUNTS_RECEIVABLE':undefined}})));
  const customer=await prisma.attemptCustomer.create({data:{attemptId:attempt.id,sourceTemplateCustomerId:templateCustomer.id,name:templateCustomer.name}});
  const invoiceEntry=await balancedEntry(attempt.id,ar.id,revenue.id,10000,'INVOICE');
  const invoice=await prisma.invoice.create({data:{attemptId:attempt.id,customerId:customer.id,arAccountId:ar.id,journalEntryId:invoiceEntry.id,number:`INV-${suffix}`,invoiceDate:new Date('2026-01-01'),dueDate:new Date('2026-01-31')}});
  await prisma.invoiceLine.create({data:{attemptId:attempt.id,invoiceId:invoice.id,revenueAccountId:revenue.id,description:'Service',amountCents:10000}});
  const paymentEntry=await balancedEntry(attempt.id,uf.id,ar.id,6000,'CUSTOMER_PAYMENT');
  const payment=await prisma.customerPayment.create({data:{attemptId:attempt.id,customerId:customer.id,destinationAccountId:uf.id,arAccountId:ar.id,journalEntryId:paymentEntry.id,paymentDate:new Date('2026-01-10'),amountCents:6000}});
  return{template,templateCustomer,sourceAccounts,attempt,bank,uf,ar,revenue,customer,invoice,payment};
}

describe.skipIf(!enabled)('P-000A PostgreSQL enforcement',()=>{
  let data:Fixture;
  beforeAll(async()=>{await prisma.$connect();data=await fixture()});
  afterAll(async()=>{await prisma.$disconnect()});
  it('accepts a valid partial application and rejects over-application',async()=>{await prisma.paymentApplication.create({data:{attemptId:data.attempt.id,paymentId:data.payment.id,invoiceId:data.invoice.id,amountCents:4000}});await expect(prisma.paymentApplication.create({data:{attemptId:data.attempt.id,paymentId:data.payment.id,invoiceId:data.invoice.id,amountCents:2001}})).rejects.toThrow()});
  it('rejects cross-customer application',async()=>{const other=await prisma.attemptCustomer.create({data:{attemptId:data.attempt.id,name:'Other Fictional Customer'}});const entry=await balancedEntry(data.attempt.id,data.uf.id,data.ar.id,500,'CUSTOMER_PAYMENT');const payment=await prisma.customerPayment.create({data:{attemptId:data.attempt.id,customerId:other.id,destinationAccountId:data.uf.id,arAccountId:data.ar.id,journalEntryId:entry.id,paymentDate:new Date('2026-01-11'),amountCents:500}});await expect(prisma.paymentApplication.create({data:{attemptId:data.attempt.id,paymentId:payment.id,invoiceId:data.invoice.id,amountCents:500}})).rejects.toThrow()});
  it('rejects cross-attempt application through composite ownership',async()=>{const other=await fixture();await expect(prisma.paymentApplication.create({data:{attemptId:data.attempt.id,paymentId:other.payment.id,invoiceId:data.invoice.id,amountCents:100}})).rejects.toThrow()});
  it('prevents depositing the same payment twice',async()=>{const entry1=await balancedEntry(data.attempt.id,data.bank.id,data.uf.id,6000,'BANK_DEPOSIT');const first=await prisma.bankDeposit.create({data:{attemptId:data.attempt.id,bankAccountId:data.bank.id,journalEntryId:entry1.id,depositDate:new Date('2026-01-12'),amountCents:6000}});await prisma.bankDepositPayment.create({data:{attemptId:data.attempt.id,depositId:first.id,paymentId:data.payment.id}});const entry2=await balancedEntry(data.attempt.id,data.bank.id,data.uf.id,6000,'BANK_DEPOSIT');const second=await prisma.bankDeposit.create({data:{attemptId:data.attempt.id,bankAccountId:data.bank.id,journalEntryId:entry2.id,depositDate:new Date('2026-01-13'),amountCents:6000}});await expect(prisma.bankDepositPayment.create({data:{attemptId:data.attempt.id,depositId:second.id,paymentId:data.payment.id}})).rejects.toThrow()});
  it('rejects cross-attempt deposit links',async()=>{const other=await fixture();const entry=await balancedEntry(data.attempt.id,data.bank.id,data.uf.id,6000,'BANK_DEPOSIT');const deposit=await prisma.bankDeposit.create({data:{attemptId:data.attempt.id,bankAccountId:data.bank.id,journalEntryId:entry.id,depositDate:new Date('2026-01-14'),amountCents:6000}});await expect(prisma.bankDepositPayment.create({data:{attemptId:data.attempt.id,depositId:deposit.id,paymentId:other.payment.id}})).rejects.toThrow()});
  it('rejects cross-template customer provenance',async()=>{const other=await fixture();await expect(prisma.attemptCustomer.create({data:{attemptId:data.attempt.id,sourceTemplateCustomerId:other.templateCustomer.id,name:'Foreign'}})).rejects.toThrow()});
  it('rejects reconciliation lines from another account and non-zero completion',async()=>{const reconciliation=await prisma.reconciliation.create({data:{attemptId:data.attempt.id,accountId:data.bank.id,beginningDate:new Date('2026-01-01'),endingDate:new Date('2026-01-31'),beginningBalanceCents:0,endingBalanceCents:1}});const arLine=await prisma.journalLine.findFirstOrThrow({where:{entryId:data.invoice.journalEntryId,attemptAccountId:data.ar.id}});await expect(prisma.reconciliationLine.create({data:{attemptId:data.attempt.id,reconciliationId:reconciliation.id,journalLineId:arLine.id,fingerprint:`${arLine.debitCents}:${arLine.creditCents}:${arLine.attemptAccountId}`}})).rejects.toThrow();await expect(prisma.reconciliation.update({where:{id:reconciliation.id},data:{status:'COMPLETED',completedAt:new Date()}})).rejects.toThrow()});
});
