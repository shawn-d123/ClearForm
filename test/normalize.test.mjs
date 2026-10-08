import { parseDate, matchChoice, tidyNhsNumber, tidyName, isYes, isNo, commandIn } from "../normalize.js";
const T = "2026-10-08"; // Thursday
const cases = [
  ["12 March 1985", false, "1985-03-12"], ["12/03/1985", false, "1985-03-12"],
  ["the 12th of March 1985", false, "1985-03-12"], ["March 12th, 1985", false, "1985-03-12"],
  ["twenty first of june 1990", false, "1990-06-21"], ["31/02/1990", false, null],
  ["12 March", false, null], ["20 October", true, "2026-10-20"], ["1 January", true, "2027-01-01"],
  ["tomorrow", true, "2026-10-09"], ["next Tuesday", true, "2026-10-13"], ["Thursday", true, "2026-10-15"],
  ["in 3 days", true, "2026-10-11"], ["1985-03-12", false, "1985-03-12"], ["12-3-85", false, "1985-03-12"],
  ["banana", true, null],
];
let fail = 0;
for (const [i, pf, want] of cases) { const got = parseDate(i, T, { preferFuture: pf }); if (got !== want) { fail++; console.log("FAIL date", i, got, want); } }
const ch = [["I'd like to see a doctor", ["GP","Nurse","Blood test"], "GP"], ["blood test please", ["GP","Nurse","Blood test"], "Blood test"],
  ["the nurse", ["GP","Nurse","Blood test"], "Nurse"], ["morning please", ["Morning","Afternoon"], "Morning"], ["second", ["Morning","Afternoon"], "Afternoon"], ["pizza", ["Morning","Afternoon"], null]];
for (const [i, o, want] of ch) { const got = matchChoice(i, o); if (got !== want) { fail++; console.log("FAIL choice", i, got, want); } }
const misc = [[tidyNhsNumber("485 777 3456"), "485 777 3456"], [tidyNhsNumber("four eight five 7773456"), "485 777 3456"], [tidyNhsNumber("123"), null],
  [tidyName("my name is jane smith"), "Jane Smith"], [tidyName("Mary O'Brien-Jones"), "Mary O'Brien-Jones"], [tidyName("Jane Smith."), "Jane Smith"], [isYes("yes that's right"), true], [isYes("no"), false], [isNo("no change it"), true], [commandIn("Go back."), "back"], [commandIn("skip"), "skip"]];
misc.forEach(([g, w], i) => { if (g !== w) { fail++; console.log("FAIL misc", i, g, w); } });
console.log(fail ? `${fail} failures` : "all normalize tests pass");
