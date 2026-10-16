// Thin proxy: filtering, pagination and normalization belong to the app.
const SOS_ENDPOINT = "https://api.artdatabanken.se/species-observation-system/v1/observations/search";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Api-Version, X-Requesting-System",
  "Access-Control-Expose-Headers": "Retry-After",
};
function errorResponse(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (request.method !== "POST") return errorResponse(405, "Endast POST-anrop tillåts.");
    const apiKey = env.ARTPORTALEN_API_KEY?.trim();
    if (!apiKey) return errorResponse(500, "Artfyndstjänsten är inte konfigurerad.");
    const incoming = new URL(request.url);
    const upstream = new URL(SOS_ENDPOINT);
    for (const name of ["skip", "take", "translationCultureCode"]) {
      const values = incoming.searchParams.getAll(name);
      if (values.length > 1) return errorResponse(400, "Dubblerad queryparameter.");
      if (values.length) upstream.searchParams.set(name, values[0]);
    }
    for (const name of ["skip", "take"]) {
      const value = upstream.searchParams.get(name);
      if (value !== null && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))
        || (name === "take" && (Number(value) < 1 || Number(value) > 500)))) {
        return errorResponse(400, "Ogiltig sidindelning.");
      }
    }
    let body;
    try {
      body = await request.text();
      const parsed = JSON.parse(body);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    } catch {
      return errorResponse(400, "Body måste vara ett JSON-objekt.");
    }
    // Never forward client credentials or an arbitrary target.
    const headers = new Headers({ "Content-Type": "application/json", "Ocp-Apim-Subscription-Key": apiKey });
    for (const name of ["X-Api-Version", "X-Requesting-System"]) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.signal.addEventListener("abort", abort);
    if (request.signal.aborted) controller.abort();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 25000);
    try {
      const response = await fetch(upstream.toString(), {
        method: "POST", headers, body, signal: controller.signal, redirect: "manual",
      });
      // Read within the timeout without parsing or reshaping SLU's response.
      const bytes = await response.arrayBuffer();
      const responseHeaders = new Headers(CORS_HEADERS);
      for (const name of ["Content-Type", "Retry-After"]) {
        const value = response.headers.get(name);
        if (value !== null) responseHeaders.set(name, value);
      }
      return new Response([204, 205, 304].includes(response.status) ? null : bytes, {
        status: response.status, statusText: response.statusText, headers: responseHeaders,
      });
    } catch {
      return errorResponse(timedOut ? 504 : 502, timedOut
        ? "Artportalen svarade inte i tid." : "Kunde inte nå Artportalen.");
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", abort);
    }
  },
};
