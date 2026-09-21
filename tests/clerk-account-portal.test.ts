import { describe, expect, it } from 'vitest';
import { clerkAccountPortalUrl, previewApplicationOrigin } from '../apps/web/clerk-account-portal.js';

describe('Clerk hosted invitation completion', () => {
  it('targets hosted signup, with a fixed post-authentication callback', () => {
    const url = new URL(clerkAccountPortalUrl('https://accounts.example/sign-in', previewApplicationOrigin, 'sign-up'));
    expect(url.origin).toBe('https://accounts.example');
    expect(url.pathname).toBe('/sign-up');
    expect([...url.searchParams]).toEqual([['redirect_url', `${previewApplicationOrigin}/auth/callback`]]);
    expect(url.toString()).not.toMatch(/ticket|token|email|student/);
  });

  it('keeps returning users on hosted signin with the same callback', () => {
    const url = new URL(clerkAccountPortalUrl('https://accounts.example/sign-in', previewApplicationOrigin, 'sign-in'));
    expect(url.pathname).toBe('/sign-in');
    expect(url.searchParams.get('redirect_url')).toBe(`${previewApplicationOrigin}/auth/callback`);
  });

  it('fails closed on missing, unsafe or unsupported configuration without echoing inputs', () => {
    for (const value of [undefined, '', 'not-a-url', ' https://accounts.example/sign-in', 'http://accounts.example/sign-in', 'https://user:secret@accounts.example/sign-in', 'https://accounts.example/sign-up', 'https://accounts.example/sign-in?ticket=private', 'https://accounts.example/sign-in#private', `${previewApplicationOrigin}/sign-in`]) {
      expect(() => clerkAccountPortalUrl(value, previewApplicationOrigin, 'sign-up')).toThrow(/configuration/);
    }
    expect(() => clerkAccountPortalUrl('https://accounts.example/sign-in', 'https://attacker.example', 'sign-up')).toThrow('Invalid Preview origin');
  });
});
