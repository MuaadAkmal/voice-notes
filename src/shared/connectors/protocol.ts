// What the `connectors` Edge Function and the app say to each other.

export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

/** Which connectors the account has; `google` is the Google Calendar connection. */
export type ConnectorsStatus = { google: { email: string; connectedAt: number } | null };

/** A short-lived Google access token; `expiresIn` is in seconds. */
export type TokenResponse = { accessToken: string; expiresIn: number };

export type ConnectorsError = 'not-connected' | 'revoked' | 'misconfigured';
