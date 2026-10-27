import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlayerHistory, BUCKET_MS, KEEP_MS } from '../server/history.js';

function fakeStore(initial = []) {
  const data = new Map(initial.map(([t, b]) => [String(t), JSON.stringify(b)]));
  return {
    data,
    async load() {
      return [...data].map(([t, v]) => [t, JSON.parse(v)]);
    },
    async save(t, b) {
      data.set(String(t), JSON.stringify(b));
    },
    async remove(ts) {
      for (const t of ts) data.delete(String(t));
    },
  };
}

test('records peaks per bucket and counts rooms created', () => {
  let now = 1_000 * BUCKET_MS;
  const h = new PlayerHistory({ now: () => now });
  h.record({ online: 3, quick: 2, priv: 1, privRooms: 1, practice: 0 });
  h.record({ online: 1, quick: 0, priv: 0, privRooms: 0, practice: 1 });
  h.roomCreated();
  h.roomCreated();
  now += BUCKET_MS;
  h.record({ online: 5, quick: 0, priv: 4, privRooms: 2, practice: 0 });
  const snap = h.snapshot();
  assert.equal(snap.buckets.length, 2);
  assert.deepEqual(snap.buckets[0][1], { o: 3, q: 2, p: 1, r: 1, s: 1, c: 2 });
  assert.deepEqual(snap.buckets[1][1], { o: 5, q: 0, p: 4, r: 2, s: 0, c: 0 });
});

test('keeps only the last week, in memory and in the store', async () => {
  let now = 5_000 * BUCKET_MS;
  const store = fakeStore();
  const h = new PlayerHistory({ store, now: () => now });
  h.record({ online: 2, quick: 0, priv: 0, privRooms: 0, practice: 0 });
  await h.flush();
  assert.equal(store.data.size, 1);
  now += KEEP_MS + BUCKET_MS;
  h.record({ online: 1, quick: 0, priv: 0, privRooms: 0, practice: 0 });
  await h.flush();
  await h.prune();
  assert.equal(h.snapshot().buckets.length, 1);
  assert.equal(store.data.size, 1, 'old bucket removed from the store too');
});

test('history survives a restart through the store', async () => {
  const now = 9_000 * BUCKET_MS;
  const store = fakeStore([[now - 3 * BUCKET_MS, { o: 7, q: 1, p: 6, r: 2, s: 0, c: 3 }], [now - KEEP_MS - BUCKET_MS, { o: 9 }]]);
  const h = new PlayerHistory({ store, now: () => now });
  h.record({ online: 1, quick: 0, priv: 0, privRooms: 0, practice: 0 });
  await h.load();
  const snap = h.snapshot();
  assert.equal(snap.persistent, true);
  assert.equal(snap.buckets.length, 2, 'week-old bucket dropped, recent one restored, current kept');
  assert.equal(snap.buckets[0][1].o, 7);
  assert.equal(store.data.size, 1);
});
