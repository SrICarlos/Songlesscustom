

const SONGS_KEY = "songs";
const SPOTIFY_API = "https://api.spotify.com/v1";

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

// -----------------------------------------------------
// Utilidades
// -----------------------------------------------------

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store"
        }
    });
}

async function readSongs(env) {
    const stored = await env.SONGS.get(SONGS_KEY, "json");
    return Array.isArray(stored) ? stored : [];
}

async function writeSongs(env, songs) {
    await env.SONGS.put(SONGS_KEY, JSON.stringify(songs));
}

async function spotifyFetch(url, accessToken) {
    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${accessToken}`
        }
    });

    if (!response.ok) {
        const errorText = await response.text();

        let errorData = null;
        try {
            errorData = JSON.parse(errorText);
        } catch {
            // El cuerpo no era JSON.
        }

        const error = new Error(`Spotify ${response.status}: ${errorText}`);
        error.status = response.status;
        error.spotifyReason = errorData?.error?.reason || null;

        const retryAfter = response.headers.get("Retry-After");
        error.retryAfter = retryAfter ? Number(retryAfter) : null;

        throw error;
    }

    return response.json();
}

function getSpotifyToken(request) {
    const authorization = request.headers.get("Authorization");

    if (!authorization || !authorization.startsWith("Bearer ")) {
        throw new HttpError(401, "Falta el token de Spotify.");
    }

    return authorization.slice("Bearer ".length);
}

// Solo deja pasar a los usuarios de Spotify listados en ADMIN_SPOTIFY_ID
// (varios IDs separados por comas). Sin esto, cualquiera en internet
// podría añadir canciones.
async function assertOwner(token, env) {
    const allowed = String(env.ADMIN_SPOTIFY_ID || "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);

    const me = await spotifyFetch(`${SPOTIFY_API}/me`, token);

    if (allowed.length === 0 || !allowed.includes(me.id)) {
        throw new HttpError(
            403,
            `Acceso denegado. Tu ID de Spotify es "${me.id}". ` +
            "Solo los IDs de la variable ADMIN_SPOTIFY_ID pueden administrar canciones."
        );
    }
}

function getRandomDifficulty() {
    const difficulties = ["easy", "medium", "hard", "impossible"];
    return difficulties[Math.floor(Math.random() * difficulties.length)];
}

function errorResponse(error) {
    console.error(error);

    if (error instanceof HttpError) {
        return json({ error: error.message }, error.status);
    }

    return json(
        {
            error: error.message,
            reason: error.spotifyReason || null,
            retryAfter: error.retryAfter || null
        },
        error.status === 429 ? 429 : 500
    );
}

// -----------------------------------------------------
// Rutas
// -----------------------------------------------------

async function searchArtists(url, token) {
    const query = String(url.searchParams.get("q") || "").trim();

    if (query.length < 2) {
        return json({ artists: [] });
    }

    const spotifyUrl = new URL(`${SPOTIFY_API}/search`);
    spotifyUrl.searchParams.set("q", `artist:${query}`);
    spotifyUrl.searchParams.set("type", "artist");
    spotifyUrl.searchParams.set("limit", "10");

    const data = await spotifyFetch(spotifyUrl, token);

    return json({ artists: data.artists?.items || [] });
}

async function getArtistAlbums(artistId, token) {
    const albums = [];
    let offset = 0;

    while (true) {
        const spotifyUrl = new URL(
            `${SPOTIFY_API}/artists/${encodeURIComponent(artistId)}/albums`
        );
        spotifyUrl.searchParams.set("include_groups", "album,single");
        spotifyUrl.searchParams.set("limit", "10");
        spotifyUrl.searchParams.set("offset", String(offset));

        const data = await spotifyFetch(spotifyUrl, token);

        albums.push(...(data.items || []));

        if (!data.next) {
            break;
        }

        offset += 10;
    }

    // Eliminar ediciones duplicadas.
    const uniqueAlbums = [
        ...new Map(albums.map((album) => [album.id, album])).values()
    ];

    return json({
        albums: uniqueAlbums.map((album) => ({
            id: album.id,
            name: album.name,
            totalTracks: album.total_tracks,
            albumType: album.album_type,
            releaseDate: album.release_date,
            image: album.images?.[1]?.url || album.images?.[0]?.url || "",
            spotifyUrl: album.external_urls?.spotify || ""
        }))
    });
}

async function getAlbumTracks(albumId, token) {
    const tracks = [];
    let offset = 0;

    while (true) {
        const spotifyUrl = new URL(
            `${SPOTIFY_API}/albums/${encodeURIComponent(albumId)}/tracks`
        );
        spotifyUrl.searchParams.set("limit", "50");
        spotifyUrl.searchParams.set("offset", String(offset));

        const data = await spotifyFetch(spotifyUrl, token);

        tracks.push(...(data.items || []));

        if (!data.next) {
            break;
        }

        offset += 50;
    }

    return json({
        tracks: tracks.map((track) => ({
            spotifyId: track.id,
            uri: track.uri,
            title: track.name,
            artist: track.artists.map((artist) => artist.name).join(", "),
            album: track.album?.name || "",
            durationMs: track.duration_ms || 0,
            spotifyUrl: track.external_urls?.spotify || ""
        }))
    });
}

async function saveSongs(request, env) {
    let body;

    try {
        body = await request.json();
    } catch {
        throw new HttpError(400, "El cuerpo debe ser JSON válido.");
    }

    const songsToAdd = body?.songs;

    if (!Array.isArray(songsToAdd)) {
        throw new HttpError(400, "songs debe ser un array.");
    }

    const existingSongs = await readSongs(env);
    const existingIds = new Set(existingSongs.map((song) => song.spotifyId));
    const newSongs = [];

    for (const song of songsToAdd) {
        if (!song.spotifyId || existingIds.has(song.spotifyId)) {
            continue;
        }

        newSongs.push({
            id: song.spotifyId,
            spotifyId: song.spotifyId,
            uri: song.uri,
            title: song.title,
            artist: song.artist,
            album: song.album,
            albumImage: song.albumImage,
            spotifyUrl: song.spotifyUrl,
            difficulty: getRandomDifficulty()
        });

        existingIds.add(song.spotifyId);
    }

    const updatedSongs = [...existingSongs, ...newSongs];

    await writeSongs(env, updatedSongs);

    return json({
        added: newSongs.length,
        skipped: songsToAdd.length - newSongs.length,
        total: updatedSongs.length
    });
}

// -----------------------------------------------------
// Punto de entrada
// -----------------------------------------------------

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const { pathname } = url;
        const method = request.method;

        try {
            // Canciones guardadas (pública, solo lectura)
            if (method === "GET" && pathname === "/api/songs") {
                return json(await readSongs(env));
            }

            // Rutas de administración: exigen ser el dueño
            if (pathname.startsWith("/api/admin/")) {
                const token = getSpotifyToken(request);
                await assertOwner(token, env);

                if (method === "GET" && pathname === "/api/admin/search-artists") {
                    return await searchArtists(url, token);
                }

                let match = pathname.match(/^\/api\/admin\/artists\/([^/]+)\/albums$/);
                if (method === "GET" && match) {
                    return await getArtistAlbums(decodeURIComponent(match[1]), token);
                }

                match = pathname.match(/^\/api\/admin\/albums\/([^/]+)\/tracks$/);
                if (method === "GET" && match) {
                    return await getAlbumTracks(decodeURIComponent(match[1]), token);
                }

                if (method === "POST" && pathname === "/api/admin/songs") {
                    return await saveSongs(request, env);
                }
            }

            return json({ error: "Ruta no encontrada." }, 404);
        } catch (error) {
            return errorResponse(error);
        }
    }
};