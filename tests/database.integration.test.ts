import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
const enabled = Boolean(process.env.DATABASE_URL);
const prisma = new PrismaClient();
describe.skipIf(!enabled)('PostgreSQL enforcement', () => {
  beforeAll(async()=>{ await prisma.$connect(); });
  afterAll(async()=>{ await prisma.$disconnect(); });
  it('rejects template mutation', async()=>{ await expect(prisma.$executeRawUnsafe(`UPDATE case_templates SET title='tampered' WHERE slug='architecture-proof'`)).rejects.toThrow(); });
  it('allows attempt-local records to change without changing template source', async()=>{
    const student=`mutable-${Date.now()}`;
    const attempt=await prisma.studentAttempt.create({data:{studentId:student,templateId:'00000000-0000-4000-8000-000000000001'}});
    const account=await prisma.attemptAccount.create({data:{attemptId:attempt.id,sourceTemplateAccountId:'00000000-0000-4000-8000-000000000101',code:'1000',name:'Cash',kind:'ASSET'}});
    await prisma.attemptAccount.update({where:{id:account.id},data:{name:'Student cash label'}});
    expect((await prisma.attemptAccount.findUniqueOrThrow({where:{id:account.id}})).name).toBe('Student cash label');
    expect((await prisma.templateAccount.findUniqueOrThrow({where:{id:'00000000-0000-4000-8000-000000000101'}})).name).toBe('Cash');
  });
  it('commits balanced journal lines', async()=>{
    const student=`balanced-${Date.now()}`;
    const attempt=await prisma.studentAttempt.create({data:{studentId:student,templateId:'00000000-0000-4000-8000-000000000001'}});
    const cash=await prisma.attemptAccount.create({data:{attemptId:attempt.id,sourceTemplateAccountId:'00000000-0000-4000-8000-000000000101',code:'1000',name:'Cash',kind:'ASSET'}});
    const equity=await prisma.attemptAccount.create({data:{attemptId:attempt.id,sourceTemplateAccountId:'00000000-0000-4000-8000-000000000301',code:'3000',name:'Owner equity',kind:'EQUITY'}});
    const entry=await prisma.$transaction(async tx=>{const created=await tx.journalEntry.create({data:{attemptId:attempt.id,description:'Opening',occurredOn:new Date('2026-08-17')}});await tx.journalLine.createMany({data:[{entryId:created.id,attemptId:attempt.id,attemptAccountId:cash.id,debitCents:500},{entryId:created.id,attemptId:attempt.id,attemptAccountId:equity.id,creditCents:500}]});return created;});
    expect(await prisma.journalLine.count({where:{entryId:entry.id}})).toBe(2);
  });
  it('rejects cross-attempt account references atomically',async()=>{
    const stamp=Date.now();
    const first=await prisma.studentAttempt.create({data:{studentId:`cross-a-${stamp}`,templateId:'00000000-0000-4000-8000-000000000001'}});
    const second=await prisma.studentAttempt.create({data:{studentId:`cross-b-${stamp}`,templateId:'00000000-0000-4000-8000-000000000001'}});
    const foreign=await prisma.attemptAccount.create({data:{attemptId:second.id,sourceTemplateAccountId:'00000000-0000-4000-8000-000000000101',code:'1000',name:'Cash',kind:'ASSET'}});
    await expect(prisma.$transaction(async tx=>{const entry=await tx.journalEntry.create({data:{attemptId:first.id,description:'Cross attempt',occurredOn:new Date('2026-08-17')}});await tx.journalLine.create({data:{entryId:entry.id,attemptId:first.id,attemptAccountId:foreign.id,debitCents:100}});})).rejects.toThrow();
    expect(await prisma.journalEntry.count({where:{attemptId:first.id}})).toBe(0);
  });
  it('rejects an unbalanced transaction atomically', async()=>{
    const student=`db-${Date.now()}`;
    const attempt=await prisma.studentAttempt.create({data:{studentId:student,templateId:'00000000-0000-4000-8000-000000000001'}});
    const account=await prisma.attemptAccount.create({data:{attemptId:attempt.id,sourceTemplateAccountId:'00000000-0000-4000-8000-000000000101',code:'1000',name:'Cash',kind:'ASSET'}});
    await expect(prisma.$transaction(async tx=>{const entry=await tx.journalEntry.create({data:{attemptId:attempt.id,description:'bad',occurredOn:new Date('2026-08-15')}});await tx.journalLine.create({data:{entryId:entry.id,attemptId:attempt.id,attemptAccountId:account.id,debitCents:100}});})).rejects.toThrow();
    expect(await prisma.journalEntry.count({where:{attemptId:attempt.id}})).toBe(0);
  });
});
