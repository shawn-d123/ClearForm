// Voice in and voice out. Phase 1 uses only browser APIs: speechSynthesis for
// speaking and SpeechRecognition for listening. Phase 3 adds Whisper and the
// extraction model behind /api, with listenFallback() kept as the offline path.

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
