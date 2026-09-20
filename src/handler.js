import { config } from "./config.js";
import { GhostfyError } from "./errors.js";
import { ghostify } from "./ghostify.js";
import { parseSoleEmoji } from "./parse.js";

/**
 * Why a message is not acted on, or null when it should be processed. Returning
 * the reason rather than a boolean means every skipped message can say why,
 * which is the difference between "no events arriving" and "events filtered".
 */
const ignoreReason = (message) => {
  if (message.channel !== config.channel) return `other channel (${message.channel})`;
  if (message.subtype) return `subtype ${message.subtype}`;
  if (message.bot_id || message.app_id) return "from a bot or app";
  if (message.thread_ts && message.thread_ts !== message.ts) return "thread reply";
  return null;
};

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

const slackError = (error) => error?.data?.error || error?.message || "unknown error";

export const createHandler = ({ registry, logger }) => {
  // Uploads are serialised: emoji.list and the upload endpoint are both rate
  // limited, and a burst in the channel would otherwise fire them in parallel.
  let queue = Promise.resolve();
  let missingScopeLogged = false;

  // A reaction failure must never take down the actual work, so every path here
  // degrades to a log line.
  const onReactionError = (verb, error) => {
    const reason = slackError(error);
    if (reason === "missing_scope") {
      if (!missingScopeLogged) {
        missingScopeLogged = true;
        logger.warn(
          `cannot ${verb} the :${config.loadingEmoji}: reaction — the bot token is missing the reactions:write scope`,
        );
      }
      return;
    }
    logger.warn(`could not ${verb} the :${config.loadingEmoji}: reaction — ${reason}`);
  };

  const addLoading = async (client, message) => {
    try {
      await client.reactions.add({
        channel: message.channel,
        timestamp: message.ts,
        name: config.loadingEmoji,
      });
      return true;
    } catch (error) {
      // A reaction left over from a crashed run still means "remove it later".
      if (slackError(error) === "already_reacted") return true;
      onReactionError("add", error);
      return false;
    }
  };

  const removeLoading = async (client, message) => {
    try {
      await client.reactions.remove({
        channel: message.channel,
        timestamp: message.ts,
        name: config.loadingEmoji,
      });
    } catch (error) {
      if (slackError(error) === "no_reaction") return;
      onReactionError("remove", error);
    }
  };

  const process = async ({ client, message, name, reacted }) => {
    const targetName = `${config.prefix}${name}`;
    const reply = (text) =>
      client.chat.postMessage({ channel: message.channel, thread_ts: message.ts, text });

    try {
      await registry.ensureFresh();

      if (registry.has(targetName)) {
        logger.info(`  skip ${targetName}: already exists`);
        await reply(`\`:${targetName}:\` already exists — :${targetName}:`);
        return;
      }

      logger.info(`  ghostifying ${name}`);
      const { degradedTo } = await ghostify(registry, name);
      if (degradedTo) {
        logger.info(`  ${targetName} only fit after degrading to ${JSON.stringify(degradedTo)}`);
      }
      await reply(`Ghostified! :${targetName}:`);
      logger.info(`  uploaded ${targetName}`);
    } catch (error) {
      logger.error(`  failed ${targetName}: ${error.stack || error.message}`);
      await reply(replyText(error)).catch((replyError) => {
        logger.error(`  could not post the failure reply: ${replyError.message}`);
      });
    } finally {
      // Clear the indicator whatever happened, including on a failed reply.
      if (reacted) await removeLoading(client, message);
    }
  };

  return async ({ message, client }) => {
    const preview = (message.text || "").slice(0, 40);
    logger.info(`event: channel=${message.channel} ts=${message.ts} text=${JSON.stringify(preview)}`);

    const skip = ignoreReason(message);
    if (skip) {
      logger.info(`  ignored: ${skip}`);
      return;
    }

    const name = parseSoleEmoji(message.text);
    if (!name) {
      logger.info("  ignored: not a lone emoji");
      return;
    }
    if (name.startsWith(config.prefix)) {
      logger.info(`  ignored: ${name} is already ghostified`);
      return;
    }

    // React before joining the queue. Work is serialised, so a message behind a
    // slow upload would otherwise sit with no indicator until its turn came.
    const reacted = await addLoading(client, message);

    const done = queue.then(() => process({ client, message, name, reacted })).catch(() => {});
    queue = done;
    return done;
  };
};
