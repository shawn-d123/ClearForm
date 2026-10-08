# ClearForm

An accessible, voice-driven appointment booking form. Hackathon demo with invented data and an NHS-style layout (no real NHS branding).

The accessible experience asks **one question per screen**: the question is shown large and read aloud, you answer by speaking or typing, the answer is read back for you to confirm, and at the end the whole form is read back and only sent when you confirm.

## Run locally

No build step. Serve the folder over HTTP (ES modules need it):

```
npm run dev        # http://localhost:3000
npm test           # date / choice / NHS number parsing
```

Add `?today=2026-10-08` to the URL to fix "today" for the demo, so "next Tuesday" is predictable.

Voice input uses the browser's SpeechRecognition (Chrome, Edge, Safari). Where it is unavailable the form is fully usable by typing.

## Files

| File | Purpose |
| --- | --- |
| `form-schema.js` | The one shared field definition, `answers`, `questionFor()` |
| `forms.js` | Renders the accessible form steps; `setFieldValue`, `getFieldEl`, `showFieldError`, `clearErrors` |
| `voice.js` | `speak`, `repeatLast`, `setRate`, `listenFallback` (on-device recognition) |
| `normalize.js` | On-device parsing of dates, choices, names and NHS numbers |
| `app.js` | Controller: question loop, confirm, back, skip, review, submit |
| `relay.js` | Screens, read-back text, `readBack()`, `submit()` |

## Accessibility

Real `<label for>` on every input, choice fields in `fieldset`/`legend`, errors in text tied with `aria-describedby` and announced through `aria-live` regions, focus moved to each new question, thick yellow focus indicator, 7:1 text contrast, works with keyboard only, respects reduced motion and forced colours. "Read aloud" can be turned off for screen reader users so speech does not double up.

## Secrets

`OPENAI_API_KEY` (Phase 3) lives only in Vercel environment variables and is read only inside `/api`. Never commit it. See `.env.example`.
