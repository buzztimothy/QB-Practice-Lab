import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
const enabled = Boolean(process.env.DATABASE_URL);
const prisma = new PrismaClient();
describe.skipIf(!enabled)('PostgreSQL enforcement', () => {
  beforeAll(async()=>{ await prisma.$connect(); });
  afterAll(async()=>{ await prisma.$disconnect(); });
  it('rejects template mutation', async()=>{ await expect(prisma.$executeRawUnsafe(`UPDATE case_templates SET title='tampered' WHERE slug='architecture-proof'`)).rejects.toThrow(); });
  it('rejects an unbalanced transaction atomically', async()=>{
    const student=`db-${Date.now()}`;
    const attempt=await prisma.studentAttempt.create({data:{studentId:student,templateId:'00000000-0000-4000-8000-000000000001'}});
    const account=await prisma.attemptAccount.create({data:{attemptId:attempt.id,sourceTemplateAccountId:'00000000-0000-4000-8000-000000000101',code:'1000',name:'Cash',kind:'ASSET'}});
    await expect(prisma.$transaction(async tx=>{const entry=await tx.journalEntry.create({data:{attemptId:attempt.id,description:'bad',occurredOn:new Date('2026-08-15')}});await tx.journalLine.create({data:{entryId:entry.id,attemptId:attempt.id,attemptAccountId:account.id,debitCents:100}});})).rejects.toThrow();
    expect(await prisma.journalEntry.count({where:{attemptId:attempt.id}})).toBe(0);
  });
});
