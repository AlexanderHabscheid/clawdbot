/**
 * Web Memory Store — per-user web memory persistence
 *
 * When CENTRIS_MEMORY_STORAGE=supabase and userId is present, uses Supabase.
 * Otherwise uses in-memory store (CLI/SDK dev use).
 *
 * @see docs/MEMORY_ARCHITECTURE.md
 */

export type WebMemoryEntry = {
  cacheKey: string;
  url: string;
  normalizedUrl: string;
  domain: string;
  intent?: string;
  playbook?: Record<string, unknown>;
  pageFingerprint?: { fingerprintId?: string; urlPattern?: string; confidence?: number };
  actionIndex: Array<Record<string, unknown>>;
  routeMemory?: { routeId: string; steps?: Array<Record<string, unknown>>; confidence?: number };
  confidence: number;
  createdAt: string;
  expiresAt: string;
  resolveHits: number;
};

export interface WebMemoryStore {
  set(key: string, entry: WebMemoryEntry): Promise<void>;
  get(key: string): Promise<WebMemoryEntry | undefined>;
  resolve(params: {
    normalizedUrl: string;
    normalizedIntent: string;
    maxAgeMs?: number;
  }): Promise<WebMemoryEntry | undefined>;
  delete(key: string): Promise<boolean>;
  deleteByScope(params: { scope: string; url?: string; playbookId?: string }): Promise<number>;
  incrementResolveHits(key: string): Promise<void>;
  list(): Promise<WebMemoryEntry[]>;
  cleanupExpired(now?: number): Promise<void>;
}

/** In-memory store for CLI/SDK dev use (no userId, no Supabase). */
export class InMemoryWebMemoryStore implements WebMemoryStore {
  private readonly map = new Map<string, WebMemoryEntry>();

  async set(key: string, entry: WebMemoryEntry): Promise<void> {
    this.map.set(key, entry);
  }

  async get(key: string): Promise<WebMemoryEntry | undefined> {
    return this.map.get(key);
  }

  async resolve(params: {
    normalizedUrl: string;
    normalizedIntent: string;
    maxAgeMs?: number;
  }): Promise<WebMemoryEntry | undefined> {
    await this.cleanupExpired();
    const now = Date.now();
    const candidates = [...this.map.values()].filter((entry) => {
      if (entry.normalizedUrl !== params.normalizedUrl) {
        return false;
      }
      if (
        params.normalizedIntent &&
        (entry.intent ?? "").trim().toLowerCase() !== params.normalizedIntent
      ) {
        return false;
      }
      if (params.maxAgeMs != null) {
        const createdAt = Date.parse(entry.createdAt);
        if (Number.isFinite(createdAt) && now - createdAt > params.maxAgeMs) {
          return false;
        }
      }
      return true;
    });
    if (candidates.length === 0) {
      return undefined;
    }
    candidates.sort((a, b) => b.confidence - a.confidence);
    return candidates[0];
  }

  async delete(key: string): Promise<boolean> {
    return this.map.delete(key);
  }

  async deleteByScope(params: {
    scope: string;
    url?: string;
    playbookId?: string;
  }): Promise<number> {
    if (params.scope === "all") {
      const n = this.map.size;
      this.map.clear();
      return n;
    }
    if (params.scope === "playbook" && params.playbookId && this.map.has(params.playbookId)) {
      this.map.delete(params.playbookId);
      return 1;
    }
    if (params.scope === "url" || params.scope === "domain") {
      const url = params.url ?? "";
      const normalizedUrl = url.replace(/\/$/, "").toLowerCase();
      const domain = url ? new URL(url.startsWith("http") ? url : `https://${url}`).hostname : "";
      let invalidated = 0;
      for (const [key, entry] of this.map.entries()) {
        const urlMatch = entry.normalizedUrl === normalizedUrl;
        const domainMatch = params.scope === "domain" && entry.domain === domain;
        if (urlMatch || domainMatch) {
          this.map.delete(key);
          invalidated++;
        }
      }
      return invalidated;
    }
    return 0;
  }

  async incrementResolveHits(key: string): Promise<void> {
    const entry = this.map.get(key);
    if (entry) {
      entry.resolveHits++;
    }
  }

