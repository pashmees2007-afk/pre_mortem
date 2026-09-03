"use client";

import { useState } from "react";
import { ArrowRight, Eye, EyeOff, LoaderCircle, MailCheck, ShieldCheck } from "lucide-react";
import { register, requestPasswordReset, signIn } from "@/lib/api";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AccessPanel({ onAuthenticated, onViewDemo }: { onAuthenticated: () => void; onViewDemo: () => void }) {
  const [mode, setMode] = useState<"signin" | "register" | "forgot">("signin");
  const [organizationName, setOrganizationName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetRequested, setResetRequested] = useState(false);

  const emailInvalid = emailTouched && email.length > 0 && !EMAIL_PATTERN.test(email);

  function switchMode(next: "signin" | "register" | "forgot") {
    if (loading) return;
    setMode(next);
    setError(null);
    setResetRequested(false);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "register") await register({ organizationName, displayName, email, password });
      else if (mode === "forgot") { await requestPasswordReset(email); setResetRequested(true); return; }
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
      {mode !== "forgot" && <div className="access-tabs"><button className={mode === "signin" ? "active" : ""} type="button" disabled={loading} onClick={() => switchMode("signin")}>Sign in</button><button className={mode === "register" ? "active" : ""} type="button" disabled={loading} onClick={() => switchMode("register")}>Create workspace</button></div>}
      {mode === "forgot"
        ? <>
          <h2>Reset your password</h2>
          <p>Enter your workspace email and we will send a reset link if an account exists.</p>
        </>
        : <>
          <h2>{mode === "signin" ? "Continue your review" : "Create your PreMortem workspace"}</h2>
          <p>{mode === "signin" ? "Use your workspace account to access projects and saved reviews." : "Start with your team workspace. You can create your first project next."}</p>
        </>}
      {mode === "forgot" && resetRequested
        ? <div className="reset-sent"><MailCheck size={18} /><p>If an account exists for <strong>{email}</strong>, a reset link is on its way. The link expires in 30 minutes.</p><button type="button" className="text-action" onClick={() => switchMode("signin")}>Back to sign in <ArrowRight size={14} /></button></div>
        : <form className="access-form" onSubmit={submit}>
          {mode === "register" && <><label className="label">Organization<input autoComplete="organization" value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} required minLength={2} /></label><label className="label">Your name<input autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required minLength={2} /></label></>}
          <label className="label">Work email
            <input type="email" autoComplete="email" aria-invalid={emailInvalid} value={email} onChange={(event) => setEmail(event.target.value)} onBlur={() => setEmailTouched(true)} required />
            {emailInvalid && <span className="field-error">Enter a valid email address.</span>}
          </label>
          {mode !== "forgot" && <label className="label">Password
            <span className="password-field">
              <input type={showPassword ? "text" : "password"} autoComplete={mode === "signin" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={mode === "register" ? 12 : 1} />
              <button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </span>
          </label>}
          {mode === "register" && <span className="hint">Use at least 12 characters, including letters and numbers.</span>}
          {mode === "signin" && <button type="button" className="text-action forgot-link" onClick={() => switchMode("forgot")}>Forgot password?</button>}
          {error && <p className="access-error" role="alert">{error}</p>}
          <button className="button primary access-submit" disabled={loading} type="submit">{loading ? <><LoaderCircle className="spin" size={14} /> Working</> : <>{mode === "signin" ? "Sign in" : mode === "register" ? "Create workspace" : "Send reset link"}<ArrowRight size={14} /></>}</button>
          {mode === "forgot" && <button type="button" className="text-action" onClick={() => switchMode("signin")}>Back to sign in</button>}
        </form>}
    </section>
  </main>;
}
