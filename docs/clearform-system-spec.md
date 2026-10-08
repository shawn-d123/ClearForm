# ClearForm: full system spec and build plan

*Working name, swap freely. The accessible form, done right.*

CodeForAll Challenge. Track: Blind / Low Vision. All data and forms invented. NHS-style layout only, no real NHS branding or logos.

This is the complete reference for the team to build from: the idea, the honest positioning, the architecture, the APIs, the data, the two features, the user flows, the reliability plan, the known issues, the build plan and the demo.

---

## 1. What ClearForm is

A blind or low vision person needs to book an appointment on a form that is unusable with a screen reader: unlabelled fields, a silent red-box error, an unreachable date picker. ClearForm lets them switch on an accessible mode that takes over the screen and lets them complete the same form by voice, hands-free and eyes-free, with a spoken read-back before anything is submitted.

The demo is a before and after: the same form, broken, then accessible, with the only change being that accessibility was switched on.

Three built things:
- A realistic NHS-style booking form with specific accessibility failures engineered in (the "before").
- The accessible relay: a full-screen, voice-driven, properly built version of the same form (the "after").
- Two standout features: voice conversational filling, and spoken, specific errors.

---

## 2. The honest positioning (read this, it decides the pitch)

The category this looks like from the outside, an "accessibility overlay," is strongly rejected by the accessibility community and by blind users themselves. Overlays are held not to work, to give a "separate but equal" experience blind users do not want, and many blind users block them outright. At a Lilly accessibility event, a judge may know this. So we do not pitch "a tool that fixes broken websites."

We pitch two things that are defensible:
- **A demonstration of accessible-by-design.** The "after" is simply a properly built form. The before and after shows what should have been built from the start. We say out loud that the real fix is building forms accessibly, and bolt-on overlays are rightly criticised.
- **A user-controlled voice assistant.** The user chooses to switch it on and drives it by voice. It does something a screen reader cannot: it holds a conversation and fills the form for them.

Name the overlay criticism yourself in the pitch before a judge does. Knowing the biggest debate in this space is a credibility win.

---

## 3. Scope and the one moment

The hero moment, which we open and close on: Maya meets a form she cannot use, switches on accessible mode, and books her appointment entirely by voice, eyes shut, start to finish.

Core first. The before and after plus one-question-at-a-time voice filling is the whole demo. Everything else is layered on only once that is solid.

---

## 4. Architecture

A single web page with a thin backend, all on Vercel.

- **Frontend (static):** one page holding the broken form, the accessible relay, and the voice UI. Plain HTML, CSS and JavaScript, no framework.
- **Backend (Vercel serverless functions):** two small endpoints that hold the API keys and call the AI services. The browser never sees a key.
  - `/api/transcribe` takes recorded audio, calls Whisper, returns text.
  - `/api/extract` takes the transcript and the form's fields, calls a fast model, returns which fields to fill with what values.
- **Speech out:** the browser's built-in Web Speech synthesis. Free and instant, no network.

The flow of one spoken answer: record audio in the browser, send to `/api/transcribe`, get clean text, send that text with the field list to `/api/extract`, get back structured values, fill the fields, read them back.

---

## 5. The form schema (one source of truth)

One definition drives everything: the broken form, the accessible form, the spoken questions, and the AI extraction. Lock it first.

```js
fields = [
  { id: "fullName", label: "Full name", type: "text",   required: true },
  { id: "dob",      label: "Date of birth", type: "date", required: true },
  { id: "nhsNo",    label: "NHS number", type: "text",   required: false },
  { id: "apptType", label: "Appointment type", type: "choice",
      options: ["GP", "Nurse", "Blood test"], required: true },
  { id: "date",     label: "Preferred date", type: "date", required: true },
  { id: "time",     label: "Preferred time", type: "choice",
      options: ["Morning", "Afternoon"], required: true },
  { id: "reason",   label: "Reason for appointment", type: "text", required: false }
]

answers = { fullName: "", dob: "", ... }   // filled as we go
```

---

## 6. The two forms

### The broken "before" (engineered failures, each a named WCAG point)

Build these deliberately so the contrast is concrete:
- Placeholder-only fields, no real labels, so a screen reader announces nothing. (This is the single most common real-world failure.)
- A choice field as an unlabelled custom dropdown a screen reader cannot describe.
- A date as a visual-only picker with no keyboard or screen-reader path.
- An error shown only as a red outline, no text.
- Light grey text on white, tiny font, cramped layout.

### The accessible "after" (what good looks like)

- Every field has a visible label programmatically tied to it, never placeholder-only.
- Related options grouped with fieldset and legend.
- Required fields marked so they are announced.
- Errors identified in text, marked with aria-invalid, announced through a live region, with a summary at the top and focus moved to it on submit (the GOV.UK Design System error summary pattern).
- Fully keyboard operable, visible focus, logical order.
- Contrast at least 4.5:1, large text, never colour alone.
- autocomplete on personal fields.

