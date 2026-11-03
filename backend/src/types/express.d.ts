/**
 * @author aliasgarbootwala3@gmail.com
 */

import "express";

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        role: import("../constants/constants.js").UserRole;
      };
    }
  }
}

export {};
