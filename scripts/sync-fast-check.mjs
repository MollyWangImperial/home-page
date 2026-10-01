// Port the original FAST runner into the top document for browser element selection.
// Detection, prompts and outcomes remain in the copied runner; its web host and introduction presentation are adapted.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(repo, "assessment-service/backend/fast_screening.py"), "utf8").replace(/\r\n/g, "\n");
const markup = source.split("<body>")[1].split('<script type="module">')[0]
  .trim().replace('onclick="postRN({type:\'exit\'})"', 'data-fast-action="exit"')
  .replace('<main class="workspace"', '<div class="workspace"').replace('</main>', '</div>')
  .replace('<strong>Emergency FAST check</strong>', '')
  .replace('  <div class="emergencyBar"><span>Prototype only - use a phone for real emergency calls.</span></div>\n', '');
let runner = source.split('<script type="module">')[1].split("</script>")[0].trim();
const replace = (before, after) => {
  if (!runner.includes(before)) throw new Error(`FAST source contract changed: ${before}`);
  runner = runner.replace(before, after);
};
// Keep the site's introduction focused on its heading, explanation and Begin action.
// Scope these removals to the intro so observation and result screens keep their own content.
const introLine = runner.split("\n").find(line => line.includes('current="intro";') && line.includes('panel.innerHTML='));
if (!introLine) throw new Error("FAST source contract changed: introduction markup");
replace(introLine, introLine
  .replace(/<div class="(?:letter|eyebrow|important)">[^<]*<\/div>/g, '')
  .replace(/<p class="privacyNote">[^<]*<\/p>/g, ''));
replace('import { PoseLandmarker, FaceLandmarker, FilesetResolver, DrawingUtils } from "/vendor/mediapipe/vision_bundle.mjs";',
  'let PoseLandmarker, FaceLandmarker, FilesetResolver, DrawingUtils;');
replace('  const message=JSON.stringify(data);\n  if(window.ReactNativeWebView&&window.ReactNativeWebView.postMessage) window.ReactNativeWebView.postMessage(message);\n  else if(window.parent&&window.parent!==window) window.parent.postMessage(message,"*");',
  '  host.onMessage(data);');
replace('    video.srcObject=stream;await video.play();', `    if(host.disposed)return false;
    video.srcObject=stream;await video.play();
    ({PoseLandmarker,FaceLandmarker,FilesetResolver,DrawingUtils}=await import(/* @vite-ignore */ host.resource("/vendor/mediapipe/vision_bundle.mjs")));
    if(host.disposed)return false;`);
for (const asset of ["/vendor/mediapipe/wasm", "/vendor/mediapipe/models/pose_landmarker_lite.task", "/vendor/mediapipe/models/face_landmarker.task"]) {
  replace(`"${asset}"`, `host.resource("${asset}")`);
}
replace('    const models=await Promise.allSettled([', '    if(host.disposed)return false;\n    const models=await Promise.allSettled([');
for (const model of ["PoseLandmarker", "FaceLandmarker"]) {
  const line = runner.split("\n").find(line => line.trim().startsWith(`${model}.createFromOptions`));
  replace(line, line.replace(/\)(,?)$/, ').then(model=>host.ownModel(model))$1'));
}
replace('    if(models[0].status===', '    if(host.disposed)return false;\n    if(models[0].status===');
replace('  }catch(error){\n    cameraLabel.textContent=', '  }catch(error){\n    if(host.disposed)return false;\n    cameraLabel.textContent=');
replace('    const data=await response.json().catch(()=>({}));', '    const data=await response.json().catch(()=>({}));\n    if(host.disposed)return;');
replace('  }catch(error){pauseForIncompleteSpeech("The transcription', '  }catch(error){if(host.disposed)return;pauseForIncompleteSpeech("The transcription');
replace('    const mimeType=speechMimeType(),chunks=[];', '    if(host.disposed)return;\n    const mimeType=speechMimeType(),chunks=[];');
replace('  }catch(error){pauseForIncompleteSpeech("Microphone', '  }catch(error){if(host.disposed)return;pauseForIncompleteSpeech("Microphone');
replace('document.getElementById("begin").onclick=async()=>{await ensureCamera();renderFace()};',
  'document.getElementById("begin").onclick=async(event)=>{event.currentTarget.disabled=true;await ensureCamera();if(!host.disposed)renderFace()};');
replace('onclick="startDemo911Call()"', 'data-fast-action="demo-call"');
runner = runner.replaceAll('onclick="location.reload()"', 'data-fast-action="restart"');
runner = runner.slice(0, runner.indexOf("window.startDemo911Call="));

const output = `// Adapted from assessment-service/backend/fast_screening.py (${source.match(/FAST_ALGORITHM_VERSION = "([^"]+)"/)[1]}).
// Regenerate with: node scripts/sync-fast-check.mjs. The backend/native runner stays unchanged.
import { createFastCheckHost } from "./fast-check-host";

export function mountFastCheck(root, base, onExit, onRestart) {
const host=createFastCheckHost(root,base,onExit,onRestart);
const {document,fetch,setTimeout,clearTimeout,requestAnimationFrame,cancelAnimationFrame}=host;
const navigator={mediaDevices:{getUserMedia:host.getUserMedia}};
root.innerHTML=${JSON.stringify(markup)};
${runner}
const click=event=>{
  const button=event.target instanceof Element?event.target.closest("[data-fast-action]"):null;
  if(!button||!root.contains(button))return;
  if(button.dataset.fastAction==="exit")postRN({type:"exit"});
  else if(button.dataset.fastAction==="demo-call")startDemo911Call();
  else if(button.dataset.fastAction==="restart")host.onRestart();
};
root.addEventListener("click",click);
renderIntro();
return ()=>{
  host.dispose();stopAliraSpeech();cancelSpeechCapture();
  video.pause();video.srcObject=null;
  root.removeEventListener("click",click);
  root.classList.remove("intro-mode");root.replaceChildren();
};
}
`;
fs.writeFileSync(path.join(repo, "client/src/lib/fast-check-runtime.js"), output);

const css = postcss.parse(source.split("<style>")[1].split("</style>")[0]);
// The isolated runner used browser heading defaults; restore those under the app's CSS reset.
css.append({ selector: "h1,h2", nodes: [{ prop: "font-weight", value: "700" }] });
css.walkRules(rule => {
  if (rule.parent.type === "atrule" && /keyframes$/.test(rule.parent.name)) return;
  if (rule.selector === "html,body") {
    rule.selector = ".fast-check-runtime";
    rule.walkDecls("height", decl => decl.remove());
    rule.append({ prop: "min-height", value: "100%" });
  } else {
    rule.selector = rule.selectors.map(selector => selector.startsWith("body.intro-mode")
      ? selector.replace("body.intro-mode", ".fast-check-runtime.intro-mode")
      : `.fast-check-runtime ${selector}`).join(",");
  }
});
// Avoid collisions with animation names on other pages.
css.walkAtRules("keyframes", rule => { rule.params = `fast${rule.params[0].toUpperCase()}${rule.params.slice(1)}`; });
css.walkDecls("animation", decl => { decl.value = decl.value.replace(/^(scanPulse|callPulse)/, name => `fast${name[0].toUpperCase()}${name.slice(1)}`); });
const scopedCss = css.toString();
fs.writeFileSync(path.join(repo, "client/src/pages/fast-check-runtime.css"), `/* Scoped styles from the original FAST runner. See scripts/sync-fast-check.mjs. */\n${scopedCss}\n`);
console.log("Synced FAST page markup, scoped styles and hosted runner.");
