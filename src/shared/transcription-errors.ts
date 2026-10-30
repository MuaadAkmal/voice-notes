export type TranscriptionFailure =
  | { kind: 'network' }
  | { kind: 'timeout' }
  | { kind: 'bad-response' }
  | { kind: 'http'; status: number; body: string }
  | { kind: 'signed-out' }
  | { kind: 'quota'; resetsAt: string }
  | { kind: 'too-large' }
  | { kind: 'provider-failed' };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The server's own explanation: the first string among the usual JSON error fields, else the raw body. */
function serverMessage(body: string): string {
  try {
    const json: unknown = JSON.parse(body);
    if (json && typeof json === 'object') {
      const o = json as Record<string, unknown>;
      const err = o.error as Record<string, unknown> | undefined;
      const candidates = [
        err && typeof err === 'object' ? err.message : undefined,
        o.message,
        o.detail,
        o.error,
      ];
      const found = candidates.find(
        (c): c is string => typeof c === 'string' && c.trim() !== '',
      );
      if (found) return found.trim().slice(0, 200);
    }
  } catch {
    // not JSON: use the body as-is
  }
  return body.trim().slice(0, 200);
}

/** One plain sentence per failure, shown on the note row and the Transcription page. */
export function transcriptionError(f: TranscriptionFailure): string {
  switch (f.kind) {
    case 'network':
      return "Can't reach the server";
    case 'timeout':
      return 'Timed out';
    case 'bad-response':
      return 'Unexpected response from the server';
    case 'signed-out':
      return 'Sign in to use Cloud';
    case 'quota': {
      const d = new Date(f.resetsAt);
      return Number.isNaN(d.getTime())
        ? 'Free minutes used'
        : `Free minutes used · resets ${d.getDate()} ${MONTHS[d.getMonth()]}`;
    }
    case 'too-large':
      return 'Recording too long for Cloud';
    case 'provider-failed':
      return 'Cloud transcription failed, try again later';
    case 'http': {
      if (f.status === 401 || f.status === 403) return 'API key rejected';
      if (f.status === 404) return 'URL or model not found';
      if (f.status === 413) return 'Recording too long for the server';
      if (f.status === 429) return 'Rate limited, try again later';
      const message = serverMessage(f.body);
      return message
        ? `Server error ${f.status}: ${message}`
        : `Server error ${f.status}`;
    }
  }
}
