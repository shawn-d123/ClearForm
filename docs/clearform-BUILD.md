# ClearForm: build brief and starter code

Hand this to Claude Code as the spec for the repo. It has the file tree, the real starter code for every file, the environment setup, the build order, and the acceptance checks. Pair it with `clearform-system-spec.md`, which holds the idea, the positioning and the demo. This file is the how-to-build.

Tell Claude Code: "Build the repo exactly as laid out in this file, then run the acceptance checks at the end." Consider saving this file as `CLAUDE.md` at the repo root so the agent keeps it in context.

Stack: plain HTML, CSS and JavaScript on the front, two Vercel serverless functions on the back, deployed to Vercel. No framework. API keys live only in Vercel environment variables.

---

## File tree

```
clearform/
  index.html            static page: broken form + accessible relay + triggers
  styles.css            high contrast, large type
  form-schema.js        the one shared field definition
  app.js                the voice loop, speech, triggers, fallbacks (ES module)
  api/
    transcribe.js       serverless: audio -> Whisper -> text
    extract.js          serverless: transcript + fields -> model -> field values
  package.json
  vercel.json           optional, function settings
  .env.example
  .gitignore
  README.md
```

Vercel serves the root static files and runs anything in `/api` as a serverless function. The browser calls `/api/transcribe` and `/api/extract`, and only those functions see the keys.

---

## Environment

Two secrets, set in the Vercel project (Settings, Environment Variables), never in code:

- `OPENAI_API_KEY` for Whisper and extraction (single-vendor, simplest).
- `ANTHROPIC_API_KEY` only if you choose Claude for extraction instead.

Local dev: `vercel dev` with a local `.env` (git-ignored). Deploy: push to the connected repo, Vercel builds automatically.

---

## Starter code

### package.json

```json
{
  "name": "clearform",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "openai": "^4.67.0"
  }
}
```

### .gitignore

```
node_modules
.env
.env.local
.vercel
```

### .env.example

```
OPENAI_API_KEY=sk-...
# ANTHROPIC_API_KEY=sk-ant-...   # only if using Claude for extraction
```

### vercel.json (optional)

```json
{
  "functions": {
    "api/*.js": { "maxDuration": 20 }
  }
}
```

### api/transcribe.js

```js
import OpenAI, { toFile } from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const { audioBase64, mimeType = "audio/webm" } = req.body || {};
    if (!audioBase64) return res.status(400).json({ error: "No audio provided" });

    const buffer = Buffer.from(audioBase64, "base64");
    const file = await toFile(buffer, "answer.webm", { type: mimeType });

    const result = await client.audio.transcriptions.create({
      file,
      model: "whisper-1",
      language: "en",
    });

    res.status(200).json({ text: result.text });
  } catch (err) {
    console.error("transcribe error", err);
    res.status(500).json({ error: "Transcription failed" });
  }
}
```

### api/extract.js

```js
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const { fields, transcript, today } = req.body || {};
    if (!fields || !transcript) {
      return res.status(400).json({ error: "Missing fields or transcript" });
    }

    const system = `You map a user's spoken words onto fields of an appointment booking form.
Return JSON only, shaped { "values": { "<fieldId>": "<value>" } }.
Rules:
- Only include fields you can fill with confidence. Omit anything unclear or not mentioned.
- Dates must be formatted YYYY-MM-DD. Resolve relative dates such as "next Tuesday" against today's date.
- For choice fields, map the answer to exactly one of the allowed options, matching loosely on sound and meaning.
- Never invent information the user did not say.`;

    const userContent = JSON.stringify({ today, fields, transcript });

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
    });

    const parsed = JSON.parse(completion.choices[0].message.content);
    res.status(200).json({ values: parsed.values || {} });
  } catch (err) {
    console.error("extract error", err);
    res.status(500).json({ error: "Extraction failed" });
  }
}
```

### form-schema.js

```js
// The single source of truth. Drives the broken form, the accessible relay,
// the spoken questions, and the AI extraction.
export const fields = [
  { id: "fullName", label: "Full name",            type: "text",   required: true },
  { id: "dob",      label: "Date of birth",        type: "date",   required: true },
  { id: "nhsNo",    label: "NHS number",           type: "text",   required: false },
  { id: "apptType", label: "Appointment type",     type: "choice", required: true,
      options: ["GP", "Nurse", "Blood test"] },
  { id: "date",     label: "Preferred date",       type: "date",   required: true },
  { id: "time",     label: "Preferred time",       type: "choice", required: true,
      options: ["Morning", "Afternoon"] },
  { id: "reason",   label: "Reason for appointment", type: "text", required: false },
];

export const answers = {};
export function questionFor(field) {
  if (field.type === "choice") {
    return `${field.label}. Options are ${field.options.join(", ")}. What would you like?`;
  }
  return `What is your ${field.label.toLowerCase()}?`;
}
```

### app.js (the voice loop, speech, triggers, fallback)

