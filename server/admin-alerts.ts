import express from "express";
import nodemailer from "nodemailer";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { readAdminAlert, type AdminAlert } from "../shared/plan-review";

// Emails the admin when Alira's plan review sees a warning sign or changes the plan. There is no
// clinician in the loop, so the admin gets what a physio would. The browser decides what happened
// (all results live there) and sends a short structured alert; this formats and emails it.
// Nothing is stored here.

export type AlertConfig = { to: string; host: string; port: number; secure: boolean; user: string; pass: string; from: string };
export type MailMessage = { to: string; from: string; subject: string; text: string };
export type SendMail = (message: MailMessage, config: AlertConfig) => Promise<void>;

export function readAlertConfig(root: string): AlertConfig {
  let fromFiles: Record<string, string | undefined> = {};
  for (const file of [".env", ".env.local"]) {
    try {
      fromFiles = { ...fromFiles, ...parseEnv(readFileSync(path.join(root, file), "utf8")) };
    } catch {
      /* Environment variables can also be supplied by the host. */
    }
  }
  const env = { ...fromFiles, ...process.env };
  const secure = (env.SMTP_SECURE ?? "").trim().toLowerCase() === "true";
  const port = Number(env.SMTP_PORT) || (secure ? 465 : 587);
  const user = env.SMTP_USER?.trim() ?? "";
  return {
    to: env.ADMIN_ALERT_EMAIL?.trim() ?? "",
    host: env.SMTP_HOST?.trim() ?? "",
    port,
    secure,
    user,
    pass: env.SMTP_PASS ?? "",
    from: env.SMTP_FROM?.trim() || user,
  };
}

export const alertsConfigured = (config: AlertConfig) => Boolean(config.to && config.host && config.from && config.user && config.pass);

/** "j*****c@gmail.com": enough to recognise the address without publishing it. */
export function maskEmail(address: string): string {
  const [name, domain] = address.split("@");
  if (!name || !domain) return "";
  return `${name.charAt(0)}${"*".repeat(Math.max(1, name.length - 2))}${name.length > 1 ? name.charAt(name.length - 1) : ""}@${domain}`;
}

let transport: { key: string; send: ReturnType<typeof nodemailer.createTransport> } | null = null;
const sendWithSmtp: SendMail = async (message, config) => {
  const key = JSON.stringify([config.host, config.port, config.secure, config.user, config.pass]);
  if (transport?.key !== key) {
    transport = {
      key,
      send: nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: { user: config.user, pass: config.pass },
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 20000,
      }),
    };
  }
  await transport.send.sendMail(message);
};

export function alertEmail(alert: AdminAlert, config: Pick<AlertConfig, "to" | "from">, sentAt = new Date()): MailMessage {
  const subject = `${alert.test ? "[Test] " : ""}${alert.kind === "warning" ? `Rehyn warning sign: ${alert.title}` : `Rehyn plan update: ${alert.title}`}`;
  const intro = alert.kind === "warning"
    ? `${alert.patient} reported a warning sign on ${alert.day}. Alira has already paused the exercise as below.`
    : `Alira's evening review changed ${alert.patient}'s exercise plan after ${alert.day}.`;
  const text = [
    "Hello,",
    "",
    ...(alert.test ? ["TEST: this came from a simulated day (the Journey's local \"Next day\" testing control), not from a real session.", ""] : []),
    intro,
    "",
    ...alert.lines.map(line => `- ${line}`),
    "",
    "Alira changes the plan with fixed rules (docs/plan-review.md). No clinician is assigned, so these alerts come to you as the admin.",
    `Sent by the Rehyn companion at ${sentAt.toISOString()}. Alert ${alert.id}.`,
  ].join("\n");
  return { to: config.to, from: config.from, subject, text };
}

class AlertError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
  }
}

export function createAdminAlertsRouter({
  root,
  getConfig = () => readAlertConfig(root),
  send = sendWithSmtp,
  now = () => new Date(),
}: {
  root: string;
  getConfig?: () => AlertConfig;
  send?: SendMail;
  now?: () => Date;
}) {
  // Initialise Express request helpers even when mounted in Vite's Connect server.
  const router = express();
  const attempts = new Map<string, { count: number; resetAt: number }>();
  // Alerts already emailed, so a retry from the browser never sends the same one twice.
  const sent = new Map<string, number>();

  router.get("/status", (_req, res) => {
    const config = getConfig();
    res.set("Cache-Control", "no-store").json({ configured: alertsConfigured(config), recipient: config.to ? maskEmail(config.to) : null });
  });

  router.post("/", express.json({ limit: "16kb" }), async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const origin = req.get("origin");
      try {
        if (origin && new URL(origin).host !== req.get("host")) throw new Error();
      } catch {
        throw new AlertError(403, "ORIGIN_NOT_ALLOWED", "This request isn't allowed.");
      }
      const alert = readAdminAlert(req.body);
      if (!alert) throw new AlertError(400, "INVALID_ALERT", "That alert is incomplete.");
      const config = getConfig();
      if (!alertsConfigured(config)) throw new AlertError(503, "ALERTS_NOT_CONFIGURED", "Admin emails aren't set up yet.");
      const time = now().getTime();
      sent.forEach((at, id) => {
        if (time - at > 7 * 86400000) sent.delete(id);
      });
      if (sent.has(alert.id)) {
        res.json({ ok: true, duplicate: true });
        return;
      }
      attempts.forEach((entry, ip) => {
        if (entry.resetAt <= time) attempts.delete(ip);
      });
      const ip = req.ip ?? req.socket.remoteAddress ?? "local";
      const rate = attempts.get(ip) ?? { count: 0, resetAt: time + 3600000 };
      if (rate.count >= 20 || attempts.size >= 1000) throw new AlertError(429, "ALERTS_BUSY", "Too many alerts. Please try again later.");
      rate.count += 1;
      attempts.set(ip, rate);
      try {
        await send(alertEmail(alert, config, now()), config);
      } catch {
        throw new AlertError(502, "EMAIL_FAILED", "The email couldn't be sent. It will be tried again.");
      }
      sent.set(alert.id, time);
      if (sent.size > 2000) sent.delete(sent.keys().next().value!);
      res.json({ ok: true });
    } catch (error) {
      const failure = error instanceof AlertError ? error : new AlertError(500, "ALERT_FAILED", "The alert couldn't be handled.");
      if (failure.code === "EMAIL_FAILED") console.warn("Admin alert email failed to send.");
      res.status(failure.status).json({ code: failure.code, error: failure.message });
    }
  });
  const errors: express.ErrorRequestHandler = (_error, _req, res, _next) => {
    res.status(400).json({ code: "INVALID_REQUEST", error: "Please try that again." });
  };
  router.use(errors);
  return router;
}
