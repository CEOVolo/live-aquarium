import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// .env is optional; real deployments pass variables through the environment.
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);

const str = (k, d = '') => (process.env[k] ?? '').trim() || d;
const num = (k, d) => {
  const v = process.env[k];
  if (v === undefined || v.trim() === '') return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

export const config = {
  host: str('HOST', '127.0.0.1'),
  port: num('PORT', 8787),
  // When set, every /api/admin/* call and the admin WebSocket must present this token.
  adminToken: str('ADMIN_TOKEN'),
  // Extra host names allowed to use the admin API without a token (e.g. a LAN name of this machine).
  allowedHosts: str('ALLOWED_HOSTS').split(',').map((h) => h.trim()).filter(Boolean),
  dataDir: path.resolve(ROOT, str('DATA_DIR', 'data')),
  mode: str('MODE', 'interactive') === 'tv' ? 'tv' : 'interactive',

  world: {
    dayLengthMin: num('DAY_LENGTH_MIN', 30),
    populationCap: num('POPULATION_CAP', 140),
  },

  ambient: {
    // Caretaker feeds the tank on its own if nobody did for this long.
    feedEveryMin: num('AUTO_FEED_MIN', 25),
    tvFeedEveryMin: num('TV_AUTO_FEED_MIN', 20),
    goldenMeanMin: num('GOLDEN_MEAN_MIN', 150),
    nightJellyMeanMin: num('NIGHT_JELLY_MEAN_MIN', 45),
    birthsPerDayPerSpecies: num('BIRTHS_PER_DAY', 2),
  },

  ai: {
    mode: str('AI_PARSER', 'auto'), // auto | on | off
    model: str('AI_MODEL', 'claude-opus-5'),
    maxCallsPerMin: num('AI_MAX_CALLS_PER_MIN', 12),
    dailyBudgetUsd: num('AI_DAILY_BUDGET_USD', 3),
    batchMax: num('AI_BATCH_MAX', 25),
    batchWaitMs: num('AI_BATCH_WAIT_MS', 1200),
  },

  youtube: {
    apiKey: str('YOUTUBE_API_KEY'),
    videoId: str('YOUTUBE_VIDEO_ID'),
    liveChatId: str('YOUTUBE_LIVE_CHAT_ID'),
    clientId: str('YOUTUBE_CLIENT_ID'),
    clientSecret: str('YOUTUBE_CLIENT_SECRET'),
    refreshToken: str('YOUTUBE_REFRESH_TOKEN'),
    dailyQuota: num('YOUTUBE_DAILY_QUOTA', 10000),
    minPollMs: num('YOUTUBE_MIN_POLL_MS', 0),
    apiBase: str('YOUTUBE_API_BASE', 'https://www.googleapis.com/youtube/v3'),
    tokenUrl: str('YOUTUBE_TOKEN_URL', 'https://oauth2.googleapis.com/token'),
  },

  sim: {
    // e.g. SIM_AUTOSTART=normal to have fake viewers chatting right after boot
    autostart: str('SIM_AUTOSTART'),
  },
};
