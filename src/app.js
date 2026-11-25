

// =====================================================
// CONFIGURACIÓN
// =====================================================

const CLIENT_ID = "93ab9700faa841aa8d2c1f1db1c5c3a7";

const REDIRECT_URI = window.location.origin + "/callback";

const SCOPES = [
    "streaming",
    "user-read-email",
    "user-read-private",
    "user-read-playback-state",
    "user-modify-playback-state"
].join(" ");

// Segundos desbloqueados por intento.
const ATTEMPT_DURATIONS = [1, 2, 3, 5, 10];

const DIFFICULTY_ORDER = ["easy", "medium", "hard", "impossible"];



const gameModes = {};


// =====================================================
// ESTADO
// =====================================================

let spotifyPlayer = null;
let spotifyDeviceId = null;
let spotifySDKReady = false;

let songs = [];

let currentMode = null;
let currentAttempt = 1;
let currentSong = null;
let currentDifficulty = "easy";   // dificultad de la ronda en curso
let selectedTrack = null;
let fragmentStartMs = 0;

// Dificultad elegida en la pantalla principal (la usa el modo infinito).
let selectedDifficulty = "easy";

let isPlaying = false;
let fragmentTimer = null;
let searchTimeout = null;
let lastRoundResult = null;

const attemptStates = [null, null, null, null, null];

// Administración
let selectedAdminArtist = null;
let adminAlbums = [];
let adminSelectedSongs = new Map();
const loadedAlbumTracks = new Set();


// =====================================================
// ELEMENTOS DOM
// =====================================================

const $ = (id) => document.getElementById(id);

const homeButton = $("homeButton");
const dailyButton = $("dailyButton");
const infiniteButton = $("infiniteButton");
const homeScreen = $("homeScreen");
const gameScreen = $("gameScreen");
const backButton = $("backButton");

const spotifyLoginButton = $("spotifyLoginButton");
const spotifyUser = $("spotifyUser");
const spotifyStatus = $("spotifyStatus");
const logoutButton = $("logoutButton");

const playButton = $("playButton");
const playIcon = $("playIcon");
const gameMode = $("gameMode");
const difficulty = $("difficulty");
const roundNumber = $("roundNumber");
const fragmentTime = $("fragmentTime");
const guessInput = $("guessInput");
const guessButton = $("guessButton");
const skipButton = $("skipButton");
const searchResults = $("searchResults");
const attemptText = $("attemptText");
const attemptDots = document.querySelectorAll(".attempt-dot");
const result = $("result");
const loading = $("loading");

const adminButton = $("adminButton");
const adminModal = $("adminModal");
const closeAdminButton = $("closeAdminButton");
const artistSearchInput = $("artistSearchInput");
const artistSearchButton = $("artistSearchButton");
const artistResults = $("artistResults");
const selectedArtistName = $("selectedArtistName");
const albumBrowser = $("albumBrowser");
const albumCount = $("albumCount");
const albumList = $("albumList");
const closeArtistButton = $("closeArtistButton");
const selectedSongsBar = $("selectedSongsBar");
const selectedSongsText = $("selectedSongsText");
const addTracksButton = $("addTracksButton");
const adminMessage = $("adminMessage");

const difficultyOptions = document.querySelectorAll(".difficulty-option");

const resultModal = $("resultModal");
const resultModalTitle = $("resultModalTitle");
const resultSongImage = $("resultSongImage");
const resultSongTitle = $("resultSongTitle");
const resultSongArtist = $("resultSongArtist");
const nextRoundButton = $("nextRoundButton");
const closeResultButton = $("closeResultButton");
const resultDifficultyButtons = document.querySelectorAll(".result-difficulty");


// =====================================================
// UTILIDADES
// =====================================================

function getAccessToken() {
    return localStorage.getItem("spotify_access_token");
}

