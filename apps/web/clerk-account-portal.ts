export const previewApplicationOrigin = 'https://preview.clientpracticelabs.com';

// Trusted configuration only. Never accept a request URL, invitation ticket, or
// caller-provided return target here. Clerk owns invitation/signup completion.
export function clerkAccountPortalUrl(signInUrl: string | undefined, appOrigin: string, flow: 'sign-in' | 'sign-up') {
  if (appOrigin !== previewApplicationOrigin) throw new Error('Invalid Preview origin');
  if (!signInUrl || signInUrl !== signInUrl.trim()) throw new Error('Clerk Account Portal configuration required');
  let portal: URL;
  try { portal = new URL(signInUrl); } catch { throw new Error('Invalid Clerk Account Portal configuration'); }
  if (portal.protocol !== 'https:' || portal.username || portal.password || portal.pathname !== '/sign-in' || portal.search || portal.hash || portal.origin === appOrigin) throw new Error('Invalid Clerk Account Portal configuration');
  portal.pathname = `/${flow}`;
  portal.searchParams.set('redirect_url', `${appOrigin}/auth/callback`);
  return portal.toString();
}
