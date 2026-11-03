import type { DownloadResponse, FileKind, PullRequest, PullResponse, PushRequest, PushResponse } from "@wire/sync/protocol";

export class NotSignedIn extends Error {}
export class Offline extends Error {}
export class AuthExpired extends Error {}
export class Rejected extends Error {}
export class ServerError extends Error {}

type Deps = { base: string; apikey: string; token: () => Promise<string | null>; fetch?: typeof fetch };

/** The `sync` Edge Function over HTTP, with the signed-in user's token on every call. */
export class SyncClient {
  constructor(private readonly d: Deps) {}

  pull(req: PullRequest): Promise<PullResponse> {
    return this.post("pull", req);
  }

  push(req: PushRequest): Promise<PushResponse> {
    return this.post("push", req);
  }

  download(kind: FileKind, name: string): Promise<DownloadResponse> {
    return this.post("files/download", { kind, name });
  }

  private async post<T>(route: string, body: unknown): Promise<T> {
    const token = await this.d.token();
    if (!token) throw new NotSignedIn();
    let res: Response;
    try {
      res = await (this.d.fetch ?? fetch)(`${this.d.base}/${route}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, apikey: this.d.apikey, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Offline();
    }
    if (res.status === 401) throw new AuthExpired();
    // Over the server's 1 MB: the same request can never succeed (batches are kept under it).
    if (res.status === 413) throw new Rejected("Too large to save");
    if (res.status === 400) {
      const msg = await res.json().then((b: { error?: string }) => b.error, () => undefined);
      throw new Rejected(msg ?? "Rejected");
    }
    if (!res.ok) throw new ServerError(`HTTP ${res.status}`);
    return (await res.json()) as T;
  }
}
