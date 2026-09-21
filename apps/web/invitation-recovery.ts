import type { InvitationRecovery, InvitationRecoveryFailure, InvitationRecoveryPhase, Prisma, PrismaClient } from '@prisma/client';
import { lockInvitationStudent } from './invitation-recovery-lock.js';
import type { InvitationRecoveryProvider } from './invitation-recovery-provider.js';

class RecoveryGuardError extends Error {}
const reject = () => { throw new RecoveryGuardError('Recovery precondition failed'); };
export interface RecoveryTarget { studentId: string; oldInvitationId: string }
export function validRecoveryTarget(target: RecoveryTarget) {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(target.studentId) && !/^(all|everyone)$/i.test(target.studentId) && /^inv_[A-Za-z0-9]{1,128}$/.test(target.oldInvitationId);
}
const bounded = (row: InvitationRecovery) => ({
  studentId:row.studentId, operationId:row.id, oldInvitationId:row.oldProviderInvitationId,
  replacementInvitationId:row.replacementProviderInvitationId, phase:row.phase,
  status:row.status, failure:row.failure, success:row.status === 'COMPLETED',
});

export class InvitationRecoveryService {
  constructor(private readonly prisma: PrismaClient, private readonly provider: InvitationRecoveryProvider, private readonly redirectUrl: string) {}

  private async prerequisites(tx: Prisma.TransactionClient, target: RecoveryTarget) {
    const student = await tx.runtimeStudent.findUnique({ where:{ id:target.studentId } });
    if (!student || student.status !== 'INVITED' || !student.email || student.email !== student.email.trim().toLowerCase()) return reject();
    const invitation = await tx.previewInvitation.findUnique({ where:{ provider_email:{ provider:'clerk', email:student.email } } });
    if (!invitation || invitation.studentId !== student.id || invitation.status !== 'SENT' || invitation.providerInvitationId !== target.oldInvitationId || invitation.consumedAt || invitation.consumedSubject) return reject();
    if (await tx.externalIdentityLink.count({ where:{ studentId:student.id } }) ||
        await tx.studentSession.count({ where:{ studentId:student.id } }) ||
        await tx.runtimeAttempt.count({ where:{ studentId:student.id } }) ||
        await tx.studentAttempt.count({ where:{ studentId:student.id } })) return reject();
    return invitation;
  }

  private async claim(target: RecoveryTarget) {
    return this.prisma.$transaction(async tx => {
      await lockInvitationStudent(tx, target.studentId);
      const existing = await tx.invitationRecovery.findUnique({ where:{ provider_oldProviderInvitationId:{ provider:'clerk', oldProviderInvitationId:target.oldInvitationId } } });
      if (existing && existing.studentId !== target.studentId) return reject();
      if (existing?.status === 'COMPLETED') return existing;
      const invitation = await this.prerequisites(tx, target);
      if (existing) {
        if (existing.invitationId !== invitation.id || existing.email !== invitation.email) return reject();
        return existing;
      }
      if (await tx.invitationRecovery.count({ where:{ invitationId:invitation.id, status:{ not:'COMPLETED' } } })) return reject();
      return tx.invitationRecovery.create({ data:{ studentId:target.studentId, email:invitation.email, provider:'clerk', invitationId:invitation.id, oldProviderInvitationId:target.oldInvitationId } });
    });
  }

  private async advance(row: InvitationRecovery, phase: InvitationRecoveryPhase, replacement?: string) {
    return this.prisma.$transaction(async tx => {
      await lockInvitationStudent(tx, row.studentId);
      const invitation = await this.prerequisites(tx, { studentId:row.studentId, oldInvitationId:row.oldProviderInvitationId });
      if (invitation.id !== row.invitationId || invitation.email !== row.email) return reject();
      const changed = await tx.invitationRecovery.updateMany({ where:{ id:row.id, phase:row.phase, status:{ not:'COMPLETED' } }, data:{ phase, status:'ACTIVE', failure:null, ...(replacement ? { replacementProviderInvitationId:replacement } : {}) } });
      return changed.count === 1;
    });
  }

  private async block(row: InvitationRecovery, failure: InvitationRecoveryFailure) {
    // A concurrent worker may already have advanced. Never overwrite its phase.
    await this.prisma.invitationRecovery.updateMany({ where:{ id:row.id, phase:row.phase, status:{ not:'COMPLETED' } }, data:{ status:'BLOCKED', failure } });
    return bounded(await this.prisma.invitationRecovery.findUniqueOrThrow({ where:{ id:row.id } }));
  }

