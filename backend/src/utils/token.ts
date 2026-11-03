/**
 * @author aliasgarbootwala3@gmail.com
 */
import jwt, { SignOptions } from "jsonwebtoken";
import { env } from "../config/env.js";
import { USER_ROLES } from "../constants/constants.js";
import type { UserRole } from "../constants/constants.js";

export interface TokenPayload {
  userId: string;
  userRole: UserRole;
  tokenVersion: number;
  iat: number;
  exp: number;
}

type TokenClaims = Pick<TokenPayload, "userId" | "userRole" | "tokenVersion">;

export const generateToken = (payload: TokenClaims): string => {
  const options: SignOptions = {
    expiresIn: env.jwtExpiresIn as SignOptions["expiresIn"],
  };

  return jwt.sign(payload, env.jwtSecret, options);
};

export const verifyToken = (token: string): TokenPayload => {
  const decoded: unknown = jwt.verify(token, env.jwtSecret);

  if (!decoded || typeof decoded !== "object") {
    throw new Error("Invalid token payload");
  }

  const payload = decoded as Record<string, unknown>;
  const isUserRole = (value: unknown): value is UserRole =>
    typeof value === "string" && USER_ROLES.includes(value as UserRole);
  const tokenVersion =
    payload.tokenVersion === undefined ? 0 : payload.tokenVersion;

  if (
    typeof payload.userId !== "string" ||
    !isUserRole(payload.userRole) ||
    typeof tokenVersion !== "number" ||
    !Number.isInteger(tokenVersion) ||
    typeof payload.iat !== "number" ||
    !Number.isInteger(payload.iat) ||
    typeof payload.exp !== "number" ||
    !Number.isInteger(payload.exp)
  ) {
    throw new Error("Invalid token payload");
  }

  return {
    userId: payload.userId,
    userRole: payload.userRole,
    tokenVersion,
    iat: payload.iat,
    exp: payload.exp,
  };
};
