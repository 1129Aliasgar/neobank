/**
 * @author aliasgarbootwala3@gmail.com
 */
/**
 * Per-request context, carried implicitly.
 *
 * Services log through a shared singleton Logger and their signatures stay
 * `(message, meta)`. Passing a request id down as an argument would mean
 * threading it through every controller, service and repository call.
 *
 * AsyncLocalStorage keeps the context attached to the async execution
 * instead: `requestContextMiddleware` enters it once per request, and
 * anything awaited downstream can read it back with `getRequestContext()`
 * — no arguments, and it survives the awaits between layers.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  /** Correlates every log line for one request. */
  requestId: string;
  ip: string;
  userAgent: string;
  method: string;
  /** Original path, before routing. */
  path: string;
  /** Filled in once authMiddleware resolves the token. */
  userId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(
  context: RequestContext,
  callback: () => T,
): T {
  return storage.run(context, callback);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Attaches the authenticated user to the active context.
 *
 * Returns false when there is no request in flight, which happens for
 * logs emitted during startup or shutdown.
 */
export function setRequestUserId(userId: string): boolean {
  const context = storage.getStore();

  if (!context) {
    return false;
  }

  context.userId = userId;

  return true;
}
