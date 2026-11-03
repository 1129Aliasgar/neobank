/**
 * Structured application logger (Pino).
 *
 * One JSON line per event, machine-readable in Render's log stream and
 * human-readable locally (pino-pretty when stdout is a TTY).
 *
 * Call sites keep the same shape as before:
 *
 *   this.logger.info("user registered", { userId })
 *   this.logger.error("register failed", { error: err.message, stack: err.stack })
 *
 * Every line logged inside a request automatically carries `requestId`, `ip`
 * and (after auth) `userId` from the AsyncLocalStorage context — no argument
 * threading. See `utils/requestContext.ts` and `middlewares/requestContext`.
 *
 * Never log credentials: authorization/cookie headers and password/token
 * fields are redacted at the logger level, so a careless call site cannot leak
 * them into the log stream.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import { injectable } from "inversify";
import pino, { type Logger as PinoLogger, type LoggerOptions } from "pino";

import { env } from "../config/env.js";
import { getRequestContext } from "./requestContext.js";

const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers.set-cookie",
  "password",
  "token",
  "*.password",
  "*.token",
];

const baseOptions: LoggerOptions = {
  level: env.logLevel,
  base: {
    service: "neobank-api",
    env: env.nodeEnv,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: REDACT_PATHS,
    censor: "[redacted]",
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
  /**
   * Pulled at log time rather than passed down: the service/repository layers
   * never see the request object.
   */
  mixin() {
    const context = getRequestContext();

    if (!context) {
      return {};
    }

    return {
      requestId: context.requestId,
      ip: context.ip,
      ...(context.userId ? { userId: context.userId } : {}),
    };
  },
};

/* Pretty output only for a real terminal; deployed stdout stays JSON. */
const usePretty = !env.isProduction && process.stdout.isTTY === true;

export const rootLogger: PinoLogger = pino({
  ...baseOptions,
  ...(usePretty
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname,service,env",
          },
        },
      }
    : {}),
});

@injectable()
export default class Logger {
  debug(message: string, meta: object = {}) {
    rootLogger.debug(meta, message);
  }

  info(message: string, meta: object = {}) {
    rootLogger.info(meta, message);
  }

  warn(message: string, meta: object = {}) {
    rootLogger.warn(meta, message);
  }

  error(message: string, meta: object = {}) {
    rootLogger.error(meta, message);
  }
}
