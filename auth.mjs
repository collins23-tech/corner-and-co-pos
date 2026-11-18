import {
  checkLoginLock,
  clearLoginFailures,
  clearSessionCookie,
  errorResponse,
  hasValidSession,
  jsonResponse,
  parseLoginPin,
  recordLoginFailure,
  sessionCookie,
} from "./_shared/pos.mjs";

export default async (request, context) => {
  if (request.method === "GET") {
    if (!process.env.STORE_PIN || process.env.STORE_PIN.length < 8 ||
        !process.env.POS_SESSION_SECRET || process.env.POS_SESSION_SECRET.length < 32) {
      return errorResponse("The store has not finished configuring secure access.", 503);
    }
    return hasValidSession(request)
      ? jsonResponse({ authenticated: true })
      : errorResponse("PIN required.", 401);
  }

  if (request.method === "DELETE") {
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store", "Set-Cookie": clearSessionCookie },
    });
  }

  if (request.method !== "POST") {
    return errorResponse("Method not allowed.", 405, { Allow: "GET, POST, DELETE" });
  }

  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) {
    return errorResponse("Request origin is not allowed.", 403);
  }

  const ip = context.ip || "unknown";
  try {
    const retryAfter = await checkLoginLock(ip);
    if (retryAfter) return errorResponse("Too many incorrect PIN attempts. Try again later.", 429, { "Retry-After": String(retryAfter) });

    const result = await parseLoginPin(request);
    if (result.error) {
      if (result.status === 401) {
        const delay = await recordLoginFailure(ip);
        if (delay) return errorResponse("Too many incorrect PIN attempts. Try again later.", 429, { "Retry-After": String(delay) });
      }
      return errorResponse(result.error, result.status);
    }

    await clearLoginFailures(ip);
    return jsonResponse({ authenticated: true }, 200, { "Set-Cookie": sessionCookie() });
  } catch (error) {
    console.error("Register authentication failed.", error);
    return errorResponse("Could not verify the PIN. Please try again.", 500);
  }
};
