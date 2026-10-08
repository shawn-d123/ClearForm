// On-device normalisation of typed or spoken answers. This is what makes the
// form work with no network at all, and it is the offline fallback once the
// AI extraction lands in Phase 3.

const MONTHS = ["january", "february", "march", "april", "may", "june", "july",
  "august", "september", "october", "november", "december"];
const MONTH_ABBR = MONTHS.map((m) => m.slice(0, 3));
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const ORDINAL_WORDS = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13,
  fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18,
  nineteenth: 19, twentieth: 20, thirtieth: 30,
};
const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, a: 1, an: 1,
};

// --- dates -----------------------------------------------------------------

function iso(y, m, d) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseIso(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toIso(date) {
  return iso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function addDays(date, n) {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

function isRealDate(y, m, d) {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2100)) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function expandYear(y, todayYear) {
  if (y >= 100) return y;
  const pivot = todayYear % 100;
  return y <= pivot ? 2000 + y : 1900 + y;
}

function monthIndex(word) {
  const w = word.toLowerCase().replace(/\.$/, "");
  let i = MONTHS.indexOf(w);
  if (i === -1) i = MONTH_ABBR.indexOf(w.slice(0, 3));
  if (i === -1 || (w.length > 3 && !MONTHS[i].startsWith(w))) return -1;
  return i;
}

// Turn "twenty first" into "21", "the third" into "3" and so on, so the
// structured patterns below can match speech recognition output.
function wordsToNumbers(s) {
  return s
    .replace(/\b(twenty|thirty)[\s-]+(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|one)\b/g,
      (_, tens, unit) => String((tens === "twenty" ? 20 : 30) + (ORDINAL_WORDS[unit] || NUMBER_WORDS[unit])))
    .replace(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth)\b/g,
      (w) => String(ORDINAL_WORDS[w]));
}

/**
 * Parse a typed or spoken date into YYYY-MM-DD, or return null.
 * UK order (day first) for numeric dates.
 * preferFuture: a date with no year resolves to its next occurrence.
 */
export function parseDate(input, todayIso, { preferFuture = false } = {}) {
  if (!input) return null;
  const today = parseIso(todayIso);
  const ty = today.getUTCFullYear();

  let s = wordsToNumbers(String(input).toLowerCase().trim())
    .replace(/[,]/g, " ")
    .replace(/\b(\d{1,2})(st|nd|rd|th)\b/g, "$1")
    .replace(/\b(the|of|on|in the year)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Relative dates
  if (/^today$/.test(s)) return todayIso;
  if (/^tomorrow$/.test(s)) return toIso(addDays(today, 1));
  if (/^(the )?day after tomorrow$/.test(s)) return toIso(addDays(today, 2));
  let m = s.match(/^in (\d+|one|two|three|four|five|six|seven|eight|nine|ten|a|an) (day|days|week|weeks)$/);
  if (m) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1]];
    return toIso(addDays(today, m[2].startsWith("week") ? n * 7 : n));
  }
  if (/^next week$/.test(s)) return toIso(addDays(today, 7));
  m = s.match(/^(next|this|coming)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)( next week)?$/);
  if (m) {
    const target = DAYS.indexOf(m[2]);
    let diff = (target - today.getUTCDay() + 7) % 7;
    if (diff === 0) diff = 7; // "Tuesday" said on a Tuesday means next week
    if (m[3]) diff += 7;
    return toIso(addDays(today, diff));
  }

  // ISO 1985-03-12
  m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return isRealDate(+m[1], +m[2], +m[3]) ? iso(+m[1], +m[2], +m[3]) : null;

  // 12/03/1985, 12-3-85, 12.03.1985, "12 3 1985"
  m = s.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2}|\d{4})$/);
  if (m) {
    const y = expandYear(+m[3], ty);
    return isRealDate(y, +m[2], +m[1]) ? iso(y, +m[2], +m[1]) : null;
  }

  // 12 March 1985, March 12 1985, 12 March, March 12, "March 12 85"
  let day, month = -1, year = null;
  m = s.match(/^(\d{1,2}) ([a-z.]+)(?: (\d{2}|\d{4}))?$/);
  if (m && monthIndex(m[2]) !== -1) { day = +m[1]; month = monthIndex(m[2]); year = m[3]; }
  if (month === -1) {
    m = s.match(/^([a-z.]+) (\d{1,2})(?: (\d{2}|\d{4}))?$/);
    if (m && monthIndex(m[1]) !== -1) { day = +m[2]; month = monthIndex(m[1]); year = m[3]; }
  }
  if (month === -1) return null;

  if (year) {
    const y = expandYear(+year, ty);
    return isRealDate(y, month + 1, day) ? iso(y, month + 1, day) : null;
  }
  if (!preferFuture) return null; // a date of birth needs a year
  let y = ty;
  if (iso(y, month + 1, day) < todayIso) y += 1;
  return isRealDate(y, month + 1, day) ? iso(y, month + 1, day) : null;
}

