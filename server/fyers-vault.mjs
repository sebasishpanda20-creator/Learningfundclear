// Strongly consistent FYERS state/session vault.
//
// Why not Workers KV: OAuth state must be consumed exactly once under
// concurrent callbacks, and KV is eventually consistent across colos, so a
// replay could be accepted in another location. Two stores provide the same
// atomic check-and-delete:
//
// - D1 (`env.DB`, table `fyers_vault`) is the deployed store. SQLite gives one
//   DELETE … RETURNING statement, so two concurrent callbacks cannot both read
//   the same row. Freebuff Sites can attach D1 but not a Durable Object.
// - The SQLite Durable Object `FyersVault` stays for plain Cloudflare deploys
//   (`wrangler.jsonc`); it serializes its own operations. `vaultFrom` in
//   fyers-routes.mjs prefers D1 and falls back to the object.
//
// Tokens are stored only as AES-GCM ciphertext (see fyers-core.sealToken); the
// key lives in the Worker secret FYERS_TOKEN_KEY and never leaves the server.

import { STATE_TTL_SECONDS } from './fyers-core.mjs';

export class MemoryStorage {
  constructor() { this.map = new Map(); }
  async get(key) { return this.map.get(key); }
  async put(key, value) { this.map.set(key, value); }
  async delete(key) { return this.map.delete(key); }
  // One synchronous step: no other callback can observe the value between the
  // read and the delete.
  take(key) {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    this.map.delete(key);
    return value;
  }
  async list({ prefix } = {}) {
    const out = new Map();
    for (const [key, value] of this.map) {
      if (!prefix || key.startsWith(prefix)) out.set(key, value);
    }
    return out;
  }
}

// SQLite storage for the Durable Object. `take` is a single DELETE … RETURNING,
// so two concurrent callbacks cannot both read the same row. Separate get and
// delete calls would leave a gap even inside a Durable Object.
export class SqlStorage {
  constructor(sql) {
    this.sql = sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS vault (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  }
  async get(key) {
    const rows = this.sql.exec('SELECT value FROM vault WHERE key = ?', key).toArray();
    return rows.length ? JSON.parse(rows[0].value) : undefined;
  }
  async put(key, value) {
    this.sql.exec(
      'INSERT INTO vault (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      JSON.stringify(value),
    );
  }
  async delete(key) {
    return this.sql.exec('DELETE FROM vault WHERE key = ?', key).rowsWritten > 0;
  }
  take(key) {
    const rows = this.sql.exec('DELETE FROM vault WHERE key = ? RETURNING value', key).toArray();
    return rows.length ? JSON.parse(rows[0].value) : undefined;
  }
  async list({ prefix = '' } = {}) {
    const rows = this.sql.exec(
      'SELECT key, value FROM vault WHERE substr(key, 1, ?) = ?',
      prefix.length,
      prefix,
    ).toArray();
    const out = new Map();
    for (const row of rows) out.set(row.key, JSON.parse(row.value));
    return out;
  }
}

// D1 storage. Same six operations as SqlStorage, so VaultCore is untouched.
// `take` is a single DELETE … RETURNING: D1 runs one statement atomically, and
// its write is what makes a replayed state lose the race.
const SCHEMA = 'CREATE TABLE IF NOT EXISTS fyers_vault (key TEXT PRIMARY KEY, value TEXT NOT NULL)';
const schemaReady = new WeakMap();

// Create the table once per isolate, and retry on the next request if that
// first attempt failed (a transient D1 error must not pin the isolate).
function ensureSchema(db) {
  let pending = schemaReady.get(db);
  if (!pending) {
    pending = db.prepare(SCHEMA).run().catch((error) => {
      schemaReady.delete(db);
      throw error;
    });
    schemaReady.set(db, pending);
  }
  return pending;
}

export class D1Storage {
  constructor(db) {
    this.db = db;
  }
  async get(key) {
    await ensureSchema(this.db);
    const row = await this.db.prepare('SELECT value FROM fyers_vault WHERE key = ?1').bind(key).first();
    return row ? JSON.parse(row.value) : undefined;
  }
  async put(key, value) {
    await ensureSchema(this.db);
    await this.db
      .prepare(
        'INSERT INTO fyers_vault (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .bind(key, JSON.stringify(value))
      .run();
  }
  async delete(key) {
    await ensureSchema(this.db);
    const res = await this.db.prepare('DELETE FROM fyers_vault WHERE key = ?1').bind(key).run();
    return (res?.meta?.changes ?? 0) > 0;
  }
  async take(key) {
    await ensureSchema(this.db);
    const { results } = await this.db
      .prepare('DELETE FROM fyers_vault WHERE key = ?1 RETURNING value')
      .bind(key)
      .all();
    return results?.length ? JSON.parse(results[0].value) : undefined;
  }
  async list({ prefix = '' } = {}) {
    await ensureSchema(this.db);
    const { results } = await this.db
      .prepare('SELECT key, value FROM fyers_vault WHERE substr(key, 1, ?1) = ?2')
      .bind(prefix.length, prefix)
      .all();
    const out = new Map();
    for (const row of results || []) out.set(row.key, JSON.parse(row.value));
    return out;
  }
}

// The shape fyers-routes.mjs calls: {kind, request(op, args)}.
export function d1Vault(db, now = () => Date.now()) {
  const core = new VaultCore(new D1Storage(db), now);
  return { kind: 'd1_sqlite', request: (op, args) => core[op](...args) };
}

export class VaultCore {
  constructor(storage, now = () => Date.now()) {
    this.storage = storage;
    this.now = now;
  }

