import type { NextFunction, Request, Response } from "express";
import type { Config } from "./config.js";
import { AppError } from "./errors.js";

const INCREMENT_WITH_EXPIRY = `
  local current = redis.call('INCR', KEYS[1])
  if current == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
  return {current, redis.call('TTL', KEYS[1])}
`;

type RateLimitRedis = { eval: (...args: unknown[]) => Promise<[number, number]> };

export function analysisRateLimit(redis: RateLimitRedis, config: Config) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.actor) throw new AppError(401, "UNAUTHENTICATED", "Authentication is required");
      const bucket = `rate:analysis:${req.actor.org_id}:${req.actor.sub}`;
      const [count, ttl] = await redis.eval(
        INCREMENT_WITH_EXPIRY,
        1,
        bucket,
        String(config.ANALYSIS_RATE_WINDOW_SECONDS),
      ) as [number, number];
      res.setHeader("RateLimit-Limit", String(config.ANALYSIS_RATE_LIMIT));
      res.setHeader("RateLimit-Remaining", String(Math.max(0, config.ANALYSIS_RATE_LIMIT - count)));
      res.setHeader("RateLimit-Reset", String(Math.max(0, ttl)));
      if (count > config.ANALYSIS_RATE_LIMIT) {
        res.setHeader("Retry-After", String(Math.max(1, ttl)));
        throw new AppError(429, "RATE_LIMITED", "Too many analysis requests; retry later");
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function authRateLimit(redis: RateLimitRedis) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const email = typeof req.body?.email === "string" ? req.body.email.toLowerCase().slice(0, 254) : "unknown";
      const bucket = `rate:auth:${req.ip}:${email}`;
      const [count, ttl] = await redis.eval(INCREMENT_WITH_EXPIRY, 1, bucket, "600") as [number, number];
      res.setHeader("RateLimit-Limit", "8");
      res.setHeader("RateLimit-Remaining", String(Math.max(0, 8 - count)));
      res.setHeader("RateLimit-Reset", String(Math.max(0, ttl)));
      if (count > 8) {
        res.setHeader("Retry-After", String(Math.max(1, ttl)));
        throw new AppError(429, "AUTH_RATE_LIMITED", "Too many sign-in attempts; retry later");
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
