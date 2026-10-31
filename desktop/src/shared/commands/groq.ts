// Groq's OpenAI-compatible chat endpoint, asked for one JSON object. The key never leaves the function.

export type Chat = (system: string, user: string) => Promise<string>;

export class LlmFailed extends Error {}

async function modelIds(o: { apiKey: string; fetch: typeof fetch }): Promise<string[]> {
  const res = await o.fetch('https://api.groq.com/openai/v1/models', {
    headers: { authorization: `Bearer ${o.apiKey}` },
    signal: AbortSignal.timeout(5_000),
  });
  const body = (await res.json()) as { data?: { id?: unknown }[] };
  return (body.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string').sort();
}

export function groqChat(o: { apiKey: string; model: string; fetch: typeof fetch; timeoutMs?: number }): Chat {
  return async (system, user) => {
    let res: Response;
    try {
      res = await o.fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${o.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: o.model,
          temperature: 0,
          // gpt-oss reasons before it answers, and that counts against max_tokens: keep it short.
          max_tokens: 1500,
          ...(o.model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}),
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
        signal: AbortSignal.timeout(o.timeoutMs ?? 15_000),
      });
    } catch {
      throw new LlmFailed('Groq unreachable');
    }
    if (!res.ok) {
      // Only ever logged by the function. A 404 is a model Groq no longer serves: say which ones it does.
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      const models = res.status === 404 ? await modelIds(o).catch(() => []) : [];
      throw new LlmFailed(`Groq ${res.status} for model ${o.model}: ${detail}${models.length ? ` | available: ${models.join(', ')}` : ''}`);
    }
    const body = (await res.json().catch(() => null)) as { choices?: { message?: { content?: unknown } }[] } | null;
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new LlmFailed('Groq sent no content');
    return content;
  };
}
