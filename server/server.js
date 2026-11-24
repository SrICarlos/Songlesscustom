import express from "express";
import fs from "node:fs/promises";
import path from "node:path";

const app = express();

const PORT = 3001;

const SONGS_FILE = path.resolve(
    process.cwd(),
    "src/data/songs.json"
);

app.use(express.json());


// =====================================================
// UTILIDADES
// =====================================================

async function readSongs() {

    try {

        const content =
            await fs.readFile(
                SONGS_FILE,
                "utf-8"
            );

        return JSON.parse(content);

    } catch (error) {

        if (error.code === "ENOENT") {

            await fs.mkdir(
                path.dirname(SONGS_FILE),
                {
                    recursive: true
                }
            );

            await fs.writeFile(
                SONGS_FILE,
                "[]",
                "utf-8"
            );

            return [];
        }

        throw error;
    }
}


async function writeSongs(songs) {

    await fs.mkdir(
        path.dirname(SONGS_FILE),
        {
            recursive: true
        }
    );

    await fs.writeFile(
        SONGS_FILE,
        JSON.stringify(
            songs,
            null,
            4
        ),
        "utf-8"
    );
}


async function spotifyFetch(
    url,
    accessToken
) {
    const response = await fetch(
        url,
        {
            headers: {
                Authorization:
                    `Bearer ${accessToken}`
            }
        }
    );

    if (!response.ok) {
        const errorText =
            await response.text();

        let errorData = null;

        try {
            errorData = JSON.parse(
                errorText
            );
        } catch {
            // El cuerpo no era JSON.
        }

        const error = new Error(
            `Spotify ${response.status}: ${errorText}`
        );

        error.status =
            response.status;

        error.spotifyReason =
            errorData?.error?.reason ||
            null;

        const retryAfter =
            response.headers.get(
                "Retry-After"
            );

        error.retryAfter =
            retryAfter
                ? Number(retryAfter)
                : null;

        throw error;
    }

    return response.json();
}

function getSpotifyToken(req) {

    const authorization =
        req.headers.authorization;

    if (
        !authorization ||
        !authorization.startsWith(
            "Bearer "
        )
    ) {

        throw new Error(
            "Falta el token de Spotify."
        );
    }

    return authorization.slice(
        "Bearer ".length
    );
}


// =====================================================
// CANCIONES GUARDADAS
// =====================================================

app.get(
    "/api/songs",
    async (req, res) => {

        try {

            const songs =
                await readSongs();

            res.json(songs);

        } catch (error) {

            console.error(error);

            res.status(500).json({
                error:
                    "No se pudieron cargar las canciones."
            });

        }

    }
);


// =====================================================
// BUSCAR ARTISTAS
// =====================================================

app.get(
    "/api/admin/search-artists",
    async (req, res) => {

        try {

            const token =
                getSpotifyToken(req);

            const query =
                String(
                    req.query.q || ""
                ).trim();

            if (query.length < 2) {

                return res.json({
                    artists: []
                });

            }

            const url =
                new URL(
                    "https://api.spotify.com/v1/search"
                );

            url.searchParams.set(
                "q",
                `artist:${query}`
            );

            url.searchParams.set(
                "type",
                "artist"
            );

            url.searchParams.set(
                "limit",
                "10"
            );

            const data =
                await spotifyFetch(
                    url,
                    token
                );

            res.json({
                artists:
                    data.artists?.items || []
            });

        } catch (error) {

            console.error(
                "Artist search:",
                error
            );

            res.status(
                error.status === 429
                    ? 429
                    : 500
            ).json({
                error:
                    error.message,

                reason:
                    error.spotifyReason,

                retryAfter:
                    error.retryAfter
            });

        }

    }
);


// =====================================================
// OBTENER TODAS LAS CANCIONES DE UN ARTISTA
// =====================================================

app.get(
    "/api/admin/artists/:artistId/albums",
    async (req, res) => {

        try {

            const token =
                getSpotifyToken(req);

            const artistId =
                req.params.artistId;

            const albums = [];

            let offset = 0;


            while (true) {

                const url =
                    new URL(
                        `https://api.spotify.com/v1/artists/${encodeURIComponent(
                            artistId
                        )}/albums`
                    );

                url.searchParams.set(
                    "include_groups",
                    "album,single"
                );

                url.searchParams.set(
                    "limit",
                    "10"
                );

                url.searchParams.set(
                    "offset",
                    String(offset)
                );


                const data =
                    await spotifyFetch(
                        url,
                        token
                    );


                albums.push(
                    ...(data.items || [])
                );


                if (!data.next) {
                    break;
                }


                offset += 10;

            }


            // Eliminar ediciones duplicadas.
            const uniqueAlbums =
                [
                    ...new Map(
                        albums.map(
                            (album) => [
                                album.id,
                                album
                            ]
                        )
                    ).values()
                ];


            res.json({
                albums:
                    uniqueAlbums.map(
                        (album) => ({

                            id:
                                album.id,

                            name:
                                album.name,

                            totalTracks:
                                album.total_tracks,

                            albumType:
                                album.album_type,

                            releaseDate:
                                album.release_date,

                            image:
                                album.images?.[1]?.url ||
                                album.images?.[0]?.url ||
                                "",

                            spotifyUrl:
                                album.external_urls
                                    ?.spotify ||
                                ""

                        })
                    )
            });


        } catch (error) {

            console.error(
                "Artist albums:",
                error
            );

            res.status(
                error.status === 429
                    ? 429
                    : 500
            ).json({

                error:
                    error.message,

                reason:
                    error.spotifyReason,

                retryAfter:
                    error.retryAfter

            });

        }

    }
);

