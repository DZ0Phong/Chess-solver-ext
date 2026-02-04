

// --- Configuration & State ---
let isEnabled = false;
let isAutoMoveEnabled = false;
let isVisualsHidden = false;
let observer = null;
let moveListObserver = null; // New observer for move list
let boardElement = null;
let moveListElement = null;
let lastFen = "";
let engineColor = 'w';
let currentTurn = 'w'; // Track turn statefully
let lastGrid = null; // Track previous board state

// Delay Settings
let minDelay = 800;
let maxDelay = 2000;
let speedMode = 'master'; // 'gm', 'master', 'analysis'

// --- Initialization ---

chrome.storage.local.get(['solverEnabled', 'autoMoveEnabled', 'hideVisuals', 'minDelay', 'maxDelay', 'speedMode'], (result) => {
    if (result.solverEnabled) {
        enableSolver();
    }
    if (result.autoMoveEnabled) {
        isAutoMoveEnabled = true;
    }
    if (result.hideVisuals) {
        isVisualsHidden = true;
    }
    // Load delay settings
    if (result.minDelay) minDelay = result.minDelay;
    if (result.maxDelay) maxDelay = result.maxDelay;
    if (result.speedMode) speedMode = result.speedMode;
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "TOGGLE_SOLVER") {
        request.enabled ? enableSolver() : disableSolver();
    }
    if (request.type === "TOGGLE_AUTO_MOVE") {
        isAutoMoveEnabled = request.enabled;

    }
    if (request.type === "TOGGLE_VISUALS") {
        isVisualsHidden = request.hidden;

        if (isVisualsHidden) {
            removeHighlights();
        } else {
            // Force redraw immediately
            lastFen = "";
            analyzeBoard();
        }
    }
    if (request.type === "UPDATE_DELAY_SETTINGS") {
        minDelay = request.minDelay || 800;
        maxDelay = request.maxDelay || 2000;
        if (request.speedMode) speedMode = request.speedMode;
    }
});

// --- Core Logic ---

function enableSolver() {
    if (isEnabled) return;
    isEnabled = true;

    addResetButton();
    startBoardObserver();
    startMoveListObserver(); // Start watching moves specifically
    startPoller(); // Start failsafe
    startNewGameDetector(); // NEW: Detect new games without refresh
}

function disableSolver() {
    isEnabled = false;

    removeResetButton();
    if (observer) {
        observer.disconnect();
        observer = null;
    }
    if (moveListObserver) {
        moveListObserver.disconnect();
        moveListObserver = null;
    }
    stopPoller();
    removeHighlights();
}

// --- Watchers ---

function startBoardObserver() {
    let retryCount = 0;
    const maxRetries = 10;

    const findBoard = () => {
        retryCount++;


        const possibleBoards = [
            document.querySelector('chess-board'),
            document.querySelector('#board-layout-chessboard'),
            document.querySelector('.board'),
            document.querySelector('wc-chess-board'),
            document.querySelector('[class*="board-layout"]')
        ];
        boardElement = possibleBoards.find(b => b !== null);

        if (boardElement) {
            console.log("Solver: ✅ Board Found");

            // Clear any old observer
            if (observer) observer.disconnect();

            observer = new MutationObserver(handleBoardMutation);
            observer.observe(boardElement, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class']
            });

            // Reset extensionContextBroken flag on successful board detection
            extensionContextBroken = false;

            // Remove refresh warning if it exists
            const warning = document.getElementById('solver-refresh-warning');
            if (warning) warning.remove();

            // Wait for game over modal to close with polling retry
            let modalCheckAttempts = 0;
            const waitForModalClose = () => {
                modalCheckAttempts++;
                if (!isGameOver()) {
                    console.log("Solver: Ready");
                    analyzeBoard();
                } else if (modalCheckAttempts < 10) {
                    // Keep trying every 500ms for up to 5 seconds
                    setTimeout(waitForModalClose, 500);
                } else {

                }
            };
            setTimeout(waitForModalClose, 500);
        } else if (retryCount < maxRetries) {

            setTimeout(findBoard, retryCount * 500); // Exponential backoff
        } else {
            console.error("Solver: ❌ Board not found after max retries! Try refreshing.");
        }
    };
    findBoard();
}

function startMoveListObserver() {
    // Watch for the move list to appear and then observe it for changes
    const findMoveList = () => {
        const list = document.querySelector('vertical-move-list') || document.querySelector('.move-list') || document.querySelector('div[class*="move-list"]');
        if (list) {

            moveListElement = list;
            moveListObserver = new MutationObserver((mutations) => {
                // If move list changes, it's DEFINITELY a turn change or move update

                handleBoardMutation();
            });
            moveListObserver.observe(list, {
                childList: true,
                subtree: true,
                attributes: true, // Watch for class changes (selected highlight)
                characterData: true
            });
        } else {
            setTimeout(findMoveList, 2000);
        }
    };
    findMoveList();
}

let pollerInterval = null;
function startPoller() {
    if (pollerInterval) clearInterval(pollerInterval);
    // Poll every 1s to check if we are stuck (Turn is ours but we haven't acted?)
    pollerInterval = setInterval(() => {
        if (!isEnabled || !boardElement) return;

        // Fast DOM check
        const domTurn = detectTurnFromDOM();
        const playerColor = getPlayerColor();

        if (domTurn && domTurn === playerColor && currentTurn !== playerColor) {

            analyzeBoard();
        }
    }, 1000);
}

