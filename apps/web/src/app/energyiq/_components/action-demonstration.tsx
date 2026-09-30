"use client";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { configApi } from "../../../lib/config-api";
import styles from "./project-actions.module.css";
import { useMessages } from "./energyiq-locale";
import { around, demonstrationMessages } from "./project-actions-messages";
type DemoMessage = keyof (typeof demonstrationMessages)["en"];
type Demo = {
  id: string;
  status: string;
  html?: string | null;
  experience?: string | null;
  errorCode?: string;
};
export function ActionDemonstration({
  projectId,
  actionId,
}: {
  projectId: string;
  actionId: string;
}) {
  const t = useMessages(demonstrationMessages);
  // The prefilled texts below are editable inputs sent to the API as written, so they stay as they are.
  const [power, setPower] = useState("0.1"),
    [hours, setHours] = useState("2"),
    [assumptions, setAssumptions] = useState(
      "Hypothetical removable load for two hours per day; equipment suitability must be checked on site.",
    );
  const [scenario, setScenario] = useState<{
      id: string;
      energyKwh: number;
    } | null>(null),
    [date, setDate] = useState(""),
    [readings, setReadings] = useState(["", "", ""]),
    [notes, setNotes] = useState(
      "Demonstration only: imagine the agreed operating schedule was changed. No real site action occurred.",
    );
  const [demo, setDemo] = useState<Demo | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<DemoMessage | "">("");
  const api = <T,>(path: string, body?: unknown) =>
    configApi.reportActionRequest<T>(
      projectId,
      `${actionId}/${path}`,
      body ? { method: "POST", body: JSON.stringify(body) } : undefined,
    );
  useEffect(() => {
    let active = true;
    configApi
      .reportActionRequest<{ items: Demo[] }>(
        projectId,
        `${actionId}/demonstrations`,
      )
      .then((r) => {
        if (active && r.items[0]) setDemo(r.items[0]);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [projectId, actionId]);
  useEffect(() => {
    if (!demo?.id) return;
    const c = new AbortController();
    const load = () =>
      configApi
        .reportActionRequest<Demo>(
          projectId,
          `${actionId}/demonstrations/${demo.id}`,
          { signal: c.signal },
        )
        .then((d) => {
          if (!c.signal.aborted) setDemo(d);
        })
        .catch(() => {
          if (!c.signal.aborted) setError("refreshFailed");
        });
    void load();
    const timer = setInterval(() => {
      if (!["succeeded", "failed", "cancelled"].includes(demo.status))
        void load();
    }, 10000);
    return () => {
      c.abort();
      clearInterval(timer);
    };
  }, [projectId, actionId, demo?.id, demo?.status]);
  async function estimate() {
    setBusy(true);
    setError("");
    try {
      setScenario(
        await api("scenarios", {
          reduciblePowerKw: Number(power),
          hoursPerDay: Number(hours),
          days: 3,
          assumptions,
        }),
      );
    } catch {
      setError("estimateFailed");
    } finally {
      setBusy(false);
    }
  }
  async function example() {
    setBusy(true);
    setError("");
    try {
      const r = await api<{
        executionDate: string;
        observations: { date: string; kwh: number }[];
      }>("demonstrations/example");
      setDate(r.executionDate);
      setReadings(r.observations.map((d) => String(d.kwh)));
    } catch {
      setError("baselineTooShort");
    } finally {
      setBusy(false);
    }
  }
  async function generate() {
    if (!scenario) return;
    setBusy(true);
    setError("");
    try {
      const observations = readings.map((kwh, i) => {
        const d = new Date(`${date}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + i + 1);
        return { date: d.toISOString().slice(0, 10), kwh: Number(kwh) };
      });
      const r = await api<{ id: string }>("demonstrations", {
        requestId: crypto.randomUUID(),
        scenarioId: scenario.id,
        executionAt: `${date}T19:00:00+08:00`,
        executionNotes: notes,
        observations,
      });
      setDemo({ id: r.id, status: "queued" });
    } catch {
      setError("startFailed");
    } finally {
      setBusy(false);
    }
  }
  const [reductionBefore, reductionAfter] = around(t("expectedReduction"), "value");
  return (
    <section className={styles.demo} aria-label={t("label")}>
      <header>
        <span className={styles.demoBadge}>{t("badge")}</span>
        <h2>{t("title")}</h2>
        <p>{t("intro")}</p>
      </header>
      <div className={styles.demoSteps}>
        <section>
          <h3>{t("step1")}</h3>
          <div className={styles.formGrid}>
            <label>
              {t("reduciblePower")}
              <input
                type="number"
                min="0"
                step="0.01"
                value={power}
                onChange={(e) => {
                  setPower(e.target.value);
                  setScenario(null);
                }}
              />
            </label>
            <label>
              {t("hoursRemoved")}
              <input
                type="number"
                min="0.1"
                max="24"
                step="0.5"
                value={hours}
                onChange={(e) => {
                  setHours(e.target.value);
                  setScenario(null);
                }}
              />
            </label>
          </div>
          <label>
            {t("assumptions")}
            <textarea
              value={assumptions}
              onChange={(e) => {
                setAssumptions(e.target.value);
                setScenario(null);
              }}
            />
          </label>
          <button
            disabled={busy || !power || !hours || assumptions.length < 10}
            onClick={estimate}
          >
            {t("calculate")}
          </button>
          {scenario && (
            <p className={styles.result}>
              {reductionBefore}<strong>{scenario.energyKwh.toFixed(2)} kWh</strong>{reductionAfter}
            </p>
          )}
          <p>{t("suitability")}</p>
        </section>
        <section>
          <h3>{t("step2")}</h3>
          <button disabled={busy} onClick={example}>
            {t("fillExample")}
          </button>
          <p>{t("exampleNote")}</p>
          <label>
            {t("mockDate")}
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label>
            {t("whatHappened")}
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <div className={styles.formGrid}>
            {readings.map((v, i) => (
              <label key={i}>
                {t("dayAfter", { day: i + 1 })}
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={v}
                  onChange={(e) =>
                    setReadings((old) =>
                      old.map((x, j) => (i === j ? e.target.value : x)),
                    )
                  }
                />
              </label>
            ))}
          </div>
          <button
            disabled={
              busy ||
              !scenario ||
              !date ||
              readings.some(
                (v) =>
                  !v.trim() || !Number.isFinite(Number(v)) || Number(v) < 0,
              ) ||
              notes.length < 10 ||
              (!!demo && ["queued", "running"].includes(demo.status))
            }
            onClick={generate}
          >
            {t("generate")}
          </button>
        </section>
      </div>
      {error && <p role="alert">{t(error)}</p>}
      {demo && (
        <section>
          <h3>{t("step3")}</h3>
          {["queued", "running"].includes(demo.status) ? (
            <p role="status">
              {demo.status === "queued" ? t("queued") : t("preparing")}
            </p>
          ) : demo.status !== "succeeded" ? (
            <p role="alert">{t("notCompleted")}</p>
          ) : (
            <>
              <p className={styles.demoBadge}>{t("fictional")}</p>
              <iframe
                title={t("frameTitle")}
                sandbox="allow-scripts"
                srcDoc={demo.html ?? ""}
                className={styles.demoPreview}
              />
              <details open>
                <summary>{t("experienceSaved")}</summary>
                <div className={styles.experience}>
                  <ReactMarkdown>{demo.experience ?? ""}</ReactMarkdown>
                </div>
                <p>{t("keptSeparate")}</p>
              </details>
            </>
          )}
        </section>
      )}
    </section>
  );
}
