"use client";

import { useState } from "react";
import { ArrowRight, LoaderCircle, ShieldCheck } from "lucide-react";
import { register, signIn } from "@/lib/api";

export function AccessPanel({ onAuthenticated, onViewDemo }: { onAuthenticated: () => void; onViewDemo: () => void }) {
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [organizationName, setOrganizationName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "register") await register({ organizationName, displayName, email, password });
      else await signIn({ email, password });
      onAuthenticated();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "We could not complete that request.");
    } finally {
      setLoading(false);
    }
  }

  return <main className="access-shell">
    <section className="access-copy">
      <div className="access-brand"><span>PM</span>PreMortem</div>
      <p className="eyebrow">Evidence-led delivery review</p>
      <h1>Find the failure path<br /><em>before</em> you ship it.</h1>
      <p className="lede">A decision record for project teams: independent research, evidence-linked risks, human approval, and verified follow-through.</p>
      <div className="access-trust"><ShieldCheck size={16} /><span>Project data, provider keys, and agent instructions stay server-side.</span></div>
      <button type="button" className="text-action" onClick={onViewDemo}>View the illustrative dossier <ArrowRight size={14} /></button>
    </section>
    <section className="access-card card" aria-label="Account access">
      <div className="access-tabs"><button className={mode === "signin" ? "active" : ""} type="button" onClick={() => setMode("signin")}>Sign in</button><button className={mode === "register" ? "active" : ""} type="button" onClick={() => setMode("register")}>Create workspace</button></div>
      <h2>{mode === "signin" ? "Continue your review" : "Create your PreMortem workspace"}</h2>
      <p>{mode === "signin" ? "Use your workspace account to access projects and saved reviews." : "Start with your team workspace. You can create your first project next."}</p>
      <form className="access-form" onSubmit={submit}>
        {mode === "register" && <><label className="label">Organization<input autoComplete="organization" value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} required minLength={2} /></label><label className="label">Your name<input autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required minLength={2} /></label></>}
        <label className="label">Work email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label className="label">Password<input type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={mode === "register" ? 12 : 1} /></label>
        {mode === "register" && <span className="hint">Use at least 12 characters, including letters and numbers.</span>}
        {error && <p className="access-error" role="alert">{error}</p>}
        <button className="button primary access-submit" disabled={loading} type="submit">{loading ? <><LoaderCircle className="spin" size={14} /> Working</> : <>{mode === "signin" ? "Sign in" : "Create workspace"}<ArrowRight size={14} /></>}</button>
      </form>
    </section>
  </main>;
}
