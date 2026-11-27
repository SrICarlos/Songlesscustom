// =====================================================
// app.js — Núcleo de Songless
//   · Configuración, estado y elementos DOM
//   · Login con Spotify (OAuth PKCE) y reproducción de previews (<audio>)
//   · Pantalla principal y selección de modos
//   · Motor de juego compartido (intentos, búsqueda, acierto)
//   · Panel de administración
//
// Son módulos ES (los que Vite espera). En index.html solo hace falta
// UN script, que apunta a app.js (este importa daily.js e infinite.js):
//   <script type="module" src="./app.js"></script>
// =====================================================


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

// Duración de las previews (iTunes): los fragmentos salen de aquí dentro.
const PREVIEW_LENGTH_MS = 30000;


// =====================================================
// MODOS DE JUEGO
// Cada modo (daily.js, infinite.js) exporta un objeto con:
//   start()               → arranca el modo desde la pantalla principal
//   onRoundEnd(won)       → se llama al terminar una ronda
//   updateNextButton()    → texto del botón "siguiente" del modal
//   onNext()              → acción del botón "siguiente"
//   onPickDifficulty(key) → (opcional) elegir dificultad en el modal
// Para añadir un modo nuevo: crea su archivo, impórtalo aquí y
// añádelo a gameModes.
// =====================================================

import { dailyMode } from "./daily.js";
import { infiniteMode } from "./infinite.js";
import { getPreviewUrl } from "./preview.js";

const gameModes = {
    daily: dailyMode,
    infinite: infiniteMode
};


// =====================================================
// ESTADO
// =====================================================

// Reproductor de audio (previews de 30 s).
const audio = new Audio();
audio.preload = "auto";
let audioToken = 0;   // invalida reproducciones que quedaron pendientes

// true tras reproducir la preview del resultado (permite reanudarla).
let resultPreviewStarted = false;

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

// Preview y enlaces del modal de resultado (el HTML está en index.html)
const resultPlayer = $("resultPlayer");
const previewPlayButton = $("previewPlayButton");
const previewPlayIcon = $("previewPlayIcon");
const previewBar = $("previewBar");
const previewBarFill = $("previewBarFill");
const previewCurrentTime = $("previewCurrentTime");
const previewTotalTime = $("previewTotalTime");
const resultLinks = $("resultLinks");
const spotifyLink = $("spotifyLink");
const youtubeLink = $("youtubeLink");

// Volumen: hay un control en la pantalla de juego y otro en el resultado
const volumeSliders = document.querySelectorAll(".volume-slider");
const volumeButtons = document.querySelectorAll(".volume-mute");


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

    // Mismo id de Spotify: es la misma canción sin más comprobaciones.
    if (a.id && b.id && a.id === b.id) return true;

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
    } catch (error) {
        console.error("Error conectando Spotify:", error);
    } finally {
        setLoading(false);
    }
}


// =====================================================
// PERFIL SPOTIFY
// =====================================================

// Los tokens de Spotify caducan a la hora. Con el refresh_token que se
// guarda al iniciar sesión se pide uno nuevo sin que el usuario haga nada.
let refreshPromise = null;

async function refreshAccessToken() {
    // Varias peticiones a la vez comparten una sola renovación.
    if (refreshPromise) return refreshPromise;

    const refreshToken = localStorage.getItem("spotify_refresh_token");

    if (!refreshToken) return null;

    refreshPromise = (async () => {
        try {
            const response = await fetch("https://accounts.spotify.com/api/token", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    client_id: CLIENT_ID,
                    grant_type: "refresh_token",
                    refresh_token: refreshToken
                })
            });

            if (!response.ok) return null;

            const data = await response.json();

            localStorage.setItem("spotify_access_token", data.access_token);

            // Spotify a veces devuelve también un refresh_token nuevo.
            if (data.refresh_token) {
                localStorage.setItem("spotify_refresh_token", data.refresh_token);
            }

            return data.access_token;
        } catch (error) {
            console.error("No se pudo renovar la sesión de Spotify:", error);
            return null;
        } finally {
            refreshPromise = null;
        }
    })();

    return refreshPromise;
}

