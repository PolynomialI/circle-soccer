// Player history for the last week: peak concurrent players (and private rooms) per 10-minute
// bucket. Kept in memory; if REDIS_URL is set (e.g. a Render Key Value instance) every bucket is
// also saved there, so the history survives restarts, redeploys and the free plan's sleeping.

export const BUCKET_MS = 10 * 60 * 1000;
export const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const KEY = 'circle-soccer:history';

// o: players online, q: in quick play, p: in private rooms, r: private rooms open,
// s: in practice, c: private rooms created during the bucket.
const empty = () => ({ o: 0, q: 0, p: 0, r: 0, s: 0, c: 0 });

export class PlayerHistory {
  constructor({ store = null, now = () => Date.now() } = {}) {
    this.store = store;
    this.now = now;
    this.buckets = new Map();
    this.dirty = new Set();
  }

  async load() {
    if (!this.store) return;
    for (const [t, saved] of await this.store.load()) {
      // Merge with anything recorded in memory while the store was connecting.
      const b = { ...empty(), ...saved };
      const mem = this.buckets.get(Number(t));
      if (mem) for (const k of Object.keys(b)) b[k] = Math.max(b[k], mem[k]);
      this.buckets.set(Number(t), b);
    }
    await this.prune();
  }

  current() {
    const t = Math.floor(this.now() / BUCKET_MS) * BUCKET_MS;
    if (!this.buckets.has(t)) {
      this.buckets.set(t, empty());
      this.prune().catch(() => {});
    }
    this.dirty.add(t);
    return this.buckets.get(t);
  }

  record({ online, quick, priv, privRooms, practice }) {
    const b = this.current();
    b.o = Math.max(b.o, online);
    b.q = Math.max(b.q, quick);
    b.p = Math.max(b.p, priv);
    b.r = Math.max(b.r, privRooms);
    b.s = Math.max(b.s, practice);
  }

  roomCreated() {
    this.current().c++;
  }

  async prune() {
    const cutoff = this.now() - KEEP_MS;
    const old = [...this.buckets.keys()].filter((t) => t + BUCKET_MS <= cutoff);
    for (const t of old) {
      this.buckets.delete(t);
      this.dirty.delete(t);
    }
    if (old.length && this.store) await this.store.remove(old);
  }

  async flush() {
    if (!this.store) return;
    const pending = [...this.dirty];
    this.dirty.clear();
    for (const t of pending) {
      const b = this.buckets.get(t);
      if (b) await this.store.save(t, b);
    }
  }

  snapshot() {
    this.prune().catch(() => {});
    return {
      bucketMs: BUCKET_MS,
      keepMs: KEEP_MS,
      now: this.now(),
      persistent: !!this.store,
      buckets: [...this.buckets].sort((a, b) => a[0] - b[0]),
    };
  }
}

export async function createRedisStore(url) {
  const { createClient } = await import('redis');
  const client = createClient({ url });
  let warned = false;
  client.on('error', (err) => {
    if (!warned) console.error('History store error:', err.message);
    warned = true;
  });
  await client.connect();
  return {
    async load() {
      const rows = await client.hGetAll(KEY);
      return Object.entries(rows).map(([t, v]) => [t, JSON.parse(v)]);
    },
    async save(t, b) {
      await client.hSet(KEY, String(t), JSON.stringify(b));
    },
    async remove(ts) {
      await client.hDel(KEY, ts.map(String));
    },
  };
}
