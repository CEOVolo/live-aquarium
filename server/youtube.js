// YouTube Live Chat reader (Data API v3, liveChatMessages.list polling).
//
// Quota: liveChatMessages.list costs 1 unit, the default project quota is
// 10 000 units per day, reset at midnight Pacific time. Polling every 2-5 s
// around the clock would need 17-43k units, so the poller spreads whatever
// quota is left over the time left until the reset (and never polls faster
// than YouTube's pollingIntervalMillis). For a 2-4 h test stream that still
// means ~1-2 s polling; for 24/7 streaming request a quota increase or move to
// liveChatMessages.streamList.

const PT = 'America/Los_Angeles';
const ptDay = (ts) => new Intl.DateTimeFormat('en-CA', { timeZone: PT, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ts);

export function msUntilPtMidnight(ts) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: PT, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(ts)
      .map((p) => [p.type, p.value]),
  );
  const elapsed = (Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second)) * 1000;
  return Math.max(1000, 86400000 - elapsed);
}

const CHAT_TYPES = new Set(['textMessageEvent', 'superChatEvent', 'superStickerEvent', 'newSponsorEvent',
  'memberMilestoneChatEvent', 'membershipGiftingEvent']);
const ENDED = new Set(['liveChatEnded', 'liveChatNotFound', 'liveChatDisabled', 'videoNotFound']);

export class YouTubeChat {
  constructor({ config, onMessage, fetchImpl = globalThis.fetch, clock = Date.now, log = console }) {
    this.cfg = { ...config };
    this.onMessage = onMessage;
    this.fetch = fetchImpl;
    this.clock = clock;
    this.log = log;
    this.state = 'idle';
    this.running = false;
    this.timer = null;
    this.token = null;
    this.backoffMs = 0;
    this.nextAt = 0;
    this.quota = { day: ptDay(clock()), used: 0 };
    this.stats = { polls: 0, messages: 0, skippedBacklog: 0, errors: 0, lastError: null, lastLatencyMs: 0, lastDelayMs: null };
    this.resetChat();
  }

  get oauth() { return Boolean(this.cfg.clientId && this.cfg.clientSecret && this.cfg.refreshToken); }

  get configured() {
    const auth = Boolean(this.cfg.apiKey) || this.oauth;
    const target = Boolean(this.cfg.liveChatId || this.cfg.videoId) || this.oauth;
    return auth && target;
  }

  resetChat() {
    this.liveChatId = this.cfg.liveChatId || null;
    this.pageToken = null;
    this.first = true;
  }

  /** Start (or restart with a new video id from the admin panel). */
  start(overrides = {}) {
    const changed = ['videoId', 'liveChatId'].some((k) => overrides[k] !== undefined && overrides[k] !== this.cfg[k]);
    Object.assign(this.cfg, overrides);
    if (changed) this.resetChat();
    if (!this.configured) {
      this.state = 'disabled';
      return false;
    }
    this.running = true;
    this.schedule(0);
    return true;
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.state = 'stopped';
  }

  schedule(ms) {
    clearTimeout(this.timer);
    if (!this.running) return;
    this.nextAt = this.clock() + ms;
    this.timer = setTimeout(() => { this.step(); }, ms);
    this.timer.unref?.();
  }

  async step() {
    if (!this.running) return;
    try {
      if (!this.liveChatId) {
        this.state = 'resolving';
        this.liveChatId = await this.resolveChatId();
        if (!this.running) return;
        if (!this.liveChatId) {
          this.state = 'waiting'; // the video is not live (yet)
          return this.schedule(60000);
        }
      }
      const res = await this.api('liveChat/messages', {
        liveChatId: this.liveChatId,
        part: 'snippet,authorDetails',
        maxResults: 2000,
        pageToken: this.pageToken,
      });
      if (!this.running) return; // stopped while the request was in flight
      this.stats.polls++;
      this.state = 'live';
      this.backoffMs = 0;
      if (res.nextPageToken) this.pageToken = res.nextPageToken;
      const items = res.items ?? [];
      if (this.first) {
        // The first page is chat history from before we connected: don't replay old commands.
        this.first = false;
        this.stats.skippedBacklog += items.length;
      } else {
        for (const item of items) {
          const msg = this.toMessage(item);
          if (msg) {
            this.stats.messages++;
            // How late chat reaches us (YouTube delivery + polling interval).
            this.stats.lastDelayMs = Math.max(0, this.clock() - msg.ts);
            this.onMessage(msg);
          }
        }
      }
      if (res.offlineAt) {
        this.state = 'ended';
        this.resetChat();
        return this.schedule(60000);
      }
      this.schedule(this.nextDelay(res.pollingIntervalMillis));
    } catch (err) {
      if (this.running) this.onError(err);
    }
  }

