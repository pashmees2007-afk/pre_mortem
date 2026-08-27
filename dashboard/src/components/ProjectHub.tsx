"use client";

import { useState } from "react";
import { Check, FolderPlus, Pencil, Plus, RotateCcw } from "lucide-react";
import type { AnalysisSummary, Project, ProductSession } from "@/lib/contracts";

export function ProjectHub({ session, projects, projectId, history, loading, onSelect, onCreate, onRename, onOpenRun }: { session: ProductSession; projects: Project[]; projectId: string; history: AnalysisSummary[]; loading: boolean; onSelect: (id: string) => void; onCreate: (name: string) => Promise<void>; onRename: (name: string) => Promise<void>; onOpenRun: (run: AnalysisSummary) => void }) {
  const [newProject, setNewProject] = useState("");
  const [rename, setRename] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const current = projects.find((project) => project.id === projectId);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newProject.trim().length < 2) return;
    setSaving(true);
    try { await onCreate(newProject.trim()); setNewProject(""); setShowCreate(false); } finally { setSaving(false); }
  }
  async function saveRename(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (rename.trim().length < 2) return;
    setSaving(true);
    try { await onRename(rename.trim()); setEditing(false); } finally { setSaving(false); }
  }

  return <section className="project-hub card" aria-label="Workspace project controls">
    <div className="project-identity"><span className="eyebrow">Workspace</span><strong>{session.organization.name}</strong><span className="hint">Signed in as {session.user.displayName ?? session.user.email}</span></div>
    <div className="project-controls"><label className="label">Current project<select value={projectId} onChange={(event) => onSelect(event.target.value)} disabled={loading || !projects.length}>{!projects.length && <option value="">Create your first project</option>}{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>{current && <button type="button" className="icon-button" aria-label="Rename current project" onClick={() => { setRename(current.name); setEditing(true); }}><Pencil size={14} /></button>}<button type="button" className="button quiet" onClick={() => setShowCreate((value) => !value)}><FolderPlus size={14} /> New project</button></div>
    {(showCreate || editing) && <form className="project-form" onSubmit={showCreate ? create : saveRename}><label className="label">{showCreate ? "New project name" : "Rename project"}<input autoFocus value={showCreate ? newProject : rename} onChange={(event) => showCreate ? setNewProject(event.target.value) : setRename(event.target.value)} minLength={2} required /></label><button className="button primary" disabled={saving} type="submit">{showCreate ? <><Plus size={14} /> Create</> : <><Check size={14} /> Save</>}</button></form>}
    <div className="history-strip"><div><span className="eyebrow">Saved analyses</span><strong>{history.length ? `${history.length} recent reviews` : "No saved reviews yet"}</strong></div><div className="history-list">{history.slice(0, 4).map((run) => <button type="button" onClick={() => onOpenRun(run)} className={`history-item ${run.status}`} key={run.id}><span>{run.status === "queued" || run.status === "running" ? <RotateCcw size={12} /> : <Check size={12} />}</span><b>{run.status}</b><small>{run.planPreview}</small></button>)}</div></div>
  </section>;
}
