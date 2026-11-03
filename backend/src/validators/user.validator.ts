/**
 * Boundary validation for authentication and the User model.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import Joi from "joi";

export { firstErrorMessage, validateOrThrow } from "./validate.js";

/*
 * bcrypt hashes at most 72 bytes and silently truncates anything longer, so 72
 * characters is the real ceiling - rejecting earlier is pointless and accepting
 * beyond it is a security hole.
 */
const PASSWORD_MAX = 72;

const username = Joi.string()
  .trim()
  .min(3)
  .max(30)
  .pattern(/^[a-zA-Z0-9._-]+$/)
  .messages({
    "string.pattern.base":
      "Username may only contain letters, numbers, dots, underscores and dashes",
  });

const email = Joi.string().trim().email({ tlds: false }).max(254).lowercase();

const password = Joi.string().min(8).max(PASSWORD_MAX);

/**
 * Registration body.
 *
 * `role` is intentionally not accepted: public sign-up always creates the
 * business OWNER. Team members are invited/assigned later by an OWNER or ADMIN.
 *
 * `businessName` and `country` are onboarding metadata, not privilege switches.
 * The name falls back to the username and the country to US when omitted, so
 * the existing three-field form keeps working.
 */
export const registerSchema = Joi.object({
  username: username.required(),
  email: email.required(),
  password: password.required(),
  businessName: Joi.string().trim().min(2).max(100).optional(),
  country: Joi.string()
    .trim()
    .uppercase()
    .length(2)
    .pattern(/^[A-Z]{2}$/)
    .optional(),
});

/**
 * Login body. Deliberately does not enforce the registration password policy:
 * length rules belong at account creation, and copying them here would lock out
 * anyone whose password predates a policy change.
 */
export const loginSchema = Joi.object({
  email: email.required(),
  password: Joi.string().required(),
});
