/**
 * Business onboarding HTTP surface.
 *
 * Routes:
 *   GET   /api/v1/businesses/current
 *   PATCH /api/v1/businesses/current
 *   POST  /api/v1/businesses/current/verification
 *   GET   /api/v1/businesses/current/verification
 *   GET   /api/v1/businesses/current/verification/history
 *   POST  /api/v1/businesses/current/verification/simulate   (sandbox only)
 *
 * The business id always comes from the token, never from the client.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import { controller, httpGet, httpPatch, httpPost } from "inversify-express-utils";
import { inject } from "inversify";
import type { Request, Response } from "express";
import { TYPES } from "../config/types.js";
import BaseController from "./base.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { verificationLimiter } from "../middlewares/rateLimit.middleware.js";
import {
  ALL_USER_ROLES,
  BUSINESS_ADMIN_ROLES,
  STATUS_CODE,
  USER_ROLE,
} from "../constants/constants.js";
import { updateBusinessSchema } from "../validators/business.validator.js";
import { simulateVerificationSchema } from "../validators/verification.validator.js";
import { validateOrThrow } from "../validators/validate.js";
import BusinessService from "../services/business.service.js";
import VerificationService from "../services/verification.service.js";
import Logger from "../utils/logger.js";
import type { UpdateBusinessInput } from "../types/business.types.js";
import type { SimulatorScenario } from "../integrations/simulator/simulator.provider.js";

/** Ops may read the attempt history; employees may not. */
const HISTORY_ROLES = [
  USER_ROLE.OWNER,
  USER_ROLE.ADMIN,
  USER_ROLE.OPERATIONS,
] as const;

@controller("/api/v1/businesses")
export default class BusinessController extends BaseController {
  @inject(TYPES.BusinessService)
  businessService!: BusinessService;

  @inject(TYPES.VerificationService)
  verificationService!: VerificationService;

  @inject(TYPES.Logger)
  logger!: Logger;

  @httpGet("/current", authMiddleware(ALL_USER_ROLES))
  async current(req: Request, res: Response) {
    try {
      const result = await this.businessService.getCurrent(
        req.user!.businessId,
        req.user!.role,
      );

      return this.success(res, result, STATUS_CODE.OK);
    } catch (error) {
      return this.handleError(res, error);
    }
  }

  @httpPatch("/current", authMiddleware(BUSINESS_ADMIN_ROLES))
  async update(req: Request, res: Response) {
    try {
      const body = validateOrThrow<typeof updateBusinessSchema>(
        updateBusinessSchema,
        req.body,
      );

      const result = await this.businessService.updateCurrent(
        req.user!.userId,
        req.user!.businessId,
        req.user!.role,
        body as UpdateBusinessInput,
      );

      return this.success(res, result, STATUS_CODE.OK);
    } catch (error) {
      return this.handleError(res, error);
    }
  }

  @httpPost(
    "/current/verification",
    authMiddleware(BUSINESS_ADMIN_ROLES),
    verificationLimiter,
  )
  async startVerification(req: Request, res: Response) {
    try {
      const result = await this.verificationService.start(
        req.user!.userId,
        req.user!.businessId,
      );

      return this.success(res, result, STATUS_CODE.CREATED);
    } catch (error) {
      return this.handleError(res, error);
    }
  }

  @httpGet("/current/verification", authMiddleware(ALL_USER_ROLES))
  async verification(req: Request, res: Response) {
    try {
      const verification = await this.verificationService.getLatest(
        req.user!.businessId,
        { sync: true },
      );

      return this.success(res, { verification }, STATUS_CODE.OK);
    } catch (error) {
      return this.handleError(res, error);
    }
  }

  @httpGet("/current/verification/history", authMiddleware([...HISTORY_ROLES]))
  async verificationHistory(req: Request, res: Response) {
    try {
      const verifications = await this.verificationService.history(
        req.user!.businessId,
      );

      return this.success(res, { verifications }, STATUS_CODE.OK);
    } catch (error) {
      return this.handleError(res, error);
    }
  }

  @httpPost(
    "/current/verification/simulate",
    authMiddleware(BUSINESS_ADMIN_ROLES),
    verificationLimiter,
  )
  async simulate(req: Request, res: Response) {
    try {
      const body = validateOrThrow(simulateVerificationSchema, req.body);

      const verification = await this.verificationService.simulate(
        req.user!.userId,
        req.user!.businessId,
        body.scenario as SimulatorScenario,
      );

      return this.success(res, { verification }, STATUS_CODE.OK);
    } catch (error) {
      return this.handleError(res, error);
    }
  }
}
