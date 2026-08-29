import { appendFile, mkdir } from "node:fs/promises";
import { LOG_DIR_PATH, LOG_FILE } from "./config";

// stderr is always written (stdout is reserved for the MCP JSON-RPC stream, and
// `docker logs` captures stderr). When SIXTY60_LOG_DIR is set, the same line is
// also appended to <dir>/mcp-server.log for volume-based log collection.
//
// Never pass secrets here (tokens, OTPs) - lines may be persisted to disk.

let dirReady: Promise<unknown> | null = null;

const ensureLogDir = (): Promise<unknown> => {
  if (!dirReady) {
    dirReady = mkdir(LOG_DIR_PATH as string, { recursive: true });
  }
  return dirReady;
};

export const log = (message: string): void => {
  const line = `${new Date().toISOString()} ${message}\n`;
  process.stderr.write(line);

  const file = LOG_FILE;
  if (!file) {
    return;
  }

  void ensureLogDir()
    .then(() => appendFile(file, line))
    .catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      process.stderr.write(
        `${new Date().toISOString()} log file write failed: ${detail}\n`,
      );
    });
};