The relay itself must obey all of this too. Do not build an inaccessible accessibility tool.

---

## 7. The two features

### Feature A: voice conversational filling

**Core (must have): one question at a time.** The relay asks a field aloud ("What is your full name?"), the user speaks, the answer is transcribed, interpreted, filled, and read back. Move to the next field. At the end, read the whole form back and submit on confirmation.

The AI does the part that is otherwise fragile: turning messy speech into a clean value. "Third of march nineteen ninety two" becomes a proper date, "gee pee" becomes "GP". Without this, raw speech-to-text is too unreliable to demo.

**Stretch (the jaw-dropper): one natural sentence fills several fields.** The user says "I'm Maya Patel, date of birth third of March 1992, I need a GP appointment next Tuesday afternoon," and multiple fields fill at once, then a read-back. Same `/api/extract` call, just returning several fields. Only reach for this once the core is solid.

**Extraction approach.** `/api/extract` sends the model the field list and the transcript, and asks for JSON mapping field ids to values, filling only what it is confident about and normalising dates, times and choices to the allowed options. Use structured output or JSON mode, low temperature.

```
System: You map a user's spoken words onto form fields. Return JSON only,
{ fieldId: value }, for fields you can fill confidently. Normalise dates to
YYYY-MM-DD, map choices to the exact allowed options, leave anything unclear out.
Input: fields = [...], transcript = "..."
```

### Feature B: spoken, specific errors

The broken form shows a silent red outline. The accessible one speaks the exact problem through a live region: "Your date of birth is missing, please add it." Cheap once the speech layer exists, maps straight to a named WCAG failure, and lands hard because the room just felt the silent version.

---

## 8. APIs and dependencies

| Piece | Tool | Why | Notes |
|---|---|---|---|
| Transcription (speech to text) | OpenAI Whisper API | Far more accurate than browser speech, especially names, dates, accents, noisy rooms | Called from `/api/transcribe`. Short clips, fast |
| Field extraction | A fast model (OpenAI gpt-4o-mini or Claude Haiku) | Turns messy speech into clean field values, and parses one sentence into many fields | Called from `/api/extract`. Low temperature, JSON output |
| Speech out | Web Speech API `speechSynthesis` | Free, instant, no network, works offline | Start from a user tap. Slightly slow rate |
| Audio capture | MediaRecorder (built in) | Records the user's answer to send to Whisper | Needs mic permission, pre-grant it |
| Fallback speech in | Web Speech `SpeechRecognition` | Free offline path if the API or wifi fails | Less accurate, but keeps the demo alive |
| Hosting + backend | Vercel (static site + serverless functions) | Gives HTTPS for the mic, and a safe place for the API keys | Keys as environment variables, never in the browser |

Keep both API keys as Vercel environment variables. The browser calls your own `/api/...` routes, those routes call OpenAI or Anthropic. Simplest single-vendor setup is OpenAI for both Whisper and extraction, one key, one SDK. Use Claude for extraction instead if you prefer, the credits cover either.

---

## 9. User flows

Trigger by voice ("turn on accessible mode") as the showpiece, with a large fixed "Accessible mode" button as the reliable fallback. The app speaks on every change.

**The before and after (the demo flow)**
1. The NHS-style form is full-screen and normal, the small Accessible mode button sits in a corner.
2. Show it breaking: turn on a real screen reader (or narrate) and hit the unlabelled fields, the mystery dropdown, the unreachable date picker, the silent error. Let it feel frustrating.
3. The turn: Maya says "turn on accessible mode," or you tap the button. The relay expands to full screen and announces itself ("Accessible mode on. Booking an appointment. Question one of five.").
4. Voice filling, eyes shut: each field asked aloud, answered by voice, interpreted, filled, read back.
5. Spoken errors: if a required field is missed, it says exactly what is wrong.
6. Read-back and submit: "Here is what I am about to submit," then confirm.
7. Land it: same form, same fields, same person, the only change was switching accessibility on.

---

## 10. Reliability plan (this is why we are using the APIs)

The point of the credits is a demo that does not stumble on voice. Protect it:
- **Keys stay server-side.** Vercel environment variables, called only from `/api` routes. Never in client code.
- **Fast models, short audio.** Use a small fast model for extraction and keep recorded clips short, so each answer returns quickly.
- **Cover the pause.** A network round trip per answer is a second or two. Play a soft "thinking" cue so it is not dead air, and say "got it" on return.
- **Graceful fallback.** If the API or the wifi fails, fall back to browser speech recognition and take the raw transcript as the answer, or let the user type. The one-question flow still works without the AI, just less polished. Build this path, do not treat it as optional.
- **Read-back is the safety net.** Any transcription or extraction mistake is caught when the form is read back before submit. Only fill fields the model is confident about.
- **Pre-test on the venue wifi.** The AI path needs the network. Test it on the actual connection in the morning, and rehearse the fallback so a bad connection is a non-event.

