// Regenerate packaged voice clips on Windows with: node scripts/generate-alira-audio.mjs
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const texts = new Set();
for (const relative of [
  "client/src/pages/Alira.tsx",
  "client/src/lib/alira-check-ins.ts",
]) {
  const source = ts.createSourceFile(
    relative,
    fs.readFileSync(path.join(root, relative), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const visit = node => {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(source) === "response" &&
      ts.isStringLiteral(node.initializer)
    )
      texts.add(node.initializer.text);
    if (ts.isObjectLiteralExpression(node)) {
      const properties = node.properties.filter(ts.isPropertyAssignment);
      const from = properties.find(
        prop => prop.name.getText(source) === "from"
      );
      const text = properties.find(
        prop => prop.name.getText(source) === "text"
      );
      if (
        from &&
        ts.isStringLiteral(from.initializer) &&
        from.initializer.text === "Alira" &&
        text &&
        ts.isStringLiteral(text.initializer)
      )
        texts.add(text.initializer.text);
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.getText(source) === "replyTo" ||
        (ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "play"))
    ) {
      const text = node.arguments[1];
      if (text && ts.isStringLiteral(text)) texts.add(text.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}
const manifest = Object.fromEntries(
  [...texts].map(text => [
    text,
    `/audio/alira/${crypto.createHash("sha256").update(text).digest("hex").slice(0, 12)}.wav`,
  ])
);
fs.mkdirSync(path.join(root, "client/public/audio/alira"), { recursive: true });
fs.writeFileSync(
  path.join(root, "client/src/lib/alira-voice-clips.json"),
  JSON.stringify(manifest, null, 2) + "\n"
);
execFileSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-File",
    path.join(root, "scripts/generate-alira-audio.ps1"),
    "-RepositoryRoot",
    root,
  ],
  { stdio: "inherit", windowsHide: true }
);
console.log(`Generated ${texts.size} Alira voice clips.`);
