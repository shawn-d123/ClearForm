# ClearForm demo: run sheet

Live URL: https://clearform-nine.vercel.app/?today=2026-10-08

`?today=2026-10-08` fixes the clock so "next Tuesday" is always Tuesday 13 October 2026. Add `&ai=off` to run on the on-device fallback only.

---

## Pre-flight (morning of, on the demo laptop and the venue wifi)

1. Chrome, latest. Open the URL. Allow the microphone when asked (or pre-grant: padlock icon > Site settings > Microphone > Allow).
2. Check the AI is live: open `https://clearform-nine.vercel.app/api/extract`. It must say `{"ready":true}`. If it says `credit_balance_exhausted`, top up the OpenAI account; if `invalid_api_key`, fix the key in Vercel.
3. Click **Accessible mode**. Under the Speak answer button it should say **Voice input: enhanced (online)**. "On-device" means the AI is down and you are on the fallback.
4. Laptop volume up, notifications off, screen reader off for the "after" (it would talk over the app).
5. Rehearse the fallback once with `&ai=off` so a bad connection is a non-event.
6. Reload the page before going on stage (fresh state).

---

## The 8 minutes

| Time | Segment | What to do and say |
|---|---|---|
| 0:00–1:00 | The problem | Maya is blind and needs a GP appointment. This is the surgery's booking form. |
| 1:00–1:45 | Why it is real | Unlabelled forms are among the most common accessibility failures on the web. And the usual "fix", the accessibility overlay, is rejected by blind users themselves. We did it properly instead. |
| 1:45–2:30 | Show it breaking | Screen reader on (NVDA or VoiceOver). Tab through the broken form (see "What breaks" below). Click Submit: red outlines, silence. Screen reader off. |
| 2:30–5:30 | The turn, eyes shut | Say "accessible mode" (or press the button). The screen takes over and talks. Answer by voice. Show one mistake being corrected ("no"), one spoken error (press Continue on an empty answer), the full read-back, then "submit". |
| 5:30–6:30 | Why it fits | Accessible-by-design: the "after" is just a properly built form. User-driven: Maya switches it on and drives it by voice. |
| 6:30–7:00 | Impact and next | Hands-free helps far more than blind users (motor impairments, low literacy, injury). In production this informs building the form right, at source. |
| 7:00–7:45 | Close | Same form, same fields, same person. The only change was switching accessibility on. |
| 7:45–8:00 | Buffer | Into questions. |

### Two ways to run the voice segment

**Steady (recommended first time):** one answer per question.
"Maya Patel" → yes → "third of March nineteen ninety two" → yes → "skip" → "I need to see a doctor" → yes → "next Tuesday" → yes → "after lunch" → yes → "it's about my knee" → yes → listen to the read-back → "submit".

**Jaw-dropper (AI must be online):** on question 1 say the whole thing:
"I'm Maya Patel, born third of March nineteen ninety two, and I need a GP appointment next Tuesday afternoon about my knee."
It reads back six answers at once → "yes" → it asks only the NHS number → "skip" → read-back → "submit".

### Showing a spoken error

On any required question, press **Continue** with the box empty (or tab to it). It says, shows and announces: "Your full name is missing. Please add it." Contrast with the broken form's silent red outline.

---

## What breaks on the "before" form (and the WCAG criterion)

| Failure | What the screen reader does | WCAG |
|---|---|---|
| No labels, only grey text painted over the inputs | "Edit text", "edit text", "edit text": no idea which is which | 1.3.1, 3.3.2, 4.1.2 |
| Appointment type is a fake dropdown made of divs | Cannot be reached with Tab at all | 2.1.1, 4.1.2 |
| Date of birth and preferred date are mouse-only calendars | Cannot be reached or operated by keyboard | 2.1.1 |
| AM/PM choice shown only by a slightly darker grey | No way to tell which is selected | 1.4.1 |
| Submit is a div, not a button | Cannot be reached with Tab | 2.1.1 |
| Error is a red outline only | Nothing is announced; nothing in text | 3.3.1, 4.1.3 |
| Light grey 11px text, cramped | Fails contrast (about 2:1) and resize | 1.4.3, 1.4.4 |

## What the "after" does right

Real `<label for>` on every input, the question as the visible label (what you hear is what you see). Choice questions in `fieldset` + `legend`. Errors in text, tied with `aria-describedby`, `aria-invalid`, announced through a live region and spoken; GOV.UK error summary with focus moved to it. Focus moves to each new question. Fully keyboard operable, thick yellow-and-black focus ring, 7:1 contrast, large type, never colour alone, respects reduced motion and Windows high contrast. "Read aloud" can be switched off for screen reader users, and Exit hands control back.

---

## Q&A

**"Isn't this an overlay?"** No. Overlays auto-patch other people's sites and are rejected by blind users because they don't work and give a separate experience. This is a user-driven assistant that the user switches on, and a demonstration of accessible-by-design: our "after" is simply a properly built form. The real fix is building forms properly at source.

**"Does it work on real sites?"** We built our own form to prove the flow end to end and keep the demo reliable. The approach applies to any form with a schema, and the honest long-term answer is fixing forms at source.

**"What if the internet is down?"** It falls back to on-device speech recognition automatically, and typing always works. The read-back still catches mistakes before anything is sent.

**"What stops the AI getting it wrong?"** Temperature 0, JSON output, fill only confident fields, every value validated against the allowed options and real dates on the server and again in the browser, and every answer read back for a yes or no before it is kept. The whole form is read back again before submit.

**"Where is the API key?"** Only in Vercel environment variables, read only by the two serverless functions. It never reaches the browser.

**"Is the data real?"** No. Invented data, NHS-style layout, no real NHS branding, and nothing is actually sent.

---

## If something goes wrong on stage

| Symptom | Do this |
|---|---|
| "Sorry, I lost my connection" | Just answer again: it has switched to on-device speech. Carry on. |
| It doesn't hear you | Press **Speak answer** (or "Done speaking" to stop early). Or type: it works exactly the same. |
| It misheard | Say "no" at the read-back, and answer again. That's the safety net, show it off. |
| Voice trigger doesn't fire | Press the **Accessible mode** button. Voice is the flourish, the button is the reliable path. |
| Anything stuck | Press Escape (stops speech and listening), then **Repeat**. Worst case: reload. |