  stateKey(hash) { return `state:${hash}`; }
  sessionKey(sid) { return `session:${sid}`; }

  async createState({ stateHash, sid, userId, expiresAt, returnTo }) {
    if (!stateHash || !sid || !userId) throw new Error('state record incomplete');
    await this.storage.put(this.stateKey(stateHash), {
      sid,
      userId,
      expiresAt,
      returnTo: typeof returnTo === 'string' ? returnTo : undefined,
      createdAt: this.now(),
    });
  }

  // Deletes before validating: a wrong sid or an expired state is burned rather
  // than retried, so a captured state cannot be replayed. The returned record
  // carries the portal user the state was issued to, which the callback uses to
  // bind the broker session without trusting a browser-supplied identity.
  async consumeState(stateHash, sid) {
    const record = await this.storage.take(this.stateKey(stateHash));
    if (!record) return null;
    if (record.sid !== sid) return null;
    if (!(record.expiresAt > this.now())) return null;
    return record;
  }

  async saveSession({ sid, userId, sealed, expiresAt, connectedAt, clientId }) {
    if (!sid || !userId || !sealed?.cipher || !sealed?.iv) throw new Error('session record incomplete');
    await this.storage.put(this.sessionKey(sid), {
      sid,
      userId,
      sealed,
      expiresAt,
      connectedAt: connectedAt ?? this.now(),
      clientId,
    });
  }

  async getSession(sid, userId) {
    const record = await this.storage.get(this.sessionKey(sid));
    if (!record) return null;
    if (record.userId !== userId) return null;
    if (!(record.expiresAt > this.now())) return null;
    return record;
  }

  async deleteSession(sid) {
    if (!sid) return false;
    return this.storage.delete(this.sessionKey(sid));
  }

  async purgeExpired() {
    const now = this.now();
    let removed = 0;
    for (const prefix of ['state:', 'session:']) {
      const entries = await this.storage.list({ prefix });
      for (const [key, value] of entries) {
        if (!(value?.expiresAt > now)) {
          await this.storage.delete(key);
          removed += 1;
        }
      }
    }
    return removed;
  }
}

export function stateExpiry(now = Date.now()) {
  return now + STATE_TTL_SECONDS * 1000;
}

// Durable Object entrypoint. RPC over fetch keeps the Worker side trivial and
// works identically under wrangler dev --local and in production.
export class FyersVault {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.core = new VaultCore(new SqlStorage(state.storage.sql));
  }

  async fetch(request) {
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ ok: false, error: 'bad_request' }, { status: 400 });
    }
    const allowed = new Set([
      'createState',
      'consumeState',
      'saveSession',
      'getSession',
      'deleteSession',
      'purgeExpired',
    ]);
    if (!allowed.has(body?.op)) {
      return Response.json({ ok: false, error: 'unknown_op' }, { status: 400 });
    }
    try {
      const args = Array.isArray(body.args) ? body.args : [];
      const result = await this.core[body.op](...args);
      return Response.json({ ok: true, result });
    } catch {
      // Never echo storage errors: they can contain token material.
      return Response.json({ ok: false, error: 'vault_error' }, { status: 500 });
    }
  }
}
