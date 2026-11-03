/**
 * @author aliasgarbootwala3@gmail.com
 */

import { STATUS_CODE } from "../constants/constants.js";
import { COMMON_ERRORS } from "../constants/error.js";
import ApiError from "../utils/apiError.js";
import { rootLogger } from "../utils/logger.js";
import { Response } from "express";

export default class BaseController {
  success(res: Response, data: unknown, status: number = STATUS_CODE.OK) {
    res.status(status).json({
      data,
      success: true,
    });
  }

  error(
    res: Response,
    message: string,
    status: number = STATUS_CODE.INTERNAL_SERVER_ERROR,
  ) {
    res.status(status).json({
      message,
      success: false,
    });
  }

  /**
   * Turns a thrown value into a response.
   *
   * An `ApiError` already carries the status it intended (401 for a bad
   * login, 404 for a missing record), so it is honoured. Everything else is
   * treated as an unexpected fault and becomes a 500.
   */
  handleError(res: Response, error: unknown) {
    if (error instanceof ApiError) {
      return this.error(res, error.message, error.statusCode);
    }

    /*
     * Anything else is an unexpected fault. Its message can contain SQL,
     * constraint names or column values (Prisma is especially chatty), so it is
     * logged server-side and the client gets the generic message.
     */
    rootLogger.error(
      {
        err: error instanceof Error ? error : undefined,
        message: error instanceof Error ? error.message : String(error),
      },
      "unhandled controller error",
    );

    return this.error(
      res,
      COMMON_ERRORS.INTERNAL_SERVER_ERROR,
      STATUS_CODE.INTERNAL_SERVER_ERROR,
    );
  }
}
