const TOKEN_URL = "https://accounts.spotify.com/api/token";
const SEARCH_URL = "https://api.spotify.com/v1/search";

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 100;
const RESULT_LIMIT = 8;                 // Spotify admite hasta 10 en búsquedas
const CACHE_SECONDS = 3600;             // misma búsqueda = sin gastar cuota

// El token de la app dura 1 hora. Se reutiliza mientras el servidor siga
// vivo (en un Worker, mientras no se recicle el isolate).
let cachedToken = null;                 // { value, expiresAt }
let tokenRequest = null;                // evita pedir 2 tokens a la vez


export class SearchError extends Error {
    constructor(status, code, retryAfter) {
        super(code);
        this.status = status;
        this.code = code;
        this.retryAfter = retryAfter;
    }
}


async function requestAppToken(clientId, clientSecret) {
    const credentials = btoa(`${clientId}:${clientSecret}`);

    const response = await fetch(TOKEN_URL, {
        method: "POST",
        headers: {
            Authorization: `Basic ${credentials}`,
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: "grant_type=client_credentials"
    });

    if (!response.ok) {
        // 400/401: client id o secret incorrectos.
        throw new SearchError(500, "spotify_credentials_rejected");
    }

    const data = await response.json();

    cachedToken = {
        value: data.access_token,
        // Un minuto de margen para no usar un token a punto de caducar.
        expiresAt: Date.now() + (data.expires_in - 60) * 1000
    };

    return cachedToken.value;
}

export async function getAppToken({ clientId, clientSecret }, forceNew = false) {
    if (!forceNew && cachedToken && cachedToken.expiresAt > Date.now()) {
        return cachedToken.value;
    }

    if (!tokenRequest) {
        tokenRequest = requestAppToken(clientId, clientSecret).finally(() => {
            tokenRequest = null;
        });
    }

    return tokenRequest;
}

function mapTrack(track) {
    return {
        id: track.id,
        name: track.name,
        artists: (track.artists || []).map((artist) => ({ name: artist.name })),
        albumImage:
            track.album?.images?.[2]?.url ||
            track.album?.images?.[0]?.url ||
            "",
        durationMs: track.duration_ms || 0
    };
}

export async function searchTracks(query, credentials) {
    if (!credentials.clientId || !credentials.clientSecret) {
        throw new SearchError(500, "missing_credentials");
    }

    const url = new URL(SEARCH_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("type", "track");
    url.searchParams.set("limit", String(RESULT_LIMIT));

    const send = (token) =>
        fetch(url, { headers: { Authorization: `Bearer ${token}` } });

    let response = await send(await getAppToken(credentials));

    // Token revocado o caducado antes de tiempo: se pide otro y se repite.
    if (response.status === 401) {
        response = await send(await getAppToken(credentials, true));
    }

    if (response.status === 429) {
        throw new SearchError(
            429,
            "spotify_rate_limited",
            response.headers.get("Retry-After") || "30"
        );
    }

    if (!response.ok) {
        throw new SearchError(502, "spotify_error");
    }

    const data = await response.json();

    return (data.tracks?.items || []).map(mapTrack);
}


// Valida y limpia lo que escribe el jugador.
export function cleanQuery(raw) {
    const query = String(raw ?? "").replace(/\s+/g, " ").trim();

    if (query.length < MIN_QUERY_LENGTH || query.length > MAX_QUERY_LENGTH) {
        throw new SearchError(400, "invalid_query");
    }

    return query;
}


// -----------------------------------------------------
// Adaptador: Cloudflare Worker
//
//   en worker.js:
//     import { handleSearchRequest } from "./search-endpoint.js";
//     ...
//     if (url.pathname === "/api/search") {
//         return handleSearchRequest(request, env, ctx);
//     }
// -----------------------------------------------------

function json(body, status = 200, headers = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json; charset=utf-8", ...headers }
    });
}

export async function handleSearchRequest(request, env, ctx) {
    if (request.method !== "GET") {
        return json({ error: "method_not_allowed" }, 405, { Allow: "GET" });
    }

    const url = new URL(request.url);

    let query;

    try {
        query = cleanQuery(url.searchParams.get("q"));
    } catch (error) {
        return json({ error: error.code }, error.status);
    }

    // Caché de Cloudflare: misma búsqueda (sin importar mayúsculas) = 1 hora
    // sin llamar a Spotify. Reduce el riesgo de agotar la cuota de tu app.
    const cache = typeof caches !== "undefined" ? caches.default : null;
    const cacheKey = new Request(
        `${url.origin}/api/search?q=${encodeURIComponent(query.toLowerCase())}`
    );

    if (cache) {
        const hit = await cache.match(cacheKey);

        if (hit) return hit;
    }

    try {
        const tracks = await searchTracks(query, {
            clientId: env.SPOTIFY_CLIENT_ID,
            clientSecret: env.SPOTIFY_CLIENT_SECRET
        });

        const response = json({ tracks }, 200, {
            "Cache-Control": `public, max-age=${CACHE_SECONDS}`
        });

        if (cache) {
            const store = cache.put(cacheKey, response.clone());

            if (ctx?.waitUntil) ctx.waitUntil(store);
            else await store;
        }

        return response;
    } catch (error) {
        if (!(error instanceof SearchError)) {
            console.error("Búsqueda:", error);
            return json({ error: "search_failed" }, 502);
        }

        console.error("Búsqueda:", error.code);

        return json(
            { error: error.code },
            error.status,
            error.retryAfter ? { "Retry-After": error.retryAfter } : {}
        );
    }
}


// -----------------------------------------------------
// Adaptador: Express (servidor local de desarrollo)
//
//   import { expressSearchHandler } from "./search-endpoint.js";
//   app.get("/api/search", expressSearchHandler({
//       clientId: process.env.SPOTIFY_CLIENT_ID,
//       clientSecret: process.env.SPOTIFY_CLIENT_SECRET
//   }));
// -----------------------------------------------------

export function expressSearchHandler(credentials) {
    return async (req, res) => {
        let query;

        try {
            query = cleanQuery(req.query.q);
        } catch (error) {
            return res.status(error.status).json({ error: error.code });
        }

        try {
            const tracks = await searchTracks(query, credentials);

            res.set("Cache-Control", `public, max-age=${CACHE_SECONDS}`);

            return res.json({ tracks });
        } catch (error) {
            const known = error instanceof SearchError;

            console.error("Búsqueda:", known ? error.code : error);

            if (known && error.retryAfter) res.set("Retry-After", error.retryAfter);

            return res
                .status(known ? error.status : 502)
                .json({ error: known ? error.code : "search_failed" });
        }
    };
}