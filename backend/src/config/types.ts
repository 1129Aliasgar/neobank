/**
 * Inversify binding identifiers.
 *
 * @author aliasgarbootwala3@gmail.com
 */

export const TYPES = {
  // Service Types
  AuthService: Symbol.for("AuthService"),
  BusinessService: Symbol.for("BusinessService"),
  VerificationService: Symbol.for("VerificationService"),
  WebhookService: Symbol.for("WebhookService"),
  LedgerService: Symbol.for("LedgerService"),
  CardService: Symbol.for("CardService"),

  // Repository Types
  AuthRepository: Symbol.for("AuthRepository"),
  BusinessRepository: Symbol.for("BusinessRepository"),
  VerificationRepository: Symbol.for("VerificationRepository"),
  WebhookRepository: Symbol.for("WebhookRepository"),

  // Integration Types
  VerificationProvider: Symbol.for("VerificationProvider"),

  // Infrastructure Types
  Database: Symbol.for("Database"),
  PrismaClient: Symbol.for("PrismaClient"),
  Logger: Symbol.for("Logger"),
} as const;
