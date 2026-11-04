/**
 * Payment requests and the approval queue.
 *
 *   GET  /api/v1/payments
 *   POST /api/v1/payments
 *   GET  /api/v1/payments/:id
 *   POST /api/v1/payments/:id/approve
 *   POST /api/v1/payments/:id/reject
 *   POST /api/v1/payments/:id/cancel
 *   GET  /api/v1/approvals
 *
 * Approval is a user-only action. There is deliberately no agent route: the
 * service also refuses a non-USER actor as a second line of defence.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import { controller, httpGet, httpPost } from "inversify-express-utils";
import { inject } from "inversify";
import type { Request, Response } from "express";
import { TYPES } from "../config/types.js";
import BaseController from "./base.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import {
  APPROVER_ROLES,
  BUSINESS_ROLES,
  STATUS_CODE,
} from "../constants/constants.js";
import {
  approvePaymentSchema,
  createPaymentSchema,
  listPaymentsSchema,
  rejectPaymentSchema,
} from "../validators/payment.validator.js";
import { validateOrThrow } from "../validators/validate.js";
import PaymentService from "../services/payment.service.js";

function param(req: Request, name: string): string {
  const value = req.params[name];
  return typeof value === "string" ? value : (value?.[0] ?? "");
}

@controller("/api/v1")
export default class PaymentController extends BaseController {
  @inject(TYPES.PaymentService)
  private readonly payments!: PaymentService;

  @httpGet("/payments", authMiddleware(BUSINESS_ROLES))
  async list(req: Request, res: Response) {
    try {
      const query = validateOrThrow(listPaymentsSchema, req.query);
      return this.success(
        res,
        await this.payments.list(
          req.user!.userId,
          req.user!.businessId,
          req.user!.role,
          query,
        ),
        STATUS_CODE.OK,
      );
    } catch (error) {
      return this.handleError(res, error);
    }
  }

  @httpPost("/payments", authMiddleware(BUSINESS_ROLES))
  async create(req: Request, res: Response) {
    try {
      const body = validateOrThrow(createPaymentSchema, req.body);
      const clientRequestId = req.header("Idempotency-Key") ?? undefined;
      const result = await this.payments.create(
        req.user!.userId,
        req.user!.businessId,
        req.user!.role,
        body,
        clientRequestId,
      );
      if (result.replayed) res.setHeader("Idempotent-Replay", "true");
      return this.success(
        res,
        result,
        result.replayed ? STATUS_CODE.OK : STATUS_CODE.CREATED,
      );
    } catch (error) {
      return this.handleError(res, error);
    }
  }

  @httpGet("/payments/:id", authMiddleware(BUSINESS_ROLES))
  async detail(req: Request, res: Response) {
    try {
      return this.success(
        res,
        await this.payments.detail(
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

  @httpPost("/payments/:id/approve", authMiddleware(APPROVER_ROLES))
  async approve(req: Request, res: Response) {
    try {
      const body = validateOrThrow(approvePaymentSchema, req.body);
      return this.success(
        res,
        await this.payments.approve(
          req.user!.userId,
          req.user!.businessId,
          req.user!.role,
          "USER",
          param(req, "id"),
          body.reason,
        ),
        STATUS_CODE.OK,
      );
    } catch (error) {
      return this.handleError(res, error);
    }
  }

  @httpPost("/payments/:id/reject", authMiddleware(APPROVER_ROLES))
  async reject(req: Request, res: Response) {
    try {
      const body = validateOrThrow(rejectPaymentSchema, req.body);
      return this.success(
        res,
        await this.payments.reject(
          req.user!.userId,
          req.user!.businessId,
          req.user!.role,
          "USER",
          param(req, "id"),
          body.reason,
        ),
        STATUS_CODE.OK,
      );
    } catch (error) {
      return this.handleError(res, error);
    }
  }

  @httpPost("/payments/:id/cancel", authMiddleware(BUSINESS_ROLES))
  async cancel(req: Request, res: Response) {
    try {
      return this.success(
        res,
        await this.payments.cancel(
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

  @httpGet("/approvals", authMiddleware(APPROVER_ROLES))
  async queue(req: Request, res: Response) {
    try {
      return this.success(
        res,
        await this.payments.queue(req.user!.businessId, req.user!.role),
        STATUS_CODE.OK,
      );
    } catch (error) {
      return this.handleError(res, error);
    }
  }
}
