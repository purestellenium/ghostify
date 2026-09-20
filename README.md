# ghostfy

A Slack bot that watches one channel. When someone posts a message that is
**nothing but a single emoji**, it downloads that emoji, runs a grayscale +
ordered-dither pass over it, uploads the result as `:ghost-<name>:`, and replies
in thread.

```
user: :parrot:
  └─ ghostfy: Ghostified! :ghost-parrot:

user: :parrot:            (second time)
  └─ ghostfy: `:ghost-parrot:` already exists — :ghost-parrot:
```

## How it works

**Trigger.** Only messages whose entire trimmed text is one emoji — either
`:shortcode:` (optionally with a `::skin-tone-N:` suffix) or a bare Unicode
character like 👻. Anything with surrounding prose, or two emoji, is ignored.
A bare Unicode emoji resolves to its primary short name from `emoji-datasource`,
so 👻 becomes `:ghost-ghost:`.

**Ignored entirely**, with no reply: messages already named `ghost-*`, messages
from bots and apps (including itself), thread replies, and edits.

**Source resolution.** A custom workspace emoji wins, following `alias:` chains
with a cycle guard. Otherwise the name is looked up in `emoji-datasource` and
fetched from Slack's standard-emoji CDN.

**The filter.** `-colorspace gray -ordered-dither o4x4,16` — a 4×4 Bayer matrix
quantising each channel to 16 levels. It lands on the alpha channel too, which
is what stipples the anti-aliased edges into the ghostly look. Animated GIFs get
`-coalesce` first (frames are delta-encoded and would filter incorrectly) and
`-layers Optimize` after. If the result exceeds Slack's 128 KB emoji limit it is
re-rendered at 128px; still over, and the bot says so rather than failing silently.

**Uploads are serialised.** `emoji.list` and `emoji.add` are both rate limited,
so a burst in the channel is processed one at a time.

## Why two sets of credentials

Slack has no bot-scoped API for adding custom emoji. Listening and replying use
a normal bot token; the upload goes through `emoji.add` with a browser session
(`xoxc-` token + `xoxd-` cookie), via [emojme](https://github.com/jackellenberger/emojme).

## Slack app setup

Create a **new** app at api.slack.com/apps — do not reuse an existing one. Slack
load-balances Socket Mode events across an app's open connections, so two
different bots sharing one app token each lose roughly half their events.

1. **Socket Mode** → enable. Generate an app-level token with `connections:write`
   → `SLACK_APP_TOKEN`.
2. **OAuth & Permissions** → bot token scopes: `channels:history`, `chat:write`,
   `emoji:read`. Install to the workspace → `SLACK_BOT_TOKEN`.
3. **Event Subscriptions** → enable, subscribe to bot event `message.channels`.
4. Invite the bot to the target channel: `/invite @ghostfy`.
5. From a logged-in Slack tab: the `xoxc-` token from local storage and the `d`
   cookie value (`xoxd-…`) → `SLACK_USER_TOKEN` and `SLACK_COOKIE`.

## Configuration

Copy `.env.example` to `.env`. Every credential is checked at boot, so a bad
deploy fails immediately rather than on the first emoji posted.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `SLACK_APP_TOKEN` | yes | — | Socket Mode app-level token (`xapp-`) |
| `SLACK_BOT_TOKEN` | yes | — | Bot user token (`xoxb-`) |
| `SLACK_USER_TOKEN` | yes | — | Browser session token (`xoxc-`) |
| `SLACK_COOKIE` | yes | — | Browser `d` cookie (`xoxd-`) |
| `SLACK_SUBDOMAIN` | no | `hackclub` | Workspace subdomain |
| `GHOSTFY_CHANNEL` | no | `C0C343T6GLA` | The one channel to watch |
| `GHOSTFY_PREFIX` | no | `ghost-` | Prefix for uploaded emoji |
| `EMOJI_CACHE_TTL_MS` | no | `30000` | How long the emoji list is cached |
| `MAGICK_BIN` | no | auto | ImageMagick binary; auto-detects `magick` then `convert` |
| `PORT` | no | `3000` | Health-check port |

## Running

```sh
bun install
bun run index.js
```

Requires ImageMagick. The bot resolves `magick` (v7) or `convert` (the v6 Debian
ships) and refuses to start if neither is present.

## Deploying

The `Dockerfile` is Bun on Debian with ImageMagick installed. Socket Mode needs
no inbound traffic, but the process serves `200 OK` on `PORT` so a platform has
something to health-check.
