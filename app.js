// Entry point and conversational controller. One question per screen:
// ask it aloud, take a spoken or typed answer, read it back, confirm, move on.
// At the end, read the whole form back and submit only on confirmation.

import { fields, answers, questionFor, hintFor, listOptions } from "./form-schema.js";
import {
  renderAccessibleForm, getStepEl, getFocusTarget, getRawValue,
  setFieldValue, showFieldError, clearFieldError, clearErrors, announce,
} from "./forms.js";
import {
  speak, stopSpeaking, repeatLast, setRate, setMuted, isMuted,
  listenFallback, stopListening, canListen,
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

const state = {
  mode: "start",        // start | question | confirm | review | done
  index: 0,             // current field
  pending: null,        // value awaiting confirmation
  viaVoice: false,      // was the pending value spoken?
  handsFree: canListen, // listen automatically after each prompt
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

// --- listening ---------------------------------------------------------------

let listenHandler = null;

function setListeningUI(on) {
  $("listening").hidden = !on;
  const btn = $("speak-btn");
  btn.classList.toggle("is-listening", on);
  btn.querySelector(".speak-label").textContent = on ? "Stop listening" : "Speak answer";
}

/** Listen once and pass the transcript to handler. */
function listen(handler) {
  if (!canListen) return;
  stopSpeaking();
  listenHandler = handler;
  setListeningUI(true);
  announce("Listening.");
  listenFallback()
    .then((text) => {
      setListeningUI(false);
      if (listenHandler === handler) handler(text);
    })
    .catch((err) => {
      setListeningUI(false);
      if (err.code === "aborted" || listenHandler !== handler) return;
      if (err.code === "not-allowed" || err.code === "service-not-allowed") {
        state.handsFree = false;
        updateToggles();
        say("I can't use the microphone. Please allow microphone access, or type your answer.");
      } else if (err.code === "no-speech") {
        say("I didn't hear anything. Press Speak answer to try again, or type your answer.");
      } else {
        say("Sorry, voice input isn't working right now. Please type your answer.");
      }
    });
}

function cancelListening() {
  listenHandler = null;
  stopListening();
  setListeningUI(false);
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

function onSpokenAnswer(text) {
  const field = current();
  const cmd = commandIn(text);
  if (cmd) return runCommand(cmd);

  // Show what was heard in the field, so the screen matches the speech.
  if (field.type !== "choice") $(`f-${field.id}`).value = text;
  takeAnswer(text, true);
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

export function startAccessibleMode() {
  $("start-screen").hidden = true;
  $("relay").hidden = false;
  document.body.classList.add("relay-active");
  renderAccessibleForm($("form-host"));
  wireForm();
  for (const k of Object.keys(answers)) delete answers[k];
  state.returnToReview = false;
  showQuestion(0, {
    prefix: `Accessible booking. There are ${fields.length} questions. You can speak or type each answer, and you can say back, repeat, or skip at any time.`,
  });
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
  $("handsfree-toggle").hidden = !canListen;
}

function init() {
  $("start-btn").addEventListener("click", startAccessibleMode);

  if (!canListen) {
    $("speak-btn").hidden = true;
    $("speak-help").hidden = true;
    $("no-mic-help").hidden = false;
    $("speak-btn").removeAttribute("aria-describedby");
  }
  updateToggles();

  $("speak-btn").addEventListener("click", () => {
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

// Exposed for debugging and the Phase 2 trigger wiring.
// clearform.hear("next Tuesday") simulates a spoken answer for testing.
const handlers = () => ({ question: onSpokenAnswer, confirm: onSpokenConfirm, review: onSpokenReview });
window.clearform = {
  startAccessibleMode, answers, state, spokenValue,
  hear: (text) => { cancelListening(); handlers()[state.mode]?.(text); },
};
