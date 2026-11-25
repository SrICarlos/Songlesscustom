// =====================================================
// infinite.js — Modo INFINITO
//
// Rondas aleatorias sin límite. Empieza con la dificultad elegida en la
// pantalla principal y, al terminar cada ronda, el botón "siguiente" sube
// a la dificultad siguiente (tras "impossible" vuelve a "easy"). También
// se puede elegir la dificultad a mano desde el modal de resultado.
//
// Depende de app.js.
// =====================================================

import {
    DIFFICULTY_ORDER,
    getRandomSong,
    getDifficultyLabel,
    generateRandomFragmentStart,
    setDifficulty,
    prepareRound,
    currentDifficulty,
    selectedDifficulty,
    result,
    nextRoundButton
} from "./app.js";

let infiniteRound = 1;


function getNextDifficulty() {
    const index = DIFFICULTY_ORDER.indexOf(currentDifficulty);

    if (index === -1 || index >= DIFFICULTY_ORDER.length - 1) {
        return "easy";
    }

    return DIFFICULTY_ORDER[index + 1];
}

async function startInfiniteRound(difficultyKey) {
    // setDifficulty actualiza selectedDifficulty dentro de app.js.
    setDifficulty(difficultyKey);

    let song;

    try {
        song = getRandomSong(difficultyKey);
    } catch (error) {
        console.error("Error seleccionando canción:", error);

        result.textContent = "No hay canciones disponibles para esta dificultad.";
        return;
    }

    await prepareRound({
        mode: "infinite",
        song,
        startMs: generateRandomFragmentStart(),
        round: infiniteRound
    });
}


// Definición del modo (app.js lo registra en gameModes).
export const infiniteMode = {
    async start() {
        infiniteRound = 1;
        await startInfiniteRound(selectedDifficulty);
    },

    onRoundEnd() {
        // El infinito no guarda progreso.
    },

    updateNextButton() {
        nextRoundButton.textContent =
            `SIGUIENTE · ${getDifficultyLabel(getNextDifficulty())} →`;
    },

    async onNext() {
        infiniteRound++;
        await startInfiniteRound(getNextDifficulty());
    },

    async onPickDifficulty(difficultyKey) {
        infiniteRound++;
        await startInfiniteRound(difficultyKey);
    }
};