---

## 11. Potential issues and mitigations

| Issue | Why it matters | Mitigation |
|---|---|---|
| API keys exposed | A key in client code is a security hole and can be abused | Serverless proxy, keys in Vercel env vars |
| Venue wifi flaky | The AI path needs the network | Browser-speech and typed fallbacks, pre-test, rehearse the fallback |
| Latency per answer | A dead pause feels broken | Fast model, short clips, a "thinking" cue, "got it" on return |
| Speech mistakes on names and dates | Wrong data submitted | Whisper plus model normalisation, and the read-back confirm catches the rest |
| Model fills a field wrongly | Hallucinated value | Low temperature, structured output, fill only confident fields, confirm before submit |
| Mic or audio blocked | Browsers block both until a gesture, and mic needs permission | Tap-to-begin gate, pre-grant the mic |
| Looks like an overlay | Informed judges reject overlays | The framing in section 2, name the criticism first |
| The tool itself inaccessible | Ironic and loses marks | The relay obeys the same WCAG rules as the "after" form |
| Double-speaking | Our speech plus a running screen reader | Demo with the screen reader off, keep markup labelled |
| Scope creep | The classic killer | Core first, freeze at 14:00, protect rehearsal |

---

## 12. Build plan

### Build order (core first)
1. The form schema and the two form renders, broken and accessible. Half an hour on the schema, then the forms.
2. Web Speech synthesis working (the app can talk).
3. The Vercel functions: `/api/transcribe` and `/api/extract`, tested with a hardcoded clip and transcript.
4. One-question voice flow end to end: record, transcribe, extract, fill, read back. The hero path.
5. Spoken errors through a live region.
6. The full-screen takeover, the voice and button triggers, the before-to-after transition.
7. Stretch: the natural-sentence multi-field fill. Polish, high contrast, large text.

### Team split (3 people)
- **P1, Forms and accessibility.** The schema, both form renders, all the WCAG work: labels, groups, live-region errors, contrast, keyboard. Owns the before and after.
- **P2, Voice and AI.** MediaRecorder capture, the two Vercel functions, Whisper and the extraction model, speech out, the triggers, and the fallbacks. Owns the deploy and the reliability plan.
- **P3, Relay experience and flow.** The full-screen takeover, the conversational flow, read-back, wiring answers to fields, the error UX, and the integration glue. Owns the slides and demo script.

### The day (judging starts 15:30, not 17:00)
- **Before the day:** repo cloned by all, one test push each, Node and agents working, Vercel project created with both API keys set as environment variables, stack locked.
- **09:50 to 10:00:** lock the schema and the function contracts together.
- **10:00 to 12:00:** build phase 1, the core only. Target by 12:00: broken and accessible forms, and one-question voice fill working on the deployed URL.
- **12:45 to 13:00:** standup, is the core solid? If yes, green-light extras.
- **13:00 to 14:00:** spoken errors, the takeover and triggers, then the stretch sentence-fill if there is time.
- **14:00:** feature freeze. Integrate, test on the real device over the venue wifi, rehearse the full 8 minutes twice, eyes shut, and the fallback path once.
- **15:30:** judging.

---

## 13. The demo and run sheet

| Time | Segment | What happens |
|---|---|---|
| 0:00 to 1:00 | The problem | Maya meets a form she cannot use. Name the barrier |
| 1:00 to 1:45 | Why it is real | Unlabelled forms are a top accessibility failure, and the overlay "fix" is rejected by blind users. We did it properly |
| 1:45 to 2:30 | What ClearForm is | The before and after, and voice filling |
| 2:30 to 5:30 | Live demo, eyes shut | Screen-read the broken form failing, switch on accessible mode, fill it by voice, hit a spoken error, read back, submit |
| 5:30 to 6:30 | Why it fits | On brief, accessibility first, and positioned against overlays |
| 6:30 to 7:00 | Impact and next | Hands-free helps far more than blind users, and in production it informs accessible-by-design |
| 7:00 to 7:45 | Close | Same form, same person, accessibility switched on |
| 7:45 to 8:00 | Buffer | Into questions |

**Q&A to have ready**
- "Isn't this an overlay?" No. Overlays auto-patch any site and are rejected by blind users. This is a user-driven assistant and a demonstration of accessible-by-design. The real fix is building forms properly, which our "after" shows.
- "Does it work on real sites?" We built our own form to prove the flow end to end and keep it reliable. The same approach applies to real forms, and the honest long-term answer is fixing them at source.
- "What if the internet is down?" It falls back to on-device speech, and the read-back still protects accuracy.

---

## 14. Ground rules

Invented data and an NHS-style form only, no real NHS branding and no real personal data. API keys live only in Vercel environment variables. The accessible relay is itself fully accessible. And the framing holds throughout: this is accessible-by-design and a user-driven assistant, not an overlay.
