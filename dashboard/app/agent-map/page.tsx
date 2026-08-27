import { ArrowRight, CheckCircle2, FileSearch, GitFork, ListTodo, Search, ShieldCheck, UserRoundCheck } from "lucide-react";

const stages = [
  ["01", "Plan the investigation", "The Main Agent selects two independent failure angles.", FileSearch],
  ["02", "Research evidence", "Separate research branches retain credible, relevant sources.", Search],
  ["03", "Challenge weak claims", "The Critic exposes evidence gaps instead of hiding uncertainty.", GitFork],
  ["04", "Rank the failure paths", "Decision Skill creates an evidence-linked risk register.", ListTodo],
  ["05", "Approve, verify, replan", "A person approves a safe action, then the agent checks the result.", UserRoundCheck],
] as const;

export default function AgentMapPage() {
  return <main className="map-page">
    <header className="map-header"><a className="brand" href="/"><span className="brand-mark">PM</span>Pre-Mortem</a><a className="button quiet" href="/">Open workspace <ArrowRight size={14} /></a></header>
    <section className="map-hero"><p className="eyebrow">How the agent works</p><h1>One main agent.<br /><em>Many accountable skills.</em></h1><p className="lede">PreMortem is a process, not a single answer. It turns a project plan into independently researched risks, approved actions, and verified learning.</p></section>
    <section className="map-flow" aria-label="PreMortem Agent Map">{stages.map(([number, title, description, Icon], index) => <article className="map-stage" key={number}><div className="map-number">{number}</div><Icon size={20} /><h2>{title}</h2><p>{description}</p>{index < stages.length - 1 && <span className="map-arrow"><ArrowRight size={17} /></span>}</article>)}</section>
    <aside className="map-proof"><ShieldCheck size={19} /><div><strong>Evidence and safety stay in the loop.</strong><span>The browser never receives provider keys or agent instructions. Claims must link to retained evidence, and external actions are not performed without human approval.</span></div></aside>
    <section className="map-cta"><div><p className="eyebrow">Ready to investigate?</p><h2>Turn a project plan into a decision record.</h2></div><a className="button primary" href="/">Open live workspace <CheckCircle2 size={14} /></a></section>
  </main>;
}