export function formatDateLong(isoDate) {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate || "";
  const d = parseIso(isoDate);
  const month = MONTHS[d.getUTCMonth()];
  return `${d.getUTCDate()} ${month[0].toUpperCase()}${month.slice(1)} ${d.getUTCFullYear()}`;
}

export function weekdayName(isoDate) {
  const d = DAYS[parseIso(isoDate).getUTCDay()];
  return d[0].toUpperCase() + d.slice(1);
}

// --- choices ---------------------------------------------------------------

const SYNONYMS = {
  "gp": ["gp", "g p", "g.p.", "gee pee", "jeep", "doctor", "doctors", "general practitioner", "physician"],
  "nurse": ["nurse", "nursing", "practice nurse"],
  "blood test": ["blood test", "blood", "bloods", "blood sample", "blood work"],
  "morning": ["morning", "am", "a.m.", "a m", "before noon", "before lunch", "early"],
  "afternoon": ["afternoon", "pm", "p.m.", "p m", "after lunch", "after noon", "later in the day"],
};
const POSITION_WORDS = [
  ["first", "one", "1", "number one", "option one"],
  ["second", "two", "2", "number two", "option two"],
  ["third", "three", "3", "number three", "option three"],
];

function hasPhrase(text, phrase) {
  const esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`).test(text);
}

/** Map free text onto one of the allowed options, or return null. */
export function matchChoice(input, options) {
  if (!input) return null;
  const text = String(input).toLowerCase().trim();
  const hits = options.filter((opt) => {
    const words = SYNONYMS[opt.toLowerCase()] || [opt.toLowerCase()];
    return words.some((w) => hasPhrase(text, w));
  });
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    // "blood test with the nurse" is ambiguous; prefer an exact option name.
    const exact = hits.filter((opt) => hasPhrase(text, opt.toLowerCase()));
    return exact.length === 1 ? exact[0] : null;
  }
  for (let i = 0; i < options.length && i < POSITION_WORDS.length; i++) {
    if (POSITION_WORDS[i].some((w) => text === w || text === `the ${w}` || text === `the ${w} one`)) {
      return options[i];
    }
  }
  return null;
}

// --- text fields -----------------------------------------------------------

export function tidyText(input) {
  // Whisper punctuates ("Jane Smith."); a form value shouldn't end in a full stop.
  return String(input || "").replace(/\s+/g, " ").trim().replace(/[\s.,!?;:]+$/, "");
}

export function tidyName(input) {
  const s = tidyText(input).replace(/^(my name is|my name's|i am|i'm|it's|it is|name is)\s+/i, "");
  // Speech recognition often returns lower case; typed names keep their casing.
  if (s && s === s.toLowerCase()) {
    return s.replace(/(^|[\s'-])([a-z])/g, (_, p, c) => p + c.toUpperCase());
  }
  return s;
}

/** NHS numbers: keep 10 digits as "485 777 3456". Returns null if not 10 digits. */
export function tidyNhsNumber(input) {
  const digits = String(input || "")
    .toLowerCase()
    .replace(/\b(zero|oh|o)\b/g, "0").replace(/\bone\b/g, "1").replace(/\btwo\b/g, "2")
    .replace(/\bthree\b/g, "3").replace(/\bfour\b/g, "4").replace(/\bfive\b/g, "5")
    .replace(/\bsix\b/g, "6").replace(/\bseven\b/g, "7").replace(/\beight\b/g, "8")
    .replace(/\bnine\b/g, "9")
    .replace(/\D/g, "");
  if (digits.length !== 10) return null;
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
}

// --- spoken intents --------------------------------------------------------

export function isYes(text) {
  return /\b(yes|yeah|yep|yup|correct|right|that's right|that is right|confirm|ok|okay|sure|affirmative|submit|send it|go ahead)\b/i.test(text || "")
    && !isNo(text);
}

export function isNo(text) {
  return /\b(no|nope|wrong|incorrect|not right|change|change it|redo|try again)\b/i.test(text || "");
}

/** Navigation commands that can be spoken at any question. */
export function commandIn(text) {
  const t = tidyText(text).toLowerCase().replace(/[.!?]$/, "");
  if (/^(repeat|repeat that|say that again|again|pardon|what)$/.test(t)) return "repeat";
  if (/^(back|go back|previous|previous question|last question)$/.test(t)) return "back";
  if (/^(skip|skip it|skip this|skip question|skip this question|next|pass|none|no thanks)$/.test(t)) return "skip";
  return null;
}
