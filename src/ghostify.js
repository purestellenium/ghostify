import { createRequire } from "node:module";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

import { config } from "./config.js";
import { runIdentify, runMagick } from "./magick.js";
import { byShortName, standardImageUrl } from "./standard-emoji.js";
import { alreadyExists, notFound, processingFailed, uploadFailed } from "./errors.js";

const require = createRequire(import.meta.url);
const EmojiAdd = require("emojme/lib/emoji-add");

const BY_MIME = {
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};
const KNOWN_EXTENSIONS = [".gif", ".jpeg", ".jpg", ".png", ".webp"];
const EXPIRED_SESSION_ERRORS = new Set(["invalid_auth", "not_authed", "token_revoked", "token_expired"]);

// Progressively cheaper renders. Slack resizes static images itself, so those
// only ever need one pass; animated GIFs get shrunk and thinned out.
const STATIC_ATTEMPTS = [{ dimension: 128, stride: 1 }];
const ANIMATED_ATTEMPTS = [
  { dimension: 128, stride: 1 },
  { dimension: 128, stride: 2 },
  { dimension: 96, stride: 3 },
  { dimension: 64, stride: 4 },
];

/**
 * Where a name's image lives: a custom emoji if the workspace has one (following
 * alias chains), otherwise Slack's CDN copy of the standard Unicode emoji.
 */
export const resolveSource = (registry, name, seen = new Set()) => {
  if (seen.has(name)) return null; // alias cycle
  seen.add(name);

  const custom = registry.map[name];
  if (typeof custom === "string" && custom.startsWith("alias:")) {
    return resolveSource(registry, custom.slice("alias:".length), seen);
  }
  if (custom) return custom;

  return standardImageUrl(byShortName.get(name));
};

const extensionFor = (contentType, url) => {
  const mime = (contentType || "").split(";")[0].trim().toLowerCase();
  if (BY_MIME[mime]) return BY_MIME[mime];

  const extension = extname(new URL(url).pathname).toLowerCase();
  if (KNOWN_EXTENSIONS.includes(extension)) return extension;

  throw processingFailed(`unsupported image type: ${contentType || "unknown"}`);
};

/**
 * Grayscale plus a 4x4 ordered dither at 16 levels. The dither also lands on the
 * alpha channel, which is what stipples the edges into the ghost look.
 */
const filterArgs = (input, output, animated, resize) => [
  input,
  // GIF frames are delta-encoded; expand them before filtering, re-optimise after.
  ...(animated ? ["-coalesce"] : []),
  ...(resize ? ["-resize", `${resize}x${resize}>`] : []),
  "-colorspace",
  "gray",
  "-ordered-dither",
  "o4x4,16",
  ...(animated ? ["-layers", "Optimize"] : []),
  output,
];

const sizeOf = async (path) => (await stat(path)).size;

const frameCount = async (path) => {
  const output = await runIdentify(["-format", "%n\n", path]);
  const first = Number.parseInt(output.trim().split("\n")[0], 10);
  return Number.isFinite(first) && first > 0 ? first : 1;
};

/**
 * ImageMagick can read an explicit scene list, so thinning an animation is a
 * matter of naming the frames to keep: "clip.gif[0,2,4,...]".
 */
const sceneSpec = (path, stride, total) => {
  if (stride <= 1 || total <= 1) return path;
  const scenes = [];
  for (let i = 0; i < total; i += stride) scenes.push(i);
  return `${path}[${scenes.join(",")}]`;
};

/**
 * Downloads, filters and uploads `:name:` as `:ghost-name:`.
 * Assumes the caller has already checked the target does not exist.
 */
export const ghostify = async (registry, name) => {
  const targetName = `${config.prefix}${name}`;

  const source = resolveSource(registry, name);
  if (!source) throw notFound(`\`:${name}:\` isn't a custom emoji here or a Unicode emoji I know.`);

  let response;
  try {
    response = await fetch(source);
  } catch (error) {
    throw processingFailed(`couldn't download the source image (${error.message}).`);
  }
  if (!response.ok) {
    throw processingFailed(`downloading the source image returned HTTP ${response.status}.`);
  }

  const sourceExtension = extensionFor(response.headers.get("content-type"), source);
  const animated = sourceExtension === ".gif";
  const outputExtension = animated ? ".gif" : ".png";

  const workDir = await mkdtemp(join(tmpdir(), "ghostify-"));
  try {
    const rawPath = join(workDir, `source${sourceExtension}`);
    const outputPath = join(workDir, `${targetName}${outputExtension}`);
    await Bun.write(rawPath, await response.arrayBuffer());

    // Slack rejects some animated GIFs with "resized_but_still_too_large" even
    // when they are inside the documented 128x128 / 128 KB limits — a long frame
    // count alone can do it, and the real threshold is undocumented. So instead
    // of guessing one, degrade and retry until Slack accepts.
    const uploader = new EmojiAdd(config.subdomain, config.userToken, config.cookie);
    const attempts = animated ? ANIMATED_ATTEMPTS : STATIC_ATTEMPTS;
    const totalFrames = animated ? await frameCount(rawPath) : 1;
    let lastError = null;
    let usedAttempt = null;

    for (const [index, attempt] of attempts.entries()) {
      const input = sceneSpec(rawPath, attempt.stride, totalFrames);
      await runMagick(filterArgs(input, outputPath, animated, attempt.dimension));

      const size = await sizeOf(outputPath);
      if (size > config.maxUploadBytes && index < attempts.length - 1) continue;
      if (size > config.maxUploadBytes) {
        throw uploadFailed(
          `the ghostified image is ${Math.round(size / 1024)} KB, over Slack's 128 KB limit.`,
        );
      }

      const result = await uploader.uploadSingle({ is_alias: 0, name: targetName, url: outputPath });
      if (!result?.error) {
        lastError = null;
        usedAttempt = index > 0 ? attempt : null;
        break;
      }

      // Someone can win the race between our existence check and this upload.
      if (result.error === "error_name_taken") {
        throw alreadyExists(`\`:${targetName}:\` already exists.`);
      }
      // emoji.add rides a browser session, which expires on sign-out, a password
      // change or rotation. Say so plainly instead of leaking "invalid_auth".
      if (EXPIRED_SESSION_ERRORS.has(result.error)) {
        throw uploadFailed(
          "the Slack browser session (SLACK_USER_TOKEN / SLACK_COOKIE) has expired and needs re-issuing.",
        );
      }
      lastError = result.error;
      if (result.error !== "resized_but_still_too_large") break;
    }

    if (lastError === "resized_but_still_too_large") {
      throw uploadFailed(
        "Slack would not accept the image even after shrinking it and dropping frames.",
      );
    }
    if (lastError) throw uploadFailed(`Slack rejected the upload: ${lastError}`);

    registry.add(targetName, outputPath);
    // The caller logs when a GIF only fit after being degraded.
    return { targetName, degradedTo: usedAttempt };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
};
