/**
 * Shared Joi helpers used by every validator.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import Joi from "joi";
import ApiError from "../utils/apiError.js";
import { STATUS_CODE } from "../constants/constants.js";
import { COMMON_ERRORS } from "../constants/error.js";

/** Returns the first validation message, or a generic fallback. */
export function firstErrorMessage(error: Joi.ValidationError): string {
  return error.details[0]?.message ?? COMMON_ERRORS.VALIDATION_FAILED;
}

/**
 * Runs a schema and returns the coerced value, or throws an ApiError the
 * controller already knows how to turn into a 400.
 *
 * `stripUnknown` drops fields the schema does not declare instead of failing,
 * so an older client sending extra keys is not rejected - but those keys can
 * never reach the service either.
 */
export function validateOrThrow<TSchema extends Joi.Schema>(
  schema: TSchema,
  payload: unknown,
): Joi.UnwrapSchemaLikeWithoutArray<TSchema> {
  const { error, value } = schema.validate(payload, {
    abortEarly: true,
    stripUnknown: true,
    convert: true,
  });

  if (error) {
    throw new ApiError(
      error.details[0]?.message ?? COMMON_ERRORS.VALIDATION_FAILED,
      STATUS_CODE.BAD_REQUEST,
    );
  }

  return value as Joi.UnwrapSchemaLikeWithoutArray<TSchema>;
}
