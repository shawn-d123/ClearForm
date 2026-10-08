// Renders the forms from the shared schema and owns the value and error
// helpers. Phase 1: the accessible form, one question per step.
// Phase 2 adds renderBrokenForm() here, generated from the same schema.

import { fields, questionFor, hintFor } from "./form-schema.js";
import { formatDateLong } from "./normalize.js";

const AUTOCOMPLETE = { fullName: "name", dob: "bday", nhsNo: "off", date: "off", reason: "off" };
const INPUT_MODE = { nhsNo: "numeric" };

const inputId = (id) => `f-${id}`;
const hintId = (id) => `f-${id}-hint`;
const errorId = (id) => `f-${id}-error`;
const stepId = (id) => `step-${id}`;

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children) if (c) node.append(c);
  return node;
}

function errorMessage(id) {
  // Hidden until showFieldError(). The "Error:" prefix is for screen readers,
  // so the message is never conveyed by colour alone.
  return el("p", { id: errorId(id), class: "error-message", hidden: true });
}

function renderTextStep(field, index, total) {
  const hint = hintFor(field);
  const input = el("input", {
    id: inputId(field.id),
    name: field.id,
    type: "text",
    class: "input",
    autocomplete: AUTOCOMPLETE[field.id] || "off",
    inputmode: INPUT_MODE[field.id],
    spellcheck: field.id === "reason" ? "true" : "false",
    required: field.required,
    "aria-required": field.required ? "true" : null,
    "aria-describedby": hint ? hintId(field.id) : null,
  });
  return el("div", { class: "field" },
    el("h1", { class: "question-heading" },
      el("label", { for: inputId(field.id), class: "question", text: questionFor(field) })),
    hint && el("p", { id: hintId(field.id), class: "hint", text: hint }),
    errorMessage(field.id),
    input);
}

function renderChoiceStep(field) {
  const hint = hintFor(field);
  const options = el("div", { class: "radios" });
  field.options.forEach((opt, i) => {
    const id = `${inputId(field.id)}-${i}`;
    options.append(el("div", { class: "radio" },
      el("input", {
        id, type: "radio", name: field.id, value: opt, class: "radio-input",
        required: field.required && i === 0,
      }),
      el("label", { for: id, class: "radio-label", text: opt })));
  });
  return el("fieldset", {
    id: inputId(field.id),
    class: "field fieldset",
    "aria-describedby": hint ? hintId(field.id) : null,
    "aria-required": field.required ? "true" : null,
  },
    el("legend", { class: "question-legend" },
      el("h1", { class: "question-heading question", text: questionFor(field) })),
    hint && el("p", { id: hintId(field.id), class: "hint", text: hint }),
    errorMessage(field.id),
    options);
}

/**
 * The "after" form: properly built, every field with a real associated label,
 * choice groups in a fieldset with a legend, errors in text tied by
 * aria-describedby and announced through the live region. Each field is its
 * own step; the relay shows one at a time.
 */
export function renderAccessibleForm(container) {
  const form = el("form", { id: "accessible-form", class: "accessible-form", novalidate: true, "aria-label": "Book an appointment" });
  fields.forEach((field, i) => {
    const step = el("section", {
      id: stepId(field.id),
      class: "step",
      "data-field": field.id,
      hidden: true,
    },
      el("p", { class: "step-count", text: `Question ${i + 1} of ${fields.length}${field.required ? "" : " (optional)"}` }),
      field.type === "choice" ? renderChoiceStep(field) : renderTextStep(field, i, fields.length));
    form.append(step);
  });
  container.replaceChildren(form);
  return form;
}

export function getStepEl(id) {
  return document.getElementById(stepId(id));
}

/** The input, or the fieldset for a choice field. */
export function getFieldEl(id) {
  return document.getElementById(inputId(id));
}

/** The element focus should go to when the question is shown. */
export function getFocusTarget(id) {
  const field = fields.find((f) => f.id === id);
  if (field.type !== "choice") return getFieldEl(id);
  const group = getFieldEl(id);
  return group.querySelector("input:checked") || group.querySelector("input");
}

/** Raw value currently in the DOM for a field (string, "" when empty). */
export function getRawValue(id) {
  const field = fields.find((f) => f.id === id);
  if (field.type === "choice") {
    const checked = getFieldEl(id).querySelector("input:checked");
    return checked ? checked.value : "";
  }
  return getFieldEl(id).value.trim();
}

export function setFieldValue(id, value) {
  const field = fields.find((f) => f.id === id);
  const node = getFieldEl(id);
  if (!field || !node) return;
  if (field.type === "choice") {
    node.querySelectorAll("input").forEach((r) => { r.checked = r.value === value; });
  } else if (field.type === "date") {
    node.value = value ? formatDateLong(value) : "";
  } else {
    node.value = value || "";
  }
}

// --- errors and announcements ----------------------------------------------

export function announce(text, { assertive = false } = {}) {
  const region = document.getElementById(assertive ? "sr-alert" : "sr-status");
  if (!region) return;
  // Clear then set, so repeating the same message is announced again.
  region.textContent = "";
  setTimeout(() => { region.textContent = text; }, 50);
}

function describedBy(node, add, id) {
  const ids = new Set((node.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
  if (add) ids.add(id); else ids.delete(id);
  if (ids.size) node.setAttribute("aria-describedby", [...ids].join(" "));
  else node.removeAttribute("aria-describedby");
}

/** Show a specific error in text, tie it to the field and announce it. */
export function showFieldError(id, message) {
  const node = getFieldEl(id);
  const msg = document.getElementById(errorId(id));
  if (!node || !msg) return;
  msg.replaceChildren(el("span", { class: "visually-hidden", text: "Error: " }), message);
  msg.hidden = false;
  node.closest(".field")?.classList.add("field--error");
  describedBy(node, true, errorId(id));
  const targets = node.tagName === "FIELDSET" ? node.querySelectorAll("input") : [node];
  targets.forEach((t) => t.setAttribute("aria-invalid", "true"));
  announce(`Error: ${message}`, { assertive: true });
}

export function clearFieldError(id) {
  const node = getFieldEl(id);
  const msg = document.getElementById(errorId(id));
  if (!node || !msg) return;
  msg.hidden = true;
  msg.textContent = "";
  node.closest(".field")?.classList.remove("field--error");
  describedBy(node, false, errorId(id));
  const targets = node.tagName === "FIELDSET" ? node.querySelectorAll("input") : [node];
  targets.forEach((t) => t.removeAttribute("aria-invalid"));
}

export function clearErrors() {
  fields.forEach((f) => clearFieldError(f.id));
}
