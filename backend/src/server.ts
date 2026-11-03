/**
 * Process entry point: owns the HTTP listener and the shutdown sequence.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import http from "node:http";
import app from "./app.js";
import { env } from "./config/env.js";
import container from "./config/container.js";
import { TYPES } from "./config/types.js";
import { rootLogger } from "./utils/logger.js";
import type { IDatabase } from "./types/database.types.js";

const server = http.createServer(app);

const PORT = env.port;

server.listen(PORT, () => {
  rootLogger.info({ port: PORT }, "server listening");
});

/**
 * Finish in-flight requests, then close the database pool. Without this a
 * deploy/restart leaves connections open until the provider times them out.
 */
async function shutdown(signal: string) {
  rootLogger.info({ signal }, "shutting down");

  server.close(async () => {
    try {
      await container.get<IDatabase>(TYPES.Database).disconnect();
    } catch (error) {
      rootLogger.error({ err: error }, "error during shutdown");
    } finally {
      process.exit(0);
    }
  });

  /* Do not hang forever on a stuck socket. */
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
