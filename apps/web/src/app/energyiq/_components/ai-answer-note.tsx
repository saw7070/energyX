"use client";

import React, { useEffect, useState, type FormEvent, type ReactNode } from "react";

import { configApi } from "../../../lib/config-api";
import { defineMessages } from "./energyiq-messages";
import { useMessages } from "./energyiq-locale";
import { EnergyIcon } from "./icons";
import styles from "./ai-answer-note.module.css";

const messages = defineMessages({
  label: "AI-generated",
  caution: "Check before acting on it.",
  question: "Was this helpful?",
  helpful: "Helpful",
  notHelpful: "Not helpful",
  thanks: "Thanks for the feedback.",
  tellMore: "What was wrong? (optional)",
  send: "Send",
  failed: "Could not save your feedback.",
  policy: "How EnergyX uses AI",
}, {
  "zh-Hans": {
    label: "AI 生成",
    caution: "请核实后再采取行动。",
    question: "这有帮助吗？",
    helpful: "有帮助",
    notHelpful: "没有帮助",
    thanks: "感谢您的反馈。",
    tellMore: "哪里有问题？（可选）",
    send: "发送",
    failed: "无法保存您的反馈。",
    policy: "EnergyX 如何使用 AI",
  },
  ms: {
    label: "Dijana AI",
    caution: "Semak sebelum bertindak.",
    question: "Adakah ini membantu?",
    helpful: "Membantu",
    notHelpful: "Tidak membantu",
    thanks: "Terima kasih atas maklum balas anda.",
    tellMore: "Apa yang salah? (pilihan)",
    send: "Hantar",
    failed: "Tidak dapat menyimpan maklum balas anda.",
    policy: "Cara EnergyX menggunakan AI",
  },
});

/**
 * Marks something the AI wrote and lets the reader say whether it helped. Shown under advisor answers, AI reports and
 * AI summaries so nobody mistakes AI text for measured figures. A thumbs-down offers an optional note.
 */
export function AiAnswerNote({ targetKind, targetId, projectId, compact = false, meta }: {
  targetKind: string;
  /** Short context shown beside the label, such as the dates and time of an answer. */
  meta?: ReactNode;
  targetId: string;
  projectId?: string | undefined;
  compact?: boolean;
}) {
  const t = useMessages(messages);
  const [rating, setRating] = useState<"up" | "down" | null>(null);
  const [comment, setComment] = useState("");
  const [askComment, setAskComment] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "failed">("idle");

  useEffect(() => {
    let alive = true;
    setRating(null);
    setStatus("idle");
    // Inside the promise chain, so a page without the feedback API (or a partial test double) just shows no rating.
    Promise.resolve()
      .then(() => configApi.getAiFeedback(targetKind, targetId))
      .then((result) => { if (alive && result?.rating) setRating(result.rating); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [targetKind, targetId]);

  const send = async (next: "up" | "down", note?: string) => {
    setRating(next);
    try {
      await Promise.resolve().then(() => configApi.sendAiFeedback({ targetKind, targetId, rating: next, ...(projectId ? { projectId } : {}), ...(note ? { comment: note } : {}) }));
      setStatus("saved");
    } catch {
      setStatus("failed");
    }
  };
  const rate = (next: "up" | "down") => {
    setAskComment(next === "down");
    void send(next);
  };
  const submitComment = (event: FormEvent) => {
    event.preventDefault();
    setAskComment(false);
    void send("down", comment.trim());
  };

  return (
    <div className={`${styles.note} ${compact ? styles.compact : ""}`} data-ai-generated="true">
      <span className={styles.badge}><EnergyIcon name="spark" className="h-3.5 w-3.5" />{t("label")}</span>
      {meta ? <span className={styles.meta}>{meta}</span> : null}
      {!compact && <span className={styles.caution}>{t("caution")}</span>}
      <span className={styles.spacer} />
      <span className={styles.question}>{status === "saved" ? t("thanks") : status === "failed" ? t("failed") : t("question")}</span>
      <button type="button" className={styles.vote} aria-pressed={rating === "up"} aria-label={t("helpful")} title={t("helpful")} onClick={() => rate("up")}>
        <EnergyIcon name="thumb-up" className="h-4 w-4" />
      </button>
      <button type="button" className={styles.vote} aria-pressed={rating === "down"} aria-label={t("notHelpful")} title={t("notHelpful")} onClick={() => rate("down")}>
        <EnergyIcon name="thumb-down" className="h-4 w-4" />
      </button>
      {askComment && (
        <form className={styles.comment} onSubmit={submitComment}>
          <input value={comment} maxLength={1000} onChange={(event) => setComment(event.target.value)} placeholder={t("tellMore")} aria-label={t("tellMore")} />
          <button type="submit">{t("send")}</button>
        </form>
      )}
      {!compact && <a className={styles.policy} href="/legal/ai-use" target="_blank" rel="noreferrer">{t("policy")}</a>}
    </div>
  );
}
