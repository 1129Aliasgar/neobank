import { controller, httpGet, httpPost } from "inversify-express-utils";
import { inject } from "inversify";
import type { Request, Response } from "express";
import BaseController from "./base.controller.js";
import CardService from "../services/card.service.js";
import { TYPES } from "../config/types.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import {
  BUSINESS_ROLES,
  BUSINESS_ADMIN_ROLES,
  STATUS_CODE,
} from "../constants/constants.js";

@controller("/api/v1/cards")
export default class CardController extends BaseController {
  @inject(TYPES.CardService) private readonly cards!: CardService;

  @httpGet("/", authMiddleware(BUSINESS_ROLES))
  async list(req: Request, res: Response) {
    try {
      return this.success(
        res,
        await this.cards.list(
          req.user!.businessId,
          req.user!.userId,
          req.user!.role,
        ),
      );
    } catch (error) {
      return this.handleError(res, error);
    }
  }

  /** Employee self-service. Always scoped to the caller, never to a query id. */
  @httpGet("/mine", authMiddleware(BUSINESS_ROLES))
  async mine(req: Request, res: Response) {
    try {
      return this.success(
        res,
        await this.cards.mine(
          req.user!.businessId,
          req.user!.userId,
          req.user!.role,
        ),
      );
    } catch (error) {
      return this.handleError(res, error);
    }
  }

  @httpGet("/eligible-employees", authMiddleware(BUSINESS_ADMIN_ROLES))
  async employees(req: Request, res: Response) {
    try {
      return this.success(
        res,
        await this.cards.eligibleEmployees(
          req.user!.businessId,
          req.user!.role,
        ),
      );
    } catch (error) {
      return this.handleError(res, error);
    }
  }

  @httpGet("/:id", authMiddleware(BUSINESS_ROLES))
  async get(req: Request, res: Response) {
    try {
      return this.success(
        res,
        await this.cards.get(
          req.user!.businessId,
          req.user!.userId,
          req.user!.role,
          String(req.params.id),
        ),
      );
    } catch (error) {
      return this.handleError(res, error);
    }
  }

  @httpPost("/cardholders", authMiddleware(BUSINESS_ADMIN_ROLES))
  async cardholder(req: Request, res: Response) {
    try {
      return this.success(
        res,
        await this.cards.createCardholder(
          req.user!.businessId,
          req.user!.role,
          String(req.body?.userId ?? ""),
        ),
        STATUS_CODE.CREATED,
      );
    } catch (error) {
      return this.handleError(res, error);
    }
  }

  @httpPost("/", authMiddleware(BUSINESS_ADMIN_ROLES))
  async issue(req: Request, res: Response) {
    try {
      return this.success(
        res,
        await this.cards.issue(
          req.user!.businessId,
          req.user!.role,
          req.user!.userId,
          req.body,
        ),
        STATUS_CODE.CREATED,
      );
    } catch (error) {
      return this.handleError(res, error);
    }
  }

  @httpPost("/:id/freeze", authMiddleware(BUSINESS_ROLES))
  async freeze(req: Request, res: Response) {
    try {
      return this.success(
        res,
        await this.cards.updateStatus(
          req.user!.businessId,
          req.user!.userId,
          req.user!.role,
          String(req.params.id),
          "PAUSED",
        ),
      );
    } catch (error) {
      return this.handleError(res, error);
    }
  }

  @httpPost("/:id/unfreeze", authMiddleware(BUSINESS_ADMIN_ROLES))
  async unfreeze(req: Request, res: Response) {
    try {
      return this.success(
        res,
        await this.cards.updateStatus(
          req.user!.businessId,
          req.user!.userId,
          req.user!.role,
          String(req.params.id),
          "ACTIVE",
        ),
      );
    } catch (error) {
      return this.handleError(res, error);
    }
  }

  @httpPost("/:id/cancel", authMiddleware(BUSINESS_ADMIN_ROLES))
  async cancel(req: Request, res: Response) {
    try {
      return this.success(
        res,
        await this.cards.updateStatus(
          req.user!.businessId,
          req.user!.userId,
          req.user!.role,
          String(req.params.id),
          "CANCELED",
        ),
      );
    } catch (error) {
      return this.handleError(res, error);
    }
  }

  @httpGet("/:id/authorizations", authMiddleware(BUSINESS_ROLES))
  async authorizations(req: Request, res: Response) {
    try {
      return this.success(
        res,
        await this.cards.authorizations(
          req.user!.businessId,
          req.user!.userId,
          req.user!.role,
          String(req.params.id),
        ),
      );
    } catch (error) {
      return this.handleError(res, error);
    }
  }

  /*
   * Sandbox drivers. They are admin-only, refuse production, and always route
   * through the signed webhook path so signature verification and idempotency
   * are exercised rather than bypassed.
   */
  @httpPost("/:id/simulate/authorize", authMiddleware(BUSINESS_ADMIN_ROLES))
  async simulateAuthorize(req: Request, res: Response) {
    try {
      return this.success(
        res,
        await this.cards.simulateAuthorization(
          req.user!.businessId,
          req.user!.role,
          String(req.params.id),
          req.body ?? {},
        ),
        STATUS_CODE.CREATED,
      );
    } catch (error) {
      return this.handleError(res, error);
    }
  }

  @httpPost("/:id/simulate/clear", authMiddleware(BUSINESS_ADMIN_ROLES))
  async simulateClear(req: Request, res: Response) {
    try {
      return this.success(
        res,
        await this.cards.simulateClearing(
          req.user!.businessId,
          req.user!.role,
          String(req.params.id),
          req.body ?? {},
        ),
        STATUS_CODE.CREATED,
      );
    } catch (error) {
      return this.handleError(res, error);
    }
  }

  @httpPost("/:id/simulate/void", authMiddleware(BUSINESS_ADMIN_ROLES))
  async simulateVoid(req: Request, res: Response) {
    try {
      return this.success(
        res,
        await this.cards.simulateVoid(
          req.user!.businessId,
          req.user!.role,
          String(req.params.id),
          req.body ?? {},
        ),
        STATUS_CODE.CREATED,
      );
    } catch (error) {
      return this.handleError(res, error);
    }
  }
}