// Helper to check if Game Over modal is actually visible
function isGameOver() {
    // Only check very specific modals that are actual game-over indicators
    // Avoid broad selectors like div[class*="game-over"] which cause false positives

    // Method 1: Check for Chess.com specific game-over modal
    const gameOverModal = document.querySelector('.game-over-modal, .modal-game-over');
    if (gameOverModal) {
        const style = window.getComputedStyle(gameOverModal);
        if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
            return true;
        }
    }

    // Method 2: Check for result text on board (e.g., "White wins", "Black wins", "Draw")
    const resultElement = document.querySelector('.game-result, [class*="result-component"]');
    if (resultElement && resultElement.offsetParent !== null) {
        return true;
    }

    return false;
}

function stopPoller() {
    if (pollerInterval) clearInterval(pollerInterval);
    pollerInterval = null;
}

// NEW: Detect new game starts (URL change or game-over modal disappearing)
let lastUrl = location.href;
let newGameObserver = null;

function forceRestart() {
    console.log("Solver: 🔄 Restarting...");

    // Clear ALL state
    boardElement = null;
    moveListElement = null;
    lastFen = "";
    lastGrid = null;
    currentTurn = 'w';
    extensionContextBroken = false; // Reset this flag!

    // Clear observers
    if (observer) observer.disconnect();
    if (moveListObserver) moveListObserver.disconnect();
    stopPoller();
    removeHighlights();

    // Remove any refresh warning
    const warning = document.getElementById('solver-refresh-warning');
    if (warning) warning.remove();

    // Restart after short delay (give page time to load new board)

    setTimeout(() => {

        startBoardObserver();
        startMoveListObserver();
        startPoller();
        console.log("Solver: ✅ Active");
    }, 1000); // Increased to 1s for more reliable detection
}

function startNewGameDetector() {
    // 1. URL Change Detection (setInterval fallback)
    setInterval(() => {
        if (location.href !== lastUrl) {
            console.log("Solver: URL changed");
            lastUrl = location.href;
            forceRestart();
        }
    }, 1000);

    // 2. History API Hooks (SPA navigation - more reliable)
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
        originalPushState.apply(this, args);
        console.log("Solver: New Game detected");
        setTimeout(forceRestart, 500);
    };

    history.replaceState = function (...args) {
        originalReplaceState.apply(this, args);
        console.log("Solver: New Game detected");
        setTimeout(forceRestart, 500);
    };

    window.addEventListener('popstate', () => {
        console.log("Solver: Navigating...");
        setTimeout(forceRestart, 500);
    });

    // 3. Game-Over Modal Disappearing (new game button clicked)
    newGameObserver = new MutationObserver(() => {
        // Check if board element got disconnected (replaced with new one)
        if (boardElement && !boardElement.isConnected) {
            console.log("Solver: Re-syncing board...");
            forceRestart();
        }
    });

    newGameObserver.observe(document.body, {
        childList: true,
        subtree: true
    });
}

let analysisDebounce = null;
function handleBoardMutation(mutations) {
    if (!isEnabled) return;
    if (analysisDebounce) clearTimeout(analysisDebounce);
    analysisDebounce = setTimeout(() => {
        analyzeBoard();
    }, 100);
}

let extensionContextBroken = false;

function showRefreshWarning() {
    const existingWarning = document.getElementById('solver-refresh-warning');
    if (existingWarning) return;

    const warning = document.createElement('div');
    warning.id = 'solver-refresh-warning';
    warning.innerHTML = '⚠️ Chess Solver disconnected! <button onclick="location.reload()">Click to Refresh</button>';
    warning.style.cssText = `
        position: fixed;
        top: 10px;
        left: 50%;
        transform: translateX(-50%);
        background: #e74c3c;
        color: white;
        padding: 10px 20px;
        border-radius: 8px;
        z-index: 999999;
        font-family: Arial, sans-serif;
        font-size: 14px;
        box-shadow: 0 4px 15px rgba(0,0,0,0.3);
    `;
    warning.querySelector('button').style.cssText = `
        margin-left: 10px;
        background: white;
        color: #e74c3c;
        border: none;
        padding: 5px 10px;
        border-radius: 4px;
        cursor: pointer;
        font-weight: bold;
    `;
    document.body.appendChild(warning);
}

