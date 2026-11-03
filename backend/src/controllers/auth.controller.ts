/**
 * Auth HTTP surface.
 *
 * Routes:
 *   POST /api/v1/auth/register
 *   POST /api/v1/auth/login
 *   GET  /api/v1/auth/profile   (Bearer token or httpOnly cookie)
 *   POST /api/v1/auth/logout
 *
 * @author aliasgarbootwala3@gmail.com
 */

import { controller, httpGet, httpPost } from "inversify-express-utils";
import { inject } from "inversify";
import type { CookieOptions, Request, Response } from "express";
import { TYPES } from "../config/types.js";
import BaseController from "./base.controller.js";
import { ALL_USER_ROLES, STATUS_CODE } from "../constants/constants.js";
import { env } from "../config/env.js";
import { loginSchema, registerSchema } from "../validators/user.validator.js";
import { validateOrThrow } from "../validators/validate.js";
import AuthService from "../services/auth.service.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import {
  loginLimiter,
  registerLimiter,
} from "../middlewares/rateLimit.middleware.js";
import Logger from "../utils/logger.js";

const TOKEN_COOKIE = "token";

/**
 * Frontend (Vercel) and API (Render) are different sites in production, so a
 * `lax` cookie would simply not be sent on the dashboard's XHR calls. `none`
 * requires `secure`, which is safe because production is HTTPS.
 */
function cookieOptions(): CookieOptions {
  const isProduction = env.isProduction;

  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    path: "/",
  };
}

function extractToken(req: Request): string {
  return (
    req.cookies?.[TOKEN_COOKIE] ??
    req.headers.authorization?.slice("Bearer ".length) ??
    ""
  );
}

@controller("/api/v1/auth")
export default class AuthController extends BaseController {
  @inject(TYPES.AuthService)
  authService!: AuthService;

  @inject(TYPES.Logger)
  logger!: Logger;

  @httpPost("/register", registerLimiter)
  async register(req: Request, res: Response) {
    try {
      const body = validateOrThrow(registerSchema, req.body);

      const result = await this.authService.register(body);

      res.cookie(TOKEN_COOKIE, result.token, cookieOptions());

      return this.success(res, result, STATUS_CODE.CREATED);
    } catch (error) {
      this.logger.error(
        "register: request failed",
        error instanceof Error
          ? { error: error.message, stack: error.stack }
          : { error: String(error) },
      );

      return this.handleError(res, error);
    }
  }

  @httpPost("/login", loginLimiter)
  async login(req: Request, res: Response) {
    try {
      const body = validateOrThrow(loginSchema, req.body);

      const result = await this.authService.login(body);

      res.cookie(TOKEN_COOKIE, result.token, cookieOptions());

      return this.success(res, result, STATUS_CODE.OK);
    } catch (error) {
      return this.handleError(res, error);
    }
  }

  @httpGet("/profile", authMiddleware(ALL_USER_ROLES))
  async profile(req: Request, res: Response) {
    try {
      const result = await this.authService.profile({
        userId: req.user!.userId,
        businessId: req.user!.businessId,
        token: extractToken(req),
      });

      return this.success(res, result, STATUS_CODE.OK);
    } catch (error) {
      return this.handleError(res, error);
    }
  }

  @httpPost("/logout", authMiddleware(ALL_USER_ROLES))
  async logout(req: Request, res: Response) {
    try {
      await this.authService.logout({
        token: extractToken(req),
        userId: req.user!.userId,
      });

      res.clearCookie(TOKEN_COOKIE, cookieOptions());

      return this.success(
        res,
        { message: "Logged out successfully" },
        STATUS_CODE.OK,
      );
    } catch (error) {
      return this.handleError(res, error);
    }
  }
}