function setLoading(value) {
    loading.classList.toggle("hidden", !value);
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function normalizeSongText(text) {
    return String(text)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function artistsToText(artists) {
    return artists.map((artist) => artist.name).join(", ");
}

function areSongsEqual(a, b) {
    if (!a || !b) return false;

    return (
        normalizeSongText(a.name) === normalizeSongText(b.name) &&
        normalizeSongText(artistsToText(a.artists)) ===
            normalizeSongText(artistsToText(b.artists))
    );
}


// =====================================================
// OAUTH PKCE
// =====================================================

function generateCodeVerifier(length = 64) {
    const characters =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ" +
        "abcdefghijklmnopqrstuvwxyz" +
        "0123456789-._~";

    const values = new Uint8Array(length);
    crypto.getRandomValues(values);

    let verifier = "";
    for (const value of values) {
        verifier += characters[value % characters.length];
    }
    return verifier;
}

async function generateCodeChallenge(verifier) {
    const data = new TextEncoder().encode(verifier);
    const digest = await crypto.subtle.digest("SHA-256", data);

    return btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

async function loginWithSpotify() {
    try {
        const verifier = generateCodeVerifier();
        localStorage.setItem("spotify_code_verifier", verifier);

        const challenge = await generateCodeChallenge(verifier);

        const authUrl = new URL("https://accounts.spotify.com/authorize");
        authUrl.searchParams.set("client_id", CLIENT_ID);
        authUrl.searchParams.set("response_type", "code");
        authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
        authUrl.searchParams.set("scope", SCOPES);
        authUrl.searchParams.set("code_challenge_method", "S256");
        authUrl.searchParams.set("code_challenge", challenge);

        window.location.href = authUrl.toString();
    } catch (error) {
        console.error("Error iniciando Spotify:", error);
    }
}

async function exchangeCodeForToken(code) {
    const verifier = localStorage.getItem("spotify_code_verifier");

    if (!verifier) {
        throw new Error("No se encontró el code_verifier.");
    }

    const body = new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier
    });

    const response = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body
    });

    if (!response.ok) {
        throw new Error(await response.text());
    }

    return response.json();
}

async function handleSpotifyCallback() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const error = params.get("error");

    if (error) {
        console.error("Spotify OAuth:", error);
        return;
    }

    if (!code) return;

    setLoading(true);

    try {
        const tokenData = await exchangeCodeForToken(code);

        localStorage.setItem("spotify_access_token", tokenData.access_token);

        if (tokenData.refresh_token) {
            localStorage.setItem("spotify_refresh_token", tokenData.refresh_token);
        }

        localStorage.removeItem("spotify_code_verifier");

        window.history.replaceState({}, document.title, "/");

        await showSpotifyUser();
        await waitForSpotifySDK();
        await initializeSpotifyPlayer();
    } catch (error) {
        console.error("Error conectando Spotify:", error);
    } finally {
        setLoading(false);
    }
}


// =====================================================
// PERFIL SPOTIFY
// =====================================================

