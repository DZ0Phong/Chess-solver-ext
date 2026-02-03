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
            const line = e.data;
            if (line === 'uciok') {
                console.log("Stockfish (Offscreen) Ready");
            }

            // Forward bestmove to background script
            if (typeof line === 'string' && line.startsWith('bestmove')) {
                const move = line.split(' ')[1];
                chrome.runtime.sendMessage({
                    type: "ENGINE_RESPONSE",
                    bestMove: move
                });
            }
        };

        engineWorker.postMessage('uci');
        // Boost Engine Strength
        engineWorker.postMessage('setoption name Skill Level value 20');
        engineWorker.postMessage('setoption name Threads value 2');
        engineWorker.postMessage('setoption name Hash value 64');
        engineWorker.postMessage('setoption name Contempt value 0'); // Play objectively

    } catch (e) {
        console.error("Offscreen Worker Error:", e);
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'INIT_ENGINE') {
        initEngine();
    } else if (request.type === 'ANALYZE_OFFSCREEN') {
        if (!engineWorker) initEngine();

        // Stop previous
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
