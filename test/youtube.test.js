import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { YouTubeChat, msUntilPtMidnight } from '../server/youtube.js';
import { makeClock, silentLog } from './helpers.js';

const PUBLISHED = '2026-09-29T19:00:01.000Z';

/**
 * A local stand-in for the YouTube Data API v3. /videos resolves the live chat,
 * /liveChat/messages serves the scripted `pages` one per request. Every request
 * URL is recorded. `hold(promise)` delays chat responses until it resolves.
 */
async function startMockYouTube() {
  const requests = [];
  const pages = [];
  let gate = null;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://mock');
    requests.push(url);
    let status = 200;
    let body;
    if (url.pathname === '/videos') {
      body = { items: [{ id: url.searchParams.get('id'), liveStreamingDetails: { activeLiveChatId: 'chat1' } }] };
    } else if (url.pathname === '/liveChat/messages') {
      if (gate) await gate;
      ({ status, body } = pages.shift() ?? page([]));
    } else {
      ({ status, body } = apiError(404, 'notFound'));
    }
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    requests,
    pages,
    hold(promise) {
      gate = promise;
    },
    close: () => new Promise((resolve) => {
      server.closeAllConnections();
      server.close(resolve);
    }),
  };
}

const chatItem = (n, author = {}, snippet = {}) => ({
  kind: 'youtube#liveChatMessage',
  id: `m${n}`,
  snippet: {
    type: 'textMessageEvent', liveChatId: 'chat1', publishedAt: PUBLISHED, hasDisplayContent: true,
    displayMessage: `message ${n}`, textMessageDetails: { messageText: `message ${n}` }, ...snippet,
  },
  authorDetails: {
    channelId: `UC${n}`, displayName: `Viewer ${n}`, isVerified: false,
    isChatOwner: false, isChatModerator: false, isChatSponsor: false, ...author,
  },
});
const page = (items, extra = {}) => ({
  status: 200,
  body: { kind: 'youtube#liveChatMessageListResponse', pollingIntervalMillis: 2000, items, ...extra },
});
const apiError = (status, reason) => ({
  status,
  body: { error: { code: status, message: reason, errors: [{ reason, domain: 'youtube.liveChat', message: reason }] } },
});

/** A poller driven by hand: `step()` is called directly; delays it would schedule are recorded, no timers armed. */
function makeChat(mock, overrides = {}) {
  const c = makeClock();
  const got = [];
  const yt = new YouTubeChat({
    config: { apiBase: mock.base, apiKey: 'k', videoId: 'v', dailyQuota: 10000, minPollMs: 0, ...overrides },
    onMessage: (m) => got.push(m),
    clock: c.clock,
    log: silentLog,
  });
  const delays = [];
  yt.schedule = (ms) => {
    if (yt.running) delays.push(ms);
  };
  yt.running = true;
  return { c, yt, got, delays };
}

