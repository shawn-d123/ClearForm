// Entry point and conversational controller. One question per screen:
// ask it aloud, take a spoken or typed answer, read it back, confirm, move on.
// At the end, read the whole form back and submit only on confirmation.

import { fields, answers, questionFor, hintFor, listOptions } from "./form-schema.js";
import {
  renderBrokenForm, renderAccessibleForm, getStepEl, getFocusTarget, getRawValue,
  setFieldValue, showFieldError, clearFieldError, clearErrors, announce,
} from "./forms.js";
import {
  speak, stopSpeaking, repeatLast, setRate, setMuted, isMuted,
  listenFallback, stopListening, canListen, onVoiceTrigger,
  canRecord, recordAnswer, stopRecording, cancelRecording, isRecording, releaseMic,
  transcribe, extract, aiReady, startThinking, stopThinking,
} from "./voice.js";
import {
  parseDate, matchChoice, tidyName, tidyText, tidyNhsNumber,
  isYes, isNo, commandIn,
} from "./normalize.js";
import {
  showScreen, renderConfirm, confirmSpeech, readBack, fieldFromSpeech,
  missingRequired, submit, spokenValue,
} from "./relay.js";

const $ = (id) => document.getElementById(id);

// The demo clock: ?today=2026-10-08 fixes "today" so relative dates are predictable.
function todayIso() {
  const fixed = new URLSearchParams(location.search).get("today");
  if (fixed && /^\d{4}-\d{2}-\d{2}$/.test(fixed)) return fixed;
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Voice is available if we can either record for Whisper or use on-device recognition.
const canVoice = canListen || canRecord;

// The AI path (Whisper + extraction). ?ai=off forces the on-device fallback,
// for rehearsing a dead connection.
const ai = {
  ready: false,
  forcedOff: new URLSearchParams(location.search).get("ai") === "off",
  blockedUntil: 0,
};

const state = {
  mode: "start",        // start | question | confirm | review | done
  index: 0,             // current field
  pending: null,        // value awaiting confirmation
  viaVoice: false,      // was the pending value spoken?
  handsFree: canVoice,  // listen automatically after each prompt
  typedThisStep: false, // user started typing, so don't open the mic
  misses: 0,            // consecutive misunderstood answers
  returnToReview: false,
};

const current = () => fields[state.index];

// --- interpreting an answer --------------------------------------------------

/** Turn raw typed or spoken text into a clean value, or a specific error. */
function interpret(field, raw) {
  const text = tidyText(raw);
  const today = todayIso();
  if (!text) {
    if (!field.required) return { value: "" };
    return { error: field.type === "choice"
      ? `Choose ${listOptions(field.options)}.`
      : `Enter your ${field.label.toLowerCase()}.` };
  }
  switch (field.id) {
    case "fullName":
      return { value: tidyName(text) };
    case "nhsNo": {
      const v = tidyNhsNumber(text);
      return v ? { value: v } : { error: "Your NHS number must be 10 digits, like 485 777 3456. Or skip this question." };
    }
    case "dob": {
      const v = parseDate(text, today, { preferFuture: false });
      if (!v) return { error: "Enter your date of birth as a day, month and year, like 12 March 1985." };
      if (v >= today) return { error: "Your date of birth must be in the past." };
      return { value: v };
    }
    case "date": {
      const v = parseDate(text, today, { preferFuture: true });
      if (!v) return { error: "Enter the date you would like, like 20 October, or next Tuesday." };
      if (v < today) return { error: "Your preferred date must be today or in the future." };
      return { value: v };
    }
  }
  if (field.type === "choice") {
    const v = matchChoice(text, field.options);
    return v ? { value: v } : { error: `Choose ${listOptions(field.options)}.` };
  }
  return { value: text };
}

// --- the AI path and its fallback ---------------------------------------------

async function checkAi() {
  if (Date.now() < ai.blockedUntil) return;
  ai.ready = !ai.forcedOff && canRecord && (await aiReady());
  updateVoiceStatus();
}

/** The API or network failed mid-answer: use on-device speech, retry the API later. */
function aiLost() {
  if (!ai.ready) return;
  ai.ready = false;
  updateVoiceStatus();
  // Back off: an API that just failed (no credit, bad key, dead wifi) would
  // otherwise cost the user a repeated answer on every retry.
  ai.blockedUntil = Date.now() + 5 * 60 * 1000;
  setTimeout(checkAi, 5 * 60 * 1000 + 100);
}

function updateVoiceStatus() {
  const el = $("voice-mode");
  if (!el) return;
  el.textContent = ai.ready ? "Voice input: enhanced (online)"
    : canListen ? "Voice input: on-device"
    : "Voice input is not available in this browser, please type.";
}

// --- listening ---------------------------------------------------------------

let listenToken = 0;

function setListeningUI(phase) { // "listening" | "thinking" | null
  const box = $("listening");
  box.hidden = !phase;
  box.querySelector(".listening-text").textContent =
    phase === "thinking" ? "Working it out…" : "Listening… speak now";
  box.classList.toggle("is-thinking", phase === "thinking");
  const btn = $("speak-btn");
  btn.classList.toggle("is-listening", phase === "listening");
  btn.querySelector(".speak-label").textContent =
    phase === "listening" ? (ai.ready ? "Done speaking" : "Stop listening") : "Speak answer";
}

/** Capture one utterance as text: Whisper when online, on-device otherwise. */
async function captureSpeech() {
  if (ai.ready) {
    const audio = await recordAnswer(); // no-speech / aborted / not-allowed propagate
    setListeningUI("thinking");
    startThinking();
    try {
      return await transcribe(audio);
    } catch (e) {
      aiLost();
      const err = new Error("AI path failed");
      err.code = "ai-failed";
      throw err;
    } finally {
      stopThinking();
    }
  }
  return listenFallback();
}

/** Listen once and pass the transcript to handler. */
function listen(handler) {
  if (!canVoice || (!ai.ready && !canListen)) return;
  stopSpeaking();
  const token = ++listenToken;
  setListeningUI("listening");
  announce("Listening.");
  captureSpeech()
    .then((text) => {
      if (token !== listenToken) return;
      setListeningUI(null);
      if (!text) return say("I didn't hear anything. Press Speak answer to try again, or type your answer.");
      handler(text);
    })
    .catch((err) => {
      if (token !== listenToken) return;
      setListeningUI(null);
      if (err.code === "aborted") return;
      if (err.code === "not-allowed" || err.code === "service-not-allowed" || err.code === "no-mic") {
        state.handsFree = false;
        updateToggles();
        say("I can't use the microphone. Please allow microphone access, or type your answer.");
      } else if (err.code === "no-speech") {
        say("I didn't hear anything. Press Speak answer to try again, or type your answer.");
      } else if (err.code === "ai-failed" && canListen) {
        say("Sorry, I lost my connection. Please say that again.", { then: () => listen(handler) });
      } else {
        say("Sorry, voice input isn't working right now. Please type your answer.");
      }
    });
}

function cancelListening() {
  listenToken++;
  stopListening();
  cancelRecording();
  stopThinking();
  setListeningUI(null);
}

/** Speak and mirror into the live region, then optionally listen. */
function say(text, { then } = {}) {
  announce(text);
  speak(text, { onend: then });
}

/** After a prompt is spoken, open the mic if hands-free is on. */
function thenListen(handler) {
  return () => {
    if (state.handsFree && !state.typedThisStep && !isMuted()) listen(handler);
  };
}

// --- question screen ---------------------------------------------------------

function showQuestion(index, { prefix = "", keepValue = false } = {}) {
  cancelListening();
  state.mode = "question";
  state.index = index;
  state.typedThisStep = false;
  const field = current();

  document.querySelectorAll(".step").forEach((s) => { s.hidden = true; });
  getStepEl(field.id).hidden = false;
  if (!keepValue) setFieldValue(field.id, answers[field.id] || "");
  showScreen("question-screen");

  $("skip-btn").hidden = field.required;
  $("back-btn").hidden = index === 0;

  const target = getFocusTarget(field.id);
  target.focus();
  if (target.select && target.value) target.select();

  const hint = hintFor(field);
  const text = `${prefix ? prefix + " " : ""}Question ${index + 1} of ${fields.length}. ${questionFor(field)} ${hint}`;
  speak(text, { onend: thenListen(onSpokenAnswer) });
}

async function onSpokenAnswer(text) {
  const field = current();
  const cmd = commandIn(text);
  if (cmd) return runCommand(cmd);

  // Show what was heard in the field, so the screen matches the speech.
  if (field.type !== "choice") $(`f-${field.id}`).value = text;

  // Online: the model maps messy speech to a clean value for this field.
  // It returns nothing when unsure, and then on-device parsing takes over.
  let raw = text;
  if (ai.ready) {
    const index = state.index;
    const token = ++listenToken;
    setListeningUI("thinking");
    startThinking();
    try {
      const values = await extract(text, todayIso(), [field]);
      if (values[field.id]) raw = values[field.id];
    } catch {
      // Fall through to on-device parsing of the raw transcript.
    } finally {
      stopThinking();
    }
    // The user may have typed, gone back or cancelled while we waited.
    if (token !== listenToken || state.mode !== "question" || state.index !== index) return;
    setListeningUI(null);
  }
  takeAnswer(raw, true);
}

function takeAnswer(raw, viaVoice) {
  const field = current();
  const { value, error } = interpret(field, raw);
  if (error) {
    state.misses++;
    showFieldError(field.id, error);
    const retry = viaVoice && state.misses < 3;
    speak(`Sorry. ${error}`, { onend: retry ? thenListen(onSpokenAnswer) : undefined });
    return;
  }
  state.misses = 0;
  clearFieldError(field.id);
  if (value === "") return skip();
  state.pending = value;
  state.viaVoice = viaVoice;
  setFieldValue(field.id, value);
  showConfirm();
}

function skip() {
  const field = current();
  if (field.required) {
    showFieldError(field.id, `This question is needed. ${questionFor(field)}`);
    speak(`This question can't be skipped. ${questionFor(field)}`, { onend: thenListen(onSpokenAnswer) });
    return;
  }
  answers[field.id] = "";
  setFieldValue(field.id, "");
  advance(`Skipped ${field.label.toLowerCase()}.`);
}

function advance(prefix) {
  if (state.returnToReview) return showReview(prefix);
  if (state.index + 1 < fields.length) return showQuestion(state.index + 1, { prefix });
  showReview(prefix);
}

function goBack() {
  if (state.mode === "confirm") return rejectAnswer();
  if (state.mode === "review") {
    state.returnToReview = false;
    return showQuestion(fields.length - 1, { prefix: "Going back." });
  }
  if (state.index === 0) return say("This is the first question.");
  state.returnToReview = false;
  showQuestion(state.index - 1, { prefix: "Going back." });
}

function runCommand(cmd) {
  if (cmd === "repeat") return showQuestion(state.index);
  if (cmd === "back") return goBack();
  if (cmd === "skip") return skip();
}

// --- confirm screen ----------------------------------------------------------

function showConfirm() {
  cancelListening();
  state.mode = "confirm";
  const field = current();
  renderConfirm(field, state.pending, state.index);
  speak(confirmSpeech(field, state.pending, state.viaVoice), { onend: thenListen(onSpokenConfirm) });
}

let confirmMisses = 0;
function onSpokenConfirm(text) {
  const cmd = commandIn(text);
  if (cmd === "back") return goBack();
  if (cmd === "repeat") return showConfirm();
  if (isNo(text)) { confirmMisses = 0; return rejectAnswer(); }
  if (isYes(text)) { confirmMisses = 0; return acceptAnswer(); }
  confirmMisses++;
  const retry = confirmMisses < 3;
  say("Please say yes, or no.", { then: retry ? thenListen(onSpokenConfirm) : undefined });
}

function acceptAnswer() {
  const field = current();
  answers[field.id] = state.pending;
  setFieldValue(field.id, state.pending);
  state.pending = null;
  advance("Got it.");
}

function rejectAnswer() {
  state.pending = null;
  showQuestion(state.index, { prefix: "Okay, let's try that again.", keepValue: true });
}

// --- review and submit -------------------------------------------------------

function showReview(prefix = "") {
  cancelListening();
  state.mode = "review";
  state.returnToReview = false;
  clearErrors();
  const text = readBack(answers, changeField);
  speak(`${prefix ? prefix + " " : ""}${text}`, { onend: thenListen(onSpokenReview) });
}

function changeField(id) {
  state.returnToReview = true;
  showQuestion(fields.findIndex((f) => f.id === id), { prefix: "Changing your answer." });
}

let reviewMisses = 0;
function onSpokenReview(text) {
  const cmd = commandIn(text);
  if (cmd === "repeat") return showReview();
  if (cmd === "back") return goBack();
  if (/\b(change|edit|fix|update)\b/i.test(text)) {
    const id = fieldFromSpeech(text);
    if (id) { reviewMisses = 0; return changeField(id); }
    return say("Which answer would you like to change? For example, say change date of birth.", { then: thenListen(onSpokenReview) });
  }
  if (isYes(text)) { reviewMisses = 0; return trySubmit(); }
  reviewMisses++;
  say("Say submit to send your request, or change and the question to edit an answer.",
    { then: reviewMisses < 3 ? thenListen(onSpokenReview) : undefined });
}

function trySubmit() {
  cancelListening();
  const missing = missingRequired(answers);
  if (missing.length) {
    // Shouldn't happen with per-question validation, but never submit blanks.
    const field = missing[0];
    state.returnToReview = true;
    showQuestion(fields.indexOf(field), { prefix: `Your ${field.label.toLowerCase()} is missing.` });
    showFieldError(field.id, `Enter your ${field.label.toLowerCase()}.`);
    return;
  }
  state.mode = "done";
  say(submit(answers));
}

// --- start and wiring --------------------------------------------------------

/** Hides the broken form, takes over the screen with the relay, starts the loop. */
export function startAccessibleMode() {
  stopVoiceTrigger();
  $("broken-view").hidden = true;
  $("trigger-bar").hidden = true;
  $("accessible-view").hidden = false;
  document.body.classList.add("relay-active");
  document.title = "Book an appointment (accessible mode) – ClearForm";
  window.scrollTo(0, 0);
  renderAccessibleForm($("form-host"));
  wireForm();
  for (const k of Object.keys(answers)) delete answers[k];
  state.returnToReview = false;
  showQuestion(0, {
    prefix: `Accessible mode on. Booking an appointment. I'll ask ${fields.length} questions, one at a time. You can speak or type each answer, and say back, repeat, or skip at any time.`,
  });
}

/** Back to the original form. The user is always in control of the assistant. */
function exitAccessibleMode() {
  cancelListening();
  stopSpeaking();
  releaseMic();
  state.mode = "start";
  document.body.classList.remove("relay-active");
  $("accessible-view").hidden = true;
  $("broken-view").hidden = false;
  $("trigger-bar").hidden = false;
  document.title = "Book an appointment – ClearForm";
  $("a11y-btn").focus();
  announce("Accessible mode off.");
  startVoiceTrigger();
}

// --- triggers: button + voice --------------------------------------------------

let stopTrigger = () => {};

function startVoiceTrigger() {
  stopTrigger();
  stopTrigger = onVoiceTrigger("accessible mode", startAccessibleMode, {
    onstate: (on) => { $("voice-chip").hidden = !on; },
  });
}

function stopVoiceTrigger() {
  stopTrigger();
  stopTrigger = () => {};
  $("voice-chip").hidden = true;
}

// Browsers only allow speech and the mic after a user gesture, so the voice
// trigger starts on the first click or key press anywhere on the page.
function armVoiceTriggerOnFirstGesture() {
  if (!canListen) return;
  const arm = () => {
    document.removeEventListener("click", arm, true);
    document.removeEventListener("keydown", arm, true);
    // If that first gesture was the Accessible mode button, don't start.
    setTimeout(() => { if (state.mode === "start") startVoiceTrigger(); }, 0);
  };
  document.addEventListener("click", arm, true);
  document.addEventListener("keydown", arm, true);
}

function wireForm() {
  const form = $("accessible-form");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (state.mode !== "question") return;
    cancelListening();
    stopSpeaking();
    takeAnswer(getRawValue(current().id), false);
  });
  // Typing means the user has chosen the keyboard: close the mic.
  form.addEventListener("input", () => {
    state.typedThisStep = true;
    cancelListening();
  });
}

