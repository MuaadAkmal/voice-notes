import { expect, it } from 'vitest';
import { transcriptionError } from '../../src/shared/transcription-errors';

const http = (status: number, body = '') =>
  transcriptionError({ kind: 'http', status, body });

it('maps transport failures', () => {
  expect(transcriptionError({ kind: 'network' })).toBe(
    "Can't reach the server",
  );
  expect(transcriptionError({ kind: 'timeout' })).toBe('Timed out');
  expect(transcriptionError({ kind: 'bad-response' })).toBe(
    'Unexpected response from the server',
  );
});

it('maps well-known statuses', () => {
  expect(http(401)).toBe('API key rejected');
  expect(http(403)).toBe('API key rejected');
  expect(http(404)).toBe('URL or model not found');
  expect(http(413)).toBe('Recording too long for the server');
  expect(http(429)).toBe('Rate limited, try again later');
});

it('quotes the server message for other errors', () => {
  expect(http(500, '{"error":{"message":"CUDA out of memory"}}')).toBe(
    'Server error 500: CUDA out of memory',
  );
  expect(http(400, '{"message":"bad"}')).toBe('Server error 400: bad');
  expect(http(422, '{"detail":"Field required"}')).toBe(
    'Server error 422: Field required',
  );
  expect(http(500, '{"error":"boom"}')).toBe('Server error 500: boom');
  expect(http(502, 'x'.repeat(300))).toBe(
    `Server error 502: ${'x'.repeat(200)}`,
  );
  expect(http(503, '')).toBe('Server error 503');
});

it('falls back to the raw body when detail is not a string', () => {
  const body = '{"detail":[{"msg":"Field required"}]}';
  expect(http(422, body)).toBe(`Server error 422: ${body}`);
});
