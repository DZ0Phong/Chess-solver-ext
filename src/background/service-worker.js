let currentResponseCallback = null;

// Initialize Offscreen Document
async function ensureOffscreenDocument() {
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
    });

    if (existingContexts.length > 0) {
        return;
    }

    await chrome.offscreen.createDocument({
        url: 'src/offscreen/offscreen.html',
        reasons: ['WORKERS'],
        justification: 'Stockfish Worker for Chess Analysis',
    });
}

// Listen for analysis requests
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "ANALYZE_BOARD") {

        console.log("Analyzing FEN:", request.fen);
        currentResponseCallback = sendResponse;

        // Ensure offscreen document exists then send message
        ensureOffscreenDocument().then(() => {
            chrome.runtime.sendMessage({
                type: 'ANALYZE_OFFSCREEN',
                fen: request.fen
            });
        });

        return true; // MESSAGE PORT OPEN
    }

    // Listen for response from Offscreen
    if (request.type === "ENGINE_RESPONSE") {
        console.log("Best move from offscreen:", request.bestMove);
        if (currentResponseCallback) {
            currentResponseCallback({ bestMove: request.bestMove });
            currentResponseCallback = null;
        }
    }
});