async function getSpotifyProfile(accessToken) {
    const response = await fetch("https://api.spotify.com/v1/me", {
        headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!response.ok) {
        throw new Error("No se pudo obtener el perfil de Spotify.");
    }

    return response.json();
}

async function showSpotifyUser() {
    const token = getAccessToken();

    if (!token) {
        spotifyLoginButton.classList.remove("hidden");
        spotifyUser.classList.add("hidden");
        return;
    }

    try {
        const profile = await getSpotifyProfile(token);

        spotifyStatus.textContent = profile.display_name || profile.id;

        spotifyLoginButton.classList.add("hidden");
        spotifyUser.classList.remove("hidden");
    } catch (error) {
        console.error("Error obteniendo perfil:", error);
        logoutSpotify();
    }
}

function logoutSpotify() {
    clearFragmentTimer();

    if (spotifyPlayer) {
        spotifyPlayer.disconnect();
        spotifyPlayer = null;
        spotifyDeviceId = null;
    }

    localStorage.removeItem("spotify_access_token");
    localStorage.removeItem("spotify_refresh_token");
    localStorage.removeItem("spotify_code_verifier");

    spotifyLoginButton.classList.remove("hidden");
    spotifyUser.classList.add("hidden");

    isPlaying = false;
    updatePlayButton();
}


// =====================================================
// DIFICULTAD (utilidades compartidas)
// =====================================================

function getSongsByDifficulty(difficultyKey) {
    return songs.filter((song) => song.difficulty === difficultyKey);
}

function getDifficultyLabel(difficultyKey) {
    const labels = {
        easy: "FÁCIL",
        medium: "INTERMEDIO",
        hard: "DIFÍCIL",
        impossible: "IMPOSIBLE"
    };

    return labels[difficultyKey] || String(difficultyKey).toUpperCase();
}

function getRandomSong(difficultyKey) {
    const available = getSongsByDifficulty(difficultyKey);

    if (available.length === 0) {
        throw new Error(`No hay canciones para ${difficultyKey}`);
    }

    return available[Math.floor(Math.random() * available.length)];
}

// Selector de la pantalla principal (afecta al modo infinito).
function setDifficulty(difficultyKey) {
    selectedDifficulty = difficultyKey;

    difficultyOptions.forEach((button) => {
        button.classList.toggle(
            "selected",
            button.dataset.difficulty === difficultyKey
        );
    });
}

function generateRandomFragmentStart(durationMs, rand = Math.random) {
    if (!durationMs) {
        // Canciones guardadas antes de registrar la duración.
        return Math.floor(rand() * 120000);
    }

    const maxFragmentDuration =
        ATTEMPT_DURATIONS[ATTEMPT_DURATIONS.length - 1] * 1000;

    const safetyMargin = 1000;

    const maximumStart = durationMs - maxFragmentDuration - safetyMargin;

    if (maximumStart <= 0) return 0;

    return Math.floor(rand() * maximumStart);
}


// =====================================================
// SPOTIFY SDK
// =====================================================

function waitForSpotifySDK() {
    return new Promise((resolve) => {
        if (typeof Spotify !== "undefined" && Spotify.Player) {
            spotifySDKReady = true;
            resolve();
            return;
        }

        if (window.spotifySDKReady) {
            spotifySDKReady = true;
            resolve();
            return;
        }

        window.addEventListener(
            "spotify-sdk-ready",
            () => {
                spotifySDKReady = true;
                resolve();
            },
            { once: true }
        );
    });
}

async function initializeSpotifyPlayer() {
    const token = getAccessToken();

    if (!token) return;
    if (spotifyPlayer) return;

    await waitForSpotifySDK();

    spotifyPlayer = new Spotify.Player({
        name: "Songless",
        getOAuthToken(callback) {
            callback(getAccessToken());
        },
        volume: 0.5
    });

    spotifyPlayer.addListener("ready", ({ device_id }) => {
        spotifyDeviceId = device_id;
        console.log("Songless listo:", device_id);
    });

    spotifyPlayer.addListener("not_ready", ({ device_id }) => {
        console.warn("Spotify device no disponible:", device_id);

        if (spotifyDeviceId === device_id) {
            spotifyDeviceId = null;
        }
    });

    spotifyPlayer.addListener("player_state_changed", (state) => {
        if (!state) return;

        isPlaying = !state.paused;
        updatePlayButton();
    });

    spotifyPlayer.addListener("initialization_error", ({ message }) => {
        console.error("Spotify initialization:", message);
    });

    spotifyPlayer.addListener("authentication_error", ({ message }) => {
        console.error("Spotify authentication:", message);
    });

    spotifyPlayer.addListener("account_error", ({ message }) => {
        console.error("Spotify account:", message);
    });

    const connected = await spotifyPlayer.connect();

    console.log("Spotify player conectado:", connected);
}


// =====================================================
// REPRODUCCIÓN
// =====================================================

async function togglePlayback() {
    if (!spotifyPlayer) {
        console.warn("El reproductor todavía no está listo.");
        return;
    }

    if (!spotifyDeviceId) {
        console.warn("No hay dispositivo Spotify disponible.");
        return;
    }

    if (isPlaying) {
        clearFragmentTimer();
        await spotifyPlayer.pause();
        isPlaying = false;
        updatePlayButton();
        return;
    }

    await playFragment();
}

async function playFragment() {
    const token = getAccessToken();

    if (!token || !spotifyDeviceId || !currentSong) return;

    const duration = ATTEMPT_DURATIONS[currentAttempt - 1];

    clearFragmentTimer();

    const response = await fetch(
        `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(spotifyDeviceId)}`,
        {
            method: "PUT",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                uris: [currentSong.uri],
                position_ms: fragmentStartMs
            })
        }
    );

    if (!response.ok) {
        console.error("Error reproduciendo:", await response.text());
        return;
    }

    isPlaying = true;
    updatePlayButton();

    startFragmentTimer(duration);
}

