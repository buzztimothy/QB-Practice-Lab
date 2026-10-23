import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { assertDisposableTestDatabase } from '../scripts/database-target-guard.js';
import { previewReleaseLockKey, withPreviewReleaseLock } from '../scripts/preview-release-lock.js';

const url=process.env.DATABASE_URL;
if(url)assertDisposableTestDatabase(url,process.env.DATABASE_LIFECYCLE_MARKER);
const db=url?describe:describe.skip;
const first=new PrismaClient(),second=new PrismaClient();
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return{promise,resolve};};
db('durable Preview release coordination on separate connections',()=>{
  // Test-only reconciliation, after the simulated work has finished. Never in operators.
  beforeEach(async()=>{await first.$executeRaw`UPDATE preview_release_fence SET held=false WHERE id='preview'`;});
  afterAll(async()=>{await first.$disconnect();await second.$disconnect();});
  it('contends with the exact session lock used by the previous deployment script',async()=>{
    await second.$transaction(async tx=>{
      const [row]=await tx.$queryRaw<{locked:boolean}[]>`SELECT pg_try_advisory_lock(6982806162030449104) AS locked`;
      expect(row.locked).toBe(true);
      try {
        await expect(withPreviewReleaseLock(first,url!,'recovery',async()=>{throw new Error('must not run');})).rejects.toThrow('PREVIEW_RELEASE_COORDINATION_BLOCKED');
      } finally {
        const [released]=await tx.$queryRaw<{unlocked:boolean}[]>`SELECT pg_advisory_unlock(6982806162030449104) AS unlocked`;
        expect(released.unlocked).toBe(true);
      }
    });
  });
  it('rejects missing durable coordination metadata before invoking any operation',async()=>{
    await first.$executeRaw`DELETE FROM preview_release_fence WHERE id='preview'`;
    try {
      let called=false;
      await expect(withPreviewReleaseLock(second,url!,'deployment',async()=>{called=true;})).rejects.toThrow('PREVIEW_RELEASE_COORDINATION_BLOCKED');
      expect(called).toBe(false);
    } finally {await first.$executeRaw`INSERT INTO preview_release_fence(id) VALUES ('preview')`;}
  });
  it.each([['recovery','deployment'],['deployment','recovery']] as const)('rejects competing %s / %s and releases only after work completion',async(owner,competitor)=>{
    const entered=deferred(),finish=deferred();
    const running=withPreviewReleaseLock(first,url!,owner,async()=>{entered.resolve();await finish.promise;});
    await entered.promise;
    try {
      let called=false;
      await expect(withPreviewReleaseLock(second,url!,competitor,async()=>{called=true;})).rejects.toThrow();
      expect(called).toBe(false);
      const [fence]=await second.$queryRaw<{held:boolean}[]>`SELECT held FROM preview_release_fence`;
      expect(fence.held).toBe(true);
      const [locks]=await second.$queryRaw<{count:bigint}[]>`SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND granted AND ((classid::bigint<<32)|objid::bigint)=${previewReleaseLockKey}`;
      expect(locks.count).toBe(1n);
    } finally {finish.resolve();await running;}
    await expect(withPreviewReleaseLock(second,url!,competitor,async()=>{})).resolves.toBeUndefined();
  });
  it('preflight creates no durable claim and a process/work failure leaves a non-expiring fence',async()=>{
    const before=await first.$queryRaw`SELECT row_to_json(f) FROM preview_release_fence f`;
    await withPreviewReleaseLock(first,url!,'preflight',async()=>{});
    expect(await first.$queryRaw`SELECT row_to_json(f) FROM preview_release_fence f`).toEqual(before);
    await expect(withPreviewReleaseLock(first,url!,'recovery',async()=>{throw new Error('simulated process failure');})).rejects.toThrow();
    await expect(withPreviewReleaseLock(second,url!,'deployment',async()=>{throw new Error('must not run');})).rejects.toThrow('PREVIEW_RELEASE_COORDINATION_BLOCKED');
    expect((await first.$queryRaw<{held:boolean}[]>`SELECT held FROM preview_release_fence`)[0].held).toBe(true);
  });
  it('connection termination cannot release durable coordination while simulated provider work is in flight',async()=>{
    const entered=deferred(),finish=deferred();
    const running=withPreviewReleaseLock(first,url!,'recovery',async()=>{entered.resolve();await finish.promise;}).then(()=>false,()=>true);
    await entered.promise;
    try {
      const [holder]=await second.$queryRaw<{pid:number}[]>`SELECT pid FROM pg_locks WHERE locktype='advisory' AND granted AND ((classid::bigint<<32)|objid::bigint)=${previewReleaseLockKey}`;
      await second.$queryRaw`SELECT pg_terminate_backend(${holder.pid}::int)`;
      await expect(withPreviewReleaseLock(second,url!,'deployment',async()=>{throw new Error('must not run');})).rejects.toThrow('PREVIEW_RELEASE_COORDINATION_BLOCKED');
    } finally {finish.resolve();}
    expect(await running).toBe(true);
    expect((await second.$queryRaw<{held:boolean}[]>`SELECT held FROM preview_release_fence`)[0].held).toBe(true);
  });
  it('transaction timeout does not clear the fence even after delayed work resolves',async()=>{
    await expect(withPreviewReleaseLock(first,url!,'deployment',async()=>{await new Promise(resolve=>setTimeout(resolve,350));},100)).rejects.toThrow();
    await expect(withPreviewReleaseLock(second,url!,'recovery',async()=>{throw new Error('must not run');})).rejects.toThrow('PREVIEW_RELEASE_COORDINATION_BLOCKED');
    expect((await second.$queryRaw<{held:boolean}[]>`SELECT held FROM preview_release_fence`)[0].held).toBe(true);
    const [locks]=await second.$queryRaw<{count:bigint}[]>`SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND granted AND ((classid::bigint<<32)|objid::bigint)=${previewReleaseLockKey}`;
    expect(locks.count).toBe(0n);
  });
});