  nextDelay(pollingIntervalMillis) {
    const youtubeFloor = Math.max(1000, Number(pollingIntervalMillis) || 5000);
    if (this.cfg.minPollMs > 0) return Math.max(youtubeFloor, this.cfg.minPollMs);
    this.rollQuotaDay();
    const left = Math.max(1, this.cfg.dailyQuota * 0.95 - this.quota.used);
    const paced = msUntilPtMidnight(this.clock()) / left;
    return Math.round(Math.max(youtubeFloor, paced));
  }

  onError(err) {
    this.stats.errors++;
    this.stats.lastError = `${err.status ?? ''} ${err.reason ?? ''} ${err.message}`.trim().slice(0, 300);
    const reason = err.reason;
    if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
      this.state = 'quota';
      return this.schedule(Math.min(msUntilPtMidnight(this.clock()) + 60000, 3600000));
    }
    if (ENDED.has(reason) || err.status === 404) {
      this.state = 'ended';
      this.resetChat();
      return this.schedule(60000);
    }
    if (err.status === 401 && this.oauth) {
      this.token = null;
      this.state = 'error';
      return this.schedule(2000);
    }
    if (err.status === 401 || (err.status === 403 && reason !== 'rateLimitExceeded')) {
      this.state = 'auth';
      this.log.warn(`[youtube] ${this.stats.lastError}`);
      return this.schedule(5 * 60000);
    }
    this.state = 'error';
    this.backoffMs = Math.min(60000, Math.max(2000, this.backoffMs * 2));
    this.schedule(this.backoffMs);
  }

  async resolveChatId() {
    if (this.cfg.liveChatId) return this.cfg.liveChatId;
    if (this.cfg.videoId) {
      const r = await this.api('videos', { part: 'liveStreamingDetails', id: this.cfg.videoId });
      return r.items?.[0]?.liveStreamingDetails?.activeLiveChatId ?? null;
    }
    if (this.oauth) {
      const r = await this.api('liveBroadcasts', { part: 'snippet', broadcastStatus: 'active', broadcastType: 'all' });
      return r.items?.[0]?.snippet?.liveChatId ?? null;
    }
    return null;
  }

  async api(resource, params) {
    const url = new URL(`${this.cfg.apiBase}/${resource}`);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    const headers = { accept: 'application/json' };
    const bearer = await this.accessToken();
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    else url.searchParams.set('key', this.cfg.apiKey);
    this.rollQuotaDay();
    this.quota.used += 1;
    const started = this.clock();
    const res = await this.fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    this.stats.lastLatencyMs = this.clock() - started;
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(body?.error?.message ?? `HTTP ${res.status}`);
      e.status = res.status;
      e.reason = body?.error?.errors?.[0]?.reason ?? body?.error?.status;
      throw e;
    }
    return body;
  }

  async accessToken() {
    if (!this.oauth) return null;
    if (this.token && this.token.exp - 60000 > this.clock()) return this.token.value;
    const res = await this.fetch(this.cfg.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        refresh_token: this.cfg.refreshToken,
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) {
      const e = new Error(`OAuth refresh failed: ${body.error_description ?? body.error ?? res.status}`);
      e.status = 401;
      e.reason = 'oauth';
      throw e;
    }
    this.token = { value: body.access_token, exp: this.clock() + (Number(body.expires_in) || 3600) * 1000 };
    return this.token.value;
  }

  rollQuotaDay() {
    const day = ptDay(this.clock());
    if (day !== this.quota.day) this.quota = { day, used: 0 };
  }

  toMessage(item) {
    const s = item?.snippet ?? {};
    const a = item?.authorDetails ?? {};
    if (!CHAT_TYPES.has(s.type)) return null;
    const channelId = a.channelId ?? s.authorChannelId;
    if (!channelId) return null;
    return {
      id: item.id,
      source: 'youtube',
      type: s.type,
      userId: `yt:${channelId}`,
      userName: a.displayName ?? 'viewer',
      text: s.displayMessage ?? s.textMessageDetails?.messageText ?? s.superChatDetails?.userComment ?? '',
      ts: Date.parse(s.publishedAt) || this.clock(),
      roles: { owner: !!a.isChatOwner, mod: !!a.isChatModerator, member: !!a.isChatSponsor },
      superchat: s.superChatDetails
        ? { amountMicros: Number(s.superChatDetails.amountMicros) || 0, currency: s.superChatDetails.currency, tier: s.superChatDetails.tier }
        : null,
    };
  }

  status() {
    this.rollQuotaDay();
    return {
      state: this.state,
      configured: this.configured,
      auth: this.oauth ? 'oauth' : this.cfg.apiKey ? 'api-key' : 'none',
      videoId: this.cfg.videoId || null,
      liveChatId: this.liveChatId ? `${this.liveChatId.slice(0, 6)}…` : null,
      quotaUsed: this.quota.used,
      quotaLimit: this.cfg.dailyQuota,
      nextPollInMs: this.running ? Math.max(0, this.nextAt - this.clock()) : null,
      ...this.stats,
    };
  }
}
