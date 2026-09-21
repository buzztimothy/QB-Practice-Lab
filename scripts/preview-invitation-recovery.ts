import { validRecoveryTarget } from '../apps/web/invitation-recovery.js';
import { deactivationConfiguration } from './preview-deactivation.js';

export const recoveryConfiguration = deactivationConfiguration;

export function recoveryTarget(args: readonly string[]) {
  const input = args[0] === '--' ? args.slice(1) : args;
  if (input.length !== 6) throw new Error('Invalid recovery confirmation');
  const values = new Map<string, string>();
  for (let index = 0; index < input.length; index += 2) {
    const key = input[index], value = input[index + 1];
    if (!['--student-id', '--confirm', '--old-invitation-id'].includes(key) || values.has(key)) throw new Error('Invalid recovery confirmation');
    values.set(key, value);
  }
  const target = { studentId:values.get('--student-id') ?? '', oldInvitationId:values.get('--old-invitation-id') ?? '' };
  if (!validRecoveryTarget(target) || values.get('--confirm') !== target.studentId) throw new Error('Invalid recovery confirmation');
  return target;
}