```js
import { fields, answers, questionFor } from "./form-schema.js";

// ---------- speech out ----------
let lastSpoken = "";
export function speak(text, { onend } = {}) {
  lastSpoken = text;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.95;
  if (onend) u.onend = onend;
  speechSynthesis.speak(u);
}
export function repeatLast() { if (lastSpoken) speak(lastSpoken); }

// ---------- audio capture + transcription ----------
let mediaRecorder, chunks = [];
async function recordAnswer() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  return new Promise((resolve) => {
    chunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: "audio/webm" });
      const base64 = await blobToBase64(blob);
      resolve(base64);
    };
    mediaRecorder.start();
  });
}
function stopRecording() { if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop(); }
function blobToBase64(blob) {
  return new Promise((res) => {
    const r = new FileReader();
    r.onloadend = () => res(r.result.split(",")[1]);
    r.readAsDataURL(blob);
  });
}

async function transcribe(audioBase64) {
  const r = await fetch("/api/transcribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audioBase64 }),
  });
  if (!r.ok) throw new Error("transcribe failed");
  return (await r.json()).text;
}

async function extract(transcript) {
  const today = new Date().toISOString().slice(0, 10);
  const r = await fetch("/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields, transcript, today }),
  });
  if (!r.ok) throw new Error("extract failed");
  return (await r.json()).values;
}

// ---------- fallback: on-device recognition ----------
function listenFallback() {
  return new Promise((resolve, reject) => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return reject(new Error("no speech recognition"));
    const rec = new SR();
    rec.lang = "en-GB";
    rec.onresult = (e) => resolve(e.results[0][0].transcript);
    rec.onerror = (e) => reject(e.error);
    rec.start();
  });
}

// ---------- fill + read back ----------
function applyValues(values) {
  for (const [id, val] of Object.entries(values)) {
    answers[id] = val;
    const el = document.getElementById("a_" + id);
    if (el) el.value = val;
  }
}
function missingRequired() {
  return fields.filter((f) => f.required && !answers[f.id]);
}
function readBack() {
  const lines = fields
    .filter((f) => answers[f.id])
    .map((f) => `${f.label}, ${answers[f.id]}`)
    .join(". ");
  speak(`Here is what I have. ${lines}. Say submit to send it, or name a field to change it.`);
}

// ---------- the conversational loop (one question at a time) ----------
let idx = 0;
async function askNext() {
  if (idx >= fields.length) {
    const missing = missingRequired();
    if (missing.length) {
      speak(`${missing[0].label} is still missing. ${questionFor(missing[0])}`);
      idx = fields.indexOf(missing[0]);
      return;
    }
    readBack();
    return;
  }
  const field = fields[idx];
  speak(questionFor(field), { onend: () => captureFor(field) });
}

async function captureFor(field) {
  try {
    const audio = await recordAnswer();
    // auto-stop after ~5s, or wire a tap/space to stop; keep it simple for the demo
    setTimeout(stopRecording, 5000);
    const transcript = await audio.then ? await transcribe(await audio) : await transcribe(audio);
    const values = await extract(transcript);
    applyValues(values);
    speak("Got it.", { onend: () => { idx++; askNext(); } });
  } catch (err) {
    console.warn("ai path failed, falling back", err);
    try {
      const transcript = await listenFallback();
      answers[field.id] = transcript;
      const el = document.getElementById("a_" + field.id);
      if (el) el.value = transcript;
      speak("Got it.", { onend: () => { idx++; askNext(); } });
    } catch {
      speak("I did not catch that. Please try again.", { onend: () => captureFor(field) });
    }
  }
}

// ---------- triggers: button + voice ----------
export function startAccessibleMode() {
  document.getElementById("brokenForm").hidden = true;
  const relay = document.getElementById("relay");
  relay.hidden = false;
  idx = 0;
  speak("Accessible mode on. Booking an appointment. I will ask one question at a time.",
        { onend: askNext });
}

function wireTriggers() {
  document.getElementById("accessibleBtn").addEventListener("click", startAccessibleMode);
  // voice trigger (optional, button is the reliable path)
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    const rec = new SR();
    rec.lang = "en-GB";
    rec.continuous = true;
    rec.onresult = (e) => {
      const said = e.results[e.results.length - 1][0].transcript.toLowerCase();
      if (said.includes("accessible mode")) startAccessibleMode();
    };
    try { rec.start(); } catch {}
  }
}

// first tap unlocks audio (mobile browsers block it until a gesture)
document.addEventListener("DOMContentLoaded", () => {
  const gate = document.getElementById("startGate");
  gate.addEventListener("click", () => {
    speak("Welcome. This is an appointment booking form.");
    gate.hidden = true;
    wireTriggers();
  });
});
```

Note for the agent: the recording stop is naive (a 5 second timer). Improve it to stop on a tap or a short silence, keep the timer as a backstop, and add a soft "thinking" cue while the two network calls run. The extraction path is the priority, the fallback must stay working.

### index.html

