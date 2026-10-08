# ClearForm: the contract

The single source of truth for how the three parts fit together. Freeze this in the first ten minutes. If something here needs to change, change it here first and tell everyone.

Read this alongside your primer and `clearform-BUILD.md` (which has the real starter code). This file says how the parts meet.

---

## The positioning everyone must know (it decides the pitch)

From the outside this looks like an "accessibility overlay," a category the accessibility community and blind users strongly reject, because overlays give a "separate but equal" experience and mostly do not work. So we never pitch "a tool that fixes broken websites." We pitch two defensible things:

- A demonstration of accessible-by-design. The "after" is simply a properly built form. The real fix is building forms accessibly, and we say so.
- A user-controlled voice assistant. The user switches it on and drives it by voice, and it does what a screen reader cannot: holds a conversation and fills the form.

Name the overlay criticism yourself before a judge does. And one build rule follows from this: the relay must be as accessible as the form it fixes. Do not build an inaccessible accessibility tool.

---

## Who owns what

Three people, three lanes, split so you each mostly edit your own files.

- **Person 1, Forms and Accessibility.** The schema, both form renders (broken and accessible), and all the WCAG work. No voice, no AI.
- **Person 2, Voice and AI.** Audio capture, the two serverless functions, Whisper, extraction, speech out, the triggers, the fallbacks, and the deploy.
- **Person 3, Flow and Experience.** The full-screen takeover, the conversational loop, read-back and submit, wiring answers into the form, the error UX, and the integration. Also the slides and demo.

---

## File structure and ownership

```
/index.html          P1 (form markup) + P3 (relay container, wiring)
/styles.css          P1
/form-schema.js      P1   the one shared field definition
/forms.js            P1   renders both forms, sets values, shows errors
/voice.js            P2   speak, record, transcribe, extract, fallback, triggers
/app.js              P3   entry point, the conversational controller, wiring
/relay.js            P3   full-screen takeover, read-back, submit, error UX
/api/transcribe.js   P2   audio -> Whisper -> text
/api/extract.js      P2   transcript + fields -> model -> values
/package.json /vercel.json /.env.example /.gitignore /README.md   P2
```

Stack: plain HTML, CSS, JavaScript (ES modules) on the front, Vercel serverless functions on the back. No framework, no build step.

---

## Secrets (non-negotiable)

`OPENAI_API_KEY` lives only in Vercel environment variables and is only ever read inside `/api` functions. It never appears in client code, in the repo, or in any response body. P2 owns this.

---

## Workflow

- One repo, everyone cloned and pushing a test commit the night before.
- Vercel project created and connected before the day, with the key set.
- Branch per person, merge small and often. `main` always deploys.
- Feature freeze 14:00 (14:30 absolute latest). Judging starts 15:30, not 17:00.

---

## Frozen shapes

### The form schema (owned by P1, read by all)

```js
fields = [
  { id: "fullName", label: "Full name",            type: "text",   required: true },
  { id: "dob",      label: "Date of birth",        type: "date",   required: true },
  { id: "nhsNo",    label: "NHS number",           type: "text",   required: false },
  { id: "apptType", label: "Appointment type",     type: "choice", required: true,
      options: ["GP", "Nurse", "Blood test"] },
  { id: "date",     label: "Preferred date",       type: "date",   required: true },
  { id: "time",     label: "Preferred time",       type: "choice", required: true,
      options: ["Morning", "Afternoon"] },
  { id: "reason",   label: "Reason for appointment", type: "text", required: false },
]
answers = {}   // { fieldId: value }, filled as we go
```

### The API contracts (owned by P2)

```
POST /api/transcribe
  body: { audioBase64, mimeType? }        ->  { text }

POST /api/extract
  body: { fields, transcript, today }     ->  { values: { fieldId: value } }
    dates normalised to YYYY-MM-DD, choices mapped to allowed options,
    only confident fields returned.
```

---

## Module interfaces (exact names, do not rename)

### P1 provides

```js
// form-schema.js
export const fields;
export const answers;
export function questionFor(field);   // -> the spoken question string

// forms.js
export function renderBrokenForm(container);
export function renderAccessibleForm(container);   // full WCAG markup
export function setFieldValue(id, value);
export function getFieldEl(id);
export function showFieldError(id, message);       // via aria-describedby + live region
export function clearErrors();
```

### P2 provides

```js
// voice.js
export function speak(text, { onend });   // cancels first, then speaks, ~0.95 rate
export function repeatLast();
export function setRate(r);
export function recordAnswer();           // -> Promise<audioBase64>
export function stopRecording();
export function transcribe(audioBase64, mimeType);   // -> Promise<text>   (calls /api/transcribe)
export function extract(transcript, today);          // -> Promise<values> (calls /api/extract)
export function listenFallback();         // -> Promise<text> (on-device, no network)
export function onVoiceTrigger(phrase, cb);          // fires cb when phrase heard
```

### P3 provides

```js
// app.js / relay.js
export function startAccessibleMode();    // hides broken form, shows relay, starts the loop
// plus the question loop, readBack(), submit(), and all wiring
```

---

## How the parts talk (the canonical flow)

**One spoken answer**
1. P3 asks the field's question with `voice.speak(questionFor(field), { onend })`.
2. P3 calls `voice.recordAnswer()`, then `voice.transcribe(...)`, then `voice.extract(...)`.
3. P3 writes the result into state and the DOM with `forms.setFieldValue(id, value)` and `answers[id] = value`.
4. P3 says "got it" and moves to the next field.
5. On any failure, P3 falls back to `voice.listenFallback()` and takes the raw transcript.

**Errors:** P3 asks P1 to show them with `forms.showFieldError(id, msg)`, which announces through the live region. P3 composes the spoken version.

**Spoken lines are composed by P3**, from P1's schema, spoken by P2. P1 renders and validates, P2 moves audio and words, P3 decides what is said and when.

**The clock:** P3 passes `today` (YYYY-MM-DD) into `voice.extract` so "next Tuesday" resolves correctly. Add a way to fix `today` for the demo.

---

## Integration smoke test (must pass before 14:30, on the deployed URL)

1. The broken form visibly and audibly fails.
2. Say "accessible mode" or tap the button, the relay expands full screen and announces itself.
3. Answer each field by voice, each is transcribed, mapped, filled and confirmed.
4. A missed required field is announced specifically through the live region.
5. The whole form is read back, and submits only on confirmation.
6. Disable the API, the fallback still completes the form.
7. The relay passes a screen reader pass.
8. No key anywhere in client code or responses.

If these pass, you have a winning demo. Everything else is polish.
