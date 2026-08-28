import { createHash } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import type { StudentCommandSession } from '../../packages/accounting-domain/src/suncoast-commands.js';
import type { AttemptRecord } from './application.js';

export const canonicalLabId = 'suncoast-lab-1';
export const canonicalLabVersion = 'SUNCOAST-L1-2026.08-D000.1';

export interface StoredAttempt {
  readonly record: AttemptRecord;
  readonly persistenceVersion: number;
}

export interface StudentAttemptRepository {
  listForStudent(studentId: string): Promise<readonly StoredAttempt[]>;
  findOwned(attemptId: string, studentId: string): Promise<StoredAttempt | null>;
  create(record: AttemptRecord): Promise<StoredAttempt>;
  save(value: StoredAttempt): Promise<StoredAttempt | null>;
  reset(previous: StoredAttempt, next: AttemptRecord): Promise<StoredAttempt | null>;
  readiness(): Promise<boolean>;
}

const clone = <T>(value: T): T => structuredClone(value);

export class InMemoryStudentAttemptRepository implements StudentAttemptRepository {
  private readonly values = new Map<string, StoredAttempt>();
  async listForStudent(studentId: string) { return [...this.values.values()].filter(item => item.record.session.studentId === studentId).sort((a,b) => a.record.session.coaching.generation-b.record.session.coaching.generation).map(clone); }
  async findOwned(attemptId: string, studentId: string) { const value=this.values.get(attemptId); return value?.record.session.studentId===studentId?clone(value):null; }
  async create(record: AttemptRecord) { if(this.values.has(record.session.attemptId)) throw new Error('Attempt already exists'); const value={record:clone(record),persistenceVersion:0};this.values.set(record.session.attemptId,value);return clone(value); }
  async save(value: StoredAttempt) { const current=this.values.get(value.record.session.attemptId);if(!current||current.persistenceVersion!==value.persistenceVersion)return null;const saved={record:clone(value.record),persistenceVersion:value.persistenceVersion+1};this.values.set(value.record.session.attemptId,saved);return clone(saved); }
  async reset(previous: StoredAttempt, next: AttemptRecord) { const current=this.values.get(previous.record.session.attemptId);if(!current||current.persistenceVersion!==previous.persistenceVersion||this.values.has(next.session.attemptId))return null;this.values.set(previous.record.session.attemptId,{record:clone(previous.record),persistenceVersion:previous.persistenceVersion+1});const created={record:clone(next),persistenceVersion:0};this.values.set(next.session.attemptId,created);return clone(created); }
  async readiness(){return true;}
}

type JsonObject = Record<string, unknown>;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const object = (value: Prisma.JsonValue) => value as JsonObject;

function split(record: AttemptRecord) {
  const session=record.session;
  const coaching=session.coaching;
  const interaction=coaching.interaction;
  const evidence=interaction.evidence;
  const p002=evidence.p002;
  const evidenceOnly={...evidence} as Record<string,unknown>;delete evidenceOnly.p002;
  const interactionOnly={...interaction} as Record<string,unknown>;delete interactionOnly.evidence;
  const coachingOnly={...coaching} as Record<string,unknown>;delete coachingOnly.interaction;
  return {
    accountingState: json({p002,excludedBankActivities:session.excludedBankActivities}),
    evidenceState: json(evidenceOnly),
    interactionState: json(interactionOnly),
    coachingState: json(coachingOnly),
  };
}

function join(row: {
  id:string;studentId:string;status:string;revision:number;accountingState:Prisma.JsonValue;evidenceState:Prisma.JsonValue;interactionState:Prisma.JsonValue;coachingState:Prisma.JsonValue;assessmentState:Prisma.JsonValue|null;meetingState:Prisma.JsonValue|null;reportState:Prisma.JsonValue|null;
}, receipts: readonly {idempotencyKey:string;fingerprint:string;commandId:string;revision:number}[]): AttemptRecord {
  const accounting=object(row.accountingState);
  const evidence={...object(row.evidenceState),p002:accounting.p002};
  const interaction={...object(row.interactionState),evidence};
  const coaching={...object(row.coachingState),interaction};
  const session={attemptId:row.id,studentId:row.studentId,revision:row.revision,coaching,receipts,excludedBankActivities:accounting.excludedBankActivities??[]} as unknown as StudentCommandSession;
  return {session,status:row.status as AttemptRecord['status'],assessment:row.assessmentState as unknown as AttemptRecord['assessment'],meeting:row.meetingState as unknown as AttemptRecord['meeting'],report:row.reportState as unknown as AttemptRecord['report']};
}

const contentHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const snapshotInputs=(record:AttemptRecord):{kind:string;payload:object}[]=>{
  const values:{kind:string;payload:object}[]=[];
  if(record.assessment)values.push({kind:'ASSESSMENT',payload:record.assessment});
  if(record.meeting)values.push({kind:'MEETING',payload:record.meeting});
  if(record.report)values.push({kind:'REPORT',payload:record.report});
  return values;
};

export class PrismaStudentAttemptRepository implements StudentAttemptRepository {
  constructor(private readonly prisma:PrismaClient){}

  private async stored(row: Awaited<ReturnType<PrismaClient['runtimeAttempt']['findUnique']>>) {
    if(!row)return null;
    const receipts=await this.prisma.runtimeIdempotency.findMany({where:{attemptId:row.id},orderBy:{revision:'asc'},select:{idempotencyKey:true,fingerprint:true,commandId:true,revision:true}});
    return {record:join(row,receipts),persistenceVersion:row.persistenceVersion};
  }