  async recover(target: RecoveryTarget) {
    let row: InvitationRecovery | undefined;
    try {
      if (!validRecoveryTarget(target)) return reject();
      row = await this.claim(target);
      for (let step = 0; step < 12; step++) {
        row = await this.prisma.invitationRecovery.findUniqueOrThrow({ where:{ id:row.id } });
        if (row.status === 'COMPLETED') return bounded(row);
        let inventory;
        try { inventory = await this.provider.inspect(row.email); }
        catch { return await this.block(row, 'PROVIDER_UNAVAILABLE'); }
        const old = inventory.invitations.find(item => item.id === row!.oldProviderInvitationId);
        const replacements = inventory.invitations.filter(item => item.recoveryId === row!.id && item.id !== row!.oldProviderInvitationId);
        const unexpected = inventory.invitations.some(item => item.status === 'pending' && item.id !== old?.id && !replacements.some(candidate => candidate.id === item.id));
        if (inventory.users !== 0 || !old || old.email !== row.email || !['pending', 'revoked', 'expired'].includes(old.status) || inventory.invitations.some(item => !['pending', 'revoked', 'expired', 'accepted'].includes(item.status)) || unexpected || replacements.length > 1) return await this.block(row, 'PROVIDER_STATE_AMBIGUOUS');
        const replacement = replacements[0];
        if (replacement && (replacement.email !== row.email || replacement.status !== 'pending')) return await this.block(row, 'PROVIDER_STATE_AMBIGUOUS');
        if (row.phase === 'CLAIMED') {
          if (replacement) return await this.block(row, 'PROVIDER_STATE_AMBIGUOUS');
          if (old.status !== 'pending') { await this.advance(row, 'OLD_REVOKED'); continue; }
          if (await this.advance(row, 'OLD_REVOCATION_PENDING')) {
            // Only the worker which durably won the transition issues the call.
            try { await this.provider.revoke(old.id); }
            catch { row = await this.prisma.invitationRecovery.findUniqueOrThrow({ where:{ id:row.id } }); return await this.block(row, 'REVOCATION_UNCONFIRMED'); }
          }
          continue;
        }
        if (row.phase === 'OLD_REVOCATION_PENDING') {
          if (old.status === 'pending') return await this.block(row, 'REVOCATION_UNCONFIRMED');
          await this.advance(row, 'OLD_REVOKED'); continue;
        }
        if (old.status === 'pending') return await this.block(row, 'PROVIDER_STATE_AMBIGUOUS');
        if (row.phase === 'OLD_REVOKED') {
          if (replacement) return await this.block(row, 'PROVIDER_STATE_AMBIGUOUS');
          if (await this.advance(row, 'REPLACEMENT_CREATE_PENDING')) {
            let id: string;
            try { id = await this.provider.create(row.email, this.redirectUrl, row.id); }
            catch { row = await this.prisma.invitationRecovery.findUniqueOrThrow({ where:{ id:row.id } }); return await this.block(row, 'CREATION_UNCONFIRMED'); }
            if (!/^inv_[A-Za-z0-9]{1,128}$/.test(id) || id === row.oldProviderInvitationId) { row = await this.prisma.invitationRecovery.findUniqueOrThrow({ where:{ id:row.id } }); return await this.block(row, 'CREATION_UNCONFIRMED'); }
            const pending = { ...row, phase:'REPLACEMENT_CREATE_PENDING' as const };
            await this.advance(pending, 'REPLACEMENT_IDENTIFIED', id);
          }
          continue;
        }
        if (row.phase === 'REPLACEMENT_CREATE_PENDING') {
          // Zero candidates is not proof that an earlier timed-out create failed.
          if (!replacement) return await this.block(row, 'CREATION_UNCONFIRMED');
          await this.advance(row, 'REPLACEMENT_IDENTIFIED', replacement.id); continue;
        }
        if (!replacement || replacement.id !== row.replacementProviderInvitationId) return await this.block(row, 'PROVIDER_STATE_AMBIGUOUS');
        if (row.phase === 'REPLACEMENT_IDENTIFIED') { await this.advance(row, 'LOCAL_RECONCILIATION_PENDING'); continue; }
        if (row.phase === 'LOCAL_RECONCILIATION_PENDING') {
          const current = row;
          return await this.prisma.$transaction(async tx => {
            await lockInvitationStudent(tx, current.studentId);
            const fresh = await tx.invitationRecovery.findUniqueOrThrow({ where:{ id:current.id } });
            if (fresh.status === 'COMPLETED') return bounded(fresh);
            if (fresh.phase !== 'LOCAL_RECONCILIATION_PENDING' || fresh.replacementProviderInvitationId !== replacement.id) return reject();
            const invitation = await this.prerequisites(tx, target);
            if (invitation.id !== fresh.invitationId || invitation.email !== fresh.email) return reject();
            await tx.previewInvitation.update({ where:{ id:fresh.invitationId }, data:{ providerInvitationId:replacement.id } });
            return bounded(await tx.invitationRecovery.update({ where:{ id:fresh.id }, data:{ phase:'COMPLETED', status:'COMPLETED', failure:null, completedAt:new Date() } }));
          });
        }
      }
      return await this.block(row, 'PROVIDER_STATE_AMBIGUOUS');
    } catch (error) {
      const failure = error instanceof RecoveryGuardError ? 'PRECONDITION_FAILED' : 'LOCAL_PERSISTENCE_FAILED';
      if (row) {
        try {
          const fresh = await this.prisma.invitationRecovery.findUniqueOrThrow({ where:{ id:row.id } });
          if (fresh.status === 'COMPLETED') return bounded(fresh);
          return await this.block(fresh, failure);
        } catch { /* Intent remains durable even if the failure annotation cannot be saved. */ }
      }
      return { success:false, status:'BLOCKED' as const, failure };
    }
  }
}
