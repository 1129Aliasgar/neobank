import { controller, httpGet, httpPost } from "inversify-express-utils";
import { inject } from "inversify";
import type { Request, Response } from "express";
import BaseController from "./base.controller.js";
import { TYPES } from "../config/types.js";
import LedgerService from "../services/ledger.service.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { BUSINESS_ADMIN_ROLES, STATUS_CODE } from "../constants/constants.js";
import { LEDGER_ERRORS } from "../constants/error.js";
import ApiError from "../utils/apiError.js";

@controller("/api/v1/accounts")
export default class LedgerController extends BaseController {
  @inject(TYPES.LedgerService) private readonly ledger!: LedgerService;

  @httpGet("/current", authMiddleware(BUSINESS_ADMIN_ROLES))
  async current(req: Request, res: Response) {
    try {
      return this.success(
        res,
        await this.ledger.getAccount(req.user!.businessId, req.user!.role),
        STATUS_CODE.OK,
      );
    } catch (e) {
      return this.handleError(res, e);
    }
  }

  @httpPost("/current/deposits", authMiddleware(BUSINESS_ADMIN_ROLES))
  async deposit(req: Request, res: Response) {
    try {
      const key = req.header("Idempotency-Key");
      if (!key) throw new ApiError(LEDGER_ERRORS.IDEMPOTENCY_KEY_REQUIRED, 400);
      const result = await this.ledger.deposit(
        req.user!.businessId,
        req.user!.userId,
        req.user!.role,
        key,
        req.body,
      );
      if (result.replayed) res.setHeader("Idempotent-Replay", "true");
      return this.success(
        res,
        result,
        result.replayed ? STATUS_CODE.OK : STATUS_CODE.CREATED,
      );
    } catch (e) {
      return this.handleError(res, e);
    }
  }

  @httpGet("/current/transactions", authMiddleware(BUSINESS_ADMIN_ROLES))
  async transactions(req: Request, res: Response) {
    try {
      return this.success(
        res,
        await this.ledger.listTransactions(
          req.user!.businessId,
          req.user!.role,
          req.query as { limit?: string; cursor?: string; kind?: string },
        ),
        STATUS_CODE.OK,
      );
    } catch (e) {
      return this.handleError(res, e);
    }
  }

  @httpGet("/current/transactions/:id", authMiddleware(BUSINESS_ADMIN_ROLES))
  async transaction(req: Request, res: Response) {
    try {
      const id =
        typeof req.params.id === "string" ? req.params.id : req.params.id[0];
      return this.success(
        res,
        await this.ledger.getTransaction(
          req.user!.businessId,
          req.user!.role,
          id,
        ),
        STATUS_CODE.OK,
      );
    } catch (e) {
      return this.handleError(res, e);
    }
  }

  @httpPost("/current/holds", authMiddleware(BUSINESS_ADMIN_ROLES))
  async hold(req: Request, res: Response) {
    try {
      const key = req.header("Idempotency-Key");
      if (!key) throw new ApiError(LEDGER_ERRORS.IDEMPOTENCY_KEY_REQUIRED, 400);
      const result = await this.ledger.reserve(
        req.user!.businessId,
        req.user!.userId,
        req.user!.role,
        key,
        req.body,
      );
      if (result.replayed) res.setHeader("Idempotent-Replay", "true");
      return this.success(
        res,
        result,
        result.replayed ? STATUS_CODE.OK : STATUS_CODE.CREATED,
      );
    } catch (e) {
      return this.handleError(res, e);
    }
  }

  @httpPost("/current/holds/:id/capture", authMiddleware(BUSINESS_ADMIN_ROLES))
  async capture(req: Request, res: Response) {
    try {
      const key = req.header("Idempotency-Key");
      if (!key) throw new ApiError(LEDGER_ERRORS.IDEMPOTENCY_KEY_REQUIRED, 400);
      const id =
        typeof req.params.id === "string" ? req.params.id : req.params.id[0];
      return this.success(
        res,
        await this.ledger.capture(
          req.user!.businessId,
          req.user!.userId,
          req.user!.role,
          id,
          key,
          req.body,
        ),
        STATUS_CODE.CREATED,
      );
    } catch (e) {
      return this.handleError(res, e);
    }
  }

  @httpPost("/current/holds/:id/release", authMiddleware(BUSINESS_ADMIN_ROLES))
  async release(req: Request, res: Response) {
    try {
      const key = req.header("Idempotency-Key");
      if (!key) throw new ApiError(LEDGER_ERRORS.IDEMPOTENCY_KEY_REQUIRED, 400);
      const id =
        typeof req.params.id === "string" ? req.params.id : req.params.id[0];
      return this.success(
        res,
        await this.ledger.release(
          req.user!.businessId,
          req.user!.role,
          id,
          key,
        ),
        STATUS_CODE.OK,
      );
    } catch (e) {
      return this.handleError(res, e);
    }
  }
}
