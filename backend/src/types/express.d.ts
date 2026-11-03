/**
 * The authenticated principal attached by `authMiddleware`.
 *
 * `businessId` is part of the request context because every domain query is
 * scoped to one business — there is no "all businesses" path in the API.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import "express";

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        businessId: string;
        role: import("../constants/constants.js").UserRole;
      };
    }
  }
}

export {};
