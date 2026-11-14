// Strongly consistent FYERS state/session vault.
//
// Why a Durable Object: OAuth state must be consumed exactly once under
// concurrent callbacks. Workers KV is eventually consistent across colos, so a
// replay could be accepted in another location. A Durable Object serializes all
// operations for one instance and its SQLite-backed storage is transactional,
// which gives atomic check-and-delete without a paid plan.
//
// Tokens are stored only as AES-GCM ciphertext (see fyers-core.sealToken); the
// key lives in the Worker secret FYERS_TOKEN_KEY and never leaves the server.

import { STATE_TTL_SECONDS } from './fyers-core.mjs';

export class MemoryStorage {
  constructor() { this.map = new Map(); }
  async get(key) { return this.map.get(key); }
  async put(key, value) { this.map.set(key, value); }
  async delete(key) { return this.map.delete(key); }
  async list({ prefix } = {}) {
    const out = new Map();
    for (const [key, value] of this.map) {
      if (!prefix || key.startsWith(prefix)) out.set(key, value);
    }
    return out;
  }
}

export class VaultCore {
  constructor(storage, now = () => Date.now()) {
    this.storage = storage;
    this.now = now;
  }

  stateKey(hash) { return `state:${hash}`; }
  sessionKey(sid) { return `session:${sid}`; }

  async createState({ stateHash, sid, userId, expiresAt }) {
    if (!stateHash || !sid || !userId) throw new Error('state record incomplete');
    await this.storage.put(this.stateKey(stateHash), {
      sid,
      userId,
      expiresAt,
      createdAt: this.now(),
    });
  }

  // Deletes before validating: a wrong sid or an expired state is burned rather
  // than retried, so a captured state cannot be replayed. The returned record
  // carries the portal user the state was issued to, which the callback uses to
  // bind the broker session without trusting a browser-supplied identity.
  async consumeState(stateHash, sid) {
    const key = this.stateKey(stateHash);
    const record = await this.storage.get(key);
    if (!record) return null;
    await this.storage.delete(key);
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
    this.core = new VaultCore(state.storage);
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