function updateToggles() {
  $("voice-toggle").setAttribute("aria-pressed", String(!isMuted()));
  $("handsfree-toggle").setAttribute("aria-pressed", String(state.handsFree));
  $("handsfree-toggle").hidden = !canVoice;
}

function init() {
  renderBrokenForm($("broken-view"));
  $("a11y-btn").addEventListener("click", startAccessibleMode);
  $("exit-btn").addEventListener("click", exitAccessibleMode);
  checkAi();
  window.addEventListener("online", checkAi);
  window.addEventListener("offline", () => { ai.ready = false; updateVoiceStatus(); });
  armVoiceTriggerOnFirstGesture();

  if (!canVoice) {
    $("speak-btn").hidden = true;
    $("speak-help").hidden = true;
    $("no-mic-help").hidden = false;
    $("speak-btn").removeAttribute("aria-describedby");
  }
  updateToggles();

  $("speak-btn").addEventListener("click", () => {
    if (isRecording()) return stopRecording(); // "Done speaking": send it now
    if (!$("listening").hidden) return cancelListening();
    state.typedThisStep = false;
    listen(onSpokenAnswer);
  });
  $("skip-btn").addEventListener("click", () => { cancelListening(); skip(); });
  $("back-btn").addEventListener("click", () => { cancelListening(); goBack(); });
  $("repeat-btn").addEventListener("click", () => {
    cancelListening();
    if (state.mode === "question") return showQuestion(state.index);
    if (state.mode === "confirm") return showConfirm();
    if (state.mode === "review") return showReview();
    repeatLast();
  });
  $("confirm-yes").addEventListener("click", () => { cancelListening(); acceptAnswer(); });
  $("confirm-no").addEventListener("click", () => { cancelListening(); rejectAnswer(); });
  $("submit-btn").addEventListener("click", trySubmit);
  $("restart-btn").addEventListener("click", startAccessibleMode);

  $("voice-toggle").addEventListener("click", () => {
    setMuted(!isMuted());
    updateToggles();
    announce(isMuted() ? "Read aloud off." : "Read aloud on.");
  });
  $("handsfree-toggle").addEventListener("click", () => {
    state.handsFree = !state.handsFree;
    if (!state.handsFree) cancelListening();
    updateToggles();
    announce(state.handsFree ? "Listen automatically on." : "Listen automatically off.");
  });
  $("speed-select").addEventListener("change", (e) => setRate(Number(e.target.value)));

  // Escape stops speech and listening, without leaving the page.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { cancelListening(); stopSpeaking(); }
  });
}

init();

// Exposed for debugging and testing.
// clearform.hear("next Tuesday") simulates a spoken answer for testing.
const handlers = () => ({ question: onSpokenAnswer, confirm: onSpokenConfirm, review: onSpokenReview });
window.clearform = {
  startAccessibleMode, answers, state, spokenValue,
  hear: (text) => { cancelListening(); handlers()[state.mode]?.(text); },
};