function startFragmentTimer(seconds) {
    clearFragmentTimer();

    fragmentTimer = setTimeout(async () => {
        if (spotifyPlayer && isPlaying) {
            try {
                await spotifyPlayer.pause();
            } catch (error) {
                console.error("Error pausando:", error);
            }
        }

        isPlaying = false;
        updatePlayButton();
    }, seconds * 1000);
}

function clearFragmentTimer() {
    if (fragmentTimer) {
        clearTimeout(fragmentTimer);
        fragmentTimer = null;
    }
}

function updatePlayButton() {
    if (isPlaying) {
        playIcon.textContent = "❚❚";
        playButton.setAttribute("aria-label", "Pausar");
    } else {
        playIcon.textContent = "▶";
        playButton.setAttribute("aria-label", "Reproducir");
    }
}

async function stopPlayback() {
    clearFragmentTimer();

    if (spotifyPlayer) {
        try {
            await spotifyPlayer.pause();
        } catch (error) {
            console.error("Error pausando:", error);
        }
    }

    isPlaying = false;
    updatePlayButton();
}


// =====================================================
// BÚSQUEDA SPOTIFY (cuadro de respuesta)
// =====================================================

async function searchSpotifyTracks(query) {
    const token = getAccessToken();

    if (!token) return;

    const trimmedQuery = query.trim();

    if (trimmedQuery.length < 2) {
        searchResults.classList.add("hidden");
        return;
    }

    searchResults.classList.remove("hidden");
    searchResults.innerHTML = `<div class="search-message">Buscando...</div>`;

    try {
        const url = new URL("https://api.spotify.com/v1/search");
        url.searchParams.set("q", trimmedQuery);
        url.searchParams.set("type", "track");
        url.searchParams.set("limit", "5");

        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (!response.ok) {
            throw new Error(await response.text());
        }

        const data = await response.json();

        renderSearchResults(data.tracks?.items || []);
    } catch (error) {
        console.error("Error buscando canciones:", error);

        searchResults.innerHTML =
            `<div class="search-message">Error realizando la búsqueda.</div>`;
    }
}

function renderSearchResults(tracks) {
    searchResults.innerHTML = "";

    if (!tracks.length) {
        searchResults.innerHTML =
            `<div class="search-message">No encontramos canciones.</div>`;
        return;
    }

    tracks.forEach((track) => {
        const button = document.createElement("button");
        button.className = "search-result";

        const image =
            track.album?.images?.[2]?.url ||
            track.album?.images?.[0]?.url ||
            "";

        const artists = artistsToText(track.artists);

        button.innerHTML = `
            ${
                image
                    ? `<img class="search-result-image" src="${escapeHtml(image)}" alt="">`
                    : `<div class="search-result-image"></div>`
            }
            <div class="search-result-info">
                <span class="search-result-title">${escapeHtml(track.name)}</span>
                <span class="search-result-artist">${escapeHtml(artists)}</span>
            </div>
        `;

        button.addEventListener("click", () => selectTrack(track));

        searchResults.appendChild(button);
    });
}

