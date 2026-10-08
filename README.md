# ClearForm

An accessible, voice-driven appointment booking form. Hackathon demo with invented data and an NHS-style layout (no real NHS branding).

The accessible experience asks **one question per screen**: the question is shown large and read aloud, you answer by speaking or typing, the answer is read back for you to confirm, and at the end the whole form is read back and only sent when you confirm.

Demo run sheet, pre-flight checklist and Q&A: [docs/DEMO.md](docs/DEMO.md).

## Run locally

No build step. Serve the folder over HTTP (ES modules need it):

```
npm run dev        # http://localhost:3000
npm test           # date / choice / NHS number parsing
```

Add `?today=2026-10-08` to the URL to fix "today" for the demo, so "next Tuesday" is predictable.

Add `?ai=off` to rehearse the offline fallback (browser speech recognition, no API calls).

## How it works

1. The page opens on the **broken form**: the same schema rendered with deliberate WCAG failures (no labels, mouse-only controls, colour-only choice, silent error).
2. **Accessible mode** (button, or say "accessible mode" after clicking anywhere once) hides it and takes over the screen.
3. Each question is read aloud. The spoken answer is recorded (stops on silence), sent to `/api/transcribe` (Whisper), then `/api/extract` (gpt-4o-mini, temperature 0, JSON) for that field. Every answer is read back and confirmed.
4. A longer answer is offered the whole form, so one sentence can fill several fields; they are read back together and confirmed.
5. If the API or network fails, it falls back to on-device SpeechRecognition and backs off the API for 5 minutes. Typing always works.
6. Missing required answers are announced specifically (live region + speech), with a GOV.UK error summary on the review screen.
7. The whole form is read back; it submits only on "submit" or the Confirm and send button.

## Deploy

Pushing to `main` deploys to Vercel. Set `OPENAI_API_KEY` in Vercel > Project > Settings > Environment Variables; the OpenAI account needs credit. `GET /api/extract` returns `{ ready }` (or `{ ready: false, reason }`, e.g. `credit_balance_exhausted`) after a tiny test call to the model, cached for 2 minutes.

Voice input uses the browser's SpeechRecognition (Chrome, Edge, Safari). Where it is unavailable the form is fully usable by typing.

## Files

| File | Purpose |
| --- | --- |
| `form-schema.js` | The one shared field definition, `answers`, `questionFor()` |
| `forms.js` | Renders the broken form and the accessible form steps; `setFieldValue`, `getFieldEl`, `showFieldError`, `clearErrors` |
| `voice.js` | Speech out, recording with stop-on-silence, `transcribe`, `extract`, `listenFallback`, `onVoiceTrigger`, thinking cue |
| `api/transcribe.js` | Audio to text with Whisper |
| `api/extract.js` | Transcript to validated field values with gpt-4o-mini |
| `normalize.js` | On-device parsing of dates, choices, names and NHS numbers |
| `app.js` | Controller: question loop, confirm, back, skip, review, submit |
| `relay.js` | Screens, read-back text, `readBack()`, `submit()` |

## Accessibility

Real `<label for>` on every input, choice fields in `fieldset`/`legend`, errors in text tied with `aria-describedby` and announced through `aria-live` regions, focus moved to each new question, thick yellow focus indicator, 7:1 text contrast, works with keyboard only, respects reduced motion and forced colours. "Read aloud" can be turned off for screen reader users so speech does not double up.

## Secrets

`OPENAI_API_KEY` (Phase 3) lives only in Vercel environment variables and is read only inside `/api`. Never commit it. See `.env.example`.