function analyzeBoard() {
    // 0. Extension Context Check - if broken, nothing we can do
    if (extensionContextBroken) {
        return;
    }

    // Quick check if chrome.runtime is still valid
    try {
        if (!chrome.runtime || !chrome.runtime.id) {
            extensionContextBroken = true;
            showRefreshWarning();
            return;
        }
    } catch (e) {
        extensionContextBroken = true;
        showRefreshWarning();
        return;
    }

    // 0b. Validity Check (Zombie Board Fix)
    if (!boardElement || !boardElement.isConnected) {
        boardElement = null;
        if (observer) observer.disconnect();
        startBoardObserver(); // Force re-detection
        return;
    }

    // 1. FAST Turn Detection (DOM only)
    const domTurn = detectTurnFromDOM();
    if (domTurn) {
        currentTurn = domTurn;
    }

    // 2. Determine Player Color
    const playerColor = getPlayerColor();

    // DEBUG: Log turn detection status


    // 3. Early Exit
    if (currentTurn !== playerColor) {

        removeHighlights();
        return;
    }

    // 4. Game Over Check
    if (isGameOver()) return;

    try {
        // 4. Parse FEN (Only if it IS our turn)
        const { fen, grid } = parseBoardToFEN(boardElement);
        if (!fen) return; // Exit if FEN invalid or Game Over

        // CRITICAL: Validate piece count (prevent garbage FEN)
        let pieceCount = 0;
        grid.forEach(row => row.forEach(p => { if (p) pieceCount++; }));
        if (pieceCount < 4) {
            console.warn(`Solver: Invalid board state - only ${pieceCount} pieces detected. Skipping.`);
            return;
        }

        lastGrid = grid;

        if (fen === lastFen) return; // No change
        lastFen = fen;

        // Update FEN with correct turn
        const fenParts = fen.split(' ');
        fenParts[1] = currentTurn;
        const correctFen = fenParts.join(' ');



        // Send to background
        try {
            chrome.runtime.sendMessage({
                type: "ANALYZE_BOARD",
                fen: correctFen
            }, (response) => {
                if (chrome.runtime.lastError) {
                    const errMsg = chrome.runtime.lastError.message || '';
                    if (errMsg.includes('Extension context invalidated') || errMsg.includes('Extension runtime context')) {
                        extensionContextBroken = true;
                        showRefreshWarning();
                    }
                    return;
                }
                if (response && response.bestMove) {
                    if (response.bestMove === '(none)') {
                        console.log("Solver: Engine detected Game Over (none)");
                        return;
                    }

                    // VALIDATE MOVE: Check source square has a piece
                    const from = response.bestMove.substring(0, 2);
                    const fromFile = from.charCodeAt(0) - 97; // a=0, h=7
                    const fromRank = parseInt(from[1]) - 1;   // 1=0, 8=7
                    const gridPiece = grid[7 - fromRank]?.[fromFile];

                    if (!gridPiece) {
                        console.warn(`Solver: Engine suggested ${response.bestMove} but source square is EMPTY! Grid may be stale.`);
                        // Force re-analyze instead of showing garbage
                        lastFen = "";
                        return;
                    }

                    highlightMove(response.bestMove, response.topMoves);
                }
            });
        } catch (err) {
            if (err.message && (err.message.includes("Extension context invalidated") || err.message.includes("Extension runtime context"))) {
                extensionContextBroken = true;
                console.error("Solver: Extension context invalidated! Please refresh.");
                showRefreshWarning();
            } else {
                console.error("Solver: SendMessage failed", err);
            }
        }
    } catch (e) {
        console.error("Solver: Analysis failed", e);
    }
}


function detectTurnFromDOM() {
    // PRIORITY 1: Clock-based detection (Most Reliable on Chess.com)
    // The player whose turn it is has an "active" or animated clock
    const clocks = document.querySelectorAll('.clock-component, [class*="clock"]');
    for (const clock of clocks) {
        const isActive = clock.classList.contains('clock-player-turn') ||
            clock.classList.contains('active') ||
            clock.querySelector('.clock-running, .clock-active');
        if (isActive) {
            // Determine if this clock is bottom (our clock) or top (opponent)
            const rect = clock.getBoundingClientRect();
            const viewportHeight = window.innerHeight;
            const isBottomClock = rect.top > viewportHeight / 2;

            const playerColor = getPlayerColor();
            // If bottom clock is active -> it's our turn
            // If top clock is active -> opponent's turn
            if (isBottomClock) {
                // OUR TURN
                return playerColor;
            } else {
                // OPPONENT TURN
                return playerColor === 'w' ? 'b' : 'w';
            }
        }
    }

    // PRIORITY 2: Move list based detection (Fallback)
    const moveList = document.querySelector('vertical-move-list') || document.querySelector('.move-list') || document.querySelector('div[class*="move-list"]');
    if (!moveList) return null;

    // Check for a highlighted last move
    const selected = moveList.querySelector('.selected, .highlight');
    if (selected) {
        if (selected.classList.contains('white') || selected.classList.contains('node-white')) return 'b';
        if (selected.classList.contains('black') || selected.classList.contains('node-black')) return 'w';

        if (selected.parentElement && selected.parentElement.children.length > 0) {
            const siblings = Array.from(selected.parentElement.children).filter(c =>
                c.classList.contains('node') || c.classList.contains('move')
            );
            if (siblings[0] === selected) return 'b';
            if (siblings[1] === selected) return 'w';
        }
    }

    // Count moves
    const moves = moveList.querySelectorAll('.node, .move-node-content, .move, .u-font-extra-small');
    let validMoves = 0;
    moves.forEach(m => {
        const text = m.innerText.trim();
        if (text && !text.match(/^\d+\.?$/) && !m.classList.contains('empty')) {
            validMoves++;
        }
    });

    if (validMoves === 0) return 'w';
    return (validMoves % 2 === 0) ? 'w' : 'b';
}

