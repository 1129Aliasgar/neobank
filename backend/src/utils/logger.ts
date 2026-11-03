/**
 * @author aliasgarbootwala3@gmail.com
 */

/**
 * Application logger.
 *
 * Call sites never change:
 *
 *   this.logger.info("user request for register", { userId })
 *   this.logger.error("card authorization webhook failed", { eventId })
 *   this.logger.warn("payment not found", { paymentId })
 *
 * Every line carries the timestamp and, when the call happens inside a
 * request, that request's id, IP and user agent — pulled from
 * AsyncLocalStorage rather than passed in. See `utils/requestContext.ts`.
 */

import { injectable } from "inversify";

import { getRequestContext } from "./requestContext.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * Lines below this level are dropped. `LOG_LEVEL` lets a noisy
 * environment raise the floor without a code change.
 */
function threshold(): number {
  const configured = (process.env.LOG_LEVEL ?? "info").toLowerCase();

  const rank = LEVEL_RANK[configured as LogLevel];

  return rank ?? LEVEL_RANK.info;
}

@injectable()
export default class Logger {
  debug(message: string, meta: object = {}) {
    this.write("debug", message, meta);
  }

  info(message: string, meta: object = {}) {
    this.write("info", message, meta);
  }

  warn(message: string, meta: object = {}) {
    this.write("warn", message, meta);
  }

  /**
   * `meta.stack` and `meta.cause` are rendered on their own lines so an
   * Error survives the trip instead of collapsing to "[object Object]".
   */
  error(message: string, meta: object = {}) {
    this.write("error", message, meta);
  }

  private write(level: LogLevel, message: string, meta: object = {}) {
    if (LEVEL_RANK[level] < threshold()) {
      return;
    }

    const timestamp = new Date().toISOString();
    const context = getRequestContext();

    /*
     * `stack` and `cause` are hoisted out of the printed object: an
     * Error passed inside meta would otherwise serialise as
     * [object Object] and the trace would be lost.
     */
    const { stack, cause, ...fields } = meta as {
      stack?: unknown;
      cause?: unknown;
    };

    const segments = [timestamp, level.toUpperCase().padEnd(5)];

    if (context) {
      segments.push(`[req:${context.requestId}]`);
      segments.push(context.ip);
      segments.push(context.userAgent);

      /* Present once authMiddleware has resolved the token. */
      if (context.userId) {
        segments.push(`(user:${context.userId})`);
      }
    }

    segments.push(message);

    const line = segments.join(" ");

    /*
     * Route by severity so `docker logs` and any downstream collector can
     * filter on the stream, and a failure is not buried on stdout.
     */
    const emit =
      level === "error" || level === "warn" ? console.error : console.log;

    if (Object.keys(fields).length > 0) {
      emit(line, fields);
    } else {
      emit(line);
    }

    if (stack) {
      console.error(typeof stack === "string" ? stack : String(stack));
    }

    if (cause instanceof Error && cause.stack) {
      console.error(cause.stack);
    }
  }
}
