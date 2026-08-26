"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, BookOpenText, ChevronRight, CircleCheck, FileSearch, FlaskConical, Layers3, LoaderCircle, Network, ShieldCheck, Sparkles, Waypoints } from "lucide-react";
import { createAnalysis, getAnalysis, submitMitigation } from "@/lib/api";
import { demoAnalysis, samplePlan } from "@/lib/demo";
import { matrixStatus } from "@/lib/matrix";
import type { Analysis, Risk, Source } from "@/lib/contracts";

const nav = [
  [Layers3, "Analysis workspace", "#workspace"],
  [Network, "Disagreement matrix", "#matrix"],
  [AlertTriangle, "Risk register", "#risks"],
  [BookOpenText, "Evidence ledger", "#sources"],
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

export default function DashboardPage() {
  const [projectId, setProjectId] = useState("00000000-0000-4000-8000-000000000000");
  const [plan, setPlan] = useState(samplePlan);
  const [analysis, setAnalysis] = useState<Analysis>(demoAnalysis);
  const [isDemo, setIsDemo] = useState(true);
  const [selectedRiskId, setSelectedRiskId] = useState(demoAnalysis.risks[0]?.id ?? "");
  const [mitigationAnswer, setMitigationAnswer] = useState("");
  const [running, setRunning] = useState(false);
  const [submittingMitigation, setSubmittingMitigation] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedRisk = analysis.risks.find((risk) => risk.id === selectedRiskId) ?? analysis.risks[0];
  const matrix = matrixStatus(analysis);
  const sourceMap = useMemo(() => new Map(analysis.sources.map((source) => [source.id, source])), [analysis.sources]);

  async function poll(runId: string) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const latest = await getAnalysis(runId);
      setAnalysis(latest);
      if (latest.status === "succeeded" || latest.status === "failed") return latest;
      await delay(1_750);
    }
    throw new Error("The analysis is still running. Refresh this workspace to continue polling.");
  }

  async function runAnalysis() {
    setError(null);
    setFeedback(null);
    setRunning(true);
    try {
      const created = await createAnalysis({ projectId, plan, idempotencyKey: crypto.randomUUID() });
      const latest = await poll(created.id);
      setIsDemo(false);
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

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><span className="brand-mark">PM</span>Pre-Mortem</div>
        <nav className="nav" aria-label="Workspace sections">
          {nav.map(([Icon, label, href], index) => <a key={label} className={index === 0 ? "active" : ""} href={href}><Icon size={15} />{label}</a>)}
        </nav>
        <div className="side-note"><span className="kicker">Decision support</span><br />Risk findings are evidence-linked hypotheses, not project predictions.</div>
      </aside>

      <main className="main">
        <div className="topline"><span className="eyebrow">Evidence-led delivery review</span><span className="status"><span className="dot" />{isDemo ? "Example dossier" : analysis.status}</span></div>
        <h1>Find the failure path<br /><em>before</em> you ship it.</h1>
        <p className="lede">A legible pre-mortem that keeps research, independent failure narratives, disagreement, and mitigations in one decision record.</p>

        <section id="workspace" className="workspace" aria-labelledby="intake-title">
          <div className="card intake">
            <label className="label" htmlFor="project">Project identifier <span className="hint">(required by the secure API)</span></label>
            <input id="project" className="textarea" style={{ minHeight: 0, height: 42, resize: "none" }} value={projectId} onChange={(event) => setProjectId(event.target.value)} aria-label="Project identifier" />
            <label id="intake-title" className="label" htmlFor="plan" style={{ marginTop: 15 }}>Sprint plan or PRD</label>
            <textarea id="plan" className="textarea" value={plan} onChange={(event) => setPlan(event.target.value)} />
            <div className="actions">
              <button className="button primary" onClick={runAnalysis} disabled={running || plan.trim().length < 80}>{running ? <><LoaderCircle size={14} className="spin" /> Analysing</> : <><FileSearch size={14} /> Start secure analysis</>}</button>
              <button className="button quiet" onClick={openDemo}><Sparkles size={14} /> View example dossier</button>
              <span className="hint">The browser sends only your plan and project ID. Prompts, source policy, and scoring stay server-owned.</span>
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

function SourceCard({ source }: { source: Source }) {
  return <article className="card source"><div className="source-head"><span className="eyebrow">Branch {source.branch} · Tier {source.sourceTier}</span><span className="hint">rank {source.providerRank?.toFixed(2) ?? "—"}</span></div><h3>{source.title}</h3><p>{source.snippet}</p><a href={source.url} target="_blank" rel="noreferrer">{source.publisher ?? source.hostname} <ArrowRight size={10} style={{ verticalAlign: "-1px" }} /></a></article>;
}
