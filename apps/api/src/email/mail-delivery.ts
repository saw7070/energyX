import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import nodemailer from "nodemailer";

import { loadPasswordAuthConfig } from "../auth/config.js";

/**
 * One way out for every email the server sends on its own (alerts, scheduled reports). It follows the same settings
 * as sign-in emails: with AUTH_EMAIL_DELIVERY=test nothing leaves the server and each message is written to the
 * outbox folder instead, so a test server never emails a customer. Without SMTP settings nothing is sent.
 */
export type MailAttachment = { filename: string; content: Buffer; contentType: string };
export type MailMessage = { to: string[]; subject: string; text: string; html?: string; attachments?: MailAttachment[] };
export type MailDelivery = {
  mode: "smtp" | "test" | "off";
  send(message: MailMessage): Promise<void>;
};

/** The outbox keeps the newest messages only, so a test server's disk does not fill up. */
const OUTBOX_LIMIT = 100;

export const createMailDelivery = (env: Record<string, string | undefined> = process.env): MailDelivery => {
  const config = loadPasswordAuthConfig(env);
  if (config.emailDelivery === "test") {
    const outbox = env.ENERGYIQ_MAIL_OUTBOX_DIR?.trim() || join(env.STORAGE_ROOT_DIR?.trim() || "storage", "outbox");
    return { mode: "test", send: async (message) => writeToOutbox(outbox, message) };
  }
  const smtp = config.smtp;
  if (!smtp?.host || !smtp.from) {
    return {
      mode: "off",
      send: async () => {
        throw new Error("ENERGYIQ_MAIL_NOT_CONFIGURED");
      },
    };
  }
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    pool: true,
    maxConnections: 2,
    ...(smtp.user ? { auth: { user: smtp.user, pass: smtp.password ?? "" } } : {}),
  });
  return {
    mode: "smtp",
    send: async (message) => {
      if (message.to.length === 0) return;
      // Recipients are blind-copied so a report sent to several people does not share their addresses.
      await transport.sendMail({
        from: smtp.from,
        to: smtp.from,
        bcc: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
        ...(message.attachments?.length
          ? { attachments: message.attachments.map((file) => ({ filename: file.filename, content: file.content, contentType: file.contentType })) }
          : {}),
      });
    },
  };
};

const writeToOutbox = (outbox: string, message: MailMessage): void => {
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const slug = message.subject.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 60) || "message";
  const folder = join(outbox, `${stamp}-${slug}`);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "message.json"), JSON.stringify({
    to: message.to,
    subject: message.subject,
    text: message.text,
    attachments: (message.attachments ?? []).map((file) => ({ filename: file.filename, contentType: file.contentType, bytes: file.content.length })),
  }, null, 2));
  if (message.html) writeFileSync(join(folder, "message.html"), message.html);
  for (const file of message.attachments ?? []) writeFileSync(join(folder, safeFileName(file.filename)), file.content);
  console.log(`[mail:test] "${message.subject}" to ${message.to.length} recipient(s) saved in ${folder}`);
  pruneOutbox(outbox);
};

const pruneOutbox = (outbox: string): void => {
  try {
    const entries = readdirSync(outbox).sort();
    for (const entry of entries.slice(0, Math.max(0, entries.length - OUTBOX_LIMIT))) rmSync(join(outbox, entry), { recursive: true, force: true });
  } catch {
    // Pruning is housekeeping; a failure here must not lose the message just written.
  }
};

const safeFileName = (name: string): string => name.replace(/[^\w.\- ]+/gu, "_").slice(0, 120) || "attachment";
