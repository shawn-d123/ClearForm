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
