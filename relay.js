// The relay's screens: question, confirm (read-back of one answer), review
// (read-back of the whole form) and done. app.js decides what happens when;
// this module renders the screens and composes what is shown and said.

import { fields } from "./form-schema.js";
import { formatDateLong, weekdayName } from "./normalize.js";

const SCREENS = ["question-screen", "confirm-screen", "review-screen", "done-screen"];
const $ = (id) => document.getElementById(id);

export function showScreen(name) {
  SCREENS.forEach((s) => { $(s).hidden = s !== name; });
}

/** How a value is shown on screen. */
export function displayValue(field, value) {
  if (!value) return "Not given";
  if (field.type === "date") {
    return field.id === "dob" ? formatDateLong(value) : `${weekdayName(value)} ${formatDateLong(value)}`;
  }
  return value;
}

/** How a value is read aloud. Numbers are read digit by digit. */
export function spokenValue(field, value) {
  if (!value) return "not given";
  if (field.id === "nhsNo") {
    return value.split(" ").map((group) => group.split("").join(" ")).join(", ");
  }
  if (field.id === "apptType" && value === "GP") return "G P";
  return displayValue(field, value);
}

export function renderConfirm(field, value, index) {
  $("confirm-count").textContent = `Question ${index + 1} of ${fields.length}`;
  $("confirm-label").textContent = field.label;
  $("confirm-value").textContent = displayValue(field, value);
  $("confirm-value").hidden = false;
  $("confirm-list").hidden = true;
  showScreen("confirm-screen");
  $("confirm-heading").focus();
}

/** Confirm several answers captured from one sentence. values: { fieldId: value } */
export function renderConfirmMulti(values) {
  const ids = Object.keys(values);
  $("confirm-count").textContent = "From what you said";
  $("confirm-label").textContent = `I filled in ${ids.length} answers`;
  $("confirm-value").hidden = true;
  const list = $("confirm-list");
  list.replaceChildren();
  for (const field of fields.filter((f) => ids.includes(f.id))) {
    const row = document.createElement("div");
    row.className = "summary-row";
    const dt = document.createElement("dt");
    dt.textContent = field.label;
    const dd = document.createElement("dd");
    dd.textContent = displayValue(field, values[field.id]);
    row.append(dt, dd);
    list.append(row);
  }
  list.hidden = false;
  showScreen("confirm-screen");
  $("confirm-heading").focus();
}

export function confirmMultiSpeech(values) {
  const lines = fields
    .filter((f) => values[f.id])
    .map((f) => `${f.label}: ${spokenValue(f, values[f.id])}.`);
  return `I heard ${lines.length} answers. ${lines.join(" ")} Is that all right? Say yes, or no.`;
}

/** The missing-field message, used on screen, in the live region and spoken. */
export function missingMessage(field) {
  return `Your ${field.label.toLowerCase().replace("nhs", "NHS")} is missing. Please add it.`;
}

/**
 * GOV.UK error summary at the top of the review: a heading, then one link
 * per problem that jumps to the question. Focus moves to it so screen reader
 * users hear it straight away. Returns the text to speak.
 */
export function showErrorSummary(missing, onFix) {
  const box = $("error-summary");
  const list = $("error-summary-list");
  list.replaceChildren();
  for (const field of missing) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "link-button error-link";
    btn.textContent = missingMessage(field);
    btn.addEventListener("click", () => onFix(field.id));
    li.append(btn);
    list.append(li);
  }
  box.hidden = false;
  box.focus();
  const first = missing[0];
  return `There is a problem. ${missing.map(missingMessage).join(" ")} Say yes to add your ${first.label.toLowerCase()} now.`;
}

export function confirmSpeech(field, value, viaVoice) {
  const verb = viaVoice ? "I heard" : "You entered";
  return `${verb}: ${spokenValue(field, value)}. Is that right? Say yes, or no.`;
}

/**
 * Render the full read-back (GOV.UK "check answers" pattern) and return the
 * text to speak. onChange(fieldId) is called when a Change button is used.
 */
export function readBack(answers, onChange) {
  const list = $("summary-list");
  list.replaceChildren();
  for (const field of fields) {
    const row = document.createElement("div");
    row.className = "summary-row";
    const dt = document.createElement("dt");
    dt.textContent = field.label;
    const dd = document.createElement("dd");
    dd.className = answers[field.id] ? "" : "summary-empty";
    dd.textContent = displayValue(field, answers[field.id]);
    const action = document.createElement("dd");
    action.className = "summary-action";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "link-button";
    btn.innerHTML = `Change<span class="visually-hidden"> ${field.label}</span>`;
    btn.addEventListener("click", () => onChange(field.id));
    action.append(btn);
    row.append(dt, dd, action);
    list.append(row);
  }
  $("error-summary").hidden = true;
  showScreen("review-screen");
  $("review-heading").focus();

  const lines = fields.map((f) => `${f.label}: ${spokenValue(f, answers[f.id])}.`);
  return `Please check your answers. ${lines.join(" ")} To send your request, say submit. To change an answer, say change, and the question, for example, change date of birth.`;
}

/** Find which field a spoken "change ..." refers to. */
export function fieldFromSpeech(text) {
  const t = (text || "").toLowerCase();
  const aliases = {
    fullName: ["name", "full name"],
    dob: ["date of birth", "birthday", "birth"],
    nhsNo: ["nhs", "n h s", "number"],
    apptType: ["appointment type", "type", "kind of appointment"],
    date: ["preferred date", "appointment date", "date"],
    time: ["time", "morning", "afternoon"],
    reason: ["reason"],
  };
  // Longest alias first so "date of birth" wins over "date".
  const pairs = Object.entries(aliases)
    .flatMap(([id, words]) => words.map((w) => [id, w]))
    .sort((a, b) => b[1].length - a[1].length);
  const hit = pairs.find(([, w]) => t.includes(w));
  return hit ? hit[0] : null;
}

/** Fields that are required but have no answer. */
export function missingRequired(answers) {
  return fields.filter((f) => f.required && !answers[f.id]);
}

/** Submit: only ever called after the read-back and an explicit confirm. */
export function submit(answers) {
  const ref = `CF-${Math.floor(100000 + Math.random() * 900000)}`;
  // Demo only: nothing leaves the browser.
  console.info("ClearForm submission (demo, not sent):", { ...answers, reference: ref });
  $("done-ref").textContent = ref;
  showScreen("done-screen");
  $("done-heading").focus();
  const spokenRef = ref.replace("-", " ").split("").join(" ");
  return `Your appointment request has been sent. Your reference number is ${spokenRef}. We will contact you to confirm the time.`;
}
