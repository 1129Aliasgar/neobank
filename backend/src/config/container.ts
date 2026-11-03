/**
 * Dependency injection container.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import { Container } from "inversify";
import "reflect-metadata";
import { TYPES } from "./types.js";

// services
import AuthService from "../services/auth.service.js";
import BusinessService from "../services/business.service.js";
import VerificationService from "../services/verification.service.js";
import WebhookService from "../services/webhook.service.js";

// repositories
import AuthRepository from "../repositories/auth.repository.js";
import BusinessRepository from "../repositories/business.repository.js";
import VerificationRepository from "../repositories/verification.repository.js";
import WebhookRepository from "../repositories/webhook.repository.js";

// integrations
import { createVerificationProvider } from "../integrations/verification.factory.js";
import type { VerificationProvider } from "../types/verification.types.js";

// infrastructure
import Logger from "../utils/logger.js";
import PrismaDatabase from "./database.js";

const container = new Container();

/*
 * Database bindings
 *
 * `Database` owns the client lifecycle (connect / disconnect). `PrismaClient`
 * hands that same instance to whoever needs to run queries, so repositories
 * depend on the client rather than on a driver.
 */
container.bind(TYPES.Database).to(PrismaDatabase).inSingletonScope();

/*
 * `Context` cannot be named here: inversify 6 ships no type entry for its
 * `exports` map, so `import { interfaces } from "inversify"` is untyped under
 * NodeNext and the shape is spelled out instead.
 */
interface ResolverContext {
  container: { get(identifier: symbol): unknown };
}

container
  .bind(TYPES.PrismaClient)
  .toDynamicValue((context: ResolverContext) =>
    (context.container.get(TYPES.Database) as PrismaDatabase).getClient(),
  )
  .inSingletonScope();

/*
 * One provider per process. Singleton scope matters for the sandbox
 * simulator, whose unfinished sessions live in memory.
 */
container
  .bind<VerificationProvider>(TYPES.VerificationProvider)
  .toDynamicValue(() => createVerificationProvider())
  .inSingletonScope();

// Service bindings
container.bind(TYPES.AuthService).to(AuthService).inSingletonScope();
container.bind(TYPES.BusinessService).to(BusinessService).inSingletonScope();
container
  .bind(TYPES.VerificationService)
  .to(VerificationService)
  .inSingletonScope();
container.bind(TYPES.WebhookService).to(WebhookService).inSingletonScope();

// Repository bindings
container.bind(TYPES.AuthRepository).to(AuthRepository).inSingletonScope();
container
  .bind(TYPES.BusinessRepository)
  .to(BusinessRepository)
  .inSingletonScope();
container
  .bind(TYPES.VerificationRepository)
  .to(VerificationRepository)
  .inSingletonScope();
container.bind(TYPES.WebhookRepository).to(WebhookRepository).inSingletonScope();

// Logger bindings
container.bind(TYPES.Logger).to(Logger).inSingletonScope();

export default container;