  async list(): Promise<WebMemoryEntry[]> {
    await this.cleanupExpired();
    return [...this.map.values()];
  }

  async cleanupExpired(now = Date.now()): Promise<void> {
    for (const [key, entry] of this.map.entries()) {
      const expiresAt = Date.parse(entry.expiresAt);
      if (Number.isFinite(expiresAt) && expiresAt <= now) {
        this.map.delete(key);
      }
    }
  }
}

function toPayload(entry: WebMemoryEntry): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    actionIndex: entry.actionIndex,
  };
  if (entry.playbook) {
    payload.playbook = entry.playbook;
  }
  if (entry.pageFingerprint) {
    payload.pageFingerprint = entry.pageFingerprint;
  }
  if (entry.routeMemory) {
    payload.routeMemory = entry.routeMemory;
  }
  return payload;
}

function fromRow(row: Record<string, unknown>): WebMemoryEntry {
  const payload = (row.payload as Record<string, unknown>) ?? {};
  return {
    cacheKey: row.cache_key as string,
    url: row.url as string,
    normalizedUrl: row.normalized_url as string,
    domain: row.domain as string,
    intent: row.intent as string | undefined,
    playbook: payload.playbook as Record<string, unknown> | undefined,
    pageFingerprint: payload.pageFingerprint as WebMemoryEntry["pageFingerprint"],
    actionIndex: (payload.actionIndex as Array<Record<string, unknown>>) ?? [],
    routeMemory: payload.routeMemory as WebMemoryEntry["routeMemory"],
    confidence: Number(row.confidence) || 0.5,
    createdAt: row.created_at as string,
    expiresAt: row.expires_at as string,
    resolveHits: Number(row.resolve_hits) || 0,
  };
}