function getPlayerColor() {
    if (!boardElement) return 'w';

    // 1. High Priority: Attributes (Very reliable on Chess.com)
    const orientation = boardElement.getAttribute('orientation');
    if (orientation) return orientation.startsWith('b') ? 'b' : 'w';
    if (boardElement.classList.contains('flipped')) return 'b';

    // 2. Robust Geometric Detection (Vote System)
    // Scan ALL pieces to determine orientation based on their positions
    // This works even if A1 is empty (user reported bug when A1 rook missing)

    let whiteVotes = 0;
    let blackVotes = 0;
    const boardRect = boardElement.getBoundingClientRect();
    const pieces = boardElement.querySelectorAll('.piece'); // Or elements with square-xy

    pieces.forEach(p => {
        const cls = p.className || "";
        const match = cls.match(/square-(\d)(\d)/);
        if (match) {
            const f = parseInt(match[1]); // 1-8 (a-h)
            const r = parseInt(match[2]); // 1-8 (rank)

            const rect = p.getBoundingClientRect();
            // Calculate relative Y position (0.0 to 1.0)
            // 0.0 = Top, 1.0 = Bottom
            const relativeY = (rect.top - boardRect.top) / boardRect.height;

            // Expected relative Y for this rank:
            // If White: Rank 8 is Top (0.0), Rank 1 is Bottom (0.875) -> Formula: (8-r)/8
            // If Black: Rank 1 is Top (0.0), Rank 8 is Bottom (0.875) -> Formula: (r-1)/8

            const expectedIfWhite = (8 - r) / 8;
            const expectedIfBlack = (r - 1) / 8;

            // Compare error
            const errWhite = Math.abs(relativeY - expectedIfWhite);
            const errBlack = Math.abs(relativeY - expectedIfBlack);

            if (errBlack < errWhite) blackVotes++;
            else whiteVotes++;
        }
    });

    if (blackVotes > whiteVotes) return 'b';
    return 'w';
}

function isWhitePiece(p) { return 'PNBRQK'.includes(p); }
function isBlackPiece(p) { return 'pnbrqk'.includes(p); }

// --- FEN Parsing ---

function parseBoardToFEN(board) {
    // 0. Game Over Check - Stop analyzing if game is done
    if (isGameOver()) {
        return { fen: null, grid: [] }; // Return null to signal stop
    }

    const grid = Array(8).fill(null).map(() => Array(8).fill(null));

    // Strategy: Broadest search
    let elements = board.querySelectorAll('.piece');
    if (elements.length === 0) {
        // Broad search for anything positioned
        elements = board.querySelectorAll('[class*="square-"]');
    }

    elements.forEach(el => {
        const cls = (el.className && typeof el.className === 'string') ? el.className : "";
        if (!cls) return;
        if (cls.includes('highlight') || cls.includes('hint') || cls.includes('hover') || cls.includes('fade')) return;

        // Coordinates
        const squareMatch = cls.match(/square-(\d)(\d)/);
        if (squareMatch) {
            const file = parseInt(squareMatch[1], 10) - 1;
            const rank = parseInt(squareMatch[2], 10) - 1;

            let color = null;
            let type = null;

            // Priority 1: data-piece attribute (e.g. "wP", "bK")
            const dataPiece = el.getAttribute('data-piece');
            if (dataPiece && dataPiece.length === 2) {
                color = dataPiece[0];
                type = dataPiece[1].toLowerCase();
            }

            // Priority 2: Standard Class (wp, bk)
            if (!color) {
                const shortMatch = cls.match(/\b([wb])([prnbqk])\b/);
                if (shortMatch) {
                    color = shortMatch[1];
                    type = shortMatch[2];
                }
            }

            // Priority 3: Long Class (white pawn)
            if (!color) {
                const colorMatch = cls.match(/\b(white|black)\b/);
                const typeMatch = cls.match(/\b(pawn|rook|knight|bishop|queen|king)\b/);
                if (colorMatch && typeMatch) {
                    color = colorMatch[1][0];
                    const map = { pawn: 'p', rook: 'r', knight: 'n', bishop: 'b', queen: 'q', king: 'k' };
                    type = map[typeMatch[1]];
                }
            }

            // Priority 4: Background Image URL (last resort for custom themes)
            if (!color) {
                const style = window.getComputedStyle(el);
                const bg = style.backgroundImage || "";
                if (bg && bg !== 'none') {
                    // url(".../wp.png") or ".../b_k.svg"
                    const bgMatch = bg.match(/([wb])_?([prnbqk])\.(png|svg|jpg|webp)/i);
                    if (bgMatch) {
                        color = bgMatch[1].toLowerCase();
                        type = bgMatch[2].toLowerCase();
                    }
                }
            }

            // Priority 5: IMG tag detection (For specialized sets/Arcade)
            if (!color) {
                const img = el.tagName === 'IMG' ? el : el.querySelector('img');
                if (img && img.src) {
                    const srcMatch = img.src.match(/([wb])_?([prnbqk])\.(png|svg|jpg|webp)/i);
                    if (srcMatch) {
                        color = srcMatch[1].toLowerCase();
                        type = srcMatch[2].toLowerCase();
                    }
                }
            }

            if (color && type) {
                if (color === 'w') type = type.toUpperCase();
                grid[7 - rank][file] = type;
            }
        }
    });

    let fenRows = [];
    let whiteKingFound = false;
    let blackKingFound = false;

    for (let row = 0; row < 8; row++) {
        let emptyCount = 0;
        let rowStr = "";
        for (let col = 0; col < 8; col++) {
            const piece = grid[row][col];
            if (piece) {
                if (emptyCount > 0) {
                    rowStr += emptyCount;
                    emptyCount = 0;
                }
                rowStr += piece;
                if (piece === 'K') whiteKingFound = true;
                if (piece === 'k') blackKingFound = true;
            } else {
                emptyCount++;
            }
        }
        if (emptyCount > 0) rowStr += emptyCount;
        fenRows.push(rowStr);
    }

    // Check if board is completely empty (Loading/Transition)
    const hasPieces = grid.some(row => row.some(p => p !== null));
    if (!hasPieces) {
        return { fen: null, grid: [] };
    }

    if (!whiteKingFound || !blackKingFound) {
        console.warn("Solver: KINGS MISSING! Grid dump:", grid);
        return { fen: null, grid: [] }; // Abort if invalid board state
    }

    return {
        fen: `${fenRows.join('/')} w - - 0 1`,
        grid: grid
    };
}

