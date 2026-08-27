"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, BadgeCheck, BookOpenText, CalendarDays, ChevronRight, CircleCheck, CircleDashed, CheckCircle2, ClipboardCheck, FileSearch, FlaskConical, GitFork, Layers3, ListTodo, LoaderCircle, LogOut, Network, RotateCcw, Search, ShieldCheck, Sparkles, UserRoundCheck, Waypoints } from "lucide-react";
import { approveMockAction, createAnalysis, createProject, getAnalysis, getSession, listProjectAnalyses, listProjects, renameProject, signOut, submitMitigation, verifyMockAction } from "@/lib/api";
import { demoAnalysis, samplePlan } from "@/lib/demo";
import { matrixStatus } from "@/lib/matrix";
import type { AgentTraceEvent, Analysis, AnalysisSummary, MockAction, ProductSession, Project, Risk, Source } from "@/lib/contracts";
import { AccessPanel } from "@/components/AccessPanel";
import { ProjectHub } from "@/components/ProjectHub";

const nav = [
  [Layers3, "Analysis workspace", "#workspace"],
  [Waypoints, "Agent activity", "#agent-flow"],
  [Network, "Disagreement matrix", "#matrix"],
  [AlertTriangle, "Risk register", "#risks"],
  [ClipboardCheck, "Approval & action", "#actions"],
  [BookOpenText, "Evidence ledger", "#sources"],
  [Waypoints, "How the agent works", "/agent-map"],
] as const;

const liveStages = [
  ["01", "Scope", "Project plan", "#workspace", FileSearch],
  ["02", "Investigate", "Two research branches", "#agent-flow", Search],
  ["03", "Challenge", "Evidence critic", "#agent-flow", GitFork],
  ["04", "Decide", "Risk register", "#risks", ListTodo],
  ["05", "Verify", "Human-approved loop", "#actions", CheckCircle2],
] as const;

function severityClass(severity: number) {
  return severity >= 4 ? "high" : severity === 3 ? "" : "teal";
}

function tonePill(status: ReturnType<typeof matrixStatus>["tone"]) {
  return status === "signal" ? "pill high" : status === "teal" ? "pill teal" : "pill";
}

function sourceFor(risk: Risk, sources: Source[]) {
  const ids = new Set(risk.evidenceIds);
  return sources.filter((source) => ids.has(source.id));
}

