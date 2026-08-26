import { Router } from "express";
import type { Config } from "./config.js";
import { CreateAnalysisInput, MitigationInput } from "./contracts.js";
import type { PreMortemEngine } from "./engine.js";
import { AppError } from "./errors.js";
import { requireUser } from "./identity.js";
import type { AnalysisQueue } from "./queue.js";
import { analysisRateLimit } from "./rateLimit.js";
import type { Repository } from "./repository.js";

export function createRouter(args: { config: Config; repo: Repository; queue: AnalysisQueue; engine: PreMortemEngine; redis: Parameters<typeof analysisRateLimit>[0] }) {
  const router = Router();
  const auth = requireUser(args.config);

  router.post("/v1/analyses", auth, analysisRateLimit(args.redis, args.config), async (req, res, next) => {
    try {
      const input = CreateAnalysisInput.parse(req.body);
      const actor = req.actor!;
      await args.repo.assertProjectMember(input.projectId, actor);
      const run = await args.repo.createOrReuseRun({ ...input, actor, policyVersion: "2026-08-01" });
      if (run.status === "queued") await args.queue.enqueue(run.id);
      res.status(202).json({ id: run.id, status: run.status });
    } catch (error) { next(error); }
  });

  router.get("/v1/analyses/:analysisId", auth, async (req, res, next) => {
    try {
      const analysisId = Array.isArray(req.params.analysisId) ? req.params.analysisId[0] : req.params.analysisId;
      if (!analysisId) throw new AppError(400, "INVALID_REQUEST", "Analysis ID is required");
      const analysis = await args.repo.getAnalysis(analysisId, req.actor!);
      res.json(analysis);
    } catch (error) { next(error); }
  });

  router.post("/v1/risks/:riskId/mitigations", auth, async (req, res, next) => {
    try {
      const input = MitigationInput.parse(req.body);
      const riskId = Array.isArray(req.params.riskId) ? req.params.riskId[0] : req.params.riskId;
      if (!riskId) throw new AppError(400, "INVALID_REQUEST", "Risk ID is required");
      const result = await args.engine.assessMitigation({ riskId, actor: req.actor!, answer: input.answer });
      res.status(201).json(result);
    } catch (error) { next(error); }
  });

  router.use((_req, _res, next) => next(new AppError(404, "NOT_FOUND", "Route not found")));
  return router;
}