// --- Visuals (Responsive Overlay) ---

const OVERLAY_ID = 'chess-solver-overlay-main';

function getOverlay() {
    if (!boardElement) return null;

    let container = document.getElementById(OVERLAY_ID);

    // Check if existing overlay is orphaned (not in current board)
    if (container && !boardElement.contains(container)) {
        container.remove();
        container = null;
    }

    if (!container) {
        container = document.createElement('div');
        container.id = OVERLAY_ID;
        container.className = 'solver-overlay';
        container.style.position = 'absolute';
        container.style.top = '0';
        container.style.left = '0';
        container.style.width = '100%';
        container.style.height = '100%';
        container.style.pointerEvents = 'none';
        container.style.zIndex = '1000';
        boardElement.appendChild(container);
    }
    return container;
}

function removeHighlights() {
    // 1. Singleton ID Remove
    const existing = document.getElementById(OVERLAY_ID);
    if (existing) existing.remove();

    // 2. Class Cleanup (Legacy/Zombie)
    const orphans = document.querySelectorAll('.solver-overlay');
    orphans.forEach(el => el.remove());

    const arrows = document.querySelectorAll('.solver-arrow');
    arrows.forEach(el => el.remove());
}

function highlightMove(move, altMoves = []) {
    removeHighlights();
    const playerColor = getPlayerColor();
    const isFlipped = playerColor === 'b';
    if (currentTurn !== playerColor) return;

    if (!move || move.length < 4) return;
    if (!boardElement) return;

    // Game Over check to prevent drawing on finished game
    if (document.querySelector('.game-over-modal') || document.querySelector('.modal-game-over') || document.querySelector('div[class*="game-over"]')) {
        return;
    }

    if (!isVisualsHidden) {
        const container = getOverlay(); // Creates new if removed
        if (container) {
            // Draw Best Move (Green Arrow)
            const from = move.substring(0, 2);
            const to = move.substring(2, 4);
            console.log(`Solver: Move ${from}->${to} (${playerColor === 'w' ? 'White' : 'Black'})`);
            drawArrow(container, from, to, isFlipped, '#00e600'); // Matrix Green

            // Draw Alt Moves (Yellow Arrows)
            if (altMoves && altMoves.length > 0) {
                // Limit to top 2 alternatives to provide variety without clutter
                altMoves.slice(0, 2).forEach(m => {
                    if (m !== move && m.length >= 4) {
                        const altFrom = m.substring(0, 2);
                        const altTo = m.substring(2, 4);
                        if (altTo !== to || altFrom !== from) {
                            drawArrow(container, altFrom, altTo, isFlipped, '#ffcc00'); // Yellow
                        }
                    }
                });
            }
        }
    }

    if (isAutoMoveEnabled) {
        const rect = boardElement.getBoundingClientRect();
        const squareSize = rect.width / 8;

        const from = move.substring(0, 2);
        const to = move.substring(2, 4);
        console.log(`Solver: Auto-moving ${from}->${to} (${speedMode})`);

        // GM Mode: Minimal delay + FAST DRAG (click-click unreliable)
        if (speedMode === 'gm') {
            const gmDelay = 50 + Math.random() * 150; // 50-200ms only
            setTimeout(() => {
                if (isGameOver()) return;
                // Pass 'true' as final arg for IS_FAST_MODE
                simulateMove(from, to, isFlipped, null, null, true);
            }, gmDelay);
        } else {
            // Normal drag mode for Master/Analysis
            const randomDelay = minDelay + Math.random() * (maxDelay - minDelay);
            setTimeout(() => {
                if (isGameOver()) return;
                simulateMove(from, to, isFlipped, null, null);
            }, randomDelay);
        }
    }
}

function createHighlight(container, square, type, isFlipped) {
    // Disabled as per user request (Arrows Only)
}

function drawArrow(container, from, to, isFlipped, color = '#00e600') {
    let svg = container.querySelector('svg');
    const svgNs = "http://www.w3.org/2000/svg";

    if (!svg) {
        svg = document.createElementNS(svgNs, "svg");
        svg.style.position = "absolute";
        svg.style.top = "0";
        svg.style.left = "0";
        svg.style.width = "100%";
        svg.style.height = "100%";
        svg.style.pointerEvents = "none";
        svg.setAttribute('viewBox', '0 0 8 8');

        // Create Definitions for markers of different colors
        const defs = document.createElementNS(svgNs, "defs");

        const createMarker = (id, color) => {
            const marker = document.createElementNS(svgNs, "marker");
            marker.setAttribute("id", id);
            marker.setAttribute("markerWidth", "4");
            marker.setAttribute("markerHeight", "4");
            marker.setAttribute("refX", "2");
            marker.setAttribute("refY", "2");
            marker.setAttribute("orient", "auto");
            const path = document.createElementNS(svgNs, "path");
            path.setAttribute("d", "M0,0 L4,2 L0,4");
            path.setAttribute("fill", color);
            marker.appendChild(path);
            return marker;
        };

        defs.appendChild(createMarker("arrow-green", "#00e600"));
        defs.appendChild(createMarker("arrow-yellow", "#ffcc00"));

        svg.appendChild(defs);
        container.appendChild(svg);
    }

    const getCoords = (sq) => {
        const fileMap = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 };
        const f = fileMap[sq[0]];
        const r = parseInt(sq[1]);
        if (!f || !r || isNaN(f) || isNaN(r)) {

            return { x: 0, y: 0 };
        }
        if (!isFlipped) {
            return { x: (f - 1) + 0.5, y: (8 - r) + 0.5 };
        } else {
            return { x: (8 - f) + 0.5, y: (r - 1) + 0.5 };
        }
    };

    const c1 = getCoords(from);
    const c2 = getCoords(to);

    const line = document.createElementNS(svgNs, "line");
    line.setAttribute("x1", c1.x);
    line.setAttribute("y1", c1.y);
    line.setAttribute("x2", c2.x);
    line.setAttribute("y2", c2.y);
    line.setAttribute("stroke", color);
    line.setAttribute("stroke-width", "0.15");
    line.setAttribute("stroke-opacity", "0.9");

    // Choose marker based on color
    const markerId = color === '#00e600' ? 'arrow-green' : 'arrow-yellow';
    line.setAttribute("marker-end", `url(#${markerId})`);

    svg.appendChild(line);
}

