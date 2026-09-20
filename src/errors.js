/** An error with a message that is safe to post back into Slack. */
export class GhostfyError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = "GhostfyError";
    this.kind = kind;
  }
}

export const notFound = (message) => new GhostfyError("not_found", message);
export const processingFailed = (message) => new GhostfyError("processing", message);
export const uploadFailed = (message) => new GhostfyError("upload", message);
export const alreadyExists = (message) => new GhostfyError("exists", message);
