import { beforeEach, expect, it } from 'vitest';
import { pasteText, type PasteDeps } from '../../src/main/dictation/paste';

let calls: string[];
let held: number; // polls left during which a modifier is still down
let failPaste: boolean;
let deps: PasteDeps<string>;

beforeEach(() => {
  calls = [];
  held = 0;
  failPaste = false;
  deps = {
    clipboard: {
      snapshot: async () => {
        calls.push('snapshot');
        return 'previous';
      },
      restore: async (s) => {
        calls.push(`restore:${s}`);
      },
      writeText: async (t) => {
        calls.push(`write:${t}`);
      },
    },
    modifiersHeld: () => held-- > 0,
    sendCtrlV: () => {
      if (failPaste) throw new Error('no koffi');
      calls.push('ctrl+v');
    },
    sleep: async (ms) => {
      calls.push(`sleep:${ms}`);
    },
  };
});

it('snapshots, writes, presses Ctrl+V, then restores after 500 ms', async () => {
  await pasteText('hi', deps);
  expect(calls).toEqual(['snapshot', 'write:hi', 'ctrl+v', 'sleep:500', 'restore:previous']);
});

it('waits for modifiers to be released before pasting', async () => {
  held = 3;
  await pasteText('hi', deps);
  expect(calls).toEqual(['snapshot', 'write:hi', 'sleep:20', 'sleep:20', 'sleep:20', 'ctrl+v', 'sleep:500', 'restore:previous']);
});

it('gives up waiting after 2 s and pastes anyway', async () => {
  held = Infinity;
  await pasteText('hi', deps);
  expect(calls.filter((c) => c === 'sleep:20')).toHaveLength(100);
  expect(calls.slice(-3)).toEqual(['ctrl+v', 'sleep:500', 'restore:previous']);
});

it('restores after a failing paste', async () => {
  failPaste = true;
  await expect(pasteText('hi', deps)).rejects.toThrow('no koffi');
  expect(calls.at(-1)).toBe('restore:previous');
});
