import { controller, httpGet, httpPost } from "inversify-express-utils";
import { inject } from "inversify";
import type { Request, Response } from "express";
import BaseController from "./base.controller.js";
import LedgerService from "../services/ledger.service.js";
import { TYPES } from "../config/types.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { STATUS_CODE, USER_ROLE } from "../constants/constants.js";
import ApiError from "../utils/apiError.js";
import { LEDGER_ERRORS } from "../constants/error.js";

@controller("/api/v1/operations/ledger")
export default class OperationsController extends BaseController {
  @inject(TYPES.LedgerService) private readonly ledger!: LedgerService;
  @httpGet("/integrity", authMiddleware([USER_ROLE.OPERATIONS]))
  async integrity(_req: Request, res: Response) {
    try {
      return this.success(res, await this.ledger.integrity(), STATUS_CODE.OK);
    } catch (e) {
      return this.handleError(res, e);
    }
  }

  @httpPost(
    "/transactions/:id/reverse",
    authMiddleware([USER_ROLE.OPERATIONS, USER_ROLE.OWNER, USER_ROLE.ADMIN]),
  )
  async reverse(req: Request, res: Response) {
    try {
      const key = req.header("Idempotency-Key");
      if (!key) throw new ApiError(LEDGER_ERRORS.IDEMPOTENCY_KEY_REQUIRED, 400);
      const id =
        typeof req.params.id === "string" ? req.params.id : req.params.id[0];
      return this.success(
        res,
        await this.ledger.reverse(
          req.user!.businessId,
          req.user!.userId,
          req.user!.role,
          id,
          key,
        ),
        STATUS_CODE.CREATED,
      );
    } catch (e) {
      return this.handleError(res, e);
    }
  }
}
