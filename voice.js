// Voice in and voice out. Speech out is the browser's speechSynthesis.
// Speech in is MediaRecorder -> /api/transcribe (Whisper) -> /api/extract,
// with the browser's on-device SpeechRecognition (listenFallback) as the
// offline path when the API or the network is unavailable.

import { fields as allFields } from "./form-schema.js";

const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
const Recognition = typeof window !== "undefined"
  ? window.SpeechRecognition || window.webkitSpeechRecognition
  : null;

let rate = 0.95;
let muted = false;
let lastText = "";
let lastOnend = null;
let speakToken = 0;
let voice = null;

function pickVoice() {
  if (!synth) return;
  const voices = synth.getVoices();
  voice =
    voices.find((v) => v.lang === "en-GB" && /natural|online|google/i.test(v.name)) ||
    voices.find((v) => v.lang === "en-GB") ||
    voices.find((v) => v.lang && v.lang.startsWith("en")) ||
    null;
}
if (synth) {
  pickVoice();
  synth.addEventListener?.("voiceschanged", pickVoice);
}

export const canSpeak = Boolean(synth);
export const canListen = Boolean(Recognition);

// Chrome stops long utterances after about 15 seconds, so speak sentence by
// sentence. This also lets the final read-back run as long as it needs.
function chunk(text) {
  return String(text)
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Speak text aloud. Cancels anything already being said first.
 * onend fires once when the whole text has been spoken (or immediately when
 * muted or unsupported), and never fires if a later speak() interrupts it.
 */
export function speak(text, { onend } = {}) {
  lastText = text;
  lastOnend = onend || null;
  const token = ++speakToken;
  const done = () => {
    if (token !== speakToken) return;
    speakToken++; // guard against double fire from the safety timer
    onend && onend();
  };

  if (synth) synth.cancel();
  if (muted || !synth || !text) {
    setTimeout(done, 0);
    return;
  }

  const parts = chunk(text);
  let i = 0;
  const next = () => {
    if (token !== speakToken) return;
    if (i >= parts.length) return done();
    const part = parts[i++];
    const u = new SpeechSynthesisUtterance(part);
    u.rate = rate;
    u.lang = "en-GB";
    if (voice) u.voice = voice;
    // onend is unreliable in some browsers; a timer based on length is the backstop.
    const ms = 1500 + (part.split(/\s+/).length * 520) / rate;
    const timer = setTimeout(next, ms);
    const finish = () => { clearTimeout(timer); next(); };
    u.onend = finish;
    u.onerror = finish;
    synth.speak(u);
  };
  // A short gap after cancel() avoids Chrome dropping the first utterance.
  setTimeout(next, 60);
}

export function stopSpeaking() {
  speakToken++;
  if (synth) synth.cancel();
}

export function repeatLast() {
  if (lastText) speak(lastText, { onend: lastOnend });
}

export function setRate(r) {
  rate = Math.min(1.5, Math.max(0.5, r));
}

export function getRate() {
  return rate;
}

export function setMuted(m) {
  muted = m;
  if (m) stopSpeaking();
}

export function isMuted() {
  return muted;
}

// --- listening -------------------------------------------------------------

let activeRecognition = null;

/**
 * Listen once with the browser's on-device speech recognition.
 * Resolves with the transcript. Rejects with an Error whose .code is
 * "unsupported", "no-speech", "not-allowed", "aborted" or another
 * SpeechRecognition error code.
 */
export function listenFallback() {
  return new Promise((resolve, reject) => {
    if (!Recognition) {
      const err = new Error("Speech recognition is not available in this browser.");
      err.code = "unsupported";
      reject(err);
      return;
    }
    stopListening();
    const rec = new Recognition();
    rec.lang = "en-GB";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.continuous = false;
    activeRecognition = rec;

    let settled = false;
    let transcript = "";
    rec.onresult = (e) => {
      transcript = Array.from(e.results).map((r) => r[0].transcript).join(" ").trim();
    };
    rec.onerror = (e) => {
      if (settled) return;
      settled = true;
      const err = new Error(e.error || "recognition error");
      err.code = e.error || "error";
      reject(err);
    };
    rec.onend = () => {
      if (activeRecognition === rec) activeRecognition = null;
      if (settled) return;
      settled = true;
      if (transcript) resolve(transcript);
      else {
        const err = new Error("No speech was heard.");
        err.code = "no-speech";
        reject(err);
      }
    };
    try {
      rec.start();
    } catch (e) {
      settled = true;
      activeRecognition = null;
      e.code = "start-failed";
      reject(e);
    }
  });
}

/** Stop listening now. A pending listenFallback() rejects with code "aborted". */
export function stopListening() {
  if (activeRecognition) {
    const rec = activeRecognition;
    activeRecognition = null;
    try { rec.abort(); } catch { /* already stopped */ }
  }
}

export function isListening() {
  return Boolean(activeRecognition);
}

// --- voice trigger -----------------------------------------------------------

/**
 * Listen in the background for a phrase, e.g. "accessible mode", and call cb
 * when it is heard. Keeps restarting (browsers end continuous recognition
 * after a pause) until the returned stop() is called. Returns a no-op stop
 * when recognition is unsupported. The button is the reliable trigger; this
 * is the flourish.
 */
export function onVoiceTrigger(phrase, cb, { onstate } = {}) {
  if (!Recognition) return () => {};
  const target = phrase.toLowerCase();
  // Near-misses speech recognition commonly returns for "accessible mode".
  const variants = [target, target.replace("accessible", "accessibility"),
    target.replace("mode", "mood"), target.replace("mode", "mod")];
  let active = true;
  let rec = null;
  let failures = 0;

  const start = () => {
    if (!active || activeRecognition) return; // never fight an answer listener
    rec = new Recognition();
    rec.lang = "en-GB";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const said = e.results[i][0].transcript.toLowerCase();
        if (variants.some((v) => said.includes(v))) {
          stop();
          cb(said);
          return;
        }
      }
    };
    rec.onstart = () => { failures = 0; onstate && onstate(true); };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") active = false;
      failures++;
    };
    rec.onend = () => {
      onstate && onstate(false);
      rec = null;
      if (active && failures < 5) setTimeout(start, 300);
    };
    try { rec.start(); } catch { /* already started */ }
  };

  function stop() {
    active = false;
    if (rec) { try { rec.abort(); } catch { /* stopped */ } rec = null; }
    onstate && onstate(false);
  }

  start();
  return stop;
}

