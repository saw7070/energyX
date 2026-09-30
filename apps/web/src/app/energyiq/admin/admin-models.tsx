"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { configApi, type ReportModelProfile, type ReportModelProtocol, type ReportModelsState } from "../../../lib/config-api/client";

const button = "rounded-lg border border-border px-4 py-2 text-sm font-semibold transition-colors hover:bg-surface-subtle disabled:cursor-wait disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
const inputClass = "mt-2 w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";
type Client = Pick<typeof configApi, "getReportModels" | "createReportModel" | "testReportModel" | "activateReportModel">;

export function AdminModels({ client = configApi }: { client?: Client }) {
  const [state, setState] = useState<ReportModelsState | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<ReportModelProfile | null>(null);
  const [form, setForm] = useState({ apiProtocol: "openai-completions" as ReportModelProtocol, name: "", modelName: "", baseUrl: "https://api.deepseek.com/v1", apiKey: "" });
  const load = useCallback(async () => {
    try { setState(await client.getReportModels()); setError(""); }
    catch { setError("Model settings could not be loaded. Please retry."); }
  }, [client]);
  useEffect(() => { void load(); }, [load]);
  async function run(id: string, work: () => Promise<void>) {
    if (busy) return;
    setBusy(id); setError(""); setNotice("");
    try { await work(); }
    catch (e) {
      const code = e && typeof e === "object" && "code" in e ? String(e.code) : "";
      setError(code.includes("REVISION") ? "Settings changed in another window. Refresh and review before switching."
        : code.includes("ENDPOINT") ? "Use an HTTPS base URL, such as https://api.deepseek.com/v1. Do not include /chat/completions or /messages."
        : id.startsWith("test:") ? "The model did not pass the report compatibility check. Check its key, model ID and support for streaming tool calls. Your current model has not changed."
        : "This change could not be completed. Refresh to check the current model before trying again.");
    } finally { setBusy(""); }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    await run("save", async () => {
      const saved = await client.createReportModel(form);
      setForm(f => ({ ...f, apiKey: "" })); setAdding(false);
      setState(s => s ? { ...s, profiles: [saved, ...s.profiles] } : s);
      setNotice("Configuration saved. Test it before switching. Your current model has not changed.");
    });
  }
  function test(profile: ReportModelProfile) {
    void run("test:" + profile.id, async () => {
      const tested = await client.testReportModel(profile.id, profile.revision);
      setState(s => s ? { ...s, profiles: s.profiles.map(p => p.id === tested.id ? tested : p) } : s);
      setNotice("Streaming and tool calls passed. You can now use this model.");
    });
  }
  function activate() {
    if (!confirm || !state) return;
    const selected = confirm;
    void run("activate", async () => {
      const updated = await client.activateReportModel(selected.id, selected.revision, state.current.revision ?? 0);
      setState(updated); setConfirm(null);
      setNotice(selected.name + " is now the default for all projects.");
    });
  }
  return <div className="mx-auto max-w-5xl space-y-6">
    <section className="rounded-2xl border border-primary/20 bg-primary/5 p-6 lg:p-8" aria-label="Current model">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-sm font-semibold text-primary">Current model · All projects</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">{state ? state.current.modelName ?? (state.current.configured ? "Model unavailable" : "No model selected") : "Loading model…"}</h2>
          <p className="mt-2 text-sm text-muted">Used for AI conversations, report generation, review and Skill creation.</p></div>
        <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold">{state?.current.available ? "Active" : state ? "Needs setup" : "Loading"}</span>
      </div>
      <p className="mt-5 border-t border-primary/15 pt-4 text-sm text-muted">A switch applies when the next task starts, including queued tasks. Tasks already running keep their model.</p>
    </section>
    {error ? <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900">{error} <button className={button + " ml-2"} disabled={Boolean(busy)} onClick={() => void load()}>Refresh</button></div> : null}
    {notice ? <p role="status" className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">{notice}</p> : null}
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-semibold">Available configurations</h3><p className="mt-1 text-sm text-muted">Save a configuration, test it, then choose when to switch.</p></div>
      <button className={button + " bg-primary text-white hover:bg-primary/90"} disabled={Boolean(busy) || !state} onClick={() => { setAdding(true); setConfirm(null); }}>Add model</button></div>
    {adding ? <form onSubmit={save} className="rounded-xl border border-border bg-surface p-6" aria-label="Add model">
      <h3 className="text-lg font-semibold">Add a model</h3>
      <p className="mt-2 text-sm text-muted">Choose OpenAI compatible or Anthropic, then test streaming and tool calls before switching.</p>
      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <label className="text-sm font-medium">Display name<input required maxLength={200} className={inputClass} value={form.name} placeholder="DeepSeek Flash" disabled={Boolean(busy)} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></label>
        <label className="text-sm font-medium">API protocol<select className={inputClass} value={form.apiProtocol} disabled={Boolean(busy)} onChange={e => setForm(f => ({ ...f, apiProtocol: e.target.value as ReportModelProtocol, baseUrl: e.target.value === "anthropic-messages" ? "https://api.anthropic.com" : "https://api.openai.com/v1", modelName: e.target.value === "anthropic-messages" ? "claude-opus-4-8" : "gpt-5.6-sol" }))}><option value="openai-completions">OpenAI compatible</option><option value="anthropic-messages">Anthropic (Claude)</option></select></label>
        <label className="text-sm font-medium">Model ID<input required maxLength={200} className={inputClass} value={form.modelName} placeholder="deepseek-flash" disabled={Boolean(busy)} onChange={e => setForm(f => ({ ...f, modelName: e.target.value }))} /></label>
        <label className="text-sm font-medium">API base URL<input required type="url" className={inputClass} value={form.baseUrl} disabled={Boolean(busy)} onChange={e => setForm(f => ({ ...f, baseUrl: e.target.value }))} /><span className="mt-1 block text-xs text-muted">Use your provider’s base URL, without /chat/completions or /messages.</span></label>
        <label className="text-sm font-medium">API key<input required type="password" autoComplete="new-password" maxLength={8192} className={inputClass} value={form.apiKey} disabled={Boolean(busy)} onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))} /><span className="mt-1 block text-xs text-muted">Stored securely on the server. Never sent to the Agent.</span></label>
      </div>
      <div className="mt-6 flex gap-3"><button type="submit" className={button + " bg-primary text-white hover:bg-primary/90"} disabled={Boolean(busy)}>{busy === "save" ? "Saving…" : "Save configuration"}</button><button type="button" className={button} disabled={Boolean(busy)} onClick={() => { setAdding(false); setForm(f => ({ ...f, apiKey: "" })); }}>Cancel</button></div>
    </form> : null}
    <div className="space-y-3">{state?.profiles.map(profile => {
      const active = profile.id === state.current.sourceProfileId;
      return <article key={profile.id} className="rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><h4 className="font-semibold">{profile.name} {active ? <span className="ml-2 rounded bg-primary/10 px-2 py-1 text-xs text-primary">Current</span> : null}</h4>
          <p className="mt-2 break-all text-sm">{profile.modelName}</p><p className="mt-1 break-all text-xs text-muted">{profile.baseUrl} · {profile.apiProtocol === "anthropic-messages" ? "Anthropic" : "OpenAI compatible"}</p>
          <p className="mt-3 text-xs text-muted">{profile.hasSecret ? "Key saved" : "Key missing"} · {profile.compatible ? "Report compatibility passed" : "Not yet verified for reports"}</p></div>
          <div className="flex flex-wrap gap-2"><button className={button} disabled={Boolean(busy) || !profile.hasSecret} onClick={() => test(profile)}>{busy === "test:" + profile.id ? "Testing…" : "Test connection"}</button>
          {!active ? <button className={button + " text-primary"} disabled={Boolean(busy) || !profile.compatible} onClick={() => { setConfirm(profile); setAdding(false); setForm(f => ({ ...f, apiKey: "" })); }}>Use this model</button> : null}</div></div>
        {confirm?.id === profile.id ? <div className="mt-5 rounded-lg border border-primary/20 bg-primary/5 p-4" role="region" aria-label="Confirm model switch"><p className="font-semibold">Switch all projects to {profile.name}?</p><p className="mt-1 text-sm text-muted">This also changes future automated reports. Running tasks continue with their current model.</p><div className="mt-4 flex gap-2"><button className={button + " bg-primary text-white hover:bg-primary/90"} disabled={Boolean(busy)} onClick={activate}>{busy === "activate" ? "Switching…" : "Confirm switch"}</button><button className={button} disabled={Boolean(busy)} onClick={() => setConfirm(null)}>Keep current model</button></div></div> : null}
      </article>;
    })}</div>
    {state && !state.profiles.length ? <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted">No configurations saved by your admin account. Add one to test and switch.</p> : null}
    <p className="text-xs text-muted">To change a key or endpoint, save a new configuration and test it first. This keeps the active model untouched. Compatibility checks make two small model requests; they do not send project data.</p>
  </div>;
}

