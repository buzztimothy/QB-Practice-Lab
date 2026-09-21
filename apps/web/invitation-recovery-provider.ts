import type { ClerkClient } from '@clerk/backend';

export interface RecoveryProviderInvitation {
  id: string;
  email: string;
  status: string;
  recoveryId?: string;
}
export interface RecoveryProviderState {
  users: number;
  invitations: readonly RecoveryProviderInvitation[];
}
export interface InvitationRecoveryProvider {
  inspect(email: string): Promise<RecoveryProviderState>;
  revoke(id: string): Promise<void>;
  create(email: string, redirectUrl: string, recoveryId: string): Promise<string>;
}

export class ClerkInvitationRecoveryProvider implements InvitationRecoveryProvider {
  constructor(private readonly clerk: Pick<ClerkClient, 'invitations' | 'users'>) {}

  async inspect(email: string): Promise<RecoveryProviderState> {
    const users = await this.clerk.users.getUserList({ emailAddress:[email], limit:1 });
    const rows = new Map<string, RecoveryProviderInvitation>();
    // Default includes all non-revoked states; query revoked separately. Refuse
    // oversized results instead of making decisions from an incomplete page.
    for (const status of [undefined, 'revoked'] as const) {
      const page = await this.clerk.invitations.getInvitationList({ query:email, status, limit:100 });
      if (page.totalCount > page.data.length) throw new Error('Incomplete provider inventory');
      for (const item of page.data) {
        const normalized = item.emailAddress.trim().toLowerCase();
        if (normalized !== email) continue;
        if (!/^inv_[A-Za-z0-9]+$/.test(item.id)) throw new Error('Invalid provider identifier');
        const correlation = item.publicMetadata?.recoveryOperationId;
        rows.set(item.id, { id:item.id, email:normalized, status:item.status, recoveryId:typeof correlation === 'string' ? correlation : undefined });
      }
    }
    return { users:users.totalCount, invitations:[...rows.values()] };
  }

  async revoke(id: string) { await this.clerk.invitations.revokeInvitation(id); }

  async create(email: string, redirectUrl: string, recoveryId: string) {
    const result = await this.clerk.invitations.createInvitation({ emailAddress:email, notify:true, ignoreExisting:false, redirectUrl, publicMetadata:{ recoveryOperationId:recoveryId } });
    if (!/^inv_[A-Za-z0-9]+$/.test(result.id) || result.emailAddress.trim().toLowerCase() !== email || result.status !== 'pending' || result.publicMetadata?.recoveryOperationId !== recoveryId) throw new Error('Unconfirmed provider creation');
    return result.id;
  }
}
