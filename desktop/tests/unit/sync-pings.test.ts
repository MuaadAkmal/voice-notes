import { beforeEach, expect, it } from 'vitest';
import { type PingSource, SyncPings } from '../../src/main/sync/pings';

let listens: string[];
let stops: number;
let asked: number;
let onPing: (from: string) => void;
let onConnected: () => void;
let pings: SyncPings;

beforeEach(() => {
  listens = [];
  stops = 0;
  asked = 0;
  const source: PingSource = {
    listen(userId, ping, connected) {
      listens.push(userId);
      onPing = ping;
      onConnected = connected;
      return () => void stops++;
    },
  };
  pings = new SyncPings({ source, selfId: () => 'me', onRemoteChange: () => void asked++ });
});

it('listens to the user, once', () => {
  pings.update('u1');
  pings.update('u1');
  expect(listens).toEqual(['u1']);
});

it('switching user stops the old channel first', () => {
  pings.update('u1');
  pings.update('u2');
  expect(stops).toBe(1);
  expect(listens).toEqual(['u1', 'u2']);
});

it('null stops', () => {
  pings.update('u1');
  pings.update(null);
  expect(stops).toBe(1);
  pings.update(null);
  expect(stops).toBe(1);
});

it('a ping from another PC, or a (re)connect, asks for a sync; its own ping does not', () => {
  pings.update('u1');
  onPing('me');
  expect(asked).toBe(0);
  onPing('other');
  expect(asked).toBe(1);
  onConnected();
  expect(asked).toBe(2);
});

it('a ping arriving after stop is ignored', () => {
  pings.update('u1');
  const late = onPing;
  const lateConnect = onConnected;
  pings.update(null);
  late('other');
  lateConnect();
  expect(asked).toBe(0);
});
