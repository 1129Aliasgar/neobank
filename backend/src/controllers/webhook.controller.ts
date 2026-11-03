/**
 * Provider webhook HTTP surface.
 *
 * The route is public by design: the signature is the credential. `req.body`
 * is a `Buffer` because `app.ts` mounts `express.raw()` on this prefix before
 * the global JSON parser — HMAC is computed over the exact transmitted bytes.
 *
 * Response codes are the provider's contract:
 *   200 accepted / duplicate / ignored (do not retry)
 *   401 bad signature or stale timestamp
 *   400 malformed payload
 *   5xx transient failure (retry)
 *
 * @author aliasgarbootwala3@gmail.com
 */

import { controller, httpPost } from "inversify-express-utils";
import { inject } from "inversify";
import type { Request, Response } from "express";
import { TYPES } from "../config/types.js";
import BaseController from "./base.controller.js";
import { STATUS_CODE } from "../constants/constants.js";
import WebhookService from "../services/webhook.service.js";
import Logger from "../utils/logger.js";

@controller("/api/v1/webhooks")
export default class WebhookController extends BaseController {
  @inject(TYPES.WebhookService)
  webhookService!: WebhookService;

  @inject(TYPES.Logger)
  logger!: Logger;

  @httpPost("/didit")
  async didit(req: Request, res: Response) {
    try {
      const raw = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(
            typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}),
            "utf8",
          );

      const outcome = await this.webhookService.handle(raw, req.headers);

      return this.success(res, { outcome }, STATUS_CODE.OK);
    } catch (error) {
      this.logger.warn("webhook processing failed", {
        error: error instanceof Error ? error.message : String(error),
      });

      return this.handleError(res, error);
    }
  }
}
