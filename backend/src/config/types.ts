/**
 * Inversify binding identifiers.
 *
 * @author aliasgarbootwala3@gmail.com
 */

export const TYPES = {
  // Service Types
  AuthService: Symbol.for("AuthService"),

  // Repository Types
  AuthRepository: Symbol.for("AuthRepository"),

  // Infrastructure Types
  Database: Symbol.for("Database"),
  PrismaClient: Symbol.for("PrismaClient"),
  Logger: Symbol.for("Logger"),
} as const;
