/**
 * The auth cookie, in one place.
 *
 * Production uses the `__Host-` prefix. The browser only accepts such a cookie
 * when it is `Secure`, `Path=/` and carries **no** `Domain` attribute, which is
 * exactly what defeats **cookie tossing**: a sibling subdomain cannot plant a
 * same-named cookie for the parent domain, because the prefixed name would be
 * rejected. In development the plain name is used so `http://localhost` works.
 *
 * The legacy `token` cookie is never read — only cleared. Accepting it would
 * reintroduce the attack the prefix just closed.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import type { CookieOptions, Request, Response } from "express";
import { env } from "../config/env.js";
import {
  AUTH_COOKIE_NAME,
  AUTH_COOKIE_NAME_DEV,
  LEGACY_AUTH_COOKIE_NAME,
} from "../constants/constants.js";

export function authCookieName(): string {
  return env.isProduction ? AUTH_COOKIE_NAME : AUTH_COOKIE_NAME_DEV;
}

function baseOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.isProduction,
    /*
     * Vercel/Netlify and Render are different sites, so `lax` would not be sent
     * on the dashboard's XHR calls. `none` requires `secure`, which production
     * is.
     */
    sameSite: env.isProduction ? "none" : "lax",
    path: "/",
    /* No `domain`: a host-only cookie cannot be overwritten by a sibling. */
  };
}

export function setAuthCookie(res: Response, token: string): void {
  res.cookie(authCookieName(), token, baseOptions());
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(authCookieName(), baseOptions());

  /* Clear every historical name so an old session cannot survive a logout. */
  res.clearCookie(AUTH_COOKIE_NAME, baseOptions());
  res.clearCookie(AUTH_COOKIE_NAME_DEV, baseOptions());
  res.clearCookie(LEGACY_AUTH_COOKIE_NAME, baseOptions());
}

export function extractToken(req: Request): string {
  const header = req.headers.authorization;

  if (header?.startsWith("Bearer ")) {
    return header.slice("Bearer ".length);
  }

  const cookie = req.cookies?.[authCookieName()];

  return typeof cookie === "string" ? cookie : "";
}