async function waitFor(check, ms = 3000) {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('YouTubeChat polling', () => {
  test('the first page (backlog) is skipped; later messages arrive with yt: ids and roles', async (t) => {
    const mock = await startMockYouTube();
    t.after(mock.close);
    mock.pages.push(
      page([chatItem(1, {}, { displayMessage: 'SHARK' }), chatItem(2)], { nextPageToken: 'p1', pollingIntervalMillis: 2000 }),
      page([
        chatItem(3, { displayName: 'Owner', isChatOwner: true }, { displayMessage: '!shark' }),
        chatItem(4, { isChatModerator: true }, { displayMessage: 'feed' }),
        chatItem(5, { isChatSponsor: true }),
        chatItem(6, {}, {
          type: 'superChatEvent', displayMessage: '$5.00 from Viewer 6: "SHARK!"',
          superChatDetails: { amountMicros: '5000000', currency: 'USD', amountDisplayString: '$5.00', userComment: 'SHARK!', tier: 2 },
        }),
        chatItem(7, {}, { type: 'messageDeletedEvent', hasDisplayContent: false }),
      ], { nextPageToken: 'p2', pollingIntervalMillis: 3000 }),
      page([chatItem(8)], { nextPageToken: 'p3' }),
    );
    const { yt, got, delays } = makeChat(mock);

    await yt.step();
    assert.equal(yt.state, 'live');
    assert.deepEqual(got, [], 'history from before we connected is not replayed');
    assert.equal(yt.stats.skippedBacklog, 2);

    await yt.step();
    assert.deepEqual(got.map((m) => m.userId), ['yt:UC3', 'yt:UC4', 'yt:UC5', 'yt:UC6']);
    assert.deepEqual(got[0], {
      id: 'm3', source: 'youtube', type: 'textMessageEvent', userId: 'yt:UC3', userName: 'Owner', text: '!shark',
      ts: Date.parse(PUBLISHED), roles: { owner: true, mod: false, member: false }, superchat: null,
    });
    assert.deepEqual(got[1].roles, { owner: false, mod: true, member: false });
    assert.deepEqual(got[2].roles, { owner: false, mod: false, member: true });
    assert.deepEqual(got[3].superchat, { amountMicros: 5_000_000, currency: 'USD', tier: 2 });

    await yt.step();
    assert.deepEqual(got.map((m) => m.id).at(-1), 'm8');

    // What went over the wire
    assert.deepEqual(mock.requests.map((u) => u.pathname), ['/videos', '/liveChat/messages', '/liveChat/messages', '/liveChat/messages']);
    const [videos, first, second, third] = mock.requests;
    assert.equal(videos.searchParams.get('id'), 'v');
    assert.equal(videos.searchParams.get('part'), 'liveStreamingDetails');
    for (const u of mock.requests) assert.equal(u.searchParams.get('key'), 'k', `${u.pathname} carries the API key`);
    assert.equal(first.searchParams.get('liveChatId'), 'chat1');
    assert.equal(first.searchParams.get('part'), 'snippet,authorDetails');
    assert.equal(first.searchParams.has('pageToken'), false);
    assert.equal(second.searchParams.get('pageToken'), 'p1');
    assert.equal(third.searchParams.get('pageToken'), 'p2');

    // Never faster than YouTube asks for
    assert.equal(delays.length, 3);
    assert.ok(delays[0] >= 2000 && delays[1] >= 3000, delays.join());
    assert.equal(yt.status().quotaUsed, 4);
    assert.equal(yt.stats.polls, 3);
    assert.equal(yt.stats.messages, 5);
  });

  test('403 quotaExceeded switches to state "quota" and waits (at most an hour)', async (t) => {
    const mock = await startMockYouTube();
    t.after(mock.close);
    mock.pages.push(page([], { nextPageToken: 'p1' }), apiError(403, 'quotaExceeded'));
    const { yt, got, delays } = makeChat(mock);
    await yt.step();
    await yt.step();
    assert.equal(yt.state, 'quota');
    assert.equal(yt.stats.errors, 1);
    assert.match(yt.stats.lastError, /quotaExceeded/);
    const wait = delays.at(-1);
    assert.ok(wait > 60_000 && wait <= 3_600_000, `waits ${wait} ms`);
    assert.deepEqual(got, []);
  });

  test('liveChatEnded switches to state "ended"; the next step looks the chat up again', async (t) => {
    const mock = await startMockYouTube();
    t.after(mock.close);
    mock.pages.push(
      page([], { nextPageToken: 'p1' }),
      apiError(403, 'liveChatEnded'),
      page([chatItem(9)], { nextPageToken: 'q1' }), // the new chat: its first page is backlog again
      page([chatItem(10)], { nextPageToken: 'q2' }),
    );
    const { yt, got, delays } = makeChat(mock);
    await yt.step();
    await yt.step();
    assert.equal(yt.state, 'ended');
    assert.equal(yt.liveChatId, null);
    assert.equal(delays.at(-1), 60_000);

    await yt.step();
    await yt.step();
    assert.equal(yt.state, 'live');
    assert.deepEqual(mock.requests.map((u) => u.pathname),
      ['/videos', '/liveChat/messages', '/liveChat/messages', '/videos', '/liveChat/messages', '/liveChat/messages']);
    assert.equal(mock.requests[4].searchParams.has('pageToken'), false, 'no stale page token for the new chat');
    assert.deepEqual(got.map((m) => m.id), ['m10']);
  });

  test('a page with offlineAt ends the chat as well', async (t) => {
    const mock = await startMockYouTube();
    t.after(mock.close);
    mock.pages.push(page([], { nextPageToken: 'p1' }), page([chatItem(1)], { offlineAt: '2026-09-29T20:00:00Z' }));
    const { yt, got } = makeChat(mock);
    await yt.step();
    await yt.step();
    assert.equal(yt.state, 'ended');
    assert.deepEqual(got.map((m) => m.id), ['m1'], 'the last messages are still delivered');
    assert.equal(yt.liveChatId, null);
  });

  test('other 403s mean bad credentials ("auth"); network failures back off ("error")', async (t) => {
    const mock = await startMockYouTube();
    t.after(mock.close);
    mock.pages.push(page([], { nextPageToken: 'p1' }), apiError(403, 'forbidden'));
    const { yt, delays } = makeChat(mock);
    await yt.step();
    await yt.step();
    assert.equal(yt.state, 'auth');
    assert.equal(delays.at(-1), 5 * 60_000);

    const closed = await startMockYouTube();
    const deadBase = closed.base;
    await closed.close();
    const { yt: offline, delays: offlineDelays } = makeChat({ base: deadBase }, { liveChatId: 'chat1' });
    await offline.step();
    assert.equal(offline.state, 'error');
    assert.equal(offlineDelays.at(-1), 2000);
    await offline.step();
    assert.equal(offlineDelays.at(-1), 4000, 'exponential backoff');
  });
});

describe('YouTubeChat lifecycle', () => {
  test('start() without an API key stays disabled', () => {
    const yt = new YouTubeChat({ config: { apiBase: 'http://127.0.0.1:9', videoId: 'v', dailyQuota: 10000, minPollMs: 0 }, onMessage() {}, log: silentLog });
    assert.equal(yt.configured, false);
    assert.equal(yt.start(), false);
    assert.equal(yt.state, 'disabled');
    assert.equal(yt.running, false);
  });

  test('start() polls on its own timer; stop() halts it', async (t) => {
    const mock = await startMockYouTube();
    t.after(mock.close);
    const c = makeClock();
    const yt = new YouTubeChat({
      config: { apiBase: mock.base, apiKey: 'k', videoId: 'v', dailyQuota: 10000, minPollMs: 0 },
      onMessage() {}, clock: c.clock, log: silentLog,
    });
    t.after(() => yt.stop());
    assert.equal(yt.start(), true);
    await waitFor(() => yt.stats.polls === 1);
    assert.equal(yt.state, 'live');
    assert.ok(yt.status().nextPollInMs >= 2000, 'next poll is scheduled, not immediate');
    yt.stop();
    assert.equal(yt.state, 'stopped');
    assert.equal(yt.status().nextPollInMs, null);
  });

  test('fixed: stop() during an in-flight poll stays "stopped" and delivers nothing more', async (t) => {
    const mock = await startMockYouTube();
    t.after(mock.close);
    mock.pages.push(page([], { nextPageToken: 'p1' }), page([chatItem(1)], { nextPageToken: 'p2' }));
    const { yt, got } = makeChat(mock);
    await yt.step();
    let release;
    mock.hold(new Promise((resolve) => {
      release = resolve;
    }));
    const inFlight = yt.step();
    await waitFor(() => mock.requests.length === 3);
    yt.stop();
    release();
    await inFlight;
    assert.equal(yt.state, 'stopped');
    assert.deepEqual(got, []);
  });
});

describe('msUntilPtMidnight', () => {
  test('counts down to midnight in Los Angeles, in summer (PDT) and winter (PST)', () => {
    const H = 3_600_000;
    assert.equal(msUntilPtMidnight(Date.UTC(2026, 8, 29, 7, 0, 0)), 24 * H); // 00:00 PDT (UTC-7)
    assert.equal(msUntilPtMidnight(Date.UTC(2026, 8, 29, 19, 0, 0)), 12 * H); // 12:00 PDT
    assert.equal(msUntilPtMidnight(Date.UTC(2026, 0, 15, 20, 0, 0)), 12 * H); // 12:00 PST (UTC-8)
    assert.equal(msUntilPtMidnight(Date.UTC(2026, 0, 16, 7, 30, 0)), 30 * 60_000); // 23:30 PST
    assert.equal(msUntilPtMidnight(Date.UTC(2026, 8, 30, 6, 59, 59, 500)), 1000, 'never less than a second');
  });
});
