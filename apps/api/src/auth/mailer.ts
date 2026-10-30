import nodemailer from "nodemailer";
import type { PasswordAuthConfig } from "./config.js";
import { environmentSubject, stagingEmailAllowed } from "../deployment-environment.js";

export type AuthMailResult = {
  testToken?: string;
  testUrl?: string;
};

export class AuthMailer {
  constructor(private readonly config: PasswordAuthConfig) {}

  assertDeliveryConfigured(): void {
    if (this.config.emailDelivery === "test") return;
    if (!this.config.smtp?.host || !this.config.smtp.from) {
      throw new Error("AUTH_CONFIG_MISSING:SMTP is required.");
    }
  }

  async sendVerification(input: { email: string; token: string }): Promise<AuthMailResult> {
    const url = `${this.config.publicBaseUrl.replace(/\/$/u, "")}/login?verify=${encodeURIComponent(input.token)}`;
    return this.send({
      email: input.email,
      subject: "Verify your EnergyX account",
      text: `Verify your EnergyX account: ${url}`,
      token: input.token,
      url
    });
  }

  async sendInvitation(input: { email: string; token: string }): Promise<AuthMailResult> {
    const url = `${this.config.publicBaseUrl.replace(/\/$/u, "")}/login?invite=${encodeURIComponent(input.token)}`;
    return this.send({
      email: input.email,
      subject: "Set up your EnergyX account",
      text: `Set up your EnergyX account: ${url}`,
      token: input.token,
      url
    });
  }

  async sendPasswordReset(input: { email: string; token: string }): Promise<AuthMailResult> {
    const url = `${this.config.publicBaseUrl.replace(/\/$/u, "")}/login?reset=${encodeURIComponent(input.token)}`;
    return this.send({
      email: input.email,
      subject: "Reset your EnergyX password",
      text: `Reset your EnergyX password: ${url}`,
      token: input.token,
      url
    });
  }

  private async send(input: {
    email: string;
    subject: string;
    text: string;
    token: string;
    url: string;
  }): Promise<AuthMailResult> {
    this.assertDeliveryConfigured();
    // Staging never emails people outside its allowlist; the link is handed back exactly as in test mode.
    if (this.config.emailDelivery === "test" || !stagingEmailAllowed(input.email)) {
      return { testToken: input.token, testUrl: input.url };
    }
    const smtp = this.config.smtp!;
    const transport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user
        ? { user: smtp.user, pass: smtp.password ?? "" }
        : undefined
    });
    await transport.sendMail({
      from: smtp.from,
      to: input.email,
      subject: environmentSubject(input.subject),
      text: input.text
    });
    return {};
  }
}