function delay(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function traceTone(status: AgentTraceEvent["status"]) {
  if (status === "attention" || status === "failed" || status === "replan") return "signal";
  if (status === "approved") return "gold";
  return "teal";
}

export default function DashboardPage() {
  const [session, setSession] = useState<ProductSession | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [guestDemo, setGuestDemo] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [history, setHistory] = useState<AnalysisSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [resumedRunId, setResumedRunId] = useState<string | null>(null);
  const [plan, setPlan] = useState(samplePlan);
  const [analysis, setAnalysis] = useState<Analysis>(demoAnalysis);
  const [isDemo, setIsDemo] = useState(true);
  const [selectedRiskId, setSelectedRiskId] = useState(demoAnalysis.risks[0]?.id ?? "");
  const [mitigationAnswer, setMitigationAnswer] = useState("");
  const [running, setRunning] = useState(false);
  const [submittingMitigation, setSubmittingMitigation] = useState(false);
  const [actionOwner, setActionOwner] = useState("Project owner");
  const [actionDueDate, setActionDueDate] = useState("2026-09-02");
  const [approvalNote, setApprovalNote] = useState("I approve this safe, reversible mock mitigation action.");
  const [verificationNote, setVerificationNote] = useState("");
  const [savingAction, setSavingAction] = useState(false);
  const [verifyingAction, setVerifyingAction] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedRisk = analysis.risks.find((risk) => risk.id === selectedRiskId) ?? analysis.risks[0];
  const matrix = matrixStatus(analysis);
  const sourceMap = useMemo(() => new Map(analysis.sources.map((source) => [source.id, source])), [analysis.sources]);

  const refreshHistory = useCallback(async (id: string) => {
    if (!id) return;
    setHistoryLoading(true);
    try { setHistory(await listProjectAnalyses(id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Saved analyses could not be loaded."); }
    finally { setHistoryLoading(false); }
  }, []);

  const refreshProjects = useCallback(async () => {
    const available = await listProjects();
    setProjects(available);
    setProjectId((current) => available.some((project) => project.id === current) ? current : (available[0]?.id ?? ""));
    return available;
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try { const current = await getSession(); if (active) setSession(current); }
      catch { if (active) setSession(null); }
      finally { if (active) setAuthLoading(false); }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!session) return;
    void refreshProjects().catch((reason) => setError(reason instanceof Error ? reason.message : "Projects could not be loaded."));
  }, [session, refreshProjects]);

  useEffect(() => { if (session && projectId) void refreshHistory(projectId); }, [session, projectId, refreshHistory]);

  useEffect(() => {
    const activeRun = history.find((run) => run.status === "queued" || run.status === "running");
    if (activeRun && activeRun.id !== resumedRunId) {
      setResumedRunId(activeRun.id);
      setFeedback("Resumed the saved analysis that was still running.");
      void openSavedRun(activeRun);
    }
  }, [history, resumedRunId]);

  async function poll(runId: string) {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const latest = await getAnalysis(runId);
      setAnalysis(latest);
      if (latest.status === "succeeded" || latest.status === "failed") { if (projectId) void refreshHistory(projectId); return latest; }
      await delay(1_750);
    }
    throw new Error("This analysis is still running. It is saved in your project history and will resume when you reopen it.");
  }

  async function runAnalysis() {
    setError(null);
    setFeedback(null);
    if (!session || !projectId) { setError("Create or select a project before starting an analysis."); return; }
    setRunning(true);
    try {
      const created = await createAnalysis({ projectId, plan, idempotencyKey: crypto.randomUUID() });
      setIsDemo(false);
      setAnalysis({ id: created.id, status: "queued", sources: [], branches: [], risks: [], disagreement: null, investigationPlan: null, critic: null, trace: [], actions: [] });
      const latest = await poll(created.id);
      setSelectedRiskId(latest.risks[0]?.id ?? "");
      if (latest.status === "failed") setError("The secure backend could not complete this run. No unsupported evidence has been shown.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Analysis could not be started.");
    } finally {
      setRunning(false);
    }
  }

  function openDemo() {
    setAnalysis(demoAnalysis);
    setSelectedRiskId(demoAnalysis.risks[0]?.id ?? "");
    setIsDemo(true);
    setError(null);
    setFeedback("Loaded the example evidence dossier. It is illustrative; live runs use your secure backend.");
  }

  async function createManagedProject(name: string) {
    try {
      const project = await createProject({ name });
      await refreshProjects();
      setProjectId(project.id);
      setHistory([]);
      setResumedRunId(null);
      setIsDemo(false);
      setFeedback(`Created ${project.name}. Add a plan when you are ready to start a review.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Project could not be created."); }
  }

  async function renameManagedProject(name: string) {
    if (!projectId) return;
    try {
      const project = await renameProject(projectId, name);
      await refreshProjects();
      setFeedback(`Renamed project to ${project.name}.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Project could not be renamed."); }
  }

  function selectManagedProject(id: string) {
    setHistory([]);
    setResumedRunId(null);
    setProjectId(id);
  }

  async function openSavedRun(run: AnalysisSummary) {
    setError(null);
    setRunning(run.status === "queued" || run.status === "running");
    try {
      const latest = await getAnalysis(run.id);
      setAnalysis(latest);
      setIsDemo(false);
      setSelectedRiskId(latest.risks[0]?.id ?? "");
      if (latest.status === "queued" || latest.status === "running") await poll(run.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Saved analysis could not be resumed."); }
    finally { setRunning(false); }
  }

  async function leaveWorkspace() {
    await signOut().catch(() => undefined);
    setSession(null); setProjects([]); setProjectId(""); setHistory([]); setGuestDemo(false); setIsDemo(true); setAnalysis(demoAnalysis);
  }

  if (authLoading) return <main className="access-shell"><div className="access-card card loading-card"><LoaderCircle className="spin" size={18} /> Checking secure workspace access…</div></main>;
  if (!session && !guestDemo) return <AccessPanel onAuthenticated={() => { setAuthLoading(true); void getSession().then((current) => setSession(current)).catch(() => setSession(null)).finally(() => setAuthLoading(false)); }} onViewDemo={() => setGuestDemo(true)} />;

  async function assessMitigation() {
    if (!selectedRisk || mitigationAnswer.trim().length < 8) return;
    setSubmittingMitigation(true);
    setError(null);
    try {
      if (isDemo) {
        const before = selectedRisk.severity;
        const after = Math.max(1, before - 1);
        setAnalysis((current) => ({ ...current, risks: current.risks.map((risk) => risk.id === selectedRisk.id ? { ...risk, severity: after } : risk) }));
        setFeedback(`Illustrative re-score: ${before} → ${after}. A live run records the assessment, evidence class, gaps, and rationale in the secure backend.`);
      } else {
        const outcome = await submitMitigation(selectedRisk.id, mitigationAnswer);
        setAnalysis((current) => ({ ...current, risks: current.risks.map((risk) => risk.id === selectedRisk.id ? { ...risk, severity: outcome.after } : risk) }));
        setFeedback(`Severity changed ${outcome.before} → ${outcome.after}. ${outcome.rationale}${outcome.assessment.gaps.length ? ` Remaining gap: ${outcome.assessment.gaps[0]}.` : ""}`);
      }
      setMitigationAnswer("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The mitigation assessment could not be saved.");
    } finally {
      setSubmittingMitigation(false);
    }
  }

  async function approveAction() {
    if (!selectedRisk || actionOwner.trim().length < 2 || approvalNote.trim().length < 8) return;
    setSavingAction(true);
    setError(null);
    try {
      if (isDemo) {
        const action: MockAction = { id: crypto.randomUUID(), riskId: selectedRisk.id, riskTitle: selectedRisk.title, owner: actionOwner.trim(), dueDate: actionDueDate, approvalNote: approvalNote.trim(), status: "approved", verificationNote: null, createdAt: new Date().toISOString(), verifiedAt: null };
        setAnalysis((current) => ({ ...current, actions: [action, ...current.actions], trace: [...current.trace, { skill: "Human Approval Gate", stage: "approve_action", status: "approved", detail: `Approved a mock mitigation action for ${action.owner}.`, metadata: { actionId: action.id }, createdAt: new Date().toISOString() }, { skill: "Action Skill", stage: "create_action", status: "completed", detail: "Created a reversible mock action card; no external project system was changed.", metadata: { actionId: action.id }, createdAt: new Date().toISOString() }] }));
        setFeedback("Mock action approved. It is recorded only inside this example dossier; no external project tool was changed.");
      } else {
        await approveMockAction(selectedRisk.id, { owner: actionOwner.trim(), dueDate: actionDueDate, approvalNote: approvalNote.trim() });
        setAnalysis(await getAnalysis(analysis.id));
        setFeedback("Action approved and recorded. The project system is still unchanged because this MVP uses a mock action board.");
      }
      setVerificationNote("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The action could not be approved.");
    } finally {
      setSavingAction(false);
    }
  }

  async function verifyAction(action: MockAction, outcome: "verified" | "failed") {
    if (verificationNote.trim().length < 8) return;
    setVerifyingAction(true);
    setError(null);
    try {
      if (isDemo) {
        setAnalysis((current) => ({ ...current, actions: current.actions.map((item) => item.id === action.id ? { ...item, status: outcome === "verified" ? "verified" : "replan_required", verificationNote: verificationNote.trim(), verifiedAt: new Date().toISOString() } : item), trace: [...current.trace, { skill: "Verification Skill", stage: "verify_action", status: outcome === "verified" ? "verified" : "failed", detail: verificationNote.trim(), metadata: { actionId: action.id }, createdAt: new Date().toISOString() }, ...(outcome === "failed" ? [{ skill: "PreMortem Main Agent", stage: "replan", status: "replan" as const, detail: "Verification failed, so the Main Agent requested a new mitigation plan.", metadata: { actionId: action.id }, createdAt: new Date().toISOString() }] : [])] }));
        setFeedback(outcome === "verified" ? "Mock action verified. The case can move forward." : "Verification failed. The Main Agent has requested a replan.");
      } else {
        await verifyMockAction(action.id, { outcome, note: verificationNote.trim() });
        setAnalysis(await getAnalysis(analysis.id));
        setFeedback(outcome === "verified" ? "Action verified." : "Verification failed and a replan was recorded.");
      }
      setVerificationNote("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The verification result could not be saved.");
    } finally {
      setVerifyingAction(false);
    }
  }

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><span className="brand-mark">PM</span>Pre-Mortem</div>
        <nav className="nav" aria-label="Workspace sections">
          {nav.map(([Icon, label, href], index) => <a key={label} className={index === 0 ? "active" : ""} href={href}><Icon size={15} />{label}</a>)}
        </nav>
        <div className="side-note"><span className="kicker">Decision support</span><br />Risk findings are evidence-linked hypotheses, not project predictions.{session && <button className="signout" type="button" onClick={leaveWorkspace}><LogOut size={13} /> Sign out</button>}</div>
      </aside>

      <main className="main">
        <div className="topline"><span className="eyebrow">Evidence-led delivery review</span><span className="status"><span className="dot" />{isDemo ? "Example dossier" : analysis.status}</span></div>
        <h1>Find the failure path.<br /><em>Then close the loop.</em></h1>
        <p className="lede">This is the live Agent Map: a project plan moves through independent research, evidence challenge, human-approved action, and verified learning.</p>

        <section className="live-agent-map" aria-label="Live PreMortem Agent Map">
          <div className="live-map-heading"><span className="eyebrow">Live agent map</span><span className="hint">Click a stage to inspect its live record</span></div>
          <div className="live-stage-list">{liveStages.map(([number, label, detail, href, Icon], index) => <a href={href} className={`live-stage ${running && index < 2 ? "working" : ""}`} key={number}><span className="live-stage-number">{number}</span><Icon size={16} /><span><strong>{label}</strong><small>{detail}</small></span>{index < liveStages.length - 1 && <ArrowRight className="live-stage-arrow" size={15} />}</a>)}</div>
        </section>

        {session ? <ProjectHub session={session} projects={projects} projectId={projectId} history={history} loading={historyLoading} onSelect={selectManagedProject} onCreate={createManagedProject} onRename={renameManagedProject} onOpenRun={openSavedRun} /> : <div className="guest-banner"><span><Sparkles size={15} /> Illustrative dossier only</span><button type="button" className="text-action" onClick={() => setGuestDemo(false)}>Sign in to run your own review <ArrowRight size={14} /></button></div>}

        <section id="workspace" className="workspace" aria-labelledby="intake-title">
          <div className="card intake">
            <label id="intake-title" className="label" htmlFor="plan" style={{ marginTop: 15 }}>Sprint plan or PRD</label>
            <textarea id="plan" className="textarea" value={plan} onChange={(event) => setPlan(event.target.value)} />
            <div className="actions">
              <button className="button primary" onClick={runAnalysis} disabled={running || plan.trim().length < 80 || !session || !projectId}>{running ? <><LoaderCircle size={14} className="spin" /> Analysing</> : <><FileSearch size={14} /> Start secure analysis</>}</button>
              <button className="button quiet" onClick={openDemo}><Sparkles size={14} /> View example dossier</button>
              <span className="hint">{session ? "The browser sends only your plan and selected project. Prompts, source policy, and scoring stay server-owned." : "Sign in and create a project to run your own secure analysis."}</span>
            </div>
          </div>
          <aside className="card principles" aria-label="Trust properties">
            <span className="eyebrow">How to read this</span>
            <h2>Reasoning you can inspect.</h2>
            <div className="principle"><span className="seal"><Waypoints size={14} /></span><div><strong>Separated evidence</strong>Each branch receives a distinct retrieval set before it forms a scenario.</div></div>
            <div className="principle"><span className="seal"><FlaskConical size={14} /></span><div><strong>Visible disagreement</strong>Different claims are surfaced, not averaged into false certainty.</div></div>
            <div className="principle"><span className="seal"><ShieldCheck size={14} /></span><div><strong>Reversible scoring</strong>Mitigation answers retain the before/after severity trail.</div></div>
          </aside>
        </section>
        {error && <div className="empty" role="alert" style={{ marginTop: 16, borderColor: "#d55a3d", color: "#9d3927" }}>{error}</div>}
        {feedback && <div className="empty" role="status" style={{ marginTop: 16, padding: 16, textAlign: "left", borderStyle: "solid", borderColor: "#b5d5ca" }}>{feedback}</div>}

        {analysis.status !== "succeeded" ? <div className="empty" style={{ marginTop: 36 }}>{analysis.status === "failed" ? "This run did not complete. The backend recorded a failure state rather than fabricating a result." : "The secure backend is collecting and comparing evidence. This workspace will update when the run completes."}</div> : <>
          <section id="agent-flow" className="section" aria-labelledby="agent-flow-title">
            <div className="section-head"><div><span className="eyebrow">Inspectable orchestration</span><h2 id="agent-flow-title" className="section-title">Agent activity trace</h2></div><p className="section-caption">The agent starts with a project goal, chooses risk angles, researches evidence, compares branches, asks for approval, and verifies action outcomes.</p></div>
            <div className="agent-flow-layout">
              <div className="card trace-card"><div className="trace-heading"><div><span className="mono">Observed sequence</span><strong>Every completed or attention-needed agent step</strong></div><span className="pill teal">{analysis.trace.length} events</span></div><div className="trace-list">{analysis.trace.map((event, index) => <TraceItem event={event} index={index} key={`${event.createdAt}-${event.stage}-${index}`} />)}</div></div>
              <aside className="agent-side-stack">
                <article className="card planner-card"><span className="eyebrow">01 · Investigation planner</span><h3>{analysis.investigationPlan?.summary ?? "The Main Agent will select the right skills once planning is complete."}</h3>{analysis.investigationPlan && <><div className="planner-angles">{analysis.investigationPlan.angles.map((angle) => <span key={`${angle.branch}-${angle.category}`}><b>Branch {angle.branch}</b>{angle.category.replaceAll("_", " ")}</span>)}</div><div className="query-pair"><p><strong>Query A</strong>{analysis.investigationPlan.researchQueries.A}</p><p><strong>Query B</strong>{analysis.investigationPlan.researchQueries.B}</p></div></>}</article>
                <article className="card critic-card"><span className="eyebrow">05 · Evidence critic</span><h3>{analysis.critic?.finding ?? "The Critic will challenge the evidence after both branches finish."}</h3>{analysis.critic && <><div className="critic-gap"><AlertTriangle size={14} /><span>{analysis.critic.evidenceGaps[0] ?? "No material evidence gap recorded."}</span></div><p className="next-check"><strong>Next check</strong>{analysis.critic.nextCheck}</p></>}</article>
              </aside>
            </div>
          </section>
          <section id="matrix" className="section" aria-labelledby="matrix-title">
            <div className="section-head"><div><span className="eyebrow">Independent branches</span><h2 id="matrix-title" className="section-title">Disagreement matrix</h2></div><p className="section-caption">The matrix compares branch-specific primary causes, evidence overlap, and the reason the system did—or did not—flag disagreement.</p></div>
            <div className="card matrix">
              <div className="matrix-top"><div><span className="mono">Comparison result</span><strong style={{ display: "block", marginTop: 4, fontSize: 14 }}>{matrix.label}</strong></div><span className={tonePill(matrix.tone)}>{analysis.disagreement?.semanticRelation ?? "unresolved"}</span></div>
              <div className="matrix-grid">
                {analysis.branches[0] ? <Branch branch={analysis.branches[0]} sources={analysis.sources} /> : <div className="branch">Branch A unavailable</div>}
                <div className="centerline"><div className="relation">{analysis.disagreement?.categoryRelation ?? "unknown"}<br /><ArrowRight size={15} style={{ marginTop: 6 }} /></div><span className="hint" style={{ marginTop: 10 }}>evidence overlap<br /><strong style={{ color: "var(--ink)" }}>{Math.round((analysis.disagreement?.evidenceOverlap ?? 0) * 100)}%</strong></span></div>
                {analysis.branches[1] ? <Branch branch={analysis.branches[1]} sources={analysis.sources} /> : <div className="branch">Branch B unavailable</div>}
              </div>
              <div className="matrix-note"><strong>Why this status:</strong> {analysis.disagreement?.explanation ?? matrix.description}</div>
            </div>
          </section>

          <section id="risks" className="section" aria-labelledby="risks-title">
            <div className="section-head"><div><span className="eyebrow">Prioritized decision record</span><h2 id="risks-title" className="section-title">Evidence-linked risk register</h2></div><p className="section-caption">Severity is calculated from impact and likelihood. It is not an opaque model confidence score.</p></div>
            <div className="risk-layout">
              <div className="risk-list">{analysis.risks.map((risk) => <RiskItem key={risk.id} risk={risk} selected={risk.id === selectedRisk?.id} onSelect={() => setSelectedRiskId(risk.id)} sourceCount={risk.evidenceIds.length} />)}</div>
              {selectedRisk && <RiskDetail risk={selectedRisk} sources={sourceFor(selectedRisk, analysis.sources)} answer={mitigationAnswer} onAnswer={setMitigationAnswer} onSubmit={assessMitigation} loading={submittingMitigation} />}
            </div>
          </section>

          <section id="actions" className="section" aria-labelledby="actions-title">
            <div className="section-head"><div><span className="eyebrow">Human-in-the-loop control</span><h2 id="actions-title" className="section-title">Approval, action, and verification</h2></div><p className="section-caption">The agent cannot close a risk by itself. A person approves a safe mock action, then verifies the result or sends the case back for replanning.</p></div>
            <div className="action-layout">
              <article className="card approval-card"><div className="approval-head"><span className="seal"><UserRoundCheck size={15} /></span><div><span className="eyebrow">Human approval gate</span><h3>{selectedRisk?.title ?? "Select a risk"}</h3></div></div><p>Approve only a reversible mock action. This MVP records the decision inside Pre-Mortem and does not change Jira, GitHub, or any external project tool.</p><div className="control-grid"><label className="label">Action owner<input className="textarea control-input" value={actionOwner} onChange={(event) => setActionOwner(event.target.value)} /></label><label className="label">Due date<input type="date" className="textarea control-input" value={actionDueDate} onChange={(event) => setActionDueDate(event.target.value)} /></label></div><label className="label">Approval note<textarea className="textarea control-note" value={approvalNote} onChange={(event) => setApprovalNote(event.target.value)} /></label><button className="button primary" onClick={approveAction} disabled={savingAction || !selectedRisk || approvalNote.trim().length < 8}>{savingAction ? <><LoaderCircle size={14} className="spin" /> Saving approval</> : <><BadgeCheck size={14} /> Approve mock action</>}</button></article>
              <article className="card action-board"><div className="action-board-head"><div><span className="eyebrow">Action board</span><h3>Approved mitigation cards</h3></div><span className="pill">{analysis.actions.length} recorded</span></div>{analysis.actions.length === 0 ? <div className="empty action-empty"><CircleDashed size={21} />No approved action yet. Assess a mitigation, then approve a safe mock task.</div> : <div className="action-list">{analysis.actions.map((action) => <ActionCard key={action.id} action={action} verificationNote={verificationNote} onNote={setVerificationNote} onVerify={verifyAction} loading={verifyingAction} />)}</div>}</article>
            </div>
          </section>

          <section id="sources" className="section" aria-labelledby="sources-title">
            <div className="section-head"><div><span className="eyebrow">Citable context</span><h2 id="sources-title" className="section-title">Evidence ledger</h2></div><p className="section-caption">Only retained source records can support a displayed risk. Sources remain visible beside the work they support.</p></div>
            <div className="sources">{analysis.sources.map((source) => <SourceCard source={source} key={source.id} />)}</div>
          </section>
        </>}
      </main>
    </div>
  );
}

function Branch({ branch, sources }: { branch: Analysis["branches"][number]; sources: Source[] }) {
  const evidenceIds = branch.scenario.claims.flatMap((claim) => claim.evidenceIds);
  const evidence = sources.filter((source) => evidenceIds.includes(source.id));
  return <article className="branch"><span className="eyebrow">Branch {branch.branch} · {branch.primaryCategory.replaceAll("_", " ")}</span><h3>{branch.rootCause}</h3><p className="root">{branch.scenario.narrative}</p>{evidence.slice(0, 2).map((source) => <div className={branch.branch === "B" ? "evidence-pip signal" : "evidence-pip"} key={source.id}><CircleCheck size={13} /><span><strong>{source.publisher ?? source.hostname}</strong><br />{source.title}</span></div>)}</article>;
}

function RiskItem({ risk, selected, onSelect, sourceCount }: { risk: Risk; selected: boolean; onSelect: () => void; sourceCount: number }) {
  return <button className={`risk ${selected ? "selected" : ""}`} onClick={onSelect}><div className="risk-top"><div><span className="eyebrow">{risk.category.replaceAll("_", " ")}</span><h3>{risk.title}</h3></div><span className={`pill ${severityClass(risk.severity)}`}>Severity {risk.severity}/5</span></div><p>{risk.explanation}</p><div className="hint" style={{ marginTop: 11 }}><BookOpenText size={12} style={{ verticalAlign: "-2px" }} /> {sourceCount} linked evidence {sourceCount === 1 ? "record" : "records"} · uncertainty: {risk.uncertainty}</div></button>;
}

function RiskDetail({ risk, sources, answer, onAnswer, onSubmit, loading }: { risk: Risk; sources: Source[]; answer: string; onAnswer: (value: string) => void; onSubmit: () => void; loading: boolean }) {
  return <aside className="card detail"><span className="eyebrow">Selected risk</span><h3>{risk.title}</h3><p>{risk.explanation}</p><div className="fact"><span>Recommended mitigation</span>{risk.mitigation}</div><div className="fact"><span>Severity rubric</span>Impact {risk.impact}/5 × likelihood {risk.likelihood}/5 → <strong>{risk.severity}/5</strong></div><div className="fact"><span>Uncertainty</span>{risk.uncertainty}</div><div className="fact"><span>Supporting evidence</span>{sources.map((source) => <a className="source-link" target="_blank" rel="noreferrer" href={source.url} key={source.id}><ChevronRight size={13} /><span>{source.publisher ?? source.hostname}<br /><strong>{source.title}</strong></span></a>)}</div><div className="mitigation"><span className="mono">Mitigation evidence</span><p style={{ margin: "6px 0 9px" }}>What concrete control, owner, test, rollback, or monitoring proof changes this risk?</p><textarea className="textarea" value={answer} onChange={(event) => onAnswer(event.target.value)} placeholder="e.g. Maria owns the gateway canary; rollback was exercised in staging on 26 Aug; alert threshold is documented…" /><button className="button primary" style={{ marginTop: 9 }} onClick={onSubmit} disabled={loading || answer.trim().length < 8}>{loading ? "Assessing control…" : "Assess mitigation"}</button><div className="score-change"><span className="score-badge">{risk.severity}/5</span><ArrowRight size={12} /><span>Re-score is retained with a rationale and can be reversed.</span></div></div></aside>;
}

function TraceItem({ event, index }: { event: AgentTraceEvent; index: number }) {
  const Icon = event.status === "approved" ? UserRoundCheck : event.status === "verified" ? CircleCheck : event.status === "replan" ? RotateCcw : event.status === "attention" || event.status === "failed" ? AlertTriangle : Waypoints;
  return <div className={`trace-item ${traceTone(event.status)}`}><span className="trace-step">{String(index + 1).padStart(2, "0")}</span><span className="trace-icon"><Icon size={15} /></span><div><strong>{event.skill}</strong><span>{event.stage.replaceAll("_", " ")}</span><p>{event.detail}</p></div></div>;
}

function ActionCard({ action, verificationNote, onNote, onVerify, loading }: { action: MockAction; verificationNote: string; onNote: (value: string) => void; onVerify: (action: MockAction, outcome: "verified" | "failed") => void; loading: boolean }) {
  const closed = action.status === "verified" || action.status === "replan_required";
  return <article className={`action-item ${action.status}`}><div className="action-item-top"><div><span className="eyebrow">{action.status.replaceAll("_", " ")}</span><h4>{action.riskTitle ?? "Approved risk mitigation"}</h4></div><span className={`pill ${action.status === "replan_required" ? "high" : action.status === "verified" ? "teal" : ""}`}>{action.status.replaceAll("_", " ")}</span></div><p><strong>Owner:</strong> {action.owner} <span>·</span> <strong>Due:</strong> <CalendarDays size={12} /> {action.dueDate}</p><div className="approval-note"><strong>Approval record</strong>{action.approvalNote}</div>{closed ? <div className="verification-result"><CircleCheck size={15} /><span>{action.verificationNote ?? "No verification note recorded."}</span></div> : <div className="verify-control"><label className="label">Verification note<textarea className="textarea control-note" value={verificationNote} onChange={(event) => onNote(event.target.value)} placeholder="What happened when you checked the mitigation?" /></label><div className="verify-buttons"><button className="button quiet" disabled={loading || verificationNote.trim().length < 8} onClick={() => onVerify(action, "verified")}><CircleCheck size={14} /> Mark verified</button><button className="button signal-button" disabled={loading || verificationNote.trim().length < 8} onClick={() => onVerify(action, "failed")}><RotateCcw size={14} /> Request replan</button></div></div>}</article>;
}

function SourceCard({ source }: { source: Source }) {
  return <article className="card source"><div className="source-head"><span className="eyebrow">Branch {source.branch} · Tier {source.sourceTier}</span><span className="hint">rank {source.providerRank?.toFixed(2) ?? "—"}</span></div><h3>{source.title}</h3><p>{source.snippet}</p><a href={source.url} target="_blank" rel="noreferrer">{source.publisher ?? source.hostname} <ArrowRight size={10} style={{ verticalAlign: "-1px" }} /></a></article>;
}
