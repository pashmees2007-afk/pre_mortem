import type { NextFunction, Request, Response } from "express";
import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";
import type { Config } from "./config.js";
import { AppError } from "./errors.js";

const ClaimsSchema = z.object({
  sub: z.string().uuid(),
  org_id: z.string().uuid(),
  role: z.enum(["member", "admin"]),
}).passthrough();

export type Actor = z.infer<typeof ClaimsSchema>;

export async function issueAccessToken(config: Config, actor: Actor) {
  const secret = new TextEncoder().encode(config.JWT_SECRET);
  return new SignJWT({ org_id: actor.org_id, role: actor.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(actor.sub)
    .setIssuer(config.JWT_ISSUER)
    .setAudience(config.JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(secret);
}

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
