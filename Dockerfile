FROM oven/bun:1-debian

# ImageMagick does the grayscale + ordered-dither pass. Debian ships v6, which
# provides `convert` rather than `magick`; src/magick.js resolves either.
RUN apt-get update \
  && apt-get install -y --no-install-recommends imagemagick ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY index.js ./
COPY src ./src

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "run", "index.js"]