// FAST CLICK MODE for GM (click source -> click target, no drag)
function simulateFastClick(from, to, isFlipped) {
    if (!boardElement) return;

    const getSquareCoords = (sq) => {
        const fileMap = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 };
        const f = fileMap[sq[0]];
        const r = parseInt(sq[1]);
        if (!f || !r) return null;

        const rect = boardElement.getBoundingClientRect();
        const sqSize = rect.width / 8;

        let left, top;
        if (!isFlipped) {
            left = (f - 1) * sqSize + sqSize * 0.5;
            top = (8 - r) * sqSize + sqSize * 0.5;
        } else {
            left = (8 - f) * sqSize + sqSize * 0.5;
            top = (r - 1) * sqSize + sqSize * 0.5;
        }
        return { x: rect.left + left, y: rect.top + top };
    };

    // RECALCULATE source coords right now (to handle viewport changes)
    const freshFromCoords = getSquareCoords(from);
    if (!freshFromCoords) return;

    // Find source element (DOM lookup needs to happen now too if we want to be safe, but let's trust piece hasn't moved yet)
    // Actually, finding the element again is safer if board re-rendered, but usually the element ref is stable enough for milliseconds.
    // However, coordinate IS critical.

    const fileMap = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 };
    const f = fileMap[from[0]];
    const r = parseInt(from[1]);
    const sourceEl = boardElement.querySelector(`.piece.square-${f}${r}`) ||
        boardElement.querySelector(`.square-${f}${r}`);

    if (!sourceEl) return;

    // Click source (select piece)
    sourceEl.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, cancelable: true, view: window,
        clientX: freshFromCoords.x, clientY: freshFromCoords.y, buttons: 1
    }));
    sourceEl.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true, cancelable: true, view: window,
        clientX: freshFromCoords.x, clientY: freshFromCoords.y, buttons: 0
    }));
    sourceEl.dispatchEvent(new MouseEvent('click', {
        bubbles: true, cancelable: true, view: window,
        clientX: freshFromCoords.x, clientY: freshFromCoords.y
    }));

    // Tiny delay then click destination
    setTimeout(() => {
        // RECALCULATE coords to handle viewport changes (e.g. console open)
        const freshToCoords = getSquareCoords(to);
        if (!freshToCoords) return;

        const destEls = document.elementsFromPoint(freshToCoords.x, freshToCoords.y);
        const destEl = destEls.find(e => {
            const c = String(e.className || "");
            return !c.includes('solver') && (c.includes('square') || c.includes('piece'));
        }) || destEls[0];

        if (destEl) {
            destEl.dispatchEvent(new MouseEvent('mousedown', {
                bubbles: true, cancelable: true, view: window,
                clientX: freshToCoords.x, clientY: freshToCoords.y, buttons: 1
            }));
            destEl.dispatchEvent(new MouseEvent('mouseup', {
                bubbles: true, cancelable: true, view: window,
                clientX: freshToCoords.x, clientY: freshToCoords.y, buttons: 0
            }));
            destEl.dispatchEvent(new MouseEvent('click', {
                bubbles: true, cancelable: true, view: window,
                clientX: freshToCoords.x, clientY: freshToCoords.y
            }));
        }
    }, 30);
}

