import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { alertEmail, createAdminAlertsRouter, maskEmail, readAlertConfig, type AlertConfig, type SendMail } from "../../../server/admin-alerts";

const config: AlertConfig = { to: "admin@example.com", host: "smtp.example.com", port: 587, secure: false, user: "sender@example.com", pass: "test-secret-do-not-expose", from: "sender@example.com" };
const alert = { id: "warning:2026-10-01:ex_handopen:rest", kind: "warning", day: "2026-10-01", patient: "Zak", title: "Zak: warning sign during Active Hand Opening", lines: ["Active Hand Opening: resting through 2026-10-02."] };
const servers: Server[] = [];
const roots: string[] = [];

async function fixture(send: SendMail = vi.fn(async () => {}), settings: AlertConfig = config) {
  const app = createAdminAlertsRouter({ root: tmpdir(), getConfig: () => settings, send, now: () => new Date("2026-10-01T19:00:00Z") });
  const server = await new Promise<Server>(resolve => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  servers.push(server);
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (body: unknown = alert, origin?: string) =>
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
  return { url, post, send };
}

afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>(resolve => server.close(() => resolve()));
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("admin alert emails", () => {
  it("says whether email is set up, without revealing the address or the password", async () => {
    const ready = await fixture();
    const status = await (await fetch(`${ready.url}/status`)).json();
    expect(status).toEqual({ configured: true, recipient: "a***n@example.com" });
    expect(JSON.stringify(status)).not.toContain(config.pass);
    const notReady = await fixture(undefined, { ...config, pass: "" });
    expect(await (await fetch(`${notReady.url}/status`)).json()).toEqual({ configured: false, recipient: "a***n@example.com" });
    const response = await notReady.post();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "ALERTS_NOT_CONFIGURED" });
  });

  it("emails the admin once per alert", async () => {
    const send = vi.fn<SendMail>(async () => {});
    const { post } = await fixture(send);
    expect((await post()).status).toBe(200);
    expect(await (await post()).json()).toEqual({ ok: true, duplicate: true });
    expect(send).toHaveBeenCalledTimes(1);
    const [message, used] = send.mock.calls[0];
    expect(used).toEqual(config);
    expect(message).toMatchObject({ to: "admin@example.com", from: "sender@example.com", subject: "Rehyn warning sign: Zak: warning sign during Active Hand Opening" });
    expect(message.text).toContain("- Active Hand Opening: resting through 2026-10-02.");
    expect(message.text).toContain("No clinician is assigned");
  });

  it("refuses other sites and malformed alerts, and reports a failed send so the browser retries", async () => {
    const { post, send } = await fixture();
    expect((await post(undefined, "https://evil.example")).status).toBe(403);
    expect((await post({ ...alert, kind: "spam" })).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
    const failing = await fixture(vi.fn(async () => { throw new Error("smtp down"); }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = await failing.post();
    warn.mockRestore();
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: "EMAIL_FAILED" });
  });

  it("limits how many alerts one browser can send in an hour", async () => {
    const { post } = await fixture();
    const statuses: number[] = [];
    for (let i = 0; i < 21; i += 1) statuses.push((await post({ ...alert, id: `a${i}` })).status);
    expect(statuses.slice(0, 20).every(status => status === 200)).toBe(true);
    expect(statuses[20]).toBe(429);
  });

  it("writes a plain email for the evening summary", () => {
    const email = alertEmail({ ...alert, kind: "plan_changes", title: "Zak: plan changes after 2026-10-01" }, config, new Date("2026-10-01T20:00:00Z"));
    expect(email.subject).toBe("Rehyn plan update: Zak: plan changes after 2026-10-01");
    expect(email.text).toContain("Alira's evening review changed Zak's exercise plan after 2026-10-01.");
    const test = alertEmail({ ...alert, test: true } as never, config);
    expect(test.subject).toBe("[Test] Rehyn warning sign: Zak: warning sign during Active Hand Opening");
    expect(test.text).toContain("TEST: this came from a simulated day");
  });

  it("reads the settings from .env.local, letting the host's environment win", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "admin-alerts-test-"));
    roots.push(root);
    await writeFile(path.join(root, ".env.local"), "ADMIN_ALERT_EMAIL=admin@example.com\nSMTP_HOST=smtp.example.com\nSMTP_USER=sender@example.com\nSMTP_PASS=from-file\nSMTP_SECURE=true\n");
    const saved = { pass: process.env.SMTP_PASS, port: process.env.SMTP_PORT };
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_PORT;
    expect(readAlertConfig(root)).toEqual({ to: "admin@example.com", host: "smtp.example.com", port: 465, secure: true, user: "sender@example.com", pass: "from-file", from: "sender@example.com" });
    process.env.SMTP_PASS = "from-host";
    expect(readAlertConfig(root).pass).toBe("from-host");
    if (saved.pass === undefined) delete process.env.SMTP_PASS;
    else process.env.SMTP_PASS = saved.pass;
    if (saved.port !== undefined) process.env.SMTP_PORT = saved.port;
    expect(maskEmail("jo@x.com")).toBe("j*o@x.com");
    expect(maskEmail("not-an-email")).toBe("");
  });
});
