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
} as const;