// --- recording for Whisper -----------------------------------------------------

export const canRecord = typeof window !== "undefined" &&
  Boolean(window.MediaRecorder && navigator.mediaDevices?.getUserMedia);

let micStream = null;
let audioCtx = null;
let recording = null; // { stop(), cancel() }
let lastMimeType = "audio/webm";

async function getMic() {
  if (micStream && micStream.getTracks().some((t) => t.readyState === "live")) return micStream;
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  return micStream;
}

/** Turn the microphone off completely (e.g. when leaving accessible mode). */
export function releaseMic() {
  cancelRecording();
  micStream?.getTracks().forEach((t) => t.stop());
  micStream = null;
}

function pickMimeType() {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return types.find((t) => MediaRecorder.isTypeSupported?.(t)) || "";
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

function codedError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * Record one answer. Stops by itself after a short silence once speech has
 * started, or when stopRecording() is called (a tap), with a time limit as
 * the backstop. Resolves with base64 audio; recordingMimeType() gives its type.
 * Rejects with .code "no-speech", "aborted" or "not-allowed".
 */
export async function recordAnswer({ silenceMs = 1300, noSpeechMs = 7000, maxMs = 12000 } = {}) {
  cancelRecording();
  let stream;
  try {
    stream = await getMic();
  } catch (e) {
    throw codedError("Microphone blocked", e.name === "NotAllowedError" ? "not-allowed" : "no-mic");
  }

  const mimeType = pickMimeType();
  const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  lastMimeType = (rec.mimeType || mimeType || "audio/webm").split(";")[0];
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

  // Simple voice activity detection on the input level.
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") await audioCtx.resume().catch(() => {});
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);

  return new Promise((resolve, reject) => {
    const started = performance.now();
    let heardSpeech = false;
    let loudFor = 0;
    let lastLoud = 0;
    let noise = 0.01;
    let outcome = null; // "done" | "cancel" | "no-speech"

    const tick = setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      const now = performance.now();
      const threshold = Math.max(0.015, noise * 2.5);
      if (rms > threshold) {
        loudFor += 50;
        lastLoud = now;
        if (loudFor >= 150) heardSpeech = true;
      } else {
        loudFor = 0;
        if (!heardSpeech) noise = noise * 0.9 + rms * 0.1; // learn the room
      }
      if (heardSpeech && now - lastLoud > silenceMs) finish("done");
      else if (!heardSpeech && now - started > noSpeechMs) finish("no-speech");
      else if (now - started > maxMs) finish("done");
    }, 50);

    function finish(how) {
      if (outcome) return;
      outcome = how;
      clearInterval(tick);
      source.disconnect();
      recording = null;
      if (rec.state !== "inactive") rec.stop(); else onStopped();
    }

    async function onStopped() {
      if (outcome === "cancel") return reject(codedError("Recording cancelled", "aborted"));
      if (outcome === "no-speech" && !heardSpeech) return reject(codedError("No speech was heard.", "no-speech"));
      const blob = new Blob(chunks, { type: lastMimeType });
      if (blob.size < 1500) return reject(codedError("No speech was heard.", "no-speech"));
      resolve(await blobToBase64(blob));
    }
    rec.onstop = onStopped;

    recording = {
      // A tap means "I've finished": send what we have, even if quiet.
      stop: () => { heardSpeech = true; finish("done"); },
      cancel: () => finish("cancel"),
    };
    rec.start(250);
  });
}

