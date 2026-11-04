/**
 * Team HTTP surface.
 *
 * Routes:
 *   GET    /api/v1/team
 *   POST   /api/v1/team/invitations
 *   GET    /api/v1/team/invitations/:token          (public)
 *   POST   /api/v1/team/invitations/:token/accept   (signed in)
 *   POST   /api/v1/team/invitations/:token/register (public, token-gated)
 *   POST   /api/v1/team/invitations/:id/resend
 *   DELETE /api/v1/team/invitations/:id
 *   PATCH  /api/v1/team/members/:id
 *   DELETE /api/v1/team/members/:id
 *
 * @author aliasgarbootwala3@gmail.com
 */

import {
  controller,
  httpDelete,
  httpGet,
  httpPatch,
  httpPost,
} from "inversify-express-utils";
import { inject } from "inversify";
import type { Request, Response } from "express";
import { TYPES } from "../config/types.js";
import BaseController from "./base.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import {
  registerLimiter,
  teamLimiter,
} from "../middlewares/rateLimit.middleware.js";
import {
  ALL_USER_ROLES,
  BUSINESS_ADMIN_ROLES,
  STATUS_CODE,
  USER_ROLE,
} from "../constants/constants.js";
import {
  changeRoleSchema,
  inviteMemberSchema,
  registerFromInvitationSchema,
} from "../validators/team.validator.js";
import { validateOrThrow } from "../validators/validate.js";
import TeamService from "../services/team.service.js";
import { setAuthCookie } from "../utils/authCookie.js";

function param(req: Request, name: string): string {
  const value = req.params[name];
  return typeof value === "string" ? value : (value?.[0] ?? "");
}

@controller("/api/v1/team")
export default class TeamController extends BaseController {
  @inject(TYPES.TeamService)
  private readonly team!: TeamService;

  @httpGet("", authMiddleware(BUSINESS_ADMIN_ROLES))
  async list(req: Request, res: Response) {
    try {
      return this.success(
        res,
        await this.team.list(
          req.user!.userId,
          req.user!.businessId,
          req.user!.role,
        ),
        STATUS_CODE.OK,
      );
    } catch (error) {
      return this.handleError(res, error);
    }
  }

  @httpPost("/invitations", authMiddleware(BUSINESS_ADMIN_ROLES), teamLimiter)
  async invite(req: Request, res: Response) {
    try {
      const body = validateOrThrow(inviteMemberSchema, req.body);
      const result = await this.team.invite(
        req.user!.userId,
        req.user!.businessId,
        req.user!.role,
        body,
      );
      return this.success(res, result, STATUS_CODE.CREATED);
    } catch (error) {
      return this.handleError(res, error);
    }
  }

  /** Public metadata for the invitation page. The token is the credential. */
  @httpGet("/invitations/:token")
  async resolve(req: Request, res: Response) {
    try {
      return this.success(
        res,
        await this.team.resolve(param(req, "token")),
        STATUS_CODE.OK,
      );
    } catch (error) {
      return this.handleError(res, error);
    }
  }

  @httpPost("/invitations/:token/accept", authMiddleware(ALL_USER_ROLES))
  async accept(req: Request, res: Response) {
    try {
      const result = await this.team.accept(
        req.user!.userId,
        param(req, "token"),
      );
      setAuthCookie(res, result.token);
      return this.success(res, result, STATUS_CODE.OK);
    } catch (error) {
      return this.handleError(res, error);
    }
  }

  @httpPost("/invitations/:token/register", registerLimiter)
  async register(req: Request, res: Response) {
    try {
      const body = validateOrThrow(registerFromInvitationSchema, req.body);
      const result = await this.team.registerFromInvitation(
        param(req, "token"),
        body,
      );
      setAuthCookie(res, result.token);
      return this.success(res, result, STATUS_CODE.CREATED);
    } catch (error) {
      return this.handleError(res, error);
    }
  }

  @httpPost(
    "/invitations/:id/resend",
    authMiddleware(BUSINESS_ADMIN_ROLES),
    teamLimiter,
  )
  async resend(req: Request, res: Response) {
    try {
      return this.success(
        res,
        await this.team.resend(
          req.user!.userId,
          req.user!.businessId,
          req.user!.role,
          param(req, "id"),
        ),
        STATUS_CODE.OK,
      );
    } catch (error) {
      return this.handleError(res, error);
    }
  }

  @httpDelete("/invitations/:id", authMiddleware(BUSINESS_ADMIN_ROLES))
  async revoke(req: Request, res: Response) {
    try {
      return this.success(
        res,
        await this.team.revoke(
          req.user!.userId,
          req.user!.businessId,
          req.user!.role,
          param(req, "id"),
        ),
        STATUS_CODE.OK,
      );
    } catch (error) {
      return this.handleError(res, error);
    }
  }

  @httpPatch("/members/:id", authMiddleware(USER_ROLE.OWNER))
  async changeRole(req: Request, res: Response) {
    try {
      const body = validateOrThrow(changeRoleSchema, req.body);
      return this.success(
        res,
        await this.team.changeRole(
          req.user!.userId,
          req.user!.businessId,
          req.user!.role,
          param(req, "id"),
          body.role,
        ),
        STATUS_CODE.OK,
      );
    } catch (error) {
      return this.handleError(res, error);
    }
  }

  @httpDelete("/members/:id", authMiddleware(USER_ROLE.OWNER))
  async disableMember(req: Request, res: Response) {
    try {
      return this.success(
        res,
        await this.team.disableMember(
          req.user!.userId,
          req.user!.businessId,
          req.user!.role,
          param(req, "id"),
        ),
        STATUS_CODE.OK,
      );
    } catch (error) {
      return this.handleError(res, error);
    }
  }
}