function simulateMove(from, to, isFlipped, ignoredRect, ignoredSquareSize, isFastMode = false) {
    // REFRESH COORDINATES: Rect passed from outside is likely stale due to debounce/timeouts
    if (!boardElement) return;
    const rect = boardElement.getBoundingClientRect();
    const squareSize = rect.width / 8;



    // Center point adjustment (0.5 is center).
    // Use 0.25 (25%) to grab VERY HIGH on 3D pieces to prevent "slipping down"
    const CENTER_OFFSET = 0.25;
    // NEW: DOM-based coordinate lookup (pixel-perfect) with RANDOM OFFSET for human-like behavior
    const getCoords = (sq) => {
        const fileMap = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 };
        const f = fileMap[sq[0]];
        const r = parseInt(sq[1]);
        if (!f || !r) return { x: NaN, y: NaN };

        // Random offset: ±5% of square size for X only (small variance for anti-detection)
        const randomOffsetX = () => (Math.random() - 0.5) * 0.1; // -0.05 to +0.05

        // Special handling for VISUAL bottom row - pieces often extend below square
        // If NOT flipped (White): bottom row = rank 1
        // If flipped (Black): bottom row = rank 8
        const isVisualBottomRow = isFlipped ? (r === 8) : (r === 1);
        const yOffset = isVisualBottomRow ? 0.15 : CENTER_OFFSET; // Grab higher on bottom row

        // Build the square class name
        const squareClass = `square-${f}${r}`;

        // Try to find the piece on this square first
        let targetEl = boardElement.querySelector(`.piece.${squareClass}`);

        // Fallback to the square itself
        if (!targetEl) {
            targetEl = boardElement.querySelector(`.${squareClass}`);
        }

        if (targetEl) {
            const elRect = targetEl.getBoundingClientRect();
            // Click near center - X has small random, Y is fixed for accuracy
            return {
                x: elRect.left + elRect.width * (0.5 + randomOffsetX()) + window.scrollX,
                y: elRect.top + elRect.height * yOffset + window.scrollY
            };
        }

        // Fallback to calculated (old method)
        let left, top;
        if (!isFlipped) {
            left = (f - 1) * squareSize + squareSize * (0.5 + randomOffsetX());
            top = (8 - r) * squareSize + squareSize * yOffset;
        } else {
            left = (8 - f) * squareSize + squareSize * (0.5 + randomOffsetX());
            top = (r - 1) * squareSize + squareSize * yOffset;
        }
        return {
            x: rect.left + window.scrollX + left,
            y: rect.top + window.scrollY + top
        };
    };

    const fromCoords = getCoords(from);
    const toCoords = getCoords(to);



    if (!Number.isFinite(fromCoords.x) || !Number.isFinite(fromCoords.y) ||
        !Number.isFinite(toCoords.x) || !Number.isFinite(toCoords.y)) {
        return;
    }

    // ULTRA ROBUST HYBRID EVENT DISPATCHER
    const dispatchAll = (el, type, x, y, buttons = 1) => {
        const opts = {
            bubbles: true, cancelable: true, view: window,
            clientX: x - window.scrollX, clientY: y - window.scrollY,
            screenX: x, screenY: y,
            buttons: buttons, pointerId: 1, isPrimary: true
        };
        // 1. Pointer Events
        try { el.dispatchEvent(new PointerEvent('pointer' + type, opts)); } catch (e) { }
        // 2. Mouse Events
        if (type === 'down') el.dispatchEvent(new MouseEvent('mousedown', opts));
        if (type === 'move') el.dispatchEvent(new MouseEvent('mousemove', opts));
        if (type === 'up') el.dispatchEvent(new MouseEvent('mouseup', opts));
        if (type === 'over') el.dispatchEvent(new MouseEvent('mouseover', opts));
        if (type === 'enter') el.dispatchEvent(new MouseEvent('mouseenter', opts));
    };

    const startX = fromCoords.x - window.scrollX;
    const startY = fromCoords.y - window.scrollY;

    // Robust Source Finding - Distance Based
    const els = document.elementsFromPoint(startX, startY);

    // Sort by distance to center (Fix for 3D pieces overlapping)
    const sorted = els.map(e => {
        const r = e.getBoundingClientRect();
        // Calculate center of element
        const centerX = r.left + r.width / 2;
        const centerY = r.top + r.height / 2;
        // Distance to click point
        const dist = Math.hypot(centerX - startX, centerY - startY);
        return { el: e, dist: dist };
    }).sort((a, b) => a.dist - b.dist);

    // PRIORITY 1: Find a PIECE that matches the expected square (Best for 3D overlap)
    const fileMap = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 };
    const f = fileMap[from[0]];
    const r = parseInt(from[1]);
    const expectedSquareClass = `square-${f}${r}`;

    let sourceEntry = sorted.find(entry => {
        const c = String(entry.el.className || "");
        // Check for piece AND optionally checking if it belongs to the right square
        // Note: Some sites might not put square class on piece, but Chess.com usually does.
        const isPiece = !c.includes('solver') && !c.includes('highlight') && (c.includes('piece') || c.includes('drag'));
        if (!isPiece) return false;

        // If the piece has a square class, it MUST match. If no square class, accept it (riskier but needed).
        if (c.includes('square-')) {
            return c.includes(expectedSquareClass);
        }
        return true;
    });

    // Fallback: If strict match failed, try any piece (old logic, but lower priority)
    if (!sourceEntry) {
        sourceEntry = sorted.find(entry => {
            const c = String(entry.el.className || "");
            return !c.includes('solver') && !c.includes('highlight') && (c.includes('piece') || c.includes('drag'));
        });
    }

    // PRIORITY 2: Find a SQUARE (fallback)
    if (!sourceEntry) {
        sourceEntry = sorted.find(entry => {
            const c = String(entry.el.className || "");
            return !c.includes('solver') && c.includes('square');
        });
    }

    let sourceEl = sourceEntry ? sourceEntry.el : els[0];

    // PRIORITY 3: Direct DOM lookup if still not found
    if (!sourceEl && boardElement) {
        const fileMap = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 };
        const f = fileMap[from[0]];
        const r = parseInt(from[1]);
        const squareClass = `square-${f}${r}`;

        // Try piece first, then square
        sourceEl = boardElement.querySelector(`.piece.${squareClass}`) ||
            boardElement.querySelector(`.${squareClass}`);
    }

    if (!sourceEl) {

        return;
    }

    // Debug Log for User Feedback


    // Helper to get FRESH coordinates (recalculates each time to handle viewport changes)
    const getFreshCoords = (sq) => {
        const fileMap = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 };
        const f = fileMap[sq[0]];
        const r = parseInt(sq[1]);
        if (!f || !r) return { x: 0, y: 0 };

        const freshRect = boardElement.getBoundingClientRect();
        const sqSize = freshRect.width / 8;

        let left, top;
        // Check for Visual Bottom Row (Rank 1 for White, Rank 8 for Black)
        // const isVisualBottomRow = isFlipped ? (r === 8) : (r === 1);

        // GLOBAL FIX: Always grab HIGH (20% from top) to avoid hitting pieces in the row below
        // This fixes the issue where clicking row 2 hits the head of pieces in row 1.
        const yOffset = 0.2;

        if (!isFlipped) {
            left = (f - 1) * sqSize + sqSize * 0.5;
            top = (8 - r) * sqSize + sqSize * yOffset;
        } else {
            left = (8 - f) * sqSize + sqSize * 0.5;
            top = (r - 1) * sqSize + sqSize * yOffset;
        }
        return {
            x: freshRect.left + left,
            y: freshRect.top + top
        };
    };

    // ACTION SEQUENCE
    // 1. Hover & Enter
    const start = getFreshCoords(from);
    dispatchAll(sourceEl, 'over', start.x, start.y, 0);
    dispatchAll(sourceEl, 'enter', start.x, start.y, 0);

    // 2. Grab (Down)
    dispatchAll(sourceEl, 'down', start.x, start.y, 1);

    // Calculate drag distance
    const end = getFreshCoords(to);
    const dragDistancePixels = Math.hypot(end.x - start.x, end.y - start.y);
    const freshRect = boardElement.getBoundingClientRect();
    const isShortMove = dragDistancePixels < (freshRect.width / 8) * 1.5;

    // Fast Mode: Minimal duration
    let dragDuration;
    if (isFastMode) {
        dragDuration = 30; // 30ms super fast drag
    } else {
        dragDuration = isShortMove ? 250 + Math.random() * 50 : 150 + Math.random() * 50;
    }

    // 3. Multiple Drag Steps
    // Fast Mode: Only 1 step
    const steps = isFastMode ? 1 : (isShortMove ? 3 : 2);
    for (let i = 1; i <= steps; i++) {
        setTimeout(() => {
            const freshFrom = getFreshCoords(from);
            const freshTo = getFreshCoords(to);
            const progress = i / (steps + 1);
            const stepX = freshFrom.x + (freshTo.x - freshFrom.x) * progress;
            const stepY = freshFrom.y + (freshTo.y - freshFrom.y) * progress;
            dispatchAll(sourceEl, 'move', stepX, stepY, 1);
        }, (dragDuration / (steps + 1)) * i);
    }

    // 4. Drop (At Destination)
    setTimeout(() => {
        const freshEnd = getFreshCoords(to);
        const endX = freshEnd.x;
        const endY = freshEnd.y;

        const destEls = document.elementsFromPoint(endX, endY);
        const destEl = destEls.find(e => {
            const c = String(e.className || "");
            return !c.includes('solver') && !c.includes('highlight') && (c.includes('piece') || c.includes('square'));
        }) || destEls[0] || sourceEl;

        // Extra move event right before drop
        dispatchAll(destEl, 'move', endX, endY, 1);

        // Small delay then release
        setTimeout(() => {
            dispatchAll(destEl, 'up', endX, endY, 0);

            // 5. Finalize with Click (Fallback for short moves)
            if (isShortMove) {
                setTimeout(() => {
                    destEl.dispatchEvent(new MouseEvent('click', {
                        bubbles: true, cancelable: true, view: window,
                        clientX: endX, clientY: endY, buttons: 0
                    }));
                }, 50);
            }
        }, 20);
    }, dragDuration);
}

