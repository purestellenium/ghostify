import { config } from "./config.js";
import { GhostfyError } from "./errors.js";
import { ghostify } from "./ghostify.js";
import { parseSoleEmoji } from "./parse.js";

/**
 * Messages we never act on. Anything with a subtype is an edit, a deletion, a
 * join notice or a bot post; thread replies keep the bot to top-level messages;
 * bot_id/app_id stop it from reacting to itself or other integrations.
 */
const shouldIgnore = (message) =>
  message.channel !== config.channel ||
  Boolean(message.subtype) ||
  Boolean(message.bot_id) ||
  Boolean(message.app_id) ||
  (Boolean(message.thread_ts) && message.thread_ts !== message.ts);

const replyText = (error) => {
  if (!(error instanceof GhostfyError)) {
    return "Something went wrong on my end — check the logs.";
  }
  switch (error.kind) {
    case "exists":
    case "not_found":
      return error.message;
    case "processing":
      return `I couldn't ghostify that — ${error.message}`;
    case "upload":
      return `I ghostified it but couldn't upload it — ${error.message}`;
    default:
      return error.message;
  }
};

export const createHandler = ({ registry, logger }) => {
  // Uploads are serialised: emoji.list and the upload endpoint are both rate
  // limited, and a busy channel would otherwise fire them in parallel.
  let queue = Promise.resolve();

  const handle = async ({ message, client }) => {
    if (shouldIgnore(message)) return;

    const name = parseSoleEmoji(message.text);
    if (!name) return;
    if (name.startsWith(config.prefix)) return; // no :ghost-ghost-parrot:

    const targetName = `${config.prefix}${name}`;
    const reply = (text) =>
      client.chat.postMessage({ channel: message.channel, thread_ts: message.ts, text });

    try {
      await registry.ensureFresh();

      if (registry.has(targetName)) {
        logger.info(`skip ${targetName}: already exists`);
        await reply(`\`:${targetName}:\` already exists — :${targetName}:`);
        return;
      }

      logger.info(`ghostifying ${name}`);
      await ghostify(registry, name);
      await reply(`Ghostified! :${targetName}:`);
    } catch (error) {
      logger.error(`failed ${targetName}: ${error.stack || error.message}`);
      await reply(replyText(error)).catch((replyError) => {
        logger.error(`could not post the failure reply: ${replyError.message}`);
      });
    }
  };

  return (args) => {
    queue = queue.then(() => handle(args)).catch(() => {});
    return queue;
  };
};
