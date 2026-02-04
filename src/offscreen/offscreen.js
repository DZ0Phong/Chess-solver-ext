// This script runs in a hidden document, so it has access to full Worker API
console.log("Offscreen Document Loaded");

let engineWorker = null;
let currentSkillLevel = 20; // Default to MAX
let topMovesCache = {};

function initEngine() {
    if (engineWorker) return;

    // Path relative to offscreen.html (in src/offscreen/)
    // Stockfish is in src/lib/stockfish/
    // Path: ../lib/stockfish/stockfish.js
    const scriptPath = '../lib/stockfish/stockfish.js';

    try {
        engineWorker = new Worker(scriptPath);

        engineWorker.onmessage = (e) => {
            const msg = e.data;
            if (typeof msg !== 'string') return;

            // 1. Parse MultiPV info lines
            // "info depth 10 ... multipv 2 ... pv e2e4"
            // Example: "info ... multipv 1 ... pv e2e4 e7e5"
            if (msg.startsWith('info') && msg.includes('multipv') && msg.includes(' pv ')) {
                const mpvMatch = msg.match(/multipv (\d+)/);
                // Strict regex for UCI move (e2e4 or a7a8q)
                const pvMatch = msg.match(/ pv ([a-h][1-8][a-h][1-8][qrbn]?)/);
                if (mpvMatch && pvMatch) {
                    const rank = parseInt(mpvMatch[1]);
                    // Only track reasonable top moves (1-3)
                    if (rank >= 1 && rank <= 3) {
                        topMovesCache[rank] = pvMatch[1];
                    }
                }
            }

            // 2. Handle Best Move
            if (msg.startsWith('bestmove')) {
                const bestMove = msg.split(' ')[1];

                // Collect top moves values (1, 2, 3)
                const attempts = [topMovesCache[1], topMovesCache[2], topMovesCache[3]].filter(m => m);

                chrome.runtime.sendMessage({
                    type: 'ENGINE_RESPONSE',
                    bestMove: bestMove,
                    topMoves: attempts
                });
            }
        };

        engineWorker.postMessage('uci');
        // Config: Start with MAX skill
        engineWorker.postMessage('setoption name Skill Level value 20');

        // **Feature: MultiPV 3 (Analyze top 3 moves)**
        engineWorker.postMessage('setoption name MultiPV value 3');

        engineWorker.postMessage('setoption name Threads value 2');
        engineWorker.postMessage('setoption name Hash value 64');
        engineWorker.postMessage('setoption name Contempt value 0');

    } catch (e) {
        console.error("Offscreen Worker Error:", e);
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'INIT_ENGINE') {
        initEngine();
    } else if (request.type === 'ANALYZE_OFFSCREEN') {
        if (!engineWorker) initEngine();

        // Reset cache for new position
        topMovesCache = {};
        engineWorker.postMessage('stop');

        // Dynamic settings based on speedMode
        const mode = request.speedMode || 'master';
        let moveTime = 1000; // Default 1s
        let skillLevel = 20; // Default MAX

        if (mode === 'gm') {
            // GM: Fastest + Smartest
            moveTime = 500;  // 0.5s think time
            skillLevel = 20; // MAX skill (3000+ ELO)
        } else if (mode === 'master') {
            // Master: Balanced
            moveTime = 1000; // 1s think time
            skillLevel = 15; // ~2000 ELO
        } else if (mode === 'analysis') {
            // Analysis: Deepest thinking
            moveTime = 2000; // 2s think time
            skillLevel = 20; // MAX skill
        }

        // Only update skill level if changed (avoid spam)
        if (skillLevel !== currentSkillLevel) {
            engineWorker.postMessage(`setoption name Skill Level value ${skillLevel}`);
            currentSkillLevel = skillLevel;
        }

        // Search
        engineWorker.postMessage(`position fen ${request.fen}`);
        engineWorker.postMessage(`go movetime ${moveTime}`);
    }
});

// Auto init
initEngine();
