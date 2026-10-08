// POST /api/transcribe  { audioBase64, mimeType? }  ->  { text }
// Audio in, Whisper, text out. The key is read here and never leaves the server.

import OpenAI, { toFile } from "openai";
import { sameOrigin, hasKey } from "./_shared.js";

const MAX_BASE64 = 3_000_000; // ~2 MB of audio; answers are a few seconds

// Biases Whisper towards the words this form expects.
const PROMPT = "Booking a GP surgery appointment. GP, nurse, blood test, morning, afternoon, NHS number, date of birth.";

const EXT = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "mp4", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-m4a": "m4a" };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!sameOrigin(req)) return res.status(403).json({ error: "Forbidden" });
  if (!hasKey()) return res.status(503).json({ error: "Transcription is not configured" });

  try {
    const { audioBase64, mimeType = "audio/webm" } = req.body || {};
    if (!audioBase64 || typeof audioBase64 !== "string") return res.status(400).json({ error: "No audio provided" });
    if (audioBase64.length > MAX_BASE64) return res.status(413).json({ error: "Audio too long" });

    const baseType = String(mimeType).split(";")[0].trim();
    const ext = EXT[baseType] || "webm";
    const buffer = Buffer.from(audioBase64, "base64");
    const file = await toFile(buffer, `answer.${ext}`, { type: baseType });

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const result = await client.audio.transcriptions.create({
      file,
      model: "whisper-1",
      language: "en",
      prompt: PROMPT,
      temperature: 0,
    });

    res.status(200).json({ text: (result.text || "").trim() });
  } catch (err) {
    console.error("transcribe error", err?.status, err?.message);
    res.status(502).json({ error: "Transcription failed" });
  }
}
