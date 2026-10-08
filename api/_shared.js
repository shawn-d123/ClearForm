// Shared guards for the /api functions. Files starting with "_" are not
// deployed as routes by Vercel.

/**
 * Only accept calls from our own page. Not real auth, but it stops the
 * endpoints (and the key's credit) being used directly from other sites.
 */
export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin GETs and server tools omit Origin
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export function hasKey() {
  return Boolean(process.env.OPENAI_API_KEY);
}

/**
 * Why an OpenAI call failed, safe to return to the browser: the HTTP status
 * and OpenAI's error code (e.g. invalid_api_key, insufficient_quota). Never
 * the message, which can echo part of the key.
 */
export function upstreamReason(err) {
  return { upstreamStatus: err?.status ?? null, upstreamCode: err?.code ?? err?.error?.code ?? null };
}
