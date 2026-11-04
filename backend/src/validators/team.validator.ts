/**
 * Boundary validation for team invitations, role changes and the approval
 * policy.
 *
 * Roles are a closed set and ownership can never be granted by an invitation
 * or a PATCH. The approval threshold is a non-negative integer string, never a
 * float, so it can be compared to `BigInt` money without rounding.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import Joi from "joi";
import { INVITABLE_ROLES } from "../constants/constants.js";

const NO_MARKUP = /^[^<>]*$/;

const email = Joi.string().trim().email({ tlds: false }).max(254).lowercase();

const username = Joi.string()
  .trim()
  .min(3)
  .max(30)
  .pattern(/^[a-zA-Z0-9._-]+$/)
  .messages({
    "string.pattern.base":
      "Username may only contain letters, numbers, dots, underscores and dashes",
  });

const password = Joi.string().min(8).max(72);

const role = Joi.string()
  .valid(...INVITABLE_ROLES)
  .messages({
    "any.only": "Invitations and role changes may only grant EMPLOYEE or ADMIN",
  });

export const inviteMemberSchema = Joi.object({
  email: email.required(),
  role: role.default("EMPLOYEE"),
});

/** Public, token-gated registration. The email comes from the invitation. */
export const registerFromInvitationSchema = Joi.object({
  username: username.required(),
  password: password.required(),
});

export const changeRoleSchema = Joi.object({
  role: role.required(),
});

export const approvalPolicySchema = Joi.object({
  approvalThresholdMinor: Joi.string()
    .trim()
    .pattern(/^\d{1,18}$/)
    .messages({
      "string.pattern.base":
        "approvalThresholdMinor must be a non-negative integer string",
    }),
})
  .min(1)
  .messages({ "object.min": "Send at least one policy field to update" });

/**
 * A rejection reason is required and must be meaningful. Approval reasons are
 * optional, so the same text rule is used without `.required()`.
 */
export const approvalReasonSchema = Joi.object({
  reason: Joi.string()
    .trim()
    .max(280)
    .pattern(NO_MARKUP)
    .allow("")
    .messages({ "string.pattern.base": "Reason cannot contain < or >" }),
});

export const rejectionReasonSchema = Joi.object({
  reason: Joi.string()
    .trim()
    .min(3)
    .max(280)
    .pattern(NO_MARKUP)
    .required()
    .messages({
      "string.empty": "A rejection reason is required",
      "string.min": "A rejection reason must be at least 3 characters",
      "string.pattern.base": "Reason cannot contain < or >",
    }),
});
