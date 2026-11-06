import { ProviderFailed, periodOf } from './core';
import { CLONE_MAX_SECONDS, CLONE_MIN_SECONDS, STOCK_VOICES, type VoiceState } from './protocol';
import { FREE_PLAN, type AsrStore } from './store';
import { wavInfo } from './wav-info';

// The rules of cloning the user's own voice (paid plans only). One clone per account.

export class NeedsPaidPlan extends Error {}
export class NoConsent extends Error {}
export class BadSamples extends Error {}
/** No slot or quota for another clone right now (our limit, or ElevenLabs'). */
export class CloneUnavailableNow extends Error {}
/** Thrown by a VoiceApi when the provider refuses to make a clone (slots, quota, rejected audio). */
export class CloneRefused extends Error {}

export type CloneStore = {
  get(user: string): Promise<string | null>;
  /** Clones across all accounts. */
  count(): Promise<number>;
  /** Saves the account's clone; returns the voice id it replaced, if any. */
  put(user: string, voiceId: string): Promise<string | null>;
  /** Deletes the account's row; returns its voice id, if any. */
  remove(user: string): Promise<string | null>;
};

export type VoiceApi = {
  create(name: string, wav: Uint8Array): Promise<string>;
  remove(voiceId: string): Promise<void>;
  preview(voiceId: string): Promise<string | null>;
};

export class VoiceCore {
  constructor(private readonly d: { store: AsrStore; clones: CloneStore; api: VoiceApi; limit: number; now: () => number }) {}

  private async paid(user: string) {
    const { plan } = await this.d.store.usage(user, periodOf(this.d.now()).period);
    return { plan, paid: plan !== FREE_PLAN };
  }

  async state(user: string): Promise<VoiceState> {
    const [{ plan, paid }, id, stock] = await Promise.all([
      this.paid(user),
      this.d.clones.get(user),
      Promise.all(
        STOCK_VOICES.map(async (v) => ({
          id: v.id,
          name: v.name,
          previewUrl: await this.d.api.preview(v.id).catch(() => null),
        })),
      ),
    ]);
    // Replacing takes no new slot, so a full account with a clone can still clone again.
    const canClone = paid && (id !== null || (await this.d.clones.count()) < this.d.limit);
    return { stock, clone: id === null ? 'none' : paid ? 'ready' : 'unusable', canClone, plan };
  }

  async clone(user: string, wav: Uint8Array, consent: boolean): Promise<VoiceState> {
    if (!consent) throw new NoConsent('consent required');
    if (!(await this.paid(user)).paid) throw new NeedsPaidPlan('cloning needs a paid plan');
    const info = wavInfo(wav);
    if (!info || info.seconds < CLONE_MIN_SECONDS || info.seconds > CLONE_MAX_SECONDS) {
      throw new BadSamples(`samples must be ${CLONE_MIN_SECONDS} to ${CLONE_MAX_SECONDS} seconds of audio`);
    }
    const replacing = (await this.d.clones.get(user)) !== null;
    if (!replacing && (await this.d.clones.count()) >= this.d.limit) throw new CloneUnavailableNow('no clone slots');

    let voiceId: string;
    try {
      voiceId = await this.d.api.create(`voice-notes-${user}`, wav);
    } catch (e) {
      if (e instanceof CloneRefused) throw new CloneUnavailableNow(e.message);
      throw new ProviderFailed(e instanceof Error ? e.message : 'provider failed');
    }
    let old: string | null;
    try {
      old = await this.d.clones.put(user, voiceId);
    } catch (e) {
      await this.d.api.remove(voiceId).catch((e2) => console.error('[asr] remove orphan clone', e2));
      throw e;
    }
    if (old && old !== voiceId) await this.d.api.remove(old).catch((e) => console.error('[asr] remove replaced clone', e));
    return this.state(user);
  }

  async remove(user: string): Promise<VoiceState> {
    const id = await this.d.clones.get(user);
    if (id) {
      // At ElevenLabs first: if that fails the row stays, so the user can retry and no voice is orphaned.
      try {
        await this.d.api.remove(id);
      } catch (e) {
        throw new ProviderFailed(e instanceof Error ? e.message : 'provider failed');
      }
      await this.d.clones.remove(user);
    }
    return this.state(user);
  }

  /** The voice id `SpeakCore` may use: a paid plan and a row. */
  usableClone = async (user: string): Promise<string | null> => {
    const id = await this.d.clones.get(user);
    return id && (await this.paid(user)).paid ? id : null;
  };
}