  async listForStudent(studentId:string){
    const rows=await this.prisma.runtimeAttempt.findMany({where:{studentId,labVersion:canonicalLabVersion},orderBy:{generation:'asc'}});
    return Promise.all(rows.map(row=>this.stored(row) as Promise<StoredAttempt>));
  }
  async findOwned(attemptId:string,studentId:string){return this.stored(await this.prisma.runtimeAttempt.findFirst({where:{id:attemptId,studentId,labVersion:canonicalLabVersion}}));}
  async create(record:AttemptRecord){
    const parts=split(record);
    let row;
    try{row=await this.prisma.$transaction(async tx=>{
      await tx.runtimeStudent.upsert({where:{id:record.session.studentId},create:{id:record.session.studentId,displayName:record.session.studentId},update:{}});
      const created=await tx.runtimeAttempt.create({data:{id:record.session.attemptId,studentId:record.session.studentId,labVersion:canonicalLabVersion,generation:record.session.coaching.generation,status:record.status,revision:record.session.revision,...parts,assessmentState:record.assessment?json(record.assessment):Prisma.DbNull,meetingState:record.meeting?json(record.meeting):Prisma.DbNull,reportState:record.report?json(record.report):Prisma.DbNull}});
      await this.append(tx,record);
      return created;
    });}catch(error){if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2002'){const existing=await this.findOwned(record.session.attemptId,record.session.studentId);if(existing)return existing;}throw error;}
    return {record:clone(record),persistenceVersion:row.persistenceVersion};
  }
  async save(value:StoredAttempt){
    const record=value.record,parts=split(record);
    const updated=await this.prisma.$transaction(async tx=>{
      const result=await tx.runtimeAttempt.updateMany({where:{id:record.session.attemptId,studentId:record.session.studentId,persistenceVersion:value.persistenceVersion},data:{status:record.status,revision:record.session.revision,persistenceVersion:{increment:1},...parts,assessmentState:record.assessment?json(record.assessment):Prisma.DbNull,meetingState:record.meeting?json(record.meeting):Prisma.DbNull,reportState:record.report?json(record.report):Prisma.DbNull}});
      if(result.count!==1)return null;
      await tx.runtimeIdempotency.createMany({data:(record.session.receipts as readonly {idempotencyKey:string;fingerprint:string;commandId:string;revision:number}[]).map(item=>({attemptId:record.session.attemptId,...item})),skipDuplicates:true});
      await this.append(tx,record);
      return tx.runtimeAttempt.findUniqueOrThrow({where:{id:record.session.attemptId}});
    });
    return updated?{record:clone(record),persistenceVersion:updated.persistenceVersion}:null;
  }
  async reset(previous:StoredAttempt,next:AttemptRecord){
    const parts=split(next);
    const result=await this.prisma.$transaction(async tx=>{
      const old=await tx.runtimeAttempt.updateMany({where:{id:previous.record.session.attemptId,studentId:previous.record.session.studentId,persistenceVersion:previous.persistenceVersion},data:{status:previous.record.status,persistenceVersion:{increment:1}}});
      if(old.count!==1)return null;
      return tx.runtimeAttempt.create({data:{id:next.session.attemptId,studentId:next.session.studentId,labVersion:canonicalLabVersion,generation:next.session.coaching.generation,status:next.status,revision:next.session.revision,...parts}});
    });
    return result?{record:clone(next),persistenceVersion:result.persistenceVersion}:null;
  }
  async readiness(){try{const bootstrap=await this.prisma.canonicalLabBootstrap.findUnique({where:{labId_version:{labId:canonicalLabId,version:canonicalLabVersion}}});await this.prisma.$queryRaw`SELECT 1`;return !!bootstrap;}catch{return false;}}
  private async append(tx:Prisma.TransactionClient,record:AttemptRecord){for(const item of snapshotInputs(record)){const hash=contentHash(item.payload);const count=await tx.runtimeSnapshot.count({where:{attemptId:record.session.attemptId,kind:item.kind}});await tx.runtimeSnapshot.createMany({data:[{attemptId:record.session.attemptId,kind:item.kind,sequence:count+1,payload:json(item.payload),contentHash:hash}],skipDuplicates:true});}}
}

export async function bootstrapCanonicalLab(prisma:PrismaClient){
  const manifest={labId:canonicalLabId,labVersion:canonicalLabVersion,content:['P001_CLEAN_MASTER','P001A_PAYROLL','P002_SCENARIOS','P003_EVIDENCE','P004_MICHAEL','P005_COACHING','P006_RUBRIC','P008_REPORT']};
  const hash=contentHash(manifest);
  const existing=await prisma.canonicalLabBootstrap.findUnique({where:{labId_version:{labId:canonicalLabId,version:canonicalLabVersion}}});
  if(existing&&existing.contentHash!==hash)throw new Error('Canonical bootstrap conflict');
  if(!existing)await prisma.canonicalLabBootstrap.create({data:{labId:canonicalLabId,version:canonicalLabVersion,contentHash:hash,contentManifest:json(manifest)}});
  return {labId:canonicalLabId,version:canonicalLabVersion,contentHash:hash};
}
