// This script runs in a hidden document, so it has access to full Worker API
console.log("Offscreen Document Loaded");

let engineWorker = null;

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
            // 1. Parse MultiPV info lines
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
                // Ensure bestMove is included/primary
                // Usually topMovesCache[1] == bestMove.

                chrome.runtime.sendMessage({
                    type: 'ENGINE_RESPONSE',
                    bestMove: bestMove,
                    topMoves: attempts
                });
            }
        };

        engineWorker.postMessage('uci');
        // Config: Human-like Sparring Mode.
        // Skill Level 10 (approx 1700 ELO).
        engineWorker.postMessage('setoption name Skill Level value 10');

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

        // Search
        // User requested "Accuracy". 500ms was too fast (weak).
        // Depth 18 is approximately 2000-2400 ELO range often.
        // But User said Depth 18 is "too slow" for Blitz (3 min).
        // Let's use 1000ms (1s) which is a good balance.
        engineWorker.postMessage(`position fen ${request.fen}`);
        engineWorker.postMessage('go movetime 1000');
    }
});

// Auto init
initEngine();
