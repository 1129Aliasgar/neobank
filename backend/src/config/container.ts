/**
 * Dependency injection container.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import { Container } from "inversify";
import "reflect-metadata";
import { TYPES } from "./types.js";

// service
import AuthService from "../services/auth.service.js";

// repository
import AuthRepository from "../repositories/auth.repository.js";

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

// Service bindings
container.bind(TYPES.AuthService).to(AuthService).inSingletonScope();

// Repository bindings
container.bind(TYPES.AuthRepository).to(AuthRepository).inSingletonScope();

// Logger bindings
container.bind(TYPES.Logger).to(Logger).inSingletonScope();

export default container;