function hardReset() {

    boardElement = null;
    lastFen = "";
    lastGrid = null;
    currentTurn = 'w'; // Default back to white or let detection fix it
    if (observer) observer.disconnect();
    if (moveListObserver) moveListObserver.disconnect();
    removeHighlights();

    // Explicitly re-run start sequence
    startBoardObserver();
    startMoveListObserver();
}

function addResetButton() {
    if (document.getElementById('solver-reset-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'solver-reset-btn';
    btn.innerText = '↺ Reset';
    btn.style.position = 'fixed';
    btn.style.top = '60px';
    btn.style.right = '20px';
    btn.style.zIndex = '999999';
    btn.style.padding = '8px 12px';
    btn.style.backgroundColor = '#2ecc71';
    btn.style.color = 'white';
    btn.style.border = 'none';
    btn.style.borderRadius = '5px';
    btn.style.cursor = 'pointer';
    btn.style.fontFamily = 'Arial, sans-serif';
    btn.style.fontWeight = 'bold';
    btn.style.boxShadow = '0 2px 5px rgba(0,0,0,0.3)';

    btn.onclick = () => {
        console.log("Solver: Resetting");
        btn.innerText = '♻️ Rebooting...';
        btn.style.backgroundColor = '#e67e22'; // Orange

        forceRestart();

        setTimeout(() => {
            btn.innerText = '↺ Reset';
            btn.style.backgroundColor = '#2ecc71';
        }, 1000);
    };

    document.body.appendChild(btn);
}

function removeResetButton() {
    const btn = document.getElementById('solver-reset-btn');
    if (btn) btn.remove();
}
