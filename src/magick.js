import { config } from "./config.js";

const CANDIDATES = ["magick", "convert"];

let resolved = null;

const works = async (bin, args) => {
  try {
    const child = Bun.spawn([bin, ...args], { stdout: "ignore", stderr: "ignore" });
    return (await child.exited) === 0;
  } catch {
    return false;
  }
};

/**
 * ImageMagick 7 ships a single `magick` binary; the ImageMagick 6 packaged by
 * Debian ships `convert` and `identify` separately. Both accept the argument
 * lists we build, so resolve whichever is present and remember how to reach the
 * identify subcommand through it.
 */
export const resolveMagick = async () => {
  if (resolved) return resolved;
  for (const bin of [config.magickBin, ...CANDIDATES].filter(Boolean)) {
    if (await works(bin, ["-version"])) {
      resolved = { convert: [bin], identify: bin.endsWith("convert") ? ["identify"] : [bin, "identify"] };
      return resolved;
    }
  }
  throw new Error("ImageMagick not found. Install it, or set MAGICK_BIN to the binary path.");
};

const spawn = async (argv) => {
  const child = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code !== 0) {
    const detail = stderr.trim().split("\n").at(-1) || `exit code ${code}`;
    throw new Error(`ImageMagick failed: ${detail}`);
  }
  return stdout;
};

export const runMagick = async (args) => {
  const bin = await resolveMagick();
  await spawn([...bin.convert, ...args]);
};

/** Runs `identify` and returns its stdout. */
export const runIdentify = async (args) => {
  const bin = await resolveMagick();
  return spawn([...bin.identify, ...args]);
};
