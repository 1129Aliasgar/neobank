/**
 * Rate limiting.
 *
 * Three buckets, deliberately separate:
 *
 * - `apiLimiter`      broad protection for every API route (one client cannot
 *                     hammer the service or the database)
 * - `loginLimiter`    brute-force protection; successful logins are not counted
 * - `registerLimiter` account-creation abuse; counts every attempt
 *
 * In-memory store: correct for a single Render instance, which is what this
 * deployment is. A multi-instance deployment must move the store to Redis,
 * otherwise each instance enforces its own bucket.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import rateLimit from "express-rate-limit";
import { STATUS_CODE } from "../constants/constants.js";

/** `draft-8` emits the modern `RateLimit` header; no legacy X-RateLimit-*. */
const headers = {
  standardHeaders: "draft-8" as const,
  legacyHeaders: false,
};

function errorBody(message: string) {
  return {
    statusCode: STATUS_CODE.TOO_MANY_REQUESTS,
    message,
    success: false,
  };
}

/**
 * Broad ceiling: 300 requests / 15 minutes / client.
 *
 * Webhooks are exempt: their credential is the HMAC signature, they are
 * machine-to-machine, and Didit's bounded retry policy means a 429 is never
 * retried — a throttled delivery would lose the decision.
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  ...headers,
  skip: (req) =>
    req.path === "/api/v1/health" ||
    req.path.startsWith("/api/v1/webhooks"),
  message: errorBody("Too many requests. Please try again later."),
});

/**
 * 10 failed logins / 15 minutes / client. `skipSuccessfulRequests` means a
 * legitimate user who logs in normally never consumes the budget.
 */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  ...headers,
  message: errorBody(
    "Too many login attempts. Please try again in 15 minutes.",
  ),
});

/** 10 registrations / hour / client. */
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  ...headers,
  message: errorBody(
    "Too many accounts created from this address. Please try again later.",
  ),
});

/**
 * 10 session creations / minute / business. The key is the authenticated
 * business, not the IP: a shared office NAT must not rate-limit an entire team,
 * and one business must not be able to spam the provider.
 */
export const verificationLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  ...headers,
  keyGenerator: (req) => req.user?.businessId ?? "anonymous",
  message: errorBody(
    "Too many verification attempts. Please try again in a minute.",
  ),
});

/**
 * 50 invitation writes / hour / business. The key is the tenant, not the IP:
 * an office sharing one address must not throttle the whole team.
 */
export const teamLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 50,
  ...headers,
  keyGenerator: (req) => req.user?.businessId ?? "anonymous",
  message: errorBody(
    "Too many team changes from this business. Please try again later.",
  ),
});
