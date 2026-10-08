// The one shared field definition. Frozen by clearform-contract.md.
// Both forms (broken and accessible), the voice extraction and the
// conversational loop all read from this array.

export const fields = [
  { id: "fullName", label: "Full name",              type: "text",   required: true },
  { id: "dob",      label: "Date of birth",          type: "date",   required: true },
  { id: "nhsNo",    label: "NHS number",             type: "text",   required: false },
  { id: "apptType", label: "Appointment type",       type: "choice", required: true,
      options: ["GP", "Nurse", "Blood test"] },
  { id: "date",     label: "Preferred date",         type: "date",   required: true },
  { id: "time",     label: "Preferred time",         type: "choice", required: true,
      options: ["Morning", "Afternoon"] },
  { id: "reason",   label: "Reason for appointment", type: "text",   required: false },
];

// { fieldId: value }, filled as we go. Dates are YYYY-MM-DD, choices are
// one of the field's options.
export const answers = {};

const questions = {
  fullName: "What is your full name?",
  dob:      "What is your date of birth?",
  nhsNo:    "What is your NHS number?",
  apptType: "What type of appointment do you need?",
  date:     "What date would you like your appointment?",
  time:     "Would you prefer a morning or an afternoon appointment?",
  reason:   "What is the reason for your appointment?",
};

// Hints are shown under the question and read aloud after it.
const hints = {
  fullName: "As it appears on your medical records.",
  dob:      "For example, 12 March 1985, or 12/03/1985.",
  nhsNo:    "This is optional. It is a 10 digit number, like 485 777 3456. You can skip this question.",
  date:     "For example, 20 October, or next Tuesday.",
  reason:   "This is optional. Tell us briefly what it is about, or skip this question.",
};

// The spoken question string. Also used as the visible label text, so what
// is heard and what is shown always match (WCAG 2.5.3 Label in Name).
export function questionFor(field) {
  return questions[field.id] || `What is your ${field.label.toLowerCase()}?`;
}

export function hintFor(field) {
  if (hints[field.id]) return hints[field.id];
  if (field.type === "choice") return `Choose one: ${listOptions(field.options)}.`;
  return "";
}

export function listOptions(options) {
  if (options.length < 2) return options.join("");
  return `${options.slice(0, -1).join(", ")}, or ${options[options.length - 1]}`;
}
