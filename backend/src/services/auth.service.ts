/**
 * Authentication for the Neobank MVP.
 *
 * Scope: register (creates the business OWNER), login, profile and logout.
 * Business, account, ledger, card, payment and approval services are separate
 * modules and must never be folded back in here.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import { inject, injectable } from "inversify";
import bcrypt from "bcrypt";
import { TYPES } from "../config/types.js";
import { generateToken, verifyToken } from "../utils/token.js";
import {
  LoginUserInput,
  LogoutUserInput,
  ProfileUserInput,
  RegisterUserInput,
  User,
  UserProfile,
} from "../types/user.types.js";
import Logger from "../utils/logger.js";
import AuthRepository from "../repositories/auth.repository.js";
import { STATUS_CODE, USER_ROLE } from "../constants/constants.js";
import { AUTH_ERRORS, USER_ERRORS } from "../constants/error.js";
import ApiError from "../utils/apiError.js";

/** Prisma's unique-constraint error code. */
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

@injectable()
export default class AuthService {
  @inject(TYPES.AuthRepository)
  authRepository!: AuthRepository;

  @inject(TYPES.Logger)
  logger!: Logger;

  /**
   * Public sign-up.
   *
   * The account is always created as OWNER: the person registering is the one
   * opening the business account. Roles are never taken from the request body,
   * otherwise anyone could register themselves as OPERATIONS.
   */
  async register(userData: RegisterUserInput) {
    this.logger.info("registering user", { email: userData.email });

    const existingEmail = await this.authRepository.findByEmail(userData.email);

    if (existingEmail) {
      this.logger.warn("registration rejected: email already registered", {
        email: userData.email,
      });

      throw new ApiError(
        USER_ERRORS.EMAIL_ALREADY_EXISTS,
        STATUS_CODE.CONFLICT,
      );
    }

    const existingUsername = await this.authRepository.findByUsername(
      userData.username,
    );

    if (existingUsername) {
      throw new ApiError(
        USER_ERRORS.USERNAME_ALREADY_EXISTS,
        STATUS_CODE.CONFLICT,
      );
    }

    const hashedPassword = await bcrypt.hash(userData.password, 10);

    let user: User;

    try {
      user = await this.authRepository.createUser({
        username: userData.username,
        email: userData.email,
        password: hashedPassword,
        role: USER_ROLE.OWNER,
      });
    } catch (error) {
      /*
       * The checks above close the common case; the unique indexes close the
       * race between two simultaneous registrations. A duplicate is a 409,
       * not a 500.
       */
      if (isUniqueConstraintViolation(error)) {
        throw new ApiError(
          USER_ERRORS.EMAIL_ALREADY_EXISTS,
          STATUS_CODE.CONFLICT,
        );
      }

      throw error;
    }

    this.logger.info("user registered", { userId: user.id });

    const token = generateToken({
      userId: user.id,
      userRole: user.role,
      tokenVersion: user.tokenVersion,
    });

    return { user: this.toProfile(user), token };
  }

  async login(userData: LoginUserInput) {
    this.logger.info("login attempt", { email: userData.email });

    const user = await this.authRepository.findByEmail(userData.email);

    /*
     * Same message whether the email is unknown or the password is wrong:
     * telling them apart would let a caller enumerate accounts.
     */
    if (!user) {
      this.logger.warn("login rejected: no account for that email", {
        email: userData.email,
      });

      throw new ApiError(AUTH_ERRORS.INVALID_TOKEN, STATUS_CODE.UNAUTHORIZED);
    }

    if (user.isDeleted) {
      this.logger.warn("login rejected: account has been deleted", {
        userId: user.id,
      });

      throw new ApiError(USER_ERRORS.ACCOUNT_DELETED, STATUS_CODE.FORBIDDEN);
    }

    const isPasswordValid = await bcrypt.compare(
      userData.password,
      user.password,
    );

    if (!isPasswordValid) {
      this.logger.warn("login rejected: wrong password", { userId: user.id });

      throw new ApiError(
        AUTH_ERRORS.INVALID_PASSWORD,
        STATUS_CODE.UNAUTHORIZED,
      );
    }

    const token = generateToken({
      userId: user.id,
      userRole: user.role,
      tokenVersion: user.tokenVersion,
    });

    this.logger.info("user logged in", { userId: user.id });

    return { user: this.toProfile(user), token };
  }

  async profile(userData: ProfileUserInput) {
    this.logger.info("requesting profile", { userId: userData.userId });

    const isBlacklisted = await this.authRepository.isTokenBlacklisted(
      userData.token,
    );

    if (isBlacklisted) {
      this.logger.warn("profile rejected: token is blacklisted", {
        userId: userData.userId,
      });

      throw new ApiError(AUTH_ERRORS.TOKEN_INVALID, STATUS_CODE.UNAUTHORIZED);
    }

    const user = await this.authRepository.findUserById(userData.userId);

    if (!user) {
      this.logger.warn("profile rejected: user no longer exists", {
        userId: userData.userId,
      });

      throw new ApiError(USER_ERRORS.NOT_FOUND, STATUS_CODE.NOT_FOUND);
    }

    return { user: this.toProfile(user) };
  }

  /**
   * Logout is a server-side act: the JWT is copied into the blacklist until its
   * own `exp`, so clearing the browser cookie is not enough to stay safe.
   */
  async logout(token: LogoutUserInput) {
    this.logger.info("logout attempt", { userId: token.userId });

    const isBlacklisted = await this.authRepository.isTokenBlacklisted(
      token.token,
    );

    if (isBlacklisted) {
      throw new ApiError(
        AUTH_ERRORS.TOKEN_ALREADY_BLACKLISTED,
        STATUS_CODE.UNAUTHORIZED,
      );
    }

    /* Re-verify rather than trusting the caller, and read `exp` off the token. */
    const { exp, userId } = verifyToken(token.token);

    const result = await this.authRepository.createToken(
      token.token,
      userId,
      new Date(exp * 1000),
    );

    this.logger.info("user logged out", { userId });

    return result;
  }

  /** The signed-in user's shape, shared by register, login and profile. */
  private toProfile(user: {
    id: string;
    username: string;
    email: string;
    role: UserProfile["role"];
    createdAt: Date;
    updatedAt: Date;
  }): UserProfile {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
