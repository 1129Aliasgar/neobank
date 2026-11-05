/**
 * Auth HTTP surface.
 *
 * Routes:
 *   POST /api/v1/auth/register
 *   POST /api/v1/auth/login
 *   GET  /api/v1/auth/me        (Bearer token or httpOnly cookie)
 *   POST /api/v1/auth/logout
 *
 * The token cookie is written through `utils/authCookie`, so production gets
 * the `__Host-` prefix that makes cookie tossing impossible.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import { controller, httpGet, httpPost } from "inversify-express-utils";
import { inject } from "inversify";
import type { Request, Response } from "express";
import { TYPES } from "../config/types.js";
import BaseController from "./base.controller.js";
import { ALL_USER_ROLES, STATUS_CODE } from "../constants/constants.js";
import { loginSchema, registerSchema } from "../validators/user.validator.js";
import { validateOrThrow } from "../validators/validate.js";
import AuthService from "../services/auth.service.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import {
  loginLimiter,
  registerLimiter,
} from "../middlewares/rateLimit.middleware.js";
import {
  clearAuthCookies,
  extractToken,
  setAuthCookie,
} from "../utils/authCookie.js";
import Logger from "../utils/logger.js";

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

      setAuthCookie(res, result.token);

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

      setAuthCookie(res, result.token);

      return this.success(res, result, STATUS_CODE.OK);
    } catch (error) {
      return this.handleError(res, error);
    }
  }

  /** The signed-in user and their onboarding state. */
  @httpGet("/me", authMiddleware(ALL_USER_ROLES))
  async me(req: Request, res: Response) {
    return this.currentSession(req, res);
  }

  @httpPost("/logout", authMiddleware(ALL_USER_ROLES))
  async logout(req: Request, res: Response) {
    try {
      await this.authService.logout({
        token: extractToken(req),
        userId: req.user!.userId,
      });

      clearAuthCookies(res);

      return this.success(
        res,
        { message: "Logged out successfully" },
        STATUS_CODE.OK,
      );
    } catch (error) {
      return this.handleError(res, error);
    }
  }

  private async currentSession(req: Request, res: Response) {
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
}
