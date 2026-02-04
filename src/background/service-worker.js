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

        currentResponseCallback = sendResponse;

        // Get speedMode from storage and send to offscreen
        chrome.storage.local.get(['speedMode'], (result) => {
            const speedMode = result.speedMode || 'master';

            ensureOffscreenDocument().then(() => {
                chrome.runtime.sendMessage({
                    type: 'ANALYZE_OFFSCREEN',
                    fen: request.fen,
                    speedMode: speedMode
                });
            });
        });

        return true; // MESSAGE PORT OPEN
    }

    // Listen for response from Offscreen
    if (request.type === "ENGINE_RESPONSE") {
        console.log("Best move from offscreen:", request.bestMove);
        if (currentResponseCallback) {
            currentResponseCallback({
                bestMove: request.bestMove,
                topMoves: request.topMoves
            });
            currentResponseCallback = null;
        }
    }
});
