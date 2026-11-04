/**
 * Boundary validation for payment requests.
 *
 * `amountMinor` is the API's integer-cents string. A decimal, a negative value
 * or an exponent never reaches the service, and the service still re-checks the
 * value because a validator is not an authorisation boundary.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import Joi from "joi";

const NO_MARKUP = /^[^<>]*$/;

function text(max: number) {
  return Joi.string()
    .trim()
    .max(max)
    .pattern(NO_MARKUP)
    .messages({ "string.pattern.base": "This field cannot contain < or >" });
}

export const createPaymentSchema = Joi.object({
  beneficiaryName: text(120).min(1).required().messages({
    "string.empty": "Beneficiary name is required",
  }),
  beneficiaryReference: text(80).allow(""),
  amountMinor: Joi.string()
    .trim()
    .pattern(/^\d{1,15}$/)
    .required()
    .messages({
      "string.pattern.base":
        "amountMinor must be a positive integer string in minor units",
    }),
  memo: text(280).allow(""),
});

export const approvePaymentSchema = Joi.object({
  reason: text(280).allow(""),
});

export const rejectPaymentSchema = Joi.object({
  reason: text(280).min(3).required().messages({
    "string.empty": "A rejection reason is required",
    "string.min": "A rejection reason must be at least 3 characters",
  }),
});

export const listPaymentsSchema = Joi.object({
  status: Joi.string()
    .valid(
      "PENDING_APPROVAL",
      "APPROVED",
      "PROCESSING",
      "COMPLETED",
      "REJECTED",
      "CANCELED",
      "FAILED",
    )
    .optional(),
  limit: Joi.number().integer().min(1).max(100).default(25),
  cursor: Joi.string().max(256).optional(),
});