// fetch a la API de Spotify con el token puesto. Si responde 401 (token
// caducado) renueva la sesión y repite la petición una vez. Si no se puede
// renovar lanza Error("NO_SESSION").
async function spotifyFetch(url, options = {}) {
    const send = (token) =>
        fetch(url, {
            ...options,
            headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` }
        });

    let token = getAccessToken() || (await refreshAccessToken());

    if (!token) throw new Error("NO_SESSION");

    let response = await send(token);

    if (response.status === 401) {
        token = await refreshAccessToken();

        if (!token) throw new Error("NO_SESSION");

        response = await send(token);
    }

    return response;
}

async function getSpotifyProfile() {
    const response = await spotifyFetch("https://api.spotify.com/v1/me");

    if (!response.ok) {
        throw new Error("No se pudo obtener el perfil de Spotify.");
    }

    return response.json();
}

async function showSpotifyUser() {
    // Sin token pero con refresh_token: intenta recuperar la sesión.
    const token = getAccessToken() || (await refreshAccessToken());

    if (!token) {
        spotifyLoginButton.classList.remove("hidden");
        spotifyUser.classList.add("hidden");
        return;
    }

    try {
        const profile = await getSpotifyProfile();

        spotifyStatus.textContent = profile.display_name || profile.id;

        spotifyLoginButton.classList.add("hidden");
        spotifyUser.classList.remove("hidden");
    } catch (error) {
        console.error("Error obteniendo perfil:", error);
        logoutSpotify();
    }
}

function logoutSpotify() {
    stopPlayback();

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

// Solo marca visualmente un nivel en el selector (no cambia la elección).
function highlightDifficulty(difficultyKey) {
    difficultyOptions.forEach((button) => {
        button.classList.toggle(
            "selected",
            button.dataset.difficulty === difficultyKey
        );
    });
}

// Elección del usuario en el selector (la usa el modo infinito).
function setDifficulty(difficultyKey) {
    selectedDifficulty = difficultyKey;
    highlightDifficulty(difficultyKey);
}

// Inicio aleatorio dentro de la preview de 30 s, dejando sitio para el
// fragmento más largo (el del último intento).
function generateRandomFragmentStart(rand = Math.random) {
    const longestFragmentMs =
        ATTEMPT_DURATIONS[ATTEMPT_DURATIONS.length - 1] * 1000;

    const safetyMargin = 500;

    const maximumStart = PREVIEW_LENGTH_MS - longestFragmentMs - safetyMargin;

    return Math.floor(rand() * maximumStart);
}


// =====================================================
// REPRODUCCIÓN (previews de 30 s con <audio>)
// =====================================================

audio.addEventListener("play", () => {
    isPlaying = true;
    updatePlayButton();
});

audio.addEventListener("pause", () => {
    isPlaying = false;
    updatePlayButton();
});

audio.addEventListener("ended", () => {
    isPlaying = false;
    updatePlayButton();
});

// URL de la preview de la canción actual (la busca si todavía no la tiene).
async function ensurePreview() {
    const song = currentSong;

    if (!song) return null;
    if (song.previewUrl) return song.previewUrl;

    song.previewUrl = await getPreviewUrl({
        spotifyId: song.id,
        title: song.name,
        artist: song.artists[0].name
    });

    return song.previewUrl;
}

// Precarga el audio para que el primer play sea inmediato.
function preloadPreview() {
    const song = currentSong;

    ensurePreview()
        .then((url) => {
            if (!url || song !== currentSong) return;

            if (audio.dataset.url !== url) {
                audio.src = url;
                audio.dataset.url = url;
                audio.load();
            }
        })
        .catch(() => {});
}

// Carga la URL (si cambió), salta a startSec y reproduce.
async function playAudioFrom(url, startSec) {
    if (audio.dataset.url !== url) {
        audio.src = url;
        audio.dataset.url = url;
    }

    if (audio.readyState < 1) {
        await new Promise((resolve, reject) => {
            audio.addEventListener("loadedmetadata", resolve, { once: true });
            audio.addEventListener(
                "error",
                () => reject(new Error("No se pudo cargar el audio.")),
                { once: true }
            );
        });
    }

    audio.currentTime = startSec;

    if (audio.seeking) {
        await new Promise((resolve) => {
            audio.addEventListener("seeked", resolve, { once: true });
        });
    }

    await audio.play();
}

async function togglePlayback() {
    if (isPlaying) {
        await stopPlayback();
        return;
    }

    await playFragment();
}

// Reproduce el fragmento del intento actual.
async function playFragment() {
    if (!currentSong) return;

    const token = ++audioToken;
    const duration = ATTEMPT_DURATIONS[currentAttempt - 1];

    resultPreviewStarted = false;

    clearFragmentTimer();

    try {
        const url = await ensurePreview();

        if (token !== audioToken) return;

        if (!url) {
            result.textContent = "No se encontró audio para esta canción.";
            return;
        }

        await playAudioFrom(url, fragmentStartMs / 1000);

        if (token !== audioToken) return;

        startFragmentTimer(duration);
    } catch (error) {
        if (token === audioToken) {
            console.error("Error reproduciendo:", error);
        }
    }
}

// Reproduce la preview completa (modal de resultado).
async function playResultPreview() {
    if (!currentSong) return;

    const token = ++audioToken;

    clearFragmentTimer();

    try {
        const url = await ensurePreview();

        if (token !== audioToken) return;

        if (!url) {
            resultPlayer.classList.add("hidden");
            return;
        }

        await playAudioFrom(url, 0);

        if (token === audioToken) resultPreviewStarted = true;
    } catch (error) {
        if (token === audioToken) {
            console.warn("No se pudo reproducir la preview:", error);
        }
    }
}

function startFragmentTimer(seconds) {
    clearFragmentTimer();

    fragmentTimer = setTimeout(() => {
        audio.pause();
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

    previewPlayIcon.textContent = isPlaying ? "❚❚" : "▶";

    previewPlayButton.setAttribute(
        "aria-label",
        isPlaying ? "Pausar preview" : "Escuchar preview"
    );
}

async function stopPlayback() {
    audioToken++;

    clearFragmentTimer();

    audio.pause();

    isPlaying = false;
    updatePlayButton();
}


// =====================================================
// VOLUMEN
// El control es una posición de 0 a 1 y el volumen real es su cuadrado:
// así hay más precisión en la zona baja, que es donde se nota el oído.
// Se guarda en el navegador y vale para el juego y para el resultado.
// =====================================================

const VOLUME_KEY = "songless_volume";
const DEFAULT_VOLUME_POSITION = 0.5;

let lastVolumePosition = DEFAULT_VOLUME_POSITION;

function loadVolumePosition() {
    try {
        const saved = parseFloat(localStorage.getItem(VOLUME_KEY));

        if (Number.isFinite(saved)) {
            return Math.min(Math.max(saved, 0), 1);
        }
    } catch (error) {
        // Sin almacenamiento: se usa el valor por defecto.
    }

    return DEFAULT_VOLUME_POSITION;
}

function setVolume(position, save = true) {
    const value = Math.min(Math.max(position, 0), 1);

    audio.volume = value * value;

    if (value > 0) lastVolumePosition = value;

    const percent = Math.round(value * 100);
    const level = value === 0 ? 0 : value < 0.5 ? 1 : 2;

    volumeSliders.forEach((slider) => {
        slider.value = String(percent);
        slider.style.setProperty("--value", `${percent}%`);
    });

    volumeButtons.forEach((button) => {
        button.dataset.level = String(level);
        button.setAttribute(
            "aria-label",
            value === 0 ? "Activar sonido" : "Silenciar"
        );
    });

    if (!save) return;

    try {
        localStorage.setItem(VOLUME_KEY, String(value));
    } catch (error) {
        // No pasa nada si no se puede guardar.
    }
}

volumeSliders.forEach((slider) => {
    slider.addEventListener("input", () => {
        setVolume(Number(slider.value) / 100);
    });
});

volumeButtons.forEach((button) => {
    button.addEventListener("click", () => {
        const muted = audio.volume === 0;

        setVolume(muted ? lastVolumePosition : 0);
    });
});

setVolume(loadVolumePosition(), false);


// =====================================================
// BUSCADOR DE CANCIONES (cuadro de respuesta)
// Busca en el catálogo de Songless: las mismas canciones que ya se
// cargan de /api/songs. No necesita sesión de Spotify ni llamadas
// externas, así que funciona para cualquiera y al instante.
// =====================================================

const MAX_SEARCH_RESULTS = 5;

function showSearchMessage(text) {
    searchResults.classList.remove("hidden");
    searchResults.innerHTML =
        `<div class="search-message">${escapeHtml(text)}</div>`;
}

// Canción del catálogo → formato que usa el juego para comparar y pintar.
function catalogSongToTrack(song) {
    return {
        id: song.spotifyId,
        name: song.title,
        artists: [{ name: song.artist }],
        albumImage: song.albumImage || ""
    };
}

function searchSongs(query) {
    const words = normalizeSongText(query).split(" ").filter(Boolean);
    const phrase = words.join(" ");

    // Menos de 2 letras (o solo símbolos): no se busca.
    if (phrase.length < 2) {
        searchResults.classList.add("hidden");
        return;
    }

    if (!songs.length) {
        showSearchMessage("Todavía no hay canciones cargadas.");
        return;
    }

    const matches = [];
    const seen = new Set();

    for (const song of songs) {
        const title = normalizeSongText(song.title);
        const artist = normalizeSongText(song.artist);

        // Una misma canción repetida (álbum y single) sale una sola vez.
        const key = `${title}|${artist}`;

        if (seen.has(key)) continue;

        // Cada palabra escrita debe aparecer en el título o en el artista,
        // sin importar mayúsculas ni tildes ("beyonce" encuentra "Beyoncé").
        const text = `${title} ${artist}`;

        if (!words.every((word) => text.includes(word))) continue;

        seen.add(key);

        // Primero las que empiezan igual, luego título, luego artista.
        const rank = title.startsWith(phrase) ? 0
            : title.includes(phrase) ? 1
            : artist.includes(phrase) ? 2
            : 3;

        matches.push({ song, rank, title });
    }

    matches.sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title));

    renderSearchResults(
        matches.slice(0, MAX_SEARCH_RESULTS).map((m) => catalogSongToTrack(m.song))
    );
}

function renderSearchResults(tracks) {
    searchResults.classList.remove("hidden");
    searchResults.innerHTML = "";

    if (!tracks.length) {
        searchResults.innerHTML =
            `<div class="search-message">No encontramos canciones.</div>`;
        return;
    }

    tracks.forEach((track) => {
        const button = document.createElement("button");
        button.className = "search-result";

        const artists = artistsToText(track.artists);

        button.innerHTML = `
            ${
                track.albumImage
                    ? `<img class="search-result-image" src="${escapeHtml(track.albumImage)}" alt="">`
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
        previewUrl: song.previewUrl || null,
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

    preloadPreview();

    guessInput.disabled = false;
    guessButton.disabled = false;
    skipButton.disabled = false;
    guessInput.value = "";
    result.textContent = "";

    gameMode.textContent = mode === "daily" ? "DIARIO" : "INFINITO";
    difficulty.textContent = getDifficultyLabel(currentDifficulty);
    roundNumber.textContent = String(round).padStart(2, "0");

    // El selector sigue a la ronda (también en el diario), sin tocar
    // la dificultad que el usuario eligió para el infinito.
    highlightDifficulty(currentDifficulty);

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

    // Al mostrar el resultado suena la preview completa.
    setResultExtras(currentSong);
    playResultPreview();
}


// =====================================================
// MODAL DE RESULTADO: preview, progreso y enlaces
// El HTML está en index.html (#resultPlayer y #resultLinks).
// =====================================================

function formatTime(seconds) {
    const total = Math.max(0, Math.floor(seconds || 0));

    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function resetPreviewProgress() {
    previewBarFill.style.width = "0%";
    previewCurrentTime.textContent = "0:00";
    previewTotalTime.textContent = formatTime(PREVIEW_LENGTH_MS / 1000);
}

function updatePreviewProgress() {
    const duration = audio.duration || PREVIEW_LENGTH_MS / 1000;
    const percent = Math.min(100, (audio.currentTime / duration) * 100);

    previewBarFill.style.width = `${percent}%`;
    previewCurrentTime.textContent = formatTime(audio.currentTime);
    previewTotalTime.textContent = formatTime(duration);
}

audio.addEventListener("timeupdate", updatePreviewProgress);

previewPlayButton.addEventListener("click", async () => {
    if (isPlaying) {
        await stopPlayback();
        return;
    }

    // Pausada a medias: continúa donde estaba.
    if (resultPreviewStarted && audio.currentTime > 0 && !audio.ended) {
        audio.play().catch(() => {});
        return;
    }

    await playResultPreview();
});

// Clic en la barra para saltar a otro punto de la preview.
previewBar.addEventListener("click", (event) => {
    if (!Number.isFinite(audio.duration) || !resultPreviewStarted) return;

    const rect = previewBar.getBoundingClientRect();
    const ratio = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);

    audio.currentTime = ratio * audio.duration;
});

// song = null oculta preview y enlaces (p. ej. en el resumen del diario).
function setResultExtras(song) {
    resultPlayer.classList.toggle("hidden", !song);
    resultLinks.classList.toggle("hidden", !song);

    resultPreviewStarted = false;

    if (!song) return;

    resetPreviewProgress();

    spotifyLink.href =
        `https://open.spotify.com/track/${encodeURIComponent(song.id)}`;

    // Enlace a la búsqueda de YouTube (uno directo al vídeo exigiría
    // guardar el id del vídeo de cada canción).
    youtubeLink.href =
        "https://www.youtube.com/results?search_query=" +
        encodeURIComponent(`${song.name} ${artistsToText(song.artists)}`);
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

    // Al volver, el selector muestra otra vez la elección del usuario.
    highlightDifficulty(selectedDifficulty);

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

    searchSongs(guessInput.value);
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
// EXPORTS (lo que usan daily.js e infinite.js)
// Las variables `let` se exportan como enlaces "vivos": los otros
// archivos siempre leen su valor actual, pero no pueden asignarlas.
// =====================================================

export {
    DIFFICULTY_ORDER,
    getSongsByDifficulty,
    getDifficultyLabel,
    getRandomSong,
    setDifficulty,
    generateRandomFragmentStart,
    prepareRound,
    goHome,
    setResultExtras,
    currentAttempt,
    currentDifficulty,
    selectedDifficulty,
    result,
    resultModal,
    resultModalTitle,
    resultSongImage,
    resultSongTitle,
    resultSongArtist,
    resultDifficultyButtons,
    nextRoundButton
};


// =====================================================
// INICIO
// =====================================================

async function init() {
    await handleSpotifyCallback();
    await showSpotifyUser();
    await loadSongs();
}

// Se ejecuta cuando ya se han cargado daily.js e infinite.js.
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}