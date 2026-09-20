import { config } from "./config.js";

/**
 * The workspace's custom emoji (name -> image URL or "alias:other"), refreshed
 * on a TTL so emoji added by other people are noticed without a restart.
 */
export class EmojiRegistry {
  constructor(client) {
    this.client = client;
    this.map = {};
    this.fetchedAt = 0;
  }

  async refresh() {
    const response = await this.client.emoji.list();
    if (!response.ok || !response.emoji) {
      throw new Error(`emoji.list failed: ${response.error || "unknown error"}`);
    }
    this.map = response.emoji;
    this.fetchedAt = Date.now();
  }

  async ensureFresh() {
    if (Date.now() - this.fetchedAt < config.emojiCacheTtlMs) return;
    await this.refresh();
  }

  has(name) {
    return Object.hasOwn(this.map, name);
  }

  /** Record a name we just uploaded, so a repeat in the same TTL window is caught. */
  add(name, url) {
    this.map[name] = url;
  }
}