```html
<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ClearForm</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <button id="startGate" class="gate">Tap anywhere to begin</button>

  <!-- THE BROKEN FORM (engineered failures, the "before") -->
  <main id="brokenForm" aria-label="Appointment booking">
    <h1>Book an appointment</h1>
    <!-- placeholder-only, no real labels; cramped; low contrast; silent errors -->
    <input class="broken" placeholder="Full name" />
    <input class="broken" placeholder="DOB" />
    <div class="fake-select broken">Appointment type</div>
    <!-- add the rest as deliberately broken controls -->
    <button class="broken-submit">Submit</button>
    <button id="accessibleBtn" class="a11y-trigger">Accessible mode</button>
  </main>

  <!-- THE ACCESSIBLE RELAY (the "after"), hidden until triggered -->
  <section id="relay" hidden aria-label="Accessible appointment booking">
    <div id="live" role="status" aria-live="assertive" class="sr-only"></div>
    <form id="accessibleForm" novalidate>
      <!-- Build these from form-schema.js: each field a real <label for> + input,
           fieldset/legend for choices, aria-describedby for errors -->
    </form>
    <div class="controls">
      <button type="button" id="repeatBtn">Repeat</button>
      <button type="button" id="slowerBtn">Slower</button>
    </div>
  </section>

  <script type="module" src="app.js"></script>
</body>
</html>
```

Agent: render the accessible form fields from `form-schema.js`, each with a programmatically associated visible label, `required` where set, `fieldset`/`legend` for choice groups, and error text tied by `aria-describedby`. Mirror every spoken step in the `#live` region so a running screen reader and our own audio agree.

### styles.css (starter)

```css
:root { --fg: #111; --bg: #fff; --accent: #005eb8; } /* NHS-style blue */
* { box-sizing: border-box; }
body { margin: 0; font: 18px/1.5 system-ui, sans-serif; color: var(--fg); background: var(--bg); }
.gate { position: fixed; inset: 0; width: 100%; height: 100%; font-size: 28px; border: 0; background: #000; color: #fff; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }

/* the broken form: deliberately poor */
.broken { display: block; width: 240px; margin: 4px; padding: 4px; font-size: 12px; color: #aaa; border: 1px solid #ddd; }
.fake-select { width: 240px; margin: 4px; padding: 4px; font-size: 12px; color: #aaa; border: 1px solid #ddd; }

/* the accessible relay: the opposite */
#relay { position: fixed; inset: 0; background: var(--bg); padding: 24px; overflow: auto; }
#relay label { display: block; font-size: 20px; font-weight: 600; margin: 16px 0 6px; }
#relay input, #relay select { width: 100%; max-width: 520px; font-size: 20px; padding: 12px; border: 2px solid var(--fg); }
#relay .error { color: #b00; font-weight: 600; }
#relay button, .a11y-trigger { font-size: 20px; padding: 14px 20px; background: var(--accent); color: #fff; border: 0; }
#relay :focus { outline: 3px solid var(--accent); outline-offset: 2px; }
```

### README.md

```
# ClearForm
Accessible voice-driven form assistant. Before/after demo of an NHS-style booking form.

## Run locally
npm install
vercel dev          # needs OPENAI_API_KEY in .env

## Deploy
Push to the repo connected to Vercel. Set OPENAI_API_KEY in Vercel env vars.

## Architecture
Static page (index.html, app.js) + two serverless functions (api/transcribe, api/extract).
Keys live only in Vercel env vars. Browser speech is the offline fallback.
```

---

## Build order (for the agent)

1. Scaffold the files above. `npm install`. Confirm `vercel dev` serves the page.
2. Render the accessible form from `form-schema.js` with full WCAG markup (labels, fieldset/legend, aria-describedby errors, live region).
3. Build the broken form with the engineered failures.
4. Get `speak()` working behind the tap gate.
5. Wire `/api/transcribe` and `/api/extract`, test each with a hardcoded input.
6. Connect the one-question voice loop end to end: ask, record, transcribe, extract, fill, read back, submit.
7. Add spoken, specific errors through the live region.
8. Add the full-screen takeover and the voice plus button triggers.
9. Confirm the browser-speech fallback works with the API disabled.
10. Stretch: one natural sentence filling several fields (same `/api/extract`, returns several values).

## Acceptance checks (done means all pass on the deployed URL)

- The broken form visibly and audibly fails: placeholder-only fields, a silent error, an unreachable control.
- Saying "accessible mode" or tapping the button expands the relay full screen and it announces itself.
- Each field can be answered by voice: speech is transcribed, mapped to the right field, filled, and confirmed.
- A missed required field is announced specifically through the live region.
- The whole form is read back before submit, and submits only on confirmation.
- With the network or API disabled, the fallback still lets the user complete the form by voice or typing.
- The relay itself passes a screen reader pass (labels, focus order, announced errors).
- Keys are never present in client code or network responses, only in the serverless functions.

## Guardrails

- Keys only in Vercel env vars, only touched by `/api` functions.
- Low temperature, JSON output, fill only confident fields, always read back before submit.
- The relay must be as accessible as the form it fixes.
- Invented data and NHS-style layout only, no real NHS branding, no real personal data.
```
