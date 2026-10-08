// Renders both forms from the shared schema and owns the value and error
// helpers. The broken "before" and the accessible "after" are generated from
// the same fields array, so they are provably the same form.

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

// --- the broken "before" ------------------------------------------------------
// Each failure is deliberate and maps to a WCAG success criterion we can name:
//   no labels, only painted-on hint text ...... 1.3.1, 3.3.2, 4.1.2
//   custom div "dropdown", not focusable ...... 2.1.1, 4.1.2
//   mouse-only calendar date picker ............ 2.1.1
//   time options chosen by colour only ......... 1.4.1
//   submit is a div, not keyboard reachable .... 2.1.1
//   error is a red outline, no text, silent .... 3.3.1, 4.1.3
//   light grey 11px text, cramped layout ....... 1.4.3, 1.4.4
// Do not fix any of these. They are the point.

const PLACEHOLDERS = { fullName: "Name", nhsNo: "NHS no.", reason: "Reason" };

function fakeDatePicker(field) {
  const wrap = el("div", { class: "b-date", "data-field": field.id });
  const display = el("div", { class: "b-date-display", text: `${field.label} (dd/mm/yyyy)` });
  const icon = el("div", { class: "b-date-icon" });
  const cal = el("div", { class: "b-cal", hidden: true });
  for (let d = 1; d <= 31; d++) {
    const day = el("div", { class: "b-cal-day", text: String(d) });
    day.addEventListener("click", (e) => {
      e.stopPropagation();
      const now = new Date();
      display.textContent = `${String(d).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
      wrap.dataset.value = display.textContent;
      cal.hidden = true;
    });
    cal.append(day);
  }
  wrap.addEventListener("click", () => { cal.hidden = !cal.hidden; });
  wrap.append(display, icon, cal);
  return wrap;
}

function fakeSelect(field) {
  const wrap = el("div", { class: "b-select", "data-field": field.id });
  const display = el("div", { class: "b-select-display", text: `${field.label}...` });
  const list = el("div", { class: "b-select-list", hidden: true });
  field.options.forEach((opt) => {
    const item = el("div", { class: "b-select-item", text: opt });
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      display.textContent = opt;
      wrap.dataset.value = opt;
      list.hidden = true;
    });
    list.append(item);
  });
  wrap.addEventListener("click", () => { list.hidden = !list.hidden; });
  wrap.append(display, list);
  return wrap;
}

function fakeToggle(field) {
  const wrap = el("div", { class: "b-toggle", "data-field": field.id });
  field.options.forEach((opt) => {
    // "AM" / "PM", with the selection shown only by a slightly darker grey.
    const item = el("div", { class: "b-toggle-item", text: opt === "Morning" ? "AM" : opt === "Afternoon" ? "PM" : opt });
    item.addEventListener("click", () => {
      wrap.querySelectorAll(".b-toggle-item").forEach((i) => i.classList.remove("b-on"));
      item.classList.add("b-on");
      wrap.dataset.value = opt;
    });
    wrap.append(item);
  });
  return wrap;
}

/** The "before": the same form, built the way too many real forms are. */
export function renderBrokenForm(container) {
  const form = el("div", { class: "b-form" });
  for (const field of fields) {
    let control;
    if (field.type === "date") control = fakeDatePicker(field);
    else if (field.id === "time") control = fakeToggle(field);
    else if (field.type === "choice") control = fakeSelect(field);
    else control = el("input", { class: "b-input", type: "text", "data-field": field.id });
    const row = el("div", { class: field.id === "reason" ? "b-row b-row--wide" : "b-row" }, control);
    if (control.tagName === "INPUT") {
      // A painted-on "placeholder": grey text over the input, tied to nothing,
      // gone the moment you focus. A screen reader just says "edit text".
      const ph = el("div", { class: "b-ph", text: PLACEHOLDERS[field.id] || field.label });
      const sync = () => { ph.hidden = document.activeElement === control || Boolean(control.value); };
      control.addEventListener("focus", sync);
      control.addEventListener("blur", sync);
      ph.addEventListener("click", () => control.focus());
      row.append(ph);
    }
    form.append(row);
  }
  const submitBtn = el("div", { class: "b-submit", text: "Submit »" });
  submitBtn.addEventListener("click", () => {
    // Silent failure: a red outline on empty required controls, nothing else.
    for (const field of fields) {
      const node = form.querySelector(`[data-field="${field.id}"]`);
      const value = node.tagName === "INPUT" ? node.value.trim() : node.dataset.value;
      node.classList.toggle("b-invalid", Boolean(field.required && !value));
    }
  });
  form.append(submitBtn);
  const actions = el("div", { class: "b-actions" },
    submitBtn,
    el("div", { class: "b-reset", text: "Clear form" }));

  // A believable, dated surgery website. Everything is a div: no landmarks,
  // no headings, no links. Looks fine to a sighted user; a screen reader
  // user gets a flat stream of text and three unnamed edit boxes.
  const nav = el("div", { class: "b-nav" });
  ["Home", "About us", "Our team", "Appointments", "Prescriptions", "Test results", "Contact"].forEach((item) => {
    nav.append(el("div", { class: item === "Appointments" ? "b-nav-item b-nav-on" : "b-nav-item", text: item }));
  });

  const sidebar = el("div", { class: "b-sidebar" },
    el("div", { class: "b-box" },
      el("div", { class: "b-box-title", text: "Opening hours" }),
      el("div", { class: "b-hours", text: "Mon – Fri 8:00am – 6:30pm" }),
      el("div", { class: "b-hours", text: "Sat 9:00am – 12:00pm (pre-booked only)" }),
      el("div", { class: "b-hours", text: "Sun Closed" })),
    el("div", { class: "b-box b-box--alert" },
      el("div", { class: "b-box-title", text: "Urgent?" }),
      el("div", { text: "If it is an emergency call 999. For urgent advice out of hours call 111." })),
    el("div", { class: "b-box" },
      el("div", { class: "b-box-title", text: "Quick links" }),
      el("div", { class: "b-fake-link", text: "Repeat prescriptions" }),
      el("div", { class: "b-fake-link", text: "Register as a new patient" }),
      el("div", { class: "b-fake-link", text: "Cancel an appointment" })));

  const content = el("div", { class: "b-content" },
    el("div", { class: "b-crumbs", text: "Home  ›  Appointments  ›  Book online" }),
    el("div", { class: "b-title", text: "Book an Appointment Online" }),
    el("div", { class: "b-intro", text: "Please complete ALL fields below and press Submit. Mandatory fields will be highlighted in red. Appointments are subject to availability and will be confirmed by telephone." }),
    el("div", { class: "b-card" }, form, actions),
    el("div", { class: "b-small", text: "By pressing Submit you agree to our terms and conditions and privacy notice. Please allow 2 working days for a response." }));

  container.replaceChildren(
    el("div", { class: "b-page" },
      el("div", { class: "b-topbar" },
        el("div", { class: "b-wrap b-topbar-inner" },
          el("div", { text: "Welcome to our online services" }),
          el("div", { class: "b-textsize", text: "Text size  A  A  A" }))),
      el("div", { class: "b-header" },
        el("div", { class: "b-wrap b-header-inner" },
          el("div", { class: "b-crest" }),
          el("div", {},
            el("div", { class: "b-logo", text: "ClearForm Surgery" }),
            el("div", { class: "b-tagline", text: "Caring for our community since 1987" })),
          el("div", { class: "b-phone", text: "Tel: 01632 960 123" }))),
      el("div", { class: "b-navbar" }, el("div", { class: "b-wrap" }, nav)),
      el("div", { class: "b-wrap b-main" }, content, sidebar),
      el("div", { class: "b-footer" },
        el("div", { class: "b-wrap", text: "© 2026 ClearForm Surgery (invented for a demonstration)  |  Accessibility statement  |  Privacy  |  Cookies  |  Site map" }))));
  return form;
}

// --- accessible form lookups ---------------------------------------------------

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
