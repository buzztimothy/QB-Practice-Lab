import type { ClerkClient } from '@clerk/backend';
import { describe, expect, it, vi } from 'vitest';
import { recoveryConfiguration, recoveryTarget } from '../scripts/preview-invitation-recovery.js';
import { ClerkInvitationRecoveryProvider } from '../apps/web/invitation-recovery-provider.js';

describe('invitation recovery operator and provider boundary', () => {
  const args = ['--student-id', 'student-a', '--confirm', 'student-a', '--old-invitation-id', 'inv_old'];
  it('requires exact single-student and old-invitation confirmation', () => {
    expect(recoveryTarget(['--', ...args])).toEqual({ studentId:'student-a', oldInvitationId:'inv_old' });
    for (const bad of [[], args.slice(0,4), [...args,'--bulk','true'], ['--unknown',...args.slice(1)], ['--student-id','student-a','--confirm','student-b',...args.slice(4)], ['--student-id','*','--confirm','*',...args.slice(4)], ['--student-id','all','--confirm','all',...args.slice(4)], [...args.slice(0,4),'--old-invitation-id','https://private-ticket'], ['--student-id','a','--student-id','a',...args.slice(4)]]) expect(() => recoveryTarget(bad)).toThrow('Invalid recovery confirmation');
    expect(() => recoveryConfiguration({})).toThrow();
  });
  it('uses complete bounded inventories and opaque metadata without returning provider secrets', async () => {
    const row={id:'inv_old',emailAddress:'A@Example.Test',status:'pending',publicMetadata:{},url:'private-url'};
    const list=vi.fn().mockResolvedValueOnce({ totalCount:1,data:[row] }).mockResolvedValueOnce({ totalCount:0,data:[] });
    const create=vi.fn().mockResolvedValue({ ...row,id:'inv_new',publicMetadata:{recoveryOperationId:'opaque-operation'} });
    const revoke=vi.fn().mockResolvedValue({url:'private-url'});
    const clerk={invitations:{getInvitationList:list,createInvitation:create,revokeInvitation:revoke},users:{getUserList:vi.fn().mockResolvedValue({totalCount:0,data:[]})}} as unknown as ClerkClient;
    const provider=new ClerkInvitationRecoveryProvider(clerk);
    const result=await provider.inspect('a@example.test');
    expect(result).toEqual({users:0,invitations:[{id:'inv_old',email:'a@example.test',status:'pending',recoveryId:undefined}]});
    expect(JSON.stringify(result)).not.toContain('private-url');
    expect(await provider.create('a@example.test','https://accounts.example/sign-up','opaque-operation')).toBe('inv_new');
    expect(create).toHaveBeenCalledExactlyOnceWith({emailAddress:'a@example.test',notify:true,ignoreExisting:false,redirectUrl:'https://accounts.example/sign-up',publicMetadata:{recoveryOperationId:'opaque-operation'}});
    await provider.revoke('inv_old'); expect(revoke).toHaveBeenCalledExactlyOnceWith('inv_old');
    list.mockResolvedValue({totalCount:101,data:[]});
    await expect(provider.inspect('a@example.test')).rejects.toThrow('Incomplete provider inventory');
  });
});
