/**
 * @author aliasgarbootwala3@gmail.com
 */

/**
 * Opens a request context for the lifetime of one HTTP request.
 *
 * Must be registered before anything that logs, so the body parsers and
 * morgan are already covered.
 */

import { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";

import { runWithRequestContext } from "../utils/requestContext.js";

/** Header a caller can set to supply its own correlation id. */
export const REQUEST_ID_HEADER = "x-request-id";

export const requestContextMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  /*
   * Reuse an inbound id so a request keeps its identity when it arrives
   * through a gateway that already assigned one.
   */
  const inbound = req.headers[REQUEST_ID_HEADER];

  const requestId =
    typeof inbound === "string" && inbound.length <= 64
      ? inbound
      : randomUUID().slice(0, 8);

  /*
   * Express resolves req.ip from the socket. trust proxy is not enabled,
   * so this is the real peer address rather than a client-supplied header.
   */
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";

  const userAgent = String(req.headers["user-agent"] ?? "unknown");

  /* Echo it back so a client can quote it in a bug report. */
  res.setHeader(REQUEST_ID_HEADER, requestId);

  runWithRequestContext(
    { requestId, ip, userAgent, method: req.method, path: req.originalUrl },
    next,
  );
};
