import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { z } from "zod";
import type { Config } from "./config.js";
import { AppError } from "./errors.js";
import { createRouter } from "./routes.js";

const require = createRequire(import.meta.url);
const pinoHttp = require("pino-http") as (options: Record<string, unknown>) => express.RequestHandler;

export function createApp(deps: Parameters<typeof createRouter>[0] & { config: Config }) {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, _res, next) => { req.requestId = req.header("x-request-id")?.slice(0, 128) || randomUUID(); next(); });
  app.use(helmet());
  app.use(express.json({ limit: "128kb", type: "application/json" }));
  app.use(pinoHttp({ redact: ["req.headers.authorization", "req.body.plan", "req.body.answer"], customProps: (req: Request) => ({ requestId: req.requestId }) }));
  app.use(createRouter(deps));
  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    const appError = error instanceof AppError
      ? error
      : error instanceof z.ZodError
        ? new AppError(400, "INVALID_REQUEST", "Invalid request")
        : new AppError(500, "INTERNAL_ERROR", "Analysis service unavailable", false);
    if (!appError.expose) {
      const requestLog = (req as Request & { log?: { error: (payload: unknown, message: string) => void } }).log;
      requestLog?.error({ err: error, requestId: req.requestId }, "Unhandled request error");
    }
    res.status(appError.status).json({ error: { code: appError.code, message: appError.expose ? appError.message : "Analysis service unavailable", requestId: req.requestId } });
  });
  return app;
}
