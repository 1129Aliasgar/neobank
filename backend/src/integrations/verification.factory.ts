/**
 * The provider seam's factory.
 *
 * The rest of the application injects `TYPES.VerificationProvider` and never
 * names Didit. Swapping providers, or running the sandbox simulator, is a
 * change here plus an enum value — no service, controller or schema edit.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import { env } from "../config/env.js";
import DiditClient from "./didit/didit.client.js";
import SimulatorProvider from "./simulator/simulator.provider.js";
import type { VerificationProvider } from "../types/verification.types.js";

/** One simulator instance per process so its in-memory sessions survive. */
const simulator = new SimulatorProvider();

export function createVerificationProvider(): VerificationProvider {
  if (env.verificationProvider === "didit") {
    return new DiditClient();
  }

  return simulator;
}

/**
 * The simulate endpoint is only meaningful for the simulator. The service uses
 * this guard instead of `instanceof` so the class stays encapsulated here.
 */
export function asSimulator(
  provider: VerificationProvider,
): SimulatorProvider | null {
  return provider.name === "SIMULATOR" ? simulator : null;
}

export type { SimulatorScenario } from "./simulator/simulator.provider.js";