export function stopRecording() {
  recording?.stop();
}

export function cancelRecording() {
  recording?.cancel();
}

export function isRecording() {
  return Boolean(recording);
}

export function recordingMimeType() {
  return lastMimeType;
}

// --- the AI endpoints --------------------------------------------------------

async function postJson(url, body, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!r.ok) throw codedError(`${url} failed with ${r.status}`, "api-failed");
    return await r.json();
  } catch (e) {
    throw e.code ? e : codedError(e.message || "Network error", "api-failed");
  } finally {
    clearTimeout(timer);
  }
}

/** Audio to text via /api/transcribe (Whisper). */
export async function transcribe(audioBase64, mimeType = lastMimeType) {
  const { text } = await postJson("/api/transcribe", { audioBase64, mimeType }, 12000);
  return (text || "").trim();
}

/**
 * Transcript to { fieldId: value } via /api/extract. fieldList defaults to the
 * whole form; currentFieldId says which question was just asked.
 */
export async function extract(transcript, today, fieldList = allFields, currentFieldId) {
  const { values } = await postJson("/api/extract", { fields: fieldList, transcript, today, currentFieldId }, 9000);
  return values || {};
}

/** Is the AI path configured and reachable? */
export async function aiReady() {
  if (!navigator.onLine) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3500);
  try {
    const r = await fetch("/api/extract", { method: "GET", signal: ctrl.signal, cache: "no-store" });
    if (!r.ok) return false;
    return Boolean((await r.json()).ready);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// --- thinking cue --------------------------------------------------------------

let thinkingTimer = null;

/** A soft, quiet two-note cue every second while the AI works, so it's never dead air. */
export function startThinking() {
  stopThinking();
  if (muted) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const blip = () => {
      const t = audioCtx.currentTime;
      [0, 0.16].forEach((offset, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.value = i ? 660 : 520;
        gain.gain.setValueAtTime(0.0001, t + offset);
        gain.gain.exponentialRampToValueAtTime(0.05, t + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.14);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t + offset);
        osc.stop(t + offset + 0.15);
      });
    };
    blip();
    thinkingTimer = setInterval(blip, 1100);
  } catch { /* no audio: the visible status still shows */ }
}

export function stopThinking() {
  clearInterval(thinkingTimer);
  thinkingTimer = null;
}
