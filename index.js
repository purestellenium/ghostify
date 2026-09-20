import { App, LogLevel } from "@slack/bolt";

import { assertCredentials, config } from "./src/config.js";
import { EmojiRegistry } from "./src/emoji-registry.js";
import { createHandler } from "./src/handler.js";
import { resolveMagick } from "./src/magick.js";

assertCredentials();

const app = new App({
  token: config.botToken,
  appToken: config.appToken,
  socketMode: true,
  logLevel: process.env.LOG_LEVEL === "debug" ? LogLevel.DEBUG : LogLevel.INFO,
});

const registry = new EmojiRegistry(app.client);

app.message(createHandler({ registry, logger: app.logger }));

app.error(async (error) => {
  app.logger.error(`unhandled Bolt error: ${error.stack || error.message}`);
});

// Fail fast on a missing ImageMagick rather than on the first emoji posted.
const magick = await resolveMagick();
app.logger.info(`using ImageMagick: ${magick.convert.join(" ")} (identify: ${magick.identify.join(" ")})`);

await registry.refresh();
app.logger.info(`loaded ${Object.keys(registry.map).length} custom emoji`);

// The progress indicator is a custom emoji, so say so at boot rather than
// failing quietly on the first message.
if (!registry.has(config.loadingEmoji)) {
  app.logger.warn(
    `:${config.loadingEmoji}: is not a custom emoji in this workspace; ` +
      "the progress reaction will fail. Set GHOSTIFY_LOADING_EMOJI to one that exists.",
  );
}

await app.start();
app.logger.info(`ghostify listening on channel ${config.channel}`);

// Socket Mode needs no inbound port, but a health endpoint gives the platform
// something to probe.
Bun.serve({
  port: config.port,
  fetch: () => new Response("ok", { headers: { "content-type": "text/plain" } }),
});

const shutdown = async (signal) => {
  app.logger.info(`${signal} received, shutting down`);
  await app.stop().catch(() => {});
  process.exit(0);
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