app.get(
    "/api/admin/albums/:albumId/tracks",
    async (req, res) => {

        try {

            const token =
                getSpotifyToken(req);

            const albumId =
                req.params.albumId;

            const tracks = [];

            let offset = 0;


            while (true) {

                const url =
                    new URL(
                        `https://api.spotify.com/v1/albums/${encodeURIComponent(
                            albumId
                        )}/tracks`
                    );

                url.searchParams.set(
                    "limit",
                    "50"
                );

                url.searchParams.set(
                    "offset",
                    String(offset)
                );


                const data =
                    await spotifyFetch(
                        url,
                        token
                    );


                tracks.push(
                    ...(data.items || [])
                );


                if (!data.next) {
                    break;
                }


                offset += 50;

            }


            res.json({
                tracks:
                    tracks.map(
                        (track) => ({

                            spotifyId:
                                track.id,

                            uri:
                                track.uri,

                            title:
                                track.name,

                            artist:
                                track.artists
                                    .map(
                                        (
                                            artist
                                        ) =>
                                            artist.name
                                    )
                                    .join(", "),

                            album:
                                track.album?.name ||
                                "",
                            durationMs:
                                track.duration_ms || 0,
                            
                            spotifyUrl:
                                track.external_urls
                                    ?.spotify ||
                                ""

                        })
                    )
            });


        } catch (error) {

            console.error(
                "Album tracks:",
                error
            );

            res.status(
                error.status === 429
                    ? 429
                    : 500
            ).json({

                error:
                    error.message,

                reason:
                    error.spotifyReason,

                retryAfter:
                    error.retryAfter

            });

        }

    }
);

function getRandomDifficulty() {

    const difficulties = [
        "easy",
        "medium",
        "hard",
        "impossible"
    ];

    const index =
        Math.floor(
            Math.random() *
            difficulties.length
        );

    return difficulties[index];
}

// =====================================================
// GUARDAR CANCIONES
// =====================================================

app.post(
    "/api/admin/songs",
    async (req, res) => {

        try {

            const songsToAdd =
                req.body?.songs;

            if (
                !Array.isArray(
                    songsToAdd
                )
            ) {

                return res.status(400).json({
                    error:
                        "songs debe ser un array."
                });

            }


        


            const existingSongs =
                await readSongs();


            const existingIds =
                new Set(
                    existingSongs.map(
                        (song) =>
                            song.spotifyId
                    )
                );


            const newSongs = [];


            for (
                const song
                of songsToAdd
            ) {

                if (
                    !song.spotifyId ||
                    existingIds.has(
                        song.spotifyId
                    )
                ) {

                    continue;

                }


                const cleanSong = {

                    id:
                        song.spotifyId,

                    spotifyId:
                        song.spotifyId,

                    uri:
                        song.uri,

                    title:
                        song.title,

                    artist:
                        song.artist,

                    album:
                        song.album,

                    albumImage:
                        song.albumImage,

                    spotifyUrl:
                        song.spotifyUrl,

                    difficulty:
                     getRandomDifficulty()

                };


                existingIds.add(
                    song.spotifyId
                );

                newSongs.push(
                    cleanSong
                );

            }


            const updatedSongs =
                [
                    ...existingSongs,
                    ...newSongs
                ];


            await writeSongs(
                updatedSongs
            );


            res.json({

                added:
                    newSongs.length,

                skipped:
                    songsToAdd.length -
                    newSongs.length,

                total:
                    updatedSongs.length

            });


        } catch (error) {

            console.error(
                "Save songs:",
                error
            );

            res.status(500).json({
                error:
                    error.message
            });

        }

    }
);


// =====================================================
// SERVER
// =====================================================

app.listen(
    PORT,
    "127.0.0.1",
    () => {

        console.log(
            `Songless API: http://127.0.0.1:${PORT}`
        );

    }
);