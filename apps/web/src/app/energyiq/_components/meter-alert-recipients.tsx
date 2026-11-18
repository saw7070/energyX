"use client";
import { useEffect, useState, type FormEvent } from "react";
import { defineMessages } from "./energyiq-messages";
import { useMessages } from "./energyiq-locale";
import { EnergyIcon } from "./icons";
import { getMeterAlertSettings, updateMeterAlertSettings, type MeterAlertSettingsDto } from "./meter-alerts-model";

const EMAIL_PATTERN = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/u;

export const meterAlertRecipientsMessages = defineMessages({
  title: "Send meter alerts to",
  body: "When meters stop sending readings, EnergyX tells the people who look after the meters and gateways: platform administrators and anyone allowed to change this live connection. You can add up to {max} more addresses, such as your installer's.",
  none: "No extra addresses yet.",
  label: "Email address",
  add: "Add",
  remove: "Remove {email}",
  invalid: "That doesn't look like an email address.",
  full: "You can add up to {max} addresses. Remove one to add another.",
  saved: "Saved.",
  failed: "This could not be saved. Try again.",
  loadFailed: "The addresses could not be loaded.",
}, {
  "zh-Hans": {
    title: "电表提醒发送给",
    body: "当电表停止发送读数时，EnergyX 会通知负责电表和网关的人：平台管理员以及有权修改此实时连接的人。您还可以再添加最多 {max} 个邮箱，例如安装商的邮箱。",
    none: "还没有添加其他邮箱。",
    label: "邮箱地址",
    add: "添加",
    remove: "移除 {email}",
    invalid: "这看起来不像邮箱地址。",
    full: "最多可添加 {max} 个邮箱。请先移除一个再添加。",
    saved: "已保存。",
    failed: "无法保存，请重试。",
    loadFailed: "无法加载这些邮箱。",
  },
  ms: {
    title: "Hantar amaran meter kepada",
    body: "Apabila meter berhenti menghantar bacaan, EnergyX memaklumkan orang yang menjaga meter dan gateway: pentadbir platform dan sesiapa yang dibenarkan menukar sambungan langsung ini. Anda boleh menambah sehingga {max} alamat lagi, contohnya alamat pemasang anda.",
    none: "Belum ada alamat tambahan.",
    label: "Alamat e-mel",
    add: "Tambah",
    remove: "Buang {email}",
    invalid: "Itu tidak kelihatan seperti alamat e-mel.",
    full: "Anda boleh menambah sehingga {max} alamat. Buang satu untuk menambah yang lain.",
    saved: "Disimpan.",
    failed: "Tidak dapat disimpan. Cuba lagi.",
    loadFailed: "Alamat tidak dapat dimuatkan.",
  },
});

/**
 * Facility → Live connection: the extra addresses that hear when meters stop sending readings ("Send meter alerts to"),
 * besides platform administrators and the people allowed to change the live connection. Up to five, each checked.
 * Shown only to the people who may change them.
 */
export function MeterAlertRecipients({ projectId }: { projectId: string }) {
  const t = useMessages(meterAlertRecipientsMessages);
  // Kept with the site it was read for, so another site never shows this one's addresses while its own load.
  const [loaded, setLoaded] = useState<{ projectId: string; settings: MeterAlertSettingsDto | null } | null>(null);
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<"invalid" | "failed" | null>(null);
  const [notice, setNotice] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    getMeterAlertSettings(projectId)
      .then((value) => { if (alive) setLoaded({ projectId, settings: value }); })
      .catch(() => { if (alive) setLoaded({ projectId, settings: null }); });
    return () => { alive = false; };
  }, [projectId]);
  const current = loaded?.projectId === projectId ? loaded : null;
  const settings = current?.settings ?? null;
  const loadFailed = current !== null && settings === null;
  const setSettings = (value: MeterAlertSettingsDto) => setLoaded({ projectId, settings: value });
  if (loadFailed) return <section className="rounded-[18px] border border-border bg-surface p-5 sm:p-6"><p role="alert" className="text-sm text-amber-900">{t("loadFailed")}</p></section>;
  if (!settings?.canEditRecipients) return null;
  const max = settings.maxHardwareEmails;
  const emails = settings.hardwareEmails;
  const full = emails.length >= max;
  const save = async (next: string[]): Promise<boolean> => {
    setBusy(true);
    setProblem(null);
    setNotice(false);
    try {
      setSettings(await updateMeterAlertSettings(projectId, { hardwareEmails: next }));
      setNotice(true);
      return true;
    } catch {
      setProblem("failed");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const add = async (event: FormEvent) => {
    event.preventDefault();
    const value = draft.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(value)) { setProblem("invalid"); return; }
    if (emails.includes(value)) { setDraft(""); return; }
    if (await save([...emails, value])) setDraft("");
  };
  return <section aria-label={t("title")} className="rounded-[18px] border border-border bg-surface p-5 shadow-[0_1px_2px_rgba(10,40,27,0.05),0_8px_24px_-16px_rgba(10,40,27,0.18)] sm:p-6">
    <div className="flex items-start gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-primary/10 text-primary" aria-hidden="true"><EnergyIcon name="bell" className="h-[18px] w-[18px]" /></span>
      <div className="min-w-0">
        <h3 className="text-base font-extrabold tracking-tight">{t("title")}</h3>
        <p className="mt-1 text-sm leading-6 text-muted">{t("body", { max })}</p>
      </div>
    </div>
    {emails.length === 0
      ? <p className="mt-3 text-sm text-muted">{t("none")}</p>
      : <ul className="mt-3 flex flex-wrap gap-2">{emails.map((email) => <li key={email} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-subtle px-3 py-1 text-sm">
        <span>{email}</span>
        <button type="button" className="rounded-full p-0.5 text-muted hover:text-foreground disabled:opacity-50" aria-label={t("remove", { email })} disabled={busy} onClick={() => void save(emails.filter((item) => item !== email))}><EnergyIcon name="close" className="h-3 w-3" /></button>
      </li>)}</ul>}
    <form className="mt-3 flex flex-wrap items-end gap-2" noValidate onSubmit={(event) => void add(event)}>
      <label className="grid min-w-[220px] flex-1 gap-1 text-xs font-semibold text-muted">{t("label")}
        <input type="email" value={draft} disabled={busy || full} placeholder="name@company.com" aria-invalid={problem === "invalid"} onChange={(event) => { setDraft(event.target.value); setProblem(null); setNotice(false); }}
          className="h-9 rounded-lg border border-border bg-surface px-3 text-sm font-normal text-foreground" />
      </label>
      <button type="submit" className="h-9 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50" disabled={busy || full || draft.trim() === ""}>{t("add")}</button>
    </form>
    {full && <p className="mt-2 text-xs text-muted">{t("full", { max })}</p>}
    {problem && <p role="alert" className="mt-2 text-xs text-red-700">{t(problem)}</p>}
    {notice && !problem && <p role="status" className="mt-2 text-xs text-emerald-800">{t("saved")}</p>}
  </section>;
}
