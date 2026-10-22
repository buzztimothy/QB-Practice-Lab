import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

export const previewReleaseLockKey = 6982806162030449104n;
const blocked = () => new Error('PREVIEW_RELEASE_COORDINATION_BLOCKED');

/**
 * The interactive transaction pins the advisory lock/unlock to one connection.
 * A separately committed fence survives loss of that connection/process while
 * a child or already-sent provider request is still running. Only successful,
 * fully awaited work can release it. Failure never clears or expires the fence.
 * All mutating operator paths must adopt this helper before recovery is enabled.
 */
export async function withPreviewReleaseLock<T>(database:PrismaClient, databaseUrl:string, operation:'preflight'|'recovery'|'deployment', work:()=>Promise<T>, timeoutMs=600_000):Promise<T> {
  const lockClient = new PrismaClient({datasources:{db:{url:databaseUrl}}});
  try {
    return await lockClient.$transaction(async tx => {
      const [lock] = await tx.$queryRaw<{locked:boolean;pid:number}[]>`SELECT pg_try_advisory_lock(${previewReleaseLockKey}) AS locked,pg_backend_pid() AS pid`;
      if (!lock.locked) throw blocked();
      const unlock = async () => {
        const [released] = await tx.$queryRaw<{unlocked:boolean;pid:number}[]>`SELECT pg_advisory_unlock(${previewReleaseLockKey}) AS unlocked,pg_backend_pid() AS pid`;
        if (!released.unlocked || released.pid !== lock.pid) throw blocked();
      };
      try {
        const [migration] = await database.$queryRaw<{applied:boolean}[]>`SELECT count(*)=1 AND bool_and(finished_at IS NOT NULL AND rolled_back_at IS NULL) AS applied FROM _prisma_migrations WHERE migration_name='202610220001_preview_release_fence'`;
        if (!migration.applied) throw blocked();
        // Missing migration, missing singleton, or an abandoned operation blocks.
        const [fence] = await database.$queryRaw<{held:boolean}[]>`SELECT held FROM preview_release_fence WHERE id='preview'`;
        if (!fence || fence.held) throw blocked();
        const owner = randomUUID();
        if (operation !== 'preflight') {
          const changed = await database.$executeRaw`UPDATE preview_release_fence SET held=true,owner=${owner}::uuid,operation=${operation},acquired_at=clock_timestamp(),released_at=NULL WHERE id='preview' AND NOT held`;
          if (changed !== 1) throw blocked();
        }
        const result = await work();
        // A timed-out/disconnected transaction cannot authorize fence release.
        const [still] = await tx.$queryRaw<{pid:number}[]>`SELECT pg_backend_pid() AS pid`;
        if (still.pid !== lock.pid) throw blocked();
        if (operation !== 'preflight') {
          const changed = await database.$executeRaw`UPDATE preview_release_fence SET held=false,released_at=clock_timestamp() WHERE id='preview' AND held AND owner=${owner}::uuid`;
          if (changed !== 1) throw blocked();
        }
        return result;
      } finally {
        await unlock();
      }
    },{timeout:timeoutMs});
  } finally {
    // A transaction timeout rolls back SQL but does not release a session lock.
    // Close this dedicated client's session even when tx-based unlock is invalid.
    await lockClient.$disconnect();
  }
}
