import { byCharacters } from "./standard-emoji.js";

// Slack emoji names are lowercase alphanumerics plus a few punctuation marks.
const SOLE_SHORTCODE = /^:([a-z0-9_+'’-]+):(?::skin-tone-[2-6]:)?$/i;

/**
 * Returns the emoji short name when `text` consists of exactly one emoji and
 * nothing else, or null for anything else (prose, multiple emoji, empty).
 */
export const parseSoleEmoji = (text) => {
  const trimmed = (text || "").trim();
  if (!trimmed) return null;

  const shortcode = SOLE_SHORTCODE.exec(trimmed);
  if (shortcode) return shortcode[1].toLowerCase();

  // A bare Unicode emoji: resolve it to its primary short name so the upload
  // has something to be called.
  return byCharacters.get(trimmed) || null;
};
