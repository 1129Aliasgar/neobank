/**
 * Boundary validation for the business profile.
 *
 * Joi is used on the backend throughout (the HLD's Zod choice applies to the
 * frontend). Every value is trimmed, length-bounded and markup-free before it
 * can reach the service; unknown keys are stripped by `validateOrThrow`, so
 * `role`, `status` or `businessId` in the body can never influence a write.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import Joi from "joi";
import { BUSINESS_TYPES } from "../constants/constants.js";

/** The 50 states plus DC. US territories are out of scope for v1. */
export const US_STATE_CODES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL",
  "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME",
  "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH",
  "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI",
  "WY",
] as const;

/* Angle brackets are rejected everywhere: none of these fields is markup. */
const NO_MARKUP = /^[^<>]*$/;

function text(max: number) {
  return Joi.string()
    .trim()
    .max(max)
    .pattern(NO_MARKUP)
    .messages({ "string.pattern.base": "This field cannot contain < or >" });
}

/** Optional field: `""` clears it, so it is accepted and stored as NULL. */
function optionalText(max: number) {
  return text(max).allow("");
}

export const updateBusinessSchema = Joi.object({
  legalName: text(120).min(2),
  tradingName: optionalText(120),
  businessType: Joi.string()
    .valid(...BUSINESS_TYPES)
    .messages({ "any.only": "Choose a valid business type" }),
  registrationNumber: optionalText(40),
  industry: optionalText(80),
  description: optionalText(500),
  email: Joi.string()
    .trim()
    .email({ tlds: false })
    .max(254)
    .lowercase()
    .allow(""),
  phone: Joi.string()
    .trim()
    .pattern(/^\+?[1-9]\d{7,14}$/)
    .allow("")
    .messages({
      "string.pattern.base":
        "Phone must be in international format, e.g. +14155550123",
    }),
  website: Joi.string()
    .trim()
    .uri({ scheme: ["http", "https"] })
    .max(255)
    .allow(""),
  addressLine1: optionalText(120),
  addressLine2: optionalText(120),
  city: optionalText(80),
  state: Joi.string()
    .trim()
    .uppercase()
    .valid(...US_STATE_CODES)
    .allow("")
    .messages({ "any.only": "Select a valid US state" }),
  postalCode: Joi.string()
    .trim()
    .pattern(/^\d{5}(-\d{4})?$/)
    .allow("")
    .messages({
      "string.pattern.base": "ZIP must be 12345 or 12345-6789",
    }),
  /* Fixed in v1; sending anything else is a client bug, not a silent default. */
  country: Joi.string()
    .trim()
    .uppercase()
    .valid("US")
    .messages({ "any.only": "Only US businesses are supported" }),
})
  .min(1)
  .messages({ "object.min": "Send at least one field to update" });
