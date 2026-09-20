import { createRequire } from "node:module";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

import { config } from "./config.js";
import { runMagick } from "./magick.js";
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

  const workDir = await mkdtemp(join(tmpdir(), "ghostfy-"));
  try {
    const rawPath = join(workDir, `source${sourceExtension}`);
    const outputPath = join(workDir, `${targetName}${outputExtension}`);
    await Bun.write(rawPath, await response.arrayBuffer());

    await runMagick(filterArgs(rawPath, outputPath, animated, null));

    // Slack caps custom emoji at 128 KB. Emoji render at 64px, so downscaling an
    // oversized source costs nothing visible.
    if ((await sizeOf(outputPath)) > config.maxUploadBytes) {
      await runMagick(filterArgs(rawPath, outputPath, animated, 128));
    }
    const finalSize = await sizeOf(outputPath);
    if (finalSize > config.maxUploadBytes) {
      throw uploadFailed(
        `the ghostified image is ${Math.round(finalSize / 1024)} KB, over Slack's 128 KB limit.`,
      );
    }

    const uploader = new EmojiAdd(config.subdomain, config.userToken, config.cookie);
    const result = await uploader.uploadSingle({
      is_alias: 0,
      name: targetName,
      url: outputPath,
    });
    if (result?.error) {
      // Someone can win the race between our existence check and this upload.
      if (result.error === "error_name_taken") {
        throw alreadyExists(`\`:${targetName}:\` already exists.`);
      }
      throw uploadFailed(`Slack rejected the upload: ${result.error}`);
    }

    registry.add(targetName, outputPath);
    return targetName;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
};
