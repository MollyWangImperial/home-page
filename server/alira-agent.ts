import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { concernStarter, starterSets } from "../client/src/lib/alira-onboarding";
import { PATIENT_NAME } from "../client/src/lib/home-stage";
import {
  AGENT_LIMITS,
  ALIRA_AGENT,
  aliraAgentTools,
  buildAliraSystemPrompt,
  echoableContent,
  readAgentMessages,
  type AgentMessage,
} from "../shared/alira-agent";

// Alira's thinking happens here, on the server, so the API key never reaches the browser. The
// browser sends the conversation, this asks Claude for Alira's next step, and the browser runs any
// tools Claude chose (they act on the page) and sends the results back. Nothing is stored here.

export type AgentConfig = { apiKey: string };
export type AgentReply = Pick<Anthropic.Beta.Messages.BetaMessage, "content" | "stop_reason">;
export type SendToClaude = (
  params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming,
  config: AgentConfig,
  signal: AbortSignal
) => Promise<AgentReply>;

export function readAgentConfig(root: string): AgentConfig {
  let fromFiles: Record<string, string | undefined> = {};
  for (const file of [".env", ".env.local"]) {
    try {
      fromFiles = { ...fromFiles, ...parseEnv(readFileSync(path.join(root, file), "utf8")) };
    } catch {
      /* Environment variables can also be supplied by the host. */
    }
  }
  const env = { ...fromFiles, ...process.env };
  return { apiKey: env.ANTHROPIC_API_KEY?.trim() ?? "" };
}

const systemPrompt = buildAliraSystemPrompt({ patientName: PATIENT_NAME, faq: [...starterSets.flat(), concernStarter] });

/** The request for Alira's next step. Only the conversation comes from the browser. */
export function agentRequest(messages: AgentMessage[]): Anthropic.Beta.Messages.MessageCreateParamsNonStreaming {
  return {
    model: ALIRA_AGENT.model,
    max_tokens: ALIRA_AGENT.maxTokens,
    // The instructions and tools are the same for every request, so they are cached together.
    system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
    tools: aliraAgentTools.map(tool => ({ ...tool, input_schema: { ...tool.input_schema } })),
    tool_choice: { type: "auto" },
    output_config: { effort: ALIRA_AGENT.effort },
    betas: [ALIRA_AGENT.fallbackBeta],
    fallbacks: "default",
    messages: messages as Anthropic.Beta.Messages.BetaMessageParam[],
  };
}

let sharedClient: { apiKey: string; client: Anthropic } | null = null;
const sendToClaude: SendToClaude = (params, config, signal) => {
  if (sharedClient?.apiKey !== config.apiKey) {
    sharedClient = { apiKey: config.apiKey, client: new Anthropic({ apiKey: config.apiKey, maxRetries: 1, timeout: ALIRA_AGENT.timeoutMs }) };
  }
  return sharedClient.client.beta.messages.create(params, { signal });
};

class AgentError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
  }
}

/** Maps the SDK's typed errors to what the browser needs to know. */
function agentError(error: unknown): AgentError {
  if (error instanceof AgentError) return error;
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError)
    return new AgentError(502, "AGENT_ACCESS_DENIED", "Alira’s connection needs attention. Please try again later.");
  if (error instanceof Anthropic.RateLimitError)
    return new AgentError(429, "AGENT_BUSY", "Alira is busy. Please try again in a moment.");
  // The API could not use this conversation (for example after a change to the tools). The browser
  // can start a fresh conversation and ask again.
  if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.UnprocessableEntityError)
    return new AgentError(409, "AGENT_CONVERSATION_REJECTED", "Alira needs to start this chat afresh.");
  if (error instanceof Anthropic.APIConnectionTimeoutError)
    return new AgentError(504, "AGENT_TIMEOUT", "Alira took too long to answer. Please try again.");
  if (error instanceof Anthropic.APIError)
    return new AgentError(503, "AGENT_UNAVAILABLE", "Alira is unavailable just now. Please try again shortly.");
  return new AgentError(502, "AGENT_CONNECTION_FAILED", "Alira couldn’t connect. Please try again.");
}

export function createAliraAgentRouter({
  root,
  getConfig = () => readAgentConfig(root),
  send = sendToClaude,
}: {
  root: string;
  getConfig?: () => AgentConfig;
  send?: SendToClaude;
}) {
  // Initialise Express request helpers even when mounted in Vite's Connect server.
  const router = express();
  const attempts = new Map<string, { count: number; resetAt: number }>();
  let pending = 0;

  router.get("/status", (_req, res) => {
    res.set("Cache-Control", "no-store").json({ configured: Boolean(getConfig().apiKey), model: ALIRA_AGENT.model });
  });

  router.post("/", express.json({ limit: AGENT_LIMITS.bodyLimit }), async (req, res) => {
    res.set("Cache-Control", "no-store");
    const upstream = new AbortController();
    // Stop thinking if the patient leaves the page before Alira answers.
    res.on("close", () => {
      if (!res.writableEnded) upstream.abort();
    });
    try {
      const origin = req.get("origin");
      try {
        if (origin && new URL(origin).host !== req.get("host")) throw new Error();
      } catch {
        throw new AgentError(403, "ORIGIN_NOT_ALLOWED", "This request isn’t allowed.");
      }
      const config = getConfig();
      if (!config.apiKey) throw new AgentError(503, "AGENT_NOT_CONFIGURED", "Alira’s thinking isn’t connected yet.");
      const read = readAgentMessages(req.body?.messages);
      if (!read.ok) throw new AgentError(400, "INVALID_CONVERSATION", read.reason);

      const now = Date.now();
      attempts.forEach((entry, ip) => {
        if (entry.resetAt <= now) attempts.delete(ip);
      });
      const ip = req.ip ?? req.socket.remoteAddress ?? "local";
      const rate = attempts.get(ip) ?? { count: 0, resetAt: now + 60000 };
      if (rate.count >= 40 || pending >= 8 || attempts.size >= 1000)
        throw new AgentError(429, "AGENT_BUSY", "Alira is busy. Please try again in a moment.");
      rate.count += 1;
      attempts.set(ip, rate);

      pending += 1;
      let reply: AgentReply;
      try {
        reply = await send(agentRequest(read.messages), config, upstream.signal);
      } finally {
        pending -= 1;
      }
      res.json({ content: echoableContent(reply.content), stop_reason: reply.stop_reason });
    } catch (error) {
      if (upstream.signal.aborted) return;
      const failure = agentError(error);
      if (!(error instanceof AgentError)) console.warn(`Alira agent request failed: ${failure.code}`);
      res.status(failure.status).json({ code: failure.code, error: failure.message });
    }
  });
  const errors: express.ErrorRequestHandler = (_error, _req, res, _next) => {
    res.status(400).json({ code: "INVALID_REQUEST", error: "Please try that again." });
  };
  router.use(errors);
  return router;
}
