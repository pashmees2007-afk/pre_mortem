import { Router } from "express";
import { z } from "zod";
import type { Config } from "./config.js";
import { CreateAnalysisInput, CreateProjectInput, LoginInput, MitigationInput, MockActionInput, PasswordResetConfirmInput, PasswordResetRequestInput, RegisterInput, UpdateProjectInput, VerificationInput } from "./contracts.js";
import type { PreMortemEngine } from "./engine.js";
import { AppError } from "./errors.js";
import { issueAccessToken, requireUser } from "./identity.js";
import type { Mailer } from "./mailer.js";
import type { AnalysisQueue } from "./queue.js";
import { analysisRateLimit, authRateLimit } from "./rateLimit.js";
import type { Repository } from "./repository.js";

export function createRouter(args: { config: Config; repo: Repository; queue: AnalysisQueue; engine: PreMortemEngine; redis: Parameters<typeof analysisRateLimit>[0]; mailer?: Mailer }) {
  const router = Router();
  const auth = requireUser(args.config);

  router.post("/v1/auth/register", authRateLimit(args.redis), async (req, res, next) => {
    try {
      const session = await args.repo.registerAccount(RegisterInput.parse(req.body));
      res.status(201).json({ accessToken: await issueAccessToken(args.config, session.actor), user: session.user, organization: session.organization });
    } catch (error) { next(error); }
  });

  router.post("/v1/auth/login", authRateLimit(args.redis), async (req, res, next) => {
    try {
      const session = await args.repo.authenticateAccount(LoginInput.parse(req.body));
      res.json({ accessToken: await issueAccessToken(args.config, session.actor), user: session.user, organization: session.organization });
    } catch (error) { next(error); }
  });

  router.post("/v1/auth/password-reset/request", authRateLimit(args.redis), async (req, res, next) => {
    try {
      const input = PasswordResetRequestInput.parse(req.body);
      const created = await args.repo.createPasswordResetToken(input.email);
      if (created && args.mailer) {
        const base = (args.config.APP_BASE_URL ?? "http://localhost:3100").replace(/\/$/, "");
        const resetUrl = `${base}/?resetToken=${encodeURIComponent(created.token)}`;
        await args.mailer.send({
          to: created.email,
          subject: "Reset your PreMortem password",
          text: `Use this link to reset your PreMortem password. It expires in 30 minutes and can only be used once.\n\n${resetUrl}\n\nIf you did not request this, you can safely ignore this email.`,
        });
      }
      // Always the same response whether or not the email exists, so this endpoint cannot be used to enumerate accounts.
      res.status(202).json({ ok: true });
    } catch (error) { next(error); }
  });

  router.post("/v1/auth/password-reset/confirm", authRateLimit(args.redis), async (req, res, next) => {
    try {
      const input = PasswordResetConfirmInput.parse(req.body);
      await args.repo.confirmPasswordReset(input.token, input.password);
      res.json({ ok: true });
    } catch (error) { next(error); }
  });

  router.get("/v1/session", auth, async (req, res, next) => {
    try { res.json(await args.repo.getSession(req.actor!)); } catch (error) { next(error); }
  });

  router.get("/v1/projects", auth, async (req, res, next) => {
    try { res.json({ projects: await args.repo.listProjects(req.actor!) }); } catch (error) { next(error); }
  });

  router.post("/v1/projects", auth, async (req, res, next) => {
    try { res.status(201).json(await args.repo.createProject({ ...CreateProjectInput.parse(req.body), actor: req.actor! })); } catch (error) { next(error); }
  });

  router.patch("/v1/projects/:projectId", auth, async (req, res, next) => {
    try {
      const projectId = z.string().uuid().parse(req.params.projectId);
      res.json(await args.repo.renameProject({ projectId, ...UpdateProjectInput.parse(req.body), actor: req.actor! }));
    } catch (error) { next(error); }
  });

  router.get("/v1/projects/:projectId/analyses", auth, async (req, res, next) => {
    try {
      const projectId = z.string().uuid().parse(req.params.projectId);
      res.json({ analyses: await args.repo.listProjectRuns(projectId, req.actor!) });
    } catch (error) { next(error); }
  });

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

  router.post("/v1/risks/:riskId/actions", auth, async (req, res, next) => {
    try {
      const input = MockActionInput.parse(req.body);
      const riskId = Array.isArray(req.params.riskId) ? req.params.riskId[0] : req.params.riskId;
      if (!riskId) throw new AppError(400, "INVALID_REQUEST", "Risk ID is required");
      const action = await args.repo.createMockAction({ riskId, actor: req.actor!, ...input });
      res.status(201).json(action);
    } catch (error) { next(error); }
  });

  router.post("/v1/actions/:actionId/verification", auth, async (req, res, next) => {
    try {
      const input = VerificationInput.parse(req.body);
      const actionId = Array.isArray(req.params.actionId) ? req.params.actionId[0] : req.params.actionId;
      if (!actionId) throw new AppError(400, "INVALID_REQUEST", "Action ID is required");
      const result = await args.repo.verifyMockAction({ actionId, actor: req.actor!, ...input });
      res.json(result);
    } catch (error) { next(error); }
  });

  router.use((_req, _res, next) => next(new AppError(404, "NOT_FOUND", "Route not found")));
  return router;
}
