import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const emojiData = require("emoji-datasource");

const VARIATION_SELECTOR = /️/g;

const charsFor = (unified) =>
  unified
    .split("-")
    .map((hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .join("");

/** name -> emoji-datasource record, for every short name including aliases. */
export const byShortName = new Map();
/** literal emoji characters -> primary short name. */
export const byCharacters = new Map();

const indexCharacters = (unified, shortName) => {
  if (!unified || !shortName) return;
  const characters = charsFor(unified);
  // Index with and without the variation selector: a picker inserts it, a
  // pasted character often does not.
  for (const key of [characters, characters.replace(VARIATION_SELECTOR, "")]) {
    if (key && !byCharacters.has(key)) byCharacters.set(key, shortName);
  }
};

for (const emoji of emojiData) {
  for (const shortName of emoji.short_names || []) {
    if (!byShortName.has(shortName)) byShortName.set(shortName, emoji);
  }

  const primary = emoji.short_names?.[0];
  indexCharacters(emoji.unified, primary);
  // Skin-tone variants collapse onto the base name; we ghostify the base emoji.
  for (const variation of Object.values(emoji.skin_variations || {})) {
    indexCharacters(variation.unified, primary);
  }
}

/** Slack's CDN URL for a standard Unicode emoji. */
export const standardImageUrl = (emoji) => {
  if (!emoji?.unified) return null;
  const codepoints = emoji.unified.toLowerCase().replaceAll("_", "-");
  return `https://a.slack-edge.com/production-standard-emoji-assets/16.0/apple-medium/${codepoints}@2x.png`;
};
