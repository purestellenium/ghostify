import { config } from "./config.js";

const CANDIDATES = ["magick", "convert"];

let resolved = null;

const works = async (bin) => {
  try {
    const child = Bun.spawn([bin, "-version"], { stdout: "ignore", stderr: "ignore" });
    return (await child.exited) === 0;
  } catch {
    return false;
  }
};

// ImageMagick 7 ships `magick`; the ImageMagick 6 packaged by Debian only ships
// `convert`. Both accept the argument list we build, so either will do.
export const resolveMagick = async () => {
  if (resolved) return resolved;
  for (const bin of [config.magickBin, ...CANDIDATES].filter(Boolean)) {
    if (await works(bin)) {
      resolved = bin;
      return resolved;
    }
  }
  throw new Error(
    "ImageMagick not found. Install it, or set MAGICK_BIN to the binary path.",
  );
};

export const runMagick = async (args) => {
  const bin = await resolveMagick();
  const child = Bun.spawn([bin, ...args], { stdout: "pipe", stderr: "pipe" });
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  if (code !== 0) {
    const detail = stderr.trim().split("\n").at(-1) || `exit code ${code}`;
    throw new Error(`ImageMagick failed: ${detail}`);
  }
};
