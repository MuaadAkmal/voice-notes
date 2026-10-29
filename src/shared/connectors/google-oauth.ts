import type { TokenResponse } from './protocol';

// Google's OAuth token endpoints, with the client secret (server only). Fetch is injected so tests
// never reach Google.

/** Google no longer honours the refresh token (revoked, expired, or the password changed). */
export class InvalidGrant extends Error {}

export interface GoogleOAuth {
  exchange(code: string, redirectUri: string): Promise<{ refreshToken: string | null; scope: string; idToken: string | null }>;
  refresh(refreshToken: string): Promise<TokenResponse>;
  revoke(token: string): Promise<void>;
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

export function googleOAuth(d: { clientId: string; clientSecret: string; fetch: typeof fetch }): GoogleOAuth {
  const post = async (url: string, params: Record<string, string>) => {
    const res = await d.fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 400 && body.error === 'invalid_grant') throw new InvalidGrant('invalid_grant');
    if (!res.ok) throw new Error(`Google answered ${res.status}`);
    return body;
  };
  const client = { client_id: d.clientId, client_secret: d.clientSecret };
  return {
    async exchange(code, redirectUri) {
      const b = await post(TOKEN_URL, { grant_type: 'authorization_code', code, redirect_uri: redirectUri, ...client });
      return {
        refreshToken: typeof b.refresh_token === 'string' ? b.refresh_token : null,
        scope: typeof b.scope === 'string' ? b.scope : '',
        idToken: typeof b.id_token === 'string' ? b.id_token : null,
      };
    },
    async refresh(refreshToken) {
      const b = await post(TOKEN_URL, { grant_type: 'refresh_token', refresh_token: refreshToken, ...client });
      if (typeof b.access_token !== 'string') throw new Error('Google sent no access token');
      return { accessToken: b.access_token, expiresIn: typeof b.expires_in === 'number' ? b.expires_in : 3600 };
    },
    async revoke(token) {
      await post(REVOKE_URL, { token });
    },
  };
}

/** The `email` claim of an id_token that came straight from Google over TLS (so no signature check). */
export function emailFromIdToken(idToken: string): string | null {
  const payload = idToken.split('.')[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const email = (JSON.parse(json) as { email?: unknown }).email;
    return typeof email === 'string' ? email : null;
  } catch {
    return null;
  }
}
