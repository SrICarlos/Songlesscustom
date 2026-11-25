// =====================================================
// daily.js — Modo DIARIO
//
// Un set fijo por día (una canción por dificultad, de fácil a imposible)
// que cambia a las 00:00. No necesita servidor: las canciones se eligen
// con un generador aleatorio con semilla basada en la fecha, así que la
// misma fecha da siempre el mismo set. El progreso se guarda en
// localStorage y se reinicia solo al cambiar de día.
//
// Depende de app.js.
// =====================================================

import {
    DIFFICULTY_ORDER,
    getSongsByDifficulty,
    getDifficultyLabel,
    generateRandomFragmentStart,
    prepareRound,
    goHome,
    setResultExtras,
    currentAttempt,
    currentDifficulty,
    resultModal,
    resultModalTitle,
    resultSongImage,
    resultSongTitle,
    resultSongArtist,
    resultDifficultyButtons,
    nextRoundButton
} from "./app.js";

const DAILY_STORAGE_KEY = "songless_daily";

// Se pone a true mientras el modal muestra el resumen final del día.
let dailySummaryShown = false;


// -----------------------------------------------------
// Fecha y aleatoriedad con semilla
// -----------------------------------------------------

// Fecha local: cambia a las 00:00 de la hora del dispositivo.
// Para que cambie a las 00:00 UTC para todo el mundo, sustituye el
// cuerpo por:  return new Date().toISOString().slice(0, 10);
function getTodayKey() {
    const d = new Date();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");

    return `${d.getFullYear()}-${month}-${day}`;
}

// Hash de texto → número (semilla).
function xmur3(str) {
    let h = 1779033703 ^ str.length;

    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }

    return function () {
        h = Math.imul(h ^ (h >>> 16), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        return (h ^= h >>> 16) >>> 0;
    };
}

// Generador pseudoaleatorio con semilla.
function mulberry32(seed) {
    return function () {
        seed |= 0;
        seed = (seed + 0x6D2B79F5) | 0;

        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function createDailyRandom(dateKey, salt) {
    return mulberry32(xmur3(`${dateKey}:${salt}`)());
}


// -----------------------------------------------------
// Set del día
// -----------------------------------------------------

function getDailySet(dateKey) {
    const set = [];

    DIFFICULTY_ORDER.forEach((difficultyKey) => {
        // Ordenado para que el resultado no dependa del orden del JSON.
        const pool = getSongsByDifficulty(difficultyKey)
            .slice()
            .sort((a, b) => a.spotifyId.localeCompare(b.spotifyId));

        if (!pool.length) return;

        const rand = createDailyRandom(dateKey, difficultyKey);
        const song = pool[Math.floor(rand() * pool.length)];

        set.push({
            song,
            fragmentStartMs: generateRandomFragmentStart(rand)
        });
    });

    return set;
}


// -----------------------------------------------------
// Progreso (localStorage)
// -----------------------------------------------------

function loadDailyProgress() {
    const today = getTodayKey();

    try {
        const saved = JSON.parse(localStorage.getItem(DAILY_STORAGE_KEY));

        if (saved && saved.date === today && Array.isArray(saved.results)) {
            return saved;
        }
    } catch (error) {
        // Datos corruptos: se empieza de cero.
    }

    // Día nuevo (o primera vez).
    return { date: today, results: [] };
}

function saveDailyProgress(progress) {
    try {
        localStorage.setItem(DAILY_STORAGE_KEY, JSON.stringify(progress));
    } catch (error) {
        console.error("No se pudo guardar el progreso diario:", error);
    }
}

function recordDailyResult(won) {
    const progress = loadDailyProgress();

    progress.results.push({
        difficulty: currentDifficulty,
        won,
        attempts: currentAttempt
    });

    saveDailyProgress(progress);
}


// -----------------------------------------------------
// Flujo del modo
// -----------------------------------------------------

async function startDailyRound() {
    const progress = loadDailyProgress();
    const set = getDailySet(progress.date);

    if (!set.length) {
        console.error("Diario: no hay canciones disponibles.");
        return;
    }

    // Ya se completó el set de hoy.
    if (progress.results.length >= set.length) {
        showDailyFinished(progress, set);
        return;
    }

    const index = progress.results.length;
    const entry = set[index];

    dailySummaryShown = false;

    await prepareRound({
        mode: "daily",
        song: entry.song,
        startMs: entry.fragmentStartMs,
        round: index + 1
    });
}

function showDailyFinished(progress, set) {
    const wins = progress.results.filter((r) => r.won).length;

    dailySummaryShown = true;

    resultModalTitle.textContent = "¡DIARIO COMPLETADO! 🎉";
    resultSongTitle.textContent = `Aciertos: ${wins} / ${set.length}`;
    resultSongArtist.textContent = "Vuelve mañana a las 00:00";
    resultSongImage.classList.add("hidden");

    resultDifficultyButtons.forEach((button) => button.classList.add("hidden"));

    // El resumen no tiene una canción: sin preview ni enlaces.
    setResultExtras(null);

    nextRoundButton.textContent = "VOLVER AL INICIO";

    resultModal.classList.remove("hidden");
}


// -----------------------------------------------------
// Definición del modo (app.js lo registra en gameModes)
// -----------------------------------------------------

export const dailyMode = {
    async start() {
        await startDailyRound();
    },

    onRoundEnd(won) {
        dailySummaryShown = false;
        recordDailyResult(won);
    },

    updateNextButton() {
        const progress = loadDailyProgress();
        const set = getDailySet(progress.date);
        const next = set[progress.results.length];

        nextRoundButton.textContent = next
            ? `SIGUIENTE · ${getDifficultyLabel(next.song.difficulty)} →`
            : "VER RESUMEN";
    },

    async onNext() {
        // Resumen ya visible: volver al inicio.
        if (dailySummaryShown) {
            await goHome();
            return;
        }

        const progress = loadDailyProgress();
        const set = getDailySet(progress.date);

        if (progress.results.length >= set.length) {
            showDailyFinished(progress, set);
            return;
        }

        await startDailyRound();
    }
};