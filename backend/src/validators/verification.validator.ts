/**
 * Boundary validation for verification actions.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import Joi from "joi";
import { SIMULATOR_SCENARIOS } from "../integrations/simulator/simulator.provider.js";

/**
 * Sandbox only. The scenario is an enum, never free text: it selects a fixed
 * provider status, and accepting an arbitrary string would let the caller
 * probe the transition function.
 */
export const simulateVerificationSchema = Joi.object({
  scenario: Joi.string()
    .valid(...SIMULATOR_SCENARIOS)
    .required()
    .messages({ "any.only": "Choose a valid sandbox scenario" }),
});
