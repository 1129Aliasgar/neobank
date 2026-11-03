/**
 * Opens a request context for the lifetime of one HTTP request.
 *
 * Must be registered after `pino-http` (which assigns `req.id`) and before
 * anything that logs application events, so body parsers and business logs
 * already carry the request id.
 *
 * @author aliasgarbootwala3@gmail.com
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
   * `pino-http` has already resolved an id (inbound header or generated), so
   * the HTTP log line and every application log share the same value. The
   * fallback keeps the middleware usable on its own.
   */
  const requestId = String(
    req.id ?? req.headers[REQUEST_ID_HEADER] ?? randomUUID().slice(0, 8),
  );

  /*
   * Express resolves req.ip from the socket. In production `trust proxy` is
   * set to one hop in app.ts (Render terminates TLS), so this is the client
   * address rather than the proxy's.
   */
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";

  const userAgent = String(req.headers["user-agent"] ?? "unknown");

  /* Echo it back so a client can quote it in a support request. */
  res.setHeader(REQUEST_ID_HEADER, requestId);

  runWithRequestContext(
    { requestId, ip, userAgent, method: req.method, path: req.originalUrl },
    next,
  );
};
