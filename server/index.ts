import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { createAliraAgentRouter } from "./alira-agent";
import { createAliraSpeaker, createAliraVoiceRouter } from "./alira-voice";
import { createExerciseDebugRouter } from "./exercise-debug";
import { createAliraSpeakRouter, createExerciseVoiceRouter, createFastCheckVoiceRouter } from "./exercise-voice";
import { createMollyProgressRouter } from "./molly-progress";
import { createAliraChannelRouter } from "./alira-channel";
import { createAliraLearningRouter } from "./alira-learning";
import { createAdminAlertsRouter } from "./admin-alerts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);
  app.use("/api/exercise-debug", createExerciseDebugRouter({ root: path.resolve(__dirname, "..") }));
  // The exercises and the FAST check speak in Alira's one voice, like the Alira page.
  const speakAlira = createAliraSpeaker({ root: path.resolve(__dirname, "..") });
  app.use("/api/exercise-voice", createExerciseVoiceRouter(undefined, speakAlira));
  app.use("/api/tts/generate", createFastCheckVoiceRouter(speakAlira));
  app.use("/api/alira/speak", createAliraSpeakRouter(speakAlira));
  app.use("/api/alira/channel", createAliraChannelRouter({ root: path.resolve(__dirname, "..") }));
  app.use("/api/alira/learning", createAliraLearningRouter({ root: path.resolve(__dirname, "..") }));
  app.use("/api/molly-progress", createMollyProgressRouter({ root: path.resolve(__dirname, "..") }));
  app.use("/api/admin-alerts", createAdminAlertsRouter({ root: path.resolve(__dirname, "..") }));
  app.use(
    "/api/alira/voice",
    createAliraVoiceRouter({ root: path.resolve(__dirname, "..") })
  );
  app.use(
    "/api/alira/agent",
    createAliraAgentRouter({ root: path.resolve(__dirname, "..") })
  );

  // Serve static files from dist/public in production
  const staticPath =
    process.env.NODE_ENV === "production" || path.basename(__dirname) === "dist"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));

  // Handle client-side routing - serve index.html for all routes
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = process.env.PORT || 3000;

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