function selectTrack(track) {
    selectedTrack = track;

    guessInput.value = `${track.name} — ${artistsToText(track.artists)}`;

    searchResults.classList.add("hidden");
}


// =====================================================
// MOTOR DE RONDA (compartido por los dos modos)
// =====================================================

function buildCurrentSong(song) {
    return {
        id: song.spotifyId,
        uri: song.uri || `spotify:track:${song.spotifyId}`,
        name: song.title,
        artists: [{ name: song.artist }],
        albumImage: song.albumImage || "",
        durationMs: song.durationMs || 0,
        difficulty: song.difficulty
    };
}

// Prepara y muestra una ronda. Cada modo decide la canción y el fragmento.
async function prepareRound({ mode, song, startMs, round }) {
    await stopPlayback();

    resultModal.classList.add("hidden");

    currentMode = mode;
    currentAttempt = 1;
    selectedTrack = null;
    attemptStates.fill(null);

    currentSong = buildCurrentSong(song);
    currentDifficulty = song.difficulty;
    fragmentStartMs = startMs;

    guessInput.disabled = false;
    guessButton.disabled = false;
    skipButton.disabled = false;
    guessInput.value = "";
    result.textContent = "";

    gameMode.textContent = mode === "daily" ? "DIARIO" : "INFINITO";
    difficulty.textContent = getDifficultyLabel(currentDifficulty);
    roundNumber.textContent = String(round).padStart(2, "0");

    // Elegir dificultad en el modal solo tiene sentido en infinito.
    resultDifficultyButtons.forEach((button) => {
        button.classList.toggle("hidden", mode === "daily");
    });

    updateAttempts();

    homeScreen.classList.add("hidden");
    gameScreen.classList.remove("hidden");
}

function updateAttempts() {
    attemptText.textContent = `${currentAttempt} / 5`;

    const seconds = ATTEMPT_DURATIONS[currentAttempt - 1];

    fragmentTime.textContent =
        `${seconds} ${seconds === 1 ? "segundo" : "segundos"}`;

    attemptDots.forEach((dot, index) => {
        dot.classList.remove("active", "failed", "skipped", "completed");

        const state = attemptStates[index];

        if (state === "failed" || state === "skipped" || state === "completed") {
            dot.classList.add(state);
        } else if (index === currentAttempt - 1) {
            dot.classList.add("active");
        }
    });
}

async function makeGuess() {
    if (!selectedTrack) {
        result.textContent = "Selecciona una canción de la lista.";
        return;
    }

    if (!currentSong) return;

    if (areSongsEqual(selectedTrack, currentSong)) {
        attemptStates[currentAttempt - 1] = "completed";
        updateAttempts();
        await showRoundResult(true);
        return;
    }

    await consumeAttempt("failed");
}

async function skip() {
    await consumeAttempt("skipped");
}

async function consumeAttempt(reason) {
    await stopPlayback();

    attemptStates[currentAttempt - 1] = reason;

    if (currentAttempt >= 5) {
        updateAttempts();
        await showRoundResult(false);
        return;
    }

    currentAttempt++;
    selectedTrack = null;
    guessInput.value = "";
    result.textContent = "";

    updateAttempts();

    guessInput.focus();
}

async function showRoundResult(won) {
    await stopPlayback();

    lastRoundResult = { won, mode: currentMode, difficulty: currentDifficulty };

    resultModalTitle.textContent = won
        ? "¡CORRECTO! 🎉"
        : "SE ACABARON LOS INTENTOS";

    if (currentSong) {
        resultSongTitle.textContent = currentSong.name;
        resultSongArtist.textContent = artistsToText(currentSong.artists);

        if (currentSong.albumImage) {
            resultSongImage.src = currentSong.albumImage;
            resultSongImage.classList.remove("hidden");
        } else {
            resultSongImage.classList.add("hidden");
        }
    }

    const mode = gameModes[currentMode];

    mode?.onRoundEnd?.(won);
    mode?.updateNextButton?.();

    resultModal.classList.remove("hidden");
}


