/**
 * Environment configuration.
 *
 * Loaded once, validated once, typed everywhere. Nothing else in the codebase
 * should read `process.env` directly: a missing DATABASE_URL or a short
 * JWT_SECRET must stop the process at boot, not surface as a 500 on the first
 * login attempt (or worse, as a forged token in production).
 *
 * @author aliasgarbootwala3@gmail.com
 */

import "./config.js"; // dotenv, must come first
import Joi from "joi";

/**
 * Didit credentials are required in production and optional elsewhere.
 *
 * Optional locally is deliberate: the sandbox account may not exist yet, and a
 * developer should still be able to run the API. When the three provider
 * values are absent the verification service falls back to a clearly labelled
 * simulator (see `integrations/verification`), which is disabled the moment
 * `NODE_ENV=production` because Joi then refuses to boot without them.
 */
const diditValue = Joi.string().when("NODE_ENV", {
  is: "production",
  then: Joi.required(),
  otherwise: Joi.optional().allow(""),
});

const schema = Joi.object({
  NODE_ENV: Joi.string()
    .valid("development", "test", "production")
    .default("development"),
  PORT: Joi.number().port().default(5000),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ["postgresql", "postgres"] })
    .required(),
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default("1d"),
  CORS_ORIGIN: Joi.string().default("*"),
  LOG_LEVEL: Joi.string()
    .valid("fatal", "error", "warn", "info", "debug", "trace")
    .default("info"),

  /* ---- Didit KYB (sandbox) ---- */
  DIDIT_API_KEY: diditValue,
  DIDIT_API_BASE_URL: Joi.string()
    .uri({ scheme: ["https"] })
    .default("https://verification.didit.me"),
  DIDIT_WORKFLOW_ID: diditValue,
  DIDIT_WEBHOOK_SECRET: diditValue,
  DIDIT_ENVIRONMENT: Joi.string()
    .valid("sandbox", "live")
    .default("sandbox"),
  /**
   * Sandbox-only scenario slug sent at session creation (`approve`, `decline`,
   * or any slug from the sandbox catalog). Empty disables it.
   *
   * This exists because Didit's sandbox registry only knows one company
   * (`Sandbox Holdings Ltd` / `SANDBOX-0001`). Sending the customer's real
   * company name in `expected_details` makes the KYB registry check fail with
   * `KYB_REGISTRY_DATA_MISMATCH_WITH_EXPECTED` and auto-decline the session,
   * even when the hosted picker is set to approve. The scenario supplies its
   * own matching magic values instead. Ignored when the environment is live.
   */
  DIDIT_SANDBOX_SCENARIO: Joi.string().allow("").default("approve"),
  /**
   * `auto` uses Didit when the three credentials are present and the simulator
   * otherwise. Setting `simulator` explicitly is how a developer demos the
   * flow while the Didit console is still being configured; production refuses
   * to run in that mode.
   */
  VERIFICATION_PROVIDER: Joi.string()
    .valid("auto", "didit", "simulator")
    .default("auto"),

  /* ---- Public URLs ---- */
  FRONTEND_URL: Joi.string().uri().default("http://localhost:3000"),
  PUBLIC_API_URL: Joi.string().uri().default("http://localhost:5000"),
  /**
   * Publicly reachable web origin, used for provider callbacks when the check
   * is finished on a phone. Empty locally: a phone cannot resolve
   * `localhost`, so the callback is omitted rather than sending it to a dead
   * end. Set this to the tunnel (e.g. `https://abc123.ngrok-free.app`) when the
   * frontend is exposed as well as the API.
   */
  PUBLIC_WEB_URL: Joi.string().uri().allow("").default(""),
  LEDGER_SANDBOX_TOOLS: Joi.boolean().truthy("true").falsy("false").default(true),
  LEDGER_SANDBOX_TOOLS_ACK: Joi.string().allow("").default(""),
  SANDBOX_FUNDING_DAILY_LIMIT_MINOR: Joi.string().pattern(/^\d+$/).default("20000000"),
  SANDBOX_DEPOSIT_MAX_MINOR: Joi.string().pattern(/^\d+$/).default("5000000"),
}).unknown(true); // a platform may inject extra vars (e.g. RENDER_*)

const { error, value } = schema.validate(process.env, {
  abortEarly: false,
  convert: true,
});

if (error) {
  const details = error.details
    .map((detail) => `  - ${detail.message}`)
    .join("\n");

  throw new Error(`Invalid environment configuration:\n${details}`);
}

export type NodeEnv = "development" | "test" | "production";

const diditApiKey = (value.DIDIT_API_KEY as string) || "";
const diditWorkflowId = (value.DIDIT_WORKFLOW_ID as string) || "";
const diditWebhookSecret = (value.DIDIT_WEBHOOK_SECRET as string) || "";

/**
 * `true` only when every value the live integration needs is present. The
 * service checks this once per call rather than trusting three strings to be
 * non-empty in the right combination.
 */
const diditConfigured = Boolean(
  diditApiKey && diditWorkflowId && diditWebhookSecret,
);

const requestedProvider = value.VERIFICATION_PROVIDER as
  | "auto"
  | "didit"
  | "simulator";

const verificationProvider: "didit" | "simulator" =
  requestedProvider === "auto"
    ? diditConfigured
      ? "didit"
      : "simulator"
    : requestedProvider;

if (value.NODE_ENV === "production" && verificationProvider !== "didit") {
  throw new Error(
    "Invalid environment configuration:\n  - production requires the Didit provider and its credentials",
  );
}

export const env = {
  nodeEnv: value.NODE_ENV as NodeEnv,
  isProduction: value.NODE_ENV === "production",
  isTest: value.NODE_ENV === "test",
  port: value.PORT as number,
  databaseUrl: value.DATABASE_URL as string,
  jwtSecret: value.JWT_SECRET as string,
  jwtExpiresIn: value.JWT_EXPIRES_IN as string,
  corsOrigin: value.CORS_ORIGIN as string,
  logLevel: value.LOG_LEVEL as string,

  didit: {
    apiKey: diditApiKey,
    baseUrl: value.DIDIT_API_BASE_URL as string,
    workflowId: diditWorkflowId,
    webhookSecret: diditWebhookSecret,
    environment: value.DIDIT_ENVIRONMENT as "sandbox" | "live",
    sandboxScenario: value.DIDIT_SANDBOX_SCENARIO as string,
    configured: diditConfigured,
  },

  /** Which implementation `integrations/verification.factory` builds. */
  verificationProvider,

  frontendUrl: value.FRONTEND_URL as string,
  publicApiUrl: value.PUBLIC_API_URL as string,
  publicWebUrl: value.PUBLIC_WEB_URL as string,
  ledger: {
    sandboxTools: value.LEDGER_SANDBOX_TOOLS as boolean,
    sandboxToolsAck: value.LEDGER_SANDBOX_TOOLS_ACK as string,
    fundingDailyLimitMinor: BigInt(value.SANDBOX_FUNDING_DAILY_LIMIT_MINOR as string),
    depositMaxMinor: BigInt(value.SANDBOX_DEPOSIT_MAX_MINOR as string),
  },
} as const;

if (value.NODE_ENV === "production" && value.LEDGER_SANDBOX_TOOLS && value.LEDGER_SANDBOX_TOOLS_ACK !== "labelled") {
  throw new Error("Invalid environment configuration:\n  - production requires LEDGER_SANDBOX_TOOLS_ACK=labelled when sandbox ledger tools are enabled");
}
