/**
 * Persistence for the auth slice only.
 *
 * No business rules live here: the repository does not know who is calling, and
 * never hashes, compares or issues anything.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import { inject, injectable } from "inversify";
import { TYPES } from "../config/types.js";
import { DbClient } from "../types/database.types.js";
import { CreateUserInput } from "../types/user.types.js";

@injectable()
export default class AuthRepository {
  private readonly db: DbClient;

  constructor(@inject(TYPES.PrismaClient) db: DbClient) {
    this.db = db;
  }

  /**
   * Fields are listed explicitly instead of spreading `userData`, so a new
   * column on the model can never be written by accident.
   */
  async createUser(userData: CreateUserInput) {
    return await this.db.user.create({
      data: {
        username: userData.username,
        email: userData.email,
        password: userData.password,
        role: userData.role,
      },
    });
  }

  /**
   * `password` is omitted client-wide, so the login check has to opt back in
   * to it explicitly. Every other read of a user gets the hash-free shape.
   */
  async findByEmail(email: string) {
    return await this.db.user.findUnique({
      where: { email },
      omit: { password: false },
    });
  }

  async findByUsername(username: string) {
    return await this.db.user.findFirst({
      where: { username, isDeleted: false },
      select: { id: true },
    });
  }

  async findUserById(id: string) {
    return await this.db.user.findUnique({
      where: { id },
    });
  }

  /** Minimal projection used by `authMiddleware` on every request. */
  async findUserForAuthorization(id: string) {
    return await this.db.user.findUnique({
      where: { id },
      select: {
        id: true,
        role: true,
        isDeleted: true,
        tokenVersion: true,
      },
    });
  }

  async isTokenBlacklisted(token: string) {
    return await this.db.blacklistToken.findUnique({
      where: { token },
    });
  }

  async createToken(token: string, userId: string, expiresAt: Date) {
    return await this.db.blacklistToken.create({
      data: { token, userId, expiresAt },
    });
  }
}
