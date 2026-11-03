/**
 * Express application wiring.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import "./config/env.js"; // dotenv + validation, must be first
import express from "express";
import "reflect-metadata";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import { randomUUID } from "node:crypto";
import type {
  Application,
  ErrorRequestHandler,
  Request,
  Response,
} from "express";
import { InversifyExpressServer } from "inversify-express-utils";
import { pinoHttp } from "pino-http";
import container from "./config/container.js";
import "./controllers/index.js";
import { TYPES } from "./config/types.js";
import { env } from "./config/env.js";
import { IDatabase } from "./types/database.types.js";
import {
  requestContextMiddleware,
  REQUEST_ID_HEADER,
} from "./middlewares/requestContext.middleware.js";
import { apiLimiter } from "./middlewares/rateLimit.middleware.js";
import { rootLogger } from "./utils/logger.js";
import { STATUS_CODE } from "./constants/constants.js";
import { COMMON_ERRORS } from "./constants/error.js";

const server = new InversifyExpressServer(container);

const db = container.get<IDatabase>(TYPES.Database);

try {
  await db.connect();
} catch (error) {
  rootLogger.fatal({ err: error }, "database connection failed");
  process.exit(1);
}

/**
 * `CORS_ORIGIN` is a comma-separated allow-list. A bare `"*"` cannot be
 * combined with `credentials: true` (the browser rejects it), so in that case
 * the request origin is reflected instead.
 */
function corsOrigin(): boolean | string[] {
  const configured = env.corsOrigin
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (configured.length === 0 || configured.includes("*")) {
    return true;
  }

  return configured;
}

server.setConfig((app: Application) => {
  /*
   * Render terminates TLS in front of the service. Trusting exactly one proxy
   * hop makes `req.ip` the real client address (rate limiting and logs) and
   * refuses to honour a client-supplied X-Forwarded-For chain beyond it.
   */
  if (env.isProduction) {
    app.set("trust proxy", 1);
  }

  app.disable("x-powered-by");

  /*
   * Structured HTTP logging first: it assigns `req.id`, so every following
   * layer — body parsers, auth, services — is correlated with one request id.
   * Health checks are excluded to keep uptime probes out of the log stream.
   */
  app.use(
    pinoHttp({
      logger: rootLogger,
      quietReqLogger: true,
      genReqId(req, res) {
        const inbound = req.headers[REQUEST_ID_HEADER];

        const id =
          typeof inbound === "string" && inbound.length <= 64
            ? inbound
            : randomUUID().slice(0, 8);

        res.setHeader(REQUEST_ID_HEADER, id);

        return id;
      },
      autoLogging: {
        ignore: (req) => req.url === "/api/v1/health",
      },
      customLogLevel(_req, res, err) {
        if (err || res.statusCode >= 500) {
          return "error";
        }

        return res.statusCode >= 400 ? "warn" : "info";
      },
      serializers: {
        req(req) {
          return { id: req.id, method: req.method, url: req.url };
        },
        res(res) {
          return { statusCode: res.statusCode };
        },
      },
    }),
  );

  app.use(requestContextMiddleware);

  /*
   * Security headers. The API is cross-origin to the Netlify frontend, so the
   * resource policy must allow that; the rest of helmet's defaults stand.
   */
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );

  /* JSON responses compress on anything above ~1 KB. */
  app.use(compression());

  /*
   * Webhooks are the one route that needs the exact transmitted bytes: HMAC is
   * computed over them, and parse-then-stringify breaks the signature. Mounted
   * before the JSON parser so `req.body` stays a Buffer. The raw parser marks
   * the request as read, so `express.json` below skips it.
   */
  app.use(
    "/api/v1/webhooks",
    express.raw({ type: "application/json", limit: "256kb" }),
  );

  app.use(express.json({ limit: "16kb" }));
  app.use(express.urlencoded({ extended: true, limit: "16kb" }));
  app.use(cookieParser());

  app.use(
    cors({
      origin: corsOrigin(),
      credentials: true,
    }),
  );

  /* Applied to every API route; health checks are exempt. */
  app.use(apiLimiter);

  /* Registered before the inversify routes so it is reachable. */
  app.get("/api/v1/health", (_req: Request, res: Response) => {
    res.status(STATUS_CODE.OK).json({ status: "ok" });
  });
});

server.setErrorConfig((app: Application) => {
  app.use((_req: Request, res: Response) => {
    res.status(STATUS_CODE.NOT_FOUND).json({
      message: COMMON_ERRORS.NOT_FOUND,
      success: false,
    });
  });

  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    const statusCode =
      typeof error?.statusCode === "number"
        ? error.statusCode
        : typeof error?.status === "number"
          ? error.status
          : STATUS_CODE.INTERNAL_SERVER_ERROR;

    /* Body-parser errors are client faults, not server faults. */
    const message =
      statusCode < 500
        ? (error?.message ?? COMMON_ERRORS.VALIDATION_FAILED)
        : COMMON_ERRORS.INTERNAL_SERVER_ERROR;

    rootLogger.error(
      {
        err: error instanceof Error ? error : undefined,
        statusCode,
      },
      "unhandled request error",
    );

    res.status(statusCode).json({ message, success: false });
  };

  app.use(errorHandler);
});

const app = server.build();

export default app;
