const trimmed = (name) => process.env[name]?.trim() || "";

const number = (name, fallback) => {
  const value = trimmed(name);
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number, got ${value}`);
  return parsed;
};

export const config = {
  // Socket Mode needs both an app-level token and a bot token.
  appToken: trimmed("SLACK_APP_TOKEN"),
  botToken: trimmed("SLACK_BOT_TOKEN"),
  // Slack exposes no bot-scoped emoji upload, so uploads ride a browser session.
  userToken: trimmed("SLACK_USER_TOKEN"),
  cookie: trimmed("SLACK_COOKIE"),

  subdomain: trimmed("SLACK_SUBDOMAIN") || "hackclub",
  channel: trimmed("GHOSTIFY_CHANNEL") || "C0C343T6GLA",
  prefix: trimmed("GHOSTIFY_PREFIX") || "ghost-",
  // Reaction shown while a message is being worked on.
  loadingEmoji: trimmed("GHOSTIFY_LOADING_EMOJI") || "loading",

  magickBin: trimmed("MAGICK_BIN") || null,
  emojiCacheTtlMs: number("EMOJI_CACHE_TTL_MS", 30_000),
  port: number("PORT", 3000),

  // Slack rejects custom emoji larger than this, in bytes and in pixels.
  maxUploadBytes: 128 * 1024,
  maxDimension: 128,
};

const CREDENTIALS = [
  ["SLACK_APP_TOKEN", config.appToken, "xapp-"],
  ["SLACK_BOT_TOKEN", config.botToken, "xoxb-"],
  ["SLACK_USER_TOKEN", config.userToken, "xoxc-"],
  ["SLACK_COOKIE", config.cookie, "xoxd-"],
];

/**
 * Checks every credential up front so a misconfigured deploy fails on boot
 * rather than on the first emoji someone posts. Called from the entrypoint, not
 * at import time, so the other modules stay importable without a full env.
 */
export const assertCredentials = () => {
  const problems = CREDENTIALS.flatMap(([name, value, prefix]) => {
    if (!value) return [`${name} is not set`];
    if (!value.startsWith(prefix)) return [`${name} must be a ${prefix}… credential`];
    return [];
  });
  if (problems.length) {
    throw new Error(`Configuration problems:\n  - ${problems.join("\n  - ")}`);
  }
};