/** Supabase-backed store for production (userId required). */
export class SupabaseWebMemoryStore implements WebMemoryStore {
  constructor(
    private readonly supabaseUrl: string,
    private readonly supabaseServiceKey: string,
    private readonly userId: string,
  ) {}

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      apikey: this.supabaseServiceKey,
      Authorization: `Bearer ${this.supabaseServiceKey}`,
      Prefer: "return=representation",
    };
  }

  async set(key: string, entry: WebMemoryEntry): Promise<void> {
    const body = {
      user_id: this.userId,
      cache_key: key,
      url: entry.url,
      normalized_url: entry.normalizedUrl,
      domain: entry.domain,
      intent: entry.intent ?? null,
      payload: toPayload(entry),
      confidence: entry.confidence,
      expires_at: entry.expiresAt,
      resolve_hits: entry.resolveHits,
    };
    const res = await fetch(`${this.supabaseUrl}/rest/v1/centris_web_memory`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      if (res.status === 409) {
        await this.upsert(key, entry);
        return;
      }
      throw new Error(`Supabase web memory set failed: ${res.status} ${await res.text()}`);
    }
  }

  private async upsert(key: string, entry: WebMemoryEntry): Promise<void> {
    const res = await fetch(
      `${this.supabaseUrl}/rest/v1/centris_web_memory?user_id=eq.${this.userId}&cache_key=eq.${encodeURIComponent(key)}`,
      {
        method: "PATCH",
        headers: this.headers(),
        body: JSON.stringify({
          url: entry.url,
          normalized_url: entry.normalizedUrl,
          domain: entry.domain,
          intent: entry.intent ?? null,
          payload: toPayload(entry),
          confidence: entry.confidence,
          expires_at: entry.expiresAt,
          resolve_hits: entry.resolveHits,
        }),
      },
    );
    if (!res.ok) {
      throw new Error(`Supabase web memory upsert failed: ${res.status} ${await res.text()}`);
    }
  }

  async get(key: string): Promise<WebMemoryEntry | undefined> {
    const res = await fetch(
      `${this.supabaseUrl}/rest/v1/centris_web_memory?user_id=eq.${this.userId}&cache_key=eq.${encodeURIComponent(key)}&select=*`,
      { headers: this.headers() },
    );
    if (!res.ok) {
      return undefined;
    }
    const rows = (await res.json()) as Record<string, unknown>[];
    return rows[0] ? fromRow(rows[0]) : undefined;
  }

  async resolve(params: {
    normalizedUrl: string;
    normalizedIntent: string;
    maxAgeMs?: number;
  }): Promise<WebMemoryEntry | undefined> {
    await this.cleanupExpired();
    let url = `${this.supabaseUrl}/rest/v1/centris_web_memory?user_id=eq.${this.userId}&normalized_url=eq.${encodeURIComponent(params.normalizedUrl)}&expires_at=gt.${new Date().toISOString()}&order=confidence.desc&select=*`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) {
      return undefined;
    }
    const rows = (await res.json()) as Record<string, unknown>[];
    const candidates = rows.map(fromRow).filter((entry) => {
      if (
        params.normalizedIntent &&
        (entry.intent ?? "").trim().toLowerCase() !== params.normalizedIntent
      ) {
        return false;
      }
      if (params.maxAgeMs != null) {
        const createdAt = Date.parse(entry.createdAt);
        if (Number.isFinite(createdAt) && Date.now() - createdAt > params.maxAgeMs) {
          return false;
        }
      }
      return true;
    });
    return candidates[0];
  }

  async delete(key: string): Promise<boolean> {
    const res = await fetch(
      `${this.supabaseUrl}/rest/v1/centris_web_memory?user_id=eq.${this.userId}&cache_key=eq.${encodeURIComponent(key)}`,
      { method: "DELETE", headers: this.headers() },
    );
    return res.ok;
  }

  async deleteByScope(params: {
    scope: string;
    url?: string;
    playbookId?: string;
  }): Promise<number> {
    if (params.scope === "all") {
      const entries = await this.list();
      for (const e of entries) {
        await this.delete(e.cacheKey);
      }
      return entries.length;
    }
    if (params.scope === "playbook" && params.playbookId) {
      const ok = await this.delete(params.playbookId);
      return ok ? 1 : 0;
    }
    if (params.scope === "url" || params.scope === "domain") {
      const url = params.url ?? "";
      const normalizedUrl = url.replace(/\/$/, "").toLowerCase();
      const domain = url ? new URL(url.startsWith("http") ? url : `https://${url}`).hostname : "";
      const entries = await this.list();
      let invalidated = 0;
      for (const entry of entries) {
        const urlMatch = entry.normalizedUrl === normalizedUrl;
        const domainMatch = params.scope === "domain" && entry.domain === domain;
        if (urlMatch || domainMatch) {
          await this.delete(entry.cacheKey);
          invalidated++;
        }
      }
      return invalidated;
    }
    return 0;
  }

  async incrementResolveHits(key: string): Promise<void> {
    const entry = await this.get(key);
    if (entry) {
      entry.resolveHits++;
      await this.upsert(key, entry);
    }
  }

  async list(): Promise<WebMemoryEntry[]> {
    await this.cleanupExpired();
    const res = await fetch(
      `${this.supabaseUrl}/rest/v1/centris_web_memory?user_id=eq.${this.userId}&expires_at=gt.${new Date().toISOString()}&select=*`,
      { headers: this.headers() },
    );
    if (!res.ok) {
      return [];
    }
    const rows = (await res.json()) as Record<string, unknown>[];
    return rows.map(fromRow);
  }

  async cleanupExpired(now = Date.now()): Promise<void> {
    const iso = new Date(now).toISOString();
    await fetch(
      `${this.supabaseUrl}/rest/v1/centris_web_memory?user_id=eq.${this.userId}&expires_at=lte.${iso}`,
      { method: "DELETE", headers: this.headers() },
    );
  }
}

let sharedInMemoryStore: InMemoryWebMemoryStore | null = null;

/** Reset shared in-memory store (for test isolation). */
export function resetWebMemoryStoreForTesting(): void {
  sharedInMemoryStore = null;
}

/** Get the appropriate store: Supabase when configured + userId, else shared in-memory. */
export function getWebMemoryStore(userId?: string): WebMemoryStore {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const storage = process.env.CENTRIS_MEMORY_STORAGE ?? "local";

  if (storage === "supabase" && supabaseUrl && supabaseKey && userId) {
    return new SupabaseWebMemoryStore(supabaseUrl, supabaseKey, userId);
  }
  if (!sharedInMemoryStore) {
    sharedInMemoryStore = new InMemoryWebMemoryStore();
  }
  return sharedInMemoryStore;
}
