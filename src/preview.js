// =====================================================
// preview.js — Busca la preview de 30 s de una canción
//
// Usa la API de búsqueda de iTunes (sin clave). Empareja por título y
// artista, y guarda las URLs encontradas en localStorage para no repetir
// la búsqueda. Si en el futuro la preview se guarda en la base de datos
// (campo previewUrl de cada canción), esta búsqueda ya no hará falta.
// =====================================================

const CACHE_KEY = "songless_previews";
const STOREFRONTS = ["ES", "US"];
const SEARCH_TIMEOUT_MS = 8000;

// Evita búsquedas duplicadas de la misma canción a la vez.
const pending = new Map();


function normalize(text) {
    return String(text)
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

// "Canción (feat. X) - Remastered 2011" → "cancion"
function baseTitle(text) {
    return normalize(
        String(text)
            .replace(/\(.*?\)|\[.*?\]/g, " ")
            .replace(/\s[-–—]\s.*$/, " ")
    );
}

function readCache() {
    try {
        return JSON.parse(localStorage.getItem(CACHE_KEY)) || {};
    } catch (error) {
        return {};
    }
}

function saveToCache(spotifyId, url) {
    try {
        const cache = readCache();
        cache[spotifyId] = url;
        localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (error) {
        // Sin almacenamiento: simplemente no se guarda en caché.
    }
}

async function searchItunes(term, country) {
    const url = new URL("https://itunes.apple.com/search");

    url.searchParams.set("term", term);
    url.searchParams.set("media", "music");
    url.searchParams.set("entity", "song");
    url.searchParams.set("limit", "15");
    url.searchParams.set("country", country);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

    try {
        const response = await fetch(url, { signal: controller.signal });

        if (!response.ok) return [];

        const data = await response.json();

        return Array.isArray(data.results) ? data.results : [];
    } finally {
        clearTimeout(timer);
    }
}

function findMatch(results, title, artist) {
    const wantedTitle = baseTitle(title);
    const wantedArtist = normalize(artist);

    return (
        results.find((item) => {
            if (!item.previewUrl) return false;
            if (baseTitle(item.trackName) !== wantedTitle) return false;

            const foundArtist = normalize(item.artistName);

            return (
                foundArtist.includes(wantedArtist) ||
                wantedArtist.includes(foundArtist)
            );
        }) || null
    );
}

async function lookup(spotifyId, title, artist) {
    const cached = readCache()[spotifyId];

    if (cached) return cached;

    const firstArtist = String(artist).split(",")[0].trim();
    const term = `${title} ${firstArtist}`;

    for (const country of STOREFRONTS) {
        try {
            const results = await searchItunes(term, country);
            const match = findMatch(results, title, firstArtist);

            if (match) {
                saveToCache(spotifyId, match.previewUrl);
                return match.previewUrl;
            }
        } catch (error) {
            console.warn(`Preview: error buscando en iTunes (${country}):`, error);
        }
    }

    return null;
}


// Devuelve la URL de la preview de 30 s, o null si no se encuentra.
export function getPreviewUrl({ spotifyId, title, artist, previewUrl }) {
    if (previewUrl) return Promise.resolve(previewUrl);

    if (!pending.has(spotifyId)) {
        const promise = lookup(spotifyId, title, artist).finally(() => {
            pending.delete(spotifyId);
        });

        pending.set(spotifyId, promise);
    }

    return pending.get(spotifyId);
}