// =====================================================
// NAVEGACIÓN
// =====================================================

async function startGame(mode) {
    const handler = gameModes[mode];

    if (!handler) {
        console.error(`Modo desconocido o no cargado: ${mode}`);
        return;
    }

    await handler.start();
}

async function goHome() {
    await stopPlayback();

    currentSong = null;
    selectedTrack = null;

    resultModal.classList.add("hidden");
    gameScreen.classList.add("hidden");
    homeScreen.classList.remove("hidden");
}


// =====================================================
// EVENTOS
// =====================================================

spotifyLoginButton.addEventListener("click", loginWithSpotify);
logoutButton.addEventListener("click", logoutSpotify);

dailyButton.addEventListener("click", () => startGame("daily"));
infiniteButton.addEventListener("click", () => startGame("infinite"));

homeButton.addEventListener("click", goHome);
backButton.addEventListener("click", goHome);

playButton.addEventListener("click", togglePlayback);
guessButton.addEventListener("click", makeGuess);
skipButton.addEventListener("click", skip);

guessInput.addEventListener("input", () => {
    selectedTrack = null;

    clearTimeout(searchTimeout);

    const query = guessInput.value;

    searchTimeout = setTimeout(() => searchSpotifyTracks(query), 300);
});

guessInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") makeGuess();
});

document.addEventListener("click", (event) => {
    if (!event.target.closest(".guess-search")) {
        searchResults.classList.add("hidden");
    }
});

difficultyOptions.forEach((button) => {
    button.addEventListener("click", () => {
        setDifficulty(button.dataset.difficulty);
    });
});

// Modal de resultado: delega en el modo activo.
nextRoundButton.addEventListener("click", async () => {
    await gameModes[currentMode]?.onNext?.();
});

resultDifficultyButtons.forEach((button) => {
    button.addEventListener("click", async () => {
        await gameModes[currentMode]?.onPickDifficulty?.(
            button.dataset.difficulty
        );
    });
});

closeResultButton.addEventListener("click", async () => {
    resultModal.classList.add("hidden");
    await goHome();
});


// =====================================================
// CARGAR CANCIONES
// =====================================================

async function loadSongs() {
    try {
        const response = await fetch("/api/songs");

        if (!response.ok) {
            throw new Error("No se pudieron cargar las canciones.");
        }

        songs = await response.json();

        console.log(`Songless: ${songs.length} canciones cargadas.`);
    } catch (error) {
        console.error("Error cargando canciones:", error);
        songs = [];
    }
}


// =====================================================
// ADMINISTRACIÓN
// =====================================================

function openAdmin() {
    adminModal.classList.remove("hidden");
    artistSearchInput.focus();
}

function closeAdmin() {
    adminModal.classList.add("hidden");
}

adminButton.addEventListener("click", openAdmin);
closeAdminButton.addEventListener("click", closeAdmin);

adminModal.addEventListener("click", (event) => {
    if (event.target === adminModal) closeAdmin();
});

artistSearchButton.addEventListener("click", searchArtists);

artistSearchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") searchArtists();
});

addTracksButton.addEventListener("click", saveAdminTracks);

closeArtistButton.addEventListener("click", () => {
    albumBrowser.classList.add("hidden");
    artistResults.innerHTML = "";
    artistSearchInput.focus();
});

function adminHeaders() {
    return { Authorization: `Bearer ${getAccessToken()}` };
}

async function searchArtists() {
    const query = artistSearchInput.value.trim();

    if (query.length < 2) return;

    adminMessage.textContent = "Buscando artistas...";
    artistResults.innerHTML = "";

    try {
        const response = await fetch(
            `/api/admin/search-artists?q=${encodeURIComponent(query)}`,
            { headers: adminHeaders() }
        );

        if (!response.ok) throw new Error(await response.text());

        const data = await response.json();

        renderArtistResults(data.artists);

        adminMessage.textContent = "";
    } catch (error) {
        console.error(error);
        adminMessage.textContent = "No se pudieron buscar artistas.";
    }
}

function renderArtistResults(artists) {
    artistResults.innerHTML = "";

    artists.forEach((artist) => {
        const button = document.createElement("button");
        button.className = "artist-result";

        const image = artist.images?.[2]?.url || artist.images?.[0]?.url || "";

        button.innerHTML = `
            ${
                image
                    ? `<img class="artist-result-image" src="${escapeHtml(image)}" alt="">`
                    : ""
            }
            <span class="artist-result-name">${escapeHtml(artist.name)}</span>
        `;

        button.addEventListener("click", () => loadArtistAlbums(artist));

        artistResults.appendChild(button);
    });
}

async function loadArtistAlbums(artist) {
    selectedAdminArtist = artist;
    adminAlbums = [];
    adminSelectedSongs = new Map();
    loadedAlbumTracks.clear();

    artistResults.innerHTML = "";
    albumList.innerHTML = "";
    albumBrowser.classList.remove("hidden");

    selectedArtistName.textContent = artist.name;
    albumCount.textContent = "Cargando álbumes...";

    try {
        const response = await fetch(
            `/api/admin/artists/${encodeURIComponent(artist.id)}/albums`,
            { headers: adminHeaders() }
        );

        if (!response.ok) throw new Error(await response.text());

        const data = await response.json();

        adminAlbums = data.albums || [];

        albumCount.textContent = `${adminAlbums.length} álbumes`;

        renderAlbums();

        adminMessage.textContent = "Abre un álbum para ver sus canciones.";
    } catch (error) {
        console.error(error);
        albumCount.textContent = "Error";
        adminMessage.textContent = "No se pudieron cargar los álbumes.";
    }
}

function renderAlbums() {
    albumList.innerHTML = "";

    adminAlbums.forEach((album) => {
        const card = document.createElement("div");
        card.className = "album-card";

        const header = document.createElement("div");
        header.className = "album-card-header";
        header.setAttribute("role", "button");
        header.setAttribute("tabindex", "0");

        const imageHtml = album.image
            ? `<img class="album-cover" src="${escapeHtml(album.image)}" alt="${escapeHtml(album.name || "Álbum")}">`
            : `<div class="album-cover album-cover-empty">♪</div>`;

        const artistName = selectedAdminArtist?.name || "Artista";
        const trackCount = Number(album.totalTracks) || 0;
        const year = album.releaseDate
            ? String(album.releaseDate).substring(0, 4)
            : "";
        const albumType = album.albumType === "single" ? "SINGLE" : "ÁLBUM";

        header.innerHTML = `
            <div class="album-cover-wrapper">${imageHtml}</div>
            <div class="album-info">
                <div class="album-title">${escapeHtml(album.name || "Álbum sin nombre")}</div>
                <div class="album-meta">
                    ${escapeHtml(artistName)} · ${trackCount}
                    ${trackCount === 1 ? "canción" : "canciones"}
                    ${year ? ` · ${escapeHtml(year)}` : ""}
                </div>
                <div class="album-type">${albumType}</div>
            </div>
            <div class="album-arrow">→</div>
        `;

        const tracksContainer = document.createElement("div");
        tracksContainer.className = "album-tracks";

        const openAlbum = () => toggleAlbum(album, card, tracksContainer);

        header.addEventListener("click", openAlbum);

        header.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openAlbum();
            }
        });

        card.appendChild(header);
        card.appendChild(tracksContainer);
        albumList.appendChild(card);
    });
}

async function toggleAlbum(album, card, tracksContainer) {
    if (card.classList.contains("open")) {
        card.classList.remove("open");
        return;
    }

    card.classList.add("open");

    if (loadedAlbumTracks.has(album.id)) return;

    tracksContainer.innerHTML =
        `<div class="album-loading">Cargando canciones...</div>`;

    try {
        if (!getAccessToken()) {
            throw new Error("No hay sesión de Spotify.");
        }

        const response = await fetch(
            `/api/admin/albums/${encodeURIComponent(album.id)}/tracks`,
            { headers: adminHeaders() }
        );

        if (!response.ok) throw new Error(await response.text());

        const data = await response.json();

        const tracks = Array.isArray(data.tracks) ? data.tracks : [];

        renderAlbumTracks(album, tracks, tracksContainer);

        loadedAlbumTracks.add(album.id);
    } catch (error) {
        console.error("Error cargando canciones:", error);

        tracksContainer.innerHTML =
            `<div class="album-loading">No se pudieron cargar las canciones.</div>`;
    }
}

function renderAlbumTracks(album, tracks, container) {
    container.innerHTML = "";

    if (!tracks.length) {
        container.innerHTML =
            `<div class="album-loading">Spotify no ha devuelto canciones para este álbum.</div>`;
        return;
    }

    tracks.forEach((track) => {
        const row = document.createElement("label");
        row.className = "album-track";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "album-track-checkbox";
        checkbox.checked = adminSelectedSongs.has(track.spotifyId);

        const info = document.createElement("div");
        info.className = "album-track-info";

        const title = document.createElement("span");
        title.className = "album-track-title";
        title.textContent = track.title || "Canción sin título";

        const artist = document.createElement("span");
        artist.className = "album-track-artist";
        artist.textContent = track.artist || selectedAdminArtist?.name || "";

        info.appendChild(title);
        info.appendChild(artist);

        checkbox.addEventListener("change", () => {
            if (checkbox.checked) {
                adminSelectedSongs.set(track.spotifyId, {
                    ...track,
                    albumImage: album.image
                });
            } else {
                adminSelectedSongs.delete(track.spotifyId);
            }

            updateSelectedSongs();
        });

        row.appendChild(checkbox);
        row.appendChild(info);
        container.appendChild(row);
    });
}

function updateSelectedSongs() {
    const count = adminSelectedSongs.size;

    addTracksButton.disabled = count === 0;

    if (count === 0) {
        selectedSongsBar.classList.add("hidden");
        return;
    }

    selectedSongsBar.classList.remove("hidden");

    selectedSongsText.textContent =
        count === 1 ? "1 canción seleccionada" : `${count} canciones seleccionadas`;

    addTracksButton.textContent =
        count === 1 ? "AÑADIR 1 CANCIÓN" : `AÑADIR ${count} CANCIONES`;
}

async function saveAdminTracks() {
    const tracks = [...adminSelectedSongs.values()];

    if (!tracks.length) return;

    addTracksButton.disabled = true;
    addTracksButton.textContent = "GUARDANDO...";

    try {
        const response = await fetch("/api/admin/songs", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...adminHeaders()
            },
            body: JSON.stringify({ songs: tracks })
        });

        if (!response.ok) throw new Error(await response.text());

        const data = await response.json();

        await loadSongs();

        adminSelectedSongs = new Map();

        // Desmarca las casillas de los álbumes ya abiertos.
        document
            .querySelectorAll(".album-track-checkbox")
            .forEach((checkbox) => { checkbox.checked = false; });

        adminMessage.textContent =
            `✅ ${data.added} canciones añadidas.` +
            (data.skipped ? ` ${data.skipped} ya estaban en Songless.` : "");
    } catch (error) {
        console.error(error);
        adminMessage.textContent = "No se pudieron guardar las canciones.";
    } finally {
        updateSelectedSongs();
    }
}


// =====================================================
// INICIO
// =====================================================

async function init() {
    await handleSpotifyCallback();
    await showSpotifyUser();
    await loadSongs();

    if (getAccessToken()) {
        try {
            await waitForSpotifySDK();
            await initializeSpotifyPlayer();
        } catch (error) {
            console.error("Error inicializando Spotify:", error);
        }
    }
}

// Se ejecuta cuando ya se han cargado daily.js e infinite.js.
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}