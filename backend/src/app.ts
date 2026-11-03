/**
 * Express application wiring.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import "./config/config.js";
import express from "express";
import "reflect-metadata";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import cors from "cors";
import type {
  Application,
  ErrorRequestHandler,
  Request,
  Response,
} from "express";
import { InversifyExpressServer } from "inversify-express-utils";
import container from "./config/container.js";
import "./controllers/index.js";
import { TYPES } from "./config/types.js";
import { IDatabase } from "./types/database.types.js";
import { requestContextMiddleware } from "./middlewares/requestContext.middleware.js";
import { STATUS_CODE } from "./constants/constants.js";
import { COMMON_ERRORS } from "./constants/error.js";

const server = new InversifyExpressServer(container);

const db = container.get<IDatabase>(TYPES.Database);

try {
  await db.connect();
} catch (error) {
  console.error("Failed to connect to the database:", error);
  process.exit(1);
}

/**
 * `CORS_ORIGIN` is a comma-separated allow-list. A bare `"*"` cannot be
 * combined with `credentials: true` (the browser rejects it), so in that case
 * the request origin is reflected instead.
 */
function corsOrigin(): boolean | string[] {
  const configured = (process.env.CORS_ORIGIN ?? "")
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
   * First, so every later log line — including the body parsers and
   * morgan — carries the request id.
   */
  app.use(requestContextMiddleware);

  app.use(express.json({ limit: "16kb" }));
  app.use(express.urlencoded({ extended: true, limit: "16kb" }));
  app.use(morgan("dev"));
  app.use(cookieParser());

  app.use(
    cors({
      origin: corsOrigin(),
      credentials: true,
    }),
  );

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

    res.status(statusCode).json({ message, success: false });
  };

  app.use(errorHandler);
});

const app = server.build();

export default app;
