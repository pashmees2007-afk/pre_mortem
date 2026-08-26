import type { NextFunction, Request, Response } from "express";
import { jwtVerify } from "jose";
import { z } from "zod";
import type { Config } from "./config.js";
import { AppError } from "./errors.js";

const ClaimsSchema = z.object({
  sub: z.string().uuid(),
  org_id: z.string().uuid(),
  role: z.enum(["member", "admin"]),
}).passthrough();

export type Actor = z.infer<typeof ClaimsSchema>;

declare global {
  namespace Express {
    interface Request {
      actor?: Actor;
      requestId?: string;
    }
  }
}

export function requireUser(config: Config) {
  const secret = new TextEncoder().encode(config.JWT_SECRET);
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const authorization = req.header("authorization");
      if (!authorization?.startsWith("Bearer ")) {
        throw new AppError(401, "UNAUTHENTICATED", "Authentication is required");
      }
      const token = authorization.slice("Bearer ".length);
      const { payload } = await jwtVerify(token, secret, {
        issuer: config.JWT_ISSUER,
        audience: config.JWT_AUDIENCE,
      });
      req.actor = ClaimsSchema.parse(payload);
      next();
    } catch (error) {
      next(error instanceof AppError ? error : new AppError(401, "UNAUTHENTICATED", "Invalid authentication token"));
    }
  };
}
