"use client";

import { useState } from "react";
import { ArrowRight, CheckCircle2, Eye, EyeOff, LoaderCircle, ShieldCheck } from "lucide-react";
import { confirmPasswordReset } from "@/lib/api";

export function ResetPasswordPanel({ token, onDone }: { token: string; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mismatch) return;
    setError(null);
    setLoading(true);
    try {
      await confirmPasswordReset(token, password);
      setDone(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "We could not reset your password.");
    } finally {
      setLoading(false);
    }
  }

  return <main className="access-shell">
    <section className="access-copy">
      <div className="access-brand"><span>PM</span>PreMortem</div>
      <p className="eyebrow">Evidence-led delivery review</p>
      <h1>Find the failure path<br /><em>before</em> you ship it.</h1>
      <div className="access-trust"><ShieldCheck size={16} /><span>Project data, provider keys, and agent instructions stay server-side.</span></div>
    </section>
    <section className="access-card card" aria-label="Reset password">
      {done
        ? <div className="reset-sent"><CheckCircle2 size={18} /><p>Your password has been reset.</p><button type="button" className="button primary access-submit" onClick={onDone}>Continue to sign in <ArrowRight size={14} /></button></div>
        : <>
          <h2>Choose a new password</h2>
          <p>This link can only be used once and expires 30 minutes after it was sent.</p>
          <form className="access-form" onSubmit={submit}>
            <label className="label">New password
              <span className="password-field">
                <input type={showPassword ? "text" : "password"} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={12} />
                <button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </span>
            </label>
            <label className="label">Confirm password
              <input type={showPassword ? "text" : "password"} autoComplete="new-password" aria-invalid={mismatch} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength={12} />
              {mismatch && <span className="field-error">Passwords do not match.</span>}
            </label>
            <span className="hint">Use at least 12 characters, including letters and numbers.</span>
            {error && <p className="access-error" role="alert">{error}</p>}
            <button className="button primary access-submit" disabled={loading || mismatch} type="submit">{loading ? <><LoaderCircle className="spin" size={14} /> Working</> : <>Set new password<ArrowRight size={14} /></>}</button>
          </form>
        </>}
    </section>
  </main>;
}
