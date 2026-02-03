console.log("Chess Solver Extension Loaded");

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

// --- Initialization ---

chrome.storage.local.get(['solverEnabled', 'autoMoveEnabled', 'hideVisuals'], (result) => {
    if (result.solverEnabled) {
        enableSolver();
    }
    if (result.autoMoveEnabled) {
        isAutoMoveEnabled = true;
    }
    if (result.hideVisuals) {
        isVisualsHidden = true;
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "TOGGLE_SOLVER") {
        request.enabled ? enableSolver() : disableSolver();
    }
    if (request.type === "TOGGLE_AUTO_MOVE") {
        isAutoMoveEnabled = request.enabled;
        console.log("Solver: Auto Move is", isAutoMoveEnabled);
    }
    if (request.type === "TOGGLE_VISUALS") {
        isVisualsHidden = request.hidden;
        console.log("Solver: Visuals hidden?", isVisualsHidden);
        if (isVisualsHidden) {
            removeHighlights();
        } else {
            // Force redraw immediately
            lastFen = "";
            analyzeBoard();
        }
    }
});

// --- Core Logic ---

function enableSolver() {
    if (isEnabled) return;
    isEnabled = true;
    console.log("Solver: Enabled");
    addResetButton();
    startBoardObserver();
    startMoveListObserver(); // Start watching moves specifically
    startPoller(); // Start failsafe
}

function disableSolver() {
    isEnabled = false;
    console.log("Solver: Disabled");
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
    const findBoard = () => {
        const possibleBoards = [
            document.querySelector('chess-board'),
            document.querySelector('#board-layout-chessboard'),
            document.querySelector('.board')
        ];
        boardElement = possibleBoards.find(b => b !== null);

        if (boardElement) {
            console.log("Solver: Board detected", boardElement);
            observer = new MutationObserver(handleBoardMutation);
            observer.observe(boardElement, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class']
            });
            analyzeBoard();
        } else {
            setTimeout(findBoard, 2000);
        }
    };
    findBoard();
}

function startMoveListObserver() {
    // Watch for the move list to appear and then observe it for changes
    const findMoveList = () => {
        const list = document.querySelector('vertical-move-list') || document.querySelector('.move-list') || document.querySelector('div[class*="move-list"]');
        if (list) {
            console.log("Solver: Move list detected", list);
            moveListElement = list;
            moveListObserver = new MutationObserver((mutations) => {
                // If move list changes, it's DEFINITELY a turn change or move update
                console.log("Solver: Move list updated");
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
            console.log("Solver: Poller detected turn change to US! Forcing analysis.");
            analyzeBoard();
        }
    }, 1000);
}

function stopPoller() {
    if (pollerInterval) clearInterval(pollerInterval);
    pollerInterval = null;
}

let analysisDebounce = null;
function handleBoardMutation(mutations) {
    if (!isEnabled) return;
    if (analysisDebounce) clearTimeout(analysisDebounce);
    analysisDebounce = setTimeout(() => {
        analyzeBoard();
    }, 100);
}

function analyzeBoard() {
    if (!boardElement) return;

    // 1. FAST Turn Detection (DOM only)
    const domTurn = detectTurnFromDOM();
    if (domTurn) {
        currentTurn = domTurn;
    }

    // 2. Determine Player Color
    const playerColor = getPlayerColor();

    // 3. Early Exit
    if (currentTurn !== playerColor) {
        removeHighlights();
        return;
    }

    try {
        // 4. Parse FEN (Only if it IS our turn)
        const { fen, grid } = parseBoardToFEN(boardElement);
        lastGrid = grid;

        if (fen === lastFen) return; // No change
        lastFen = fen;

        // Update FEN with correct turn
        const fenParts = fen.split(' ');
        fenParts[1] = currentTurn;
        const correctFen = fenParts.join(' ');

        console.log(`Solver: My Turn (${currentTurn})! Analyzing...`);

        // Send to background
        chrome.runtime.sendMessage({
            type: "ANALYZE_BOARD",
            fen: correctFen
        }, (response) => {
            if (response && response.bestMove) {
                highlightMove(response.bestMove, response.topMoves);
            }
        });
    } catch (e) {
        console.error("Solver: Analysis failed", e);
    }
}

function detectTurnFromDOM() {
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

    // GEOMETRIC DETECTION (Most Robust)
    // Find square A1 (class 'square-11')
    const a1 = boardElement.querySelector('.square-11');
    if (a1) {
        const boardRect = boardElement.getBoundingClientRect();
        const a1Rect = a1.getBoundingClientRect();

        // If A1 is in the Top-Half of the board -> Black (Flipped)
        const relativeTop = a1Rect.top - boardRect.top;

        // A1 is Top-Right for Black, Bottom-Left for White
        // So if relativeTop is small (< 50% height), it's Black.
        if (relativeTop < boardRect.height / 2) {
            return 'b'; // Black
        } else {
            return 'w'; // White
        }
    }

    // Fallback: Attributes
    const orientation = boardElement.getAttribute('orientation');
    if (orientation) return orientation.startsWith('b') ? 'b' : 'w';
    if (boardElement.classList.contains('flipped')) return 'b';
    return 'w';
}

function isWhitePiece(p) { return 'PNBRQK'.includes(p); }
function isBlackPiece(p) { return 'pnbrqk'.includes(p); }

// --- FEN Parsing ---

function parseBoardToFEN(board) {
    // 0. Game Over Check - Stop analyzing if game is done
    if (document.querySelector('.game-over-modal') || document.querySelector('.modal-game-over') || document.querySelector('div[class*="game-over"]')) {
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

    if (!whiteKingFound || !blackKingFound) {
        console.warn("Solver: KINGS MISSING! Grid dump:", grid);
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

    if (!isVisualsHidden) {
        const container = getOverlay(); // Creates new if removed
        if (container) {
            // Draw Best Move
            const from = move.substring(0, 2);
            const to = move.substring(2, 4);
            createHighlight(container, from, 'from', isFlipped);
            createHighlight(container, to, 'to', isFlipped);
            drawArrow(container, from, to, isFlipped);

            // Draw Alt Moves (+)
            if (altMoves && altMoves.length > 0) {
                // Limit to top 1 alternative to reduce clutter
                altMoves.slice(0, 1).forEach(m => {
                    if (m !== move && m.length >= 4) {
                        const altTo = m.substring(2, 4);
                        // Only draw if not overlapping the main best move
                        if (altTo !== to) {
                            createHighlight(container, altTo, 'alt', isFlipped);
                        }
                    }
                });
            }
        }
    }

    if (isAutoMoveEnabled) {
        const rect = boardElement.getBoundingClientRect();
        const squareSize = rect.width / 8;

        console.log(`Solver: Auto Move Initiated. Turn: ${currentTurn}`);
        const from = move.substring(0, 2);
        const to = move.substring(2, 4);

        // Random delay: 0.5s to 1.5s
        const randomDelay = 500 + Math.random() * 1000;

        setTimeout(() => {
            simulateMove(from, to, isFlipped, rect, squareSize);
        }, randomDelay);
    }
}

function createHighlight(container, square, type, isFlipped) {
    const fileMap = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 };
    const f = fileMap[square[0]];
    const r = parseInt(square[1]);

    let col, row;
    if (!isFlipped) {
        col = f - 1;
        row = 8 - r;
    } else {
        col = 8 - f;
        row = r - 1;
    }

    const overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    overlay.style.left = `${col * 12.5}%`;
    overlay.style.top = `${row * 12.5}%`;
    overlay.style.width = '12.5%';
    overlay.style.height = '12.5%';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.pointerEvents = 'none';

    if (type === 'from') {
        overlay.style.backgroundColor = 'rgba(255, 255, 0, 0.4)'; // Faded yellow
        overlay.style.borderRadius = '50%';
        container.appendChild(overlay);
    } else {
        const text = document.createElement('div');
        text.style.fontWeight = 'bold';
        text.style.fontFamily = 'Arial, sans-serif';
        text.style.display = 'flex';
        text.style.alignItems = 'center';
        text.style.justifyContent = 'center';
        text.style.width = '100%';
        text.style.height = '100%';

        if (type === 'to') {
            text.innerText = 'X';
            text.style.color = '#00e600'; // Matrix Green
            text.style.fontSize = 'clamp(20px, 6vw, 60px)'; // Big
            text.style.opacity = '0.9';
            text.style.textShadow = '0 0 5px black';
        } else if (type === 'alt') {
            text.innerText = '+';
            text.style.color = '#ffffff'; // White/Gray
            text.style.fontSize = 'clamp(20px, 6vw, 60px)'; // Same size as X
            text.style.opacity = '0.4'; // Faded ("mờ mờ")
            text.style.textShadow = '0 0 2px black';
        }
        overlay.appendChild(text);
        container.appendChild(overlay);
    }
}

function drawArrow(container, from, to, isFlipped) {
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

        const defs = document.createElementNS(svgNs, "defs");
        const marker = document.createElementNS(svgNs, "marker");
        marker.setAttribute("id", "arrowhead");
        marker.setAttribute("markerWidth", "4");
        marker.setAttribute("markerHeight", "4");
        marker.setAttribute("refX", "2");
        marker.setAttribute("refY", "2");
        marker.setAttribute("orient", "auto");
        const path = document.createElementNS(svgNs, "path");
        path.setAttribute("d", "M0,0 L4,2 L0,4");
        path.setAttribute("fill", "orange");
        marker.appendChild(path);
        defs.appendChild(marker);
        svg.appendChild(defs);
        container.appendChild(svg);
    }

    const getCoords = (sq) => {
        const fileMap = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 };
        const f = fileMap[sq[0]];
        const r = parseInt(sq[1]);
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
    line.setAttribute("stroke", "orange");
    line.setAttribute("stroke-width", "0.15");
    line.setAttribute("stroke-opacity", "0.8");
    line.setAttribute("marker-end", "url(#arrowhead)");

    svg.appendChild(line);
}

function simulateMove(from, to, isFlipped, rect, squareSize) {
    const getCoords = (sq) => {
        const fileMap = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 };
        const f = fileMap[sq[0]];
        const r = parseInt(sq[1]);
        if (!f || !r) return { x: NaN, y: NaN };

        let left, top;
        // Target center
        if (!isFlipped) {
            left = (f - 1) * squareSize + (squareSize / 2);
            top = (8 - r) * squareSize + (squareSize / 2);
        } else {
            left = (8 - f) * squareSize + (squareSize / 2);
            top = (r - 1) * squareSize + (squareSize / 2);
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

    // Robust Source Finding
    const els = document.elementsFromPoint(startX, startY);
    const sourceEl = els.find(e => {
        const c = String(e.className || "");
        return !c.includes('solver') && (c.includes('piece') || c.includes('drag') || c.includes('square'));
    }) || els[0];

    if (!sourceEl) { console.warn("Solver: Source not found for auto-move"); return; }

    console.log("Solver: Dragging element", sourceEl);

    // ACTION SEQUENCE
    // 1. Hover & Enter
    dispatchAll(sourceEl, 'over', startX, startY, 0);
    dispatchAll(sourceEl, 'enter', startX, startY, 0);

    // 2. Grab (Down)
    dispatchAll(sourceEl, 'down', startX, startY, 1);

    const dragDuration = 250 + Math.random() * 200;

    // 3. Drag Step (Move slightly) - Critical for detection
    setTimeout(() => {
        const midX = (fromCoords.x + toCoords.x) / 2 - window.scrollX;
        const midY = (fromCoords.y + toCoords.y) / 2 - window.scrollY;
        dispatchAll(sourceEl, 'move', midX, midY, 1);
    }, dragDuration / 2);

    // 4. Drop (At Destination)
    setTimeout(() => {
        const endX = toCoords.x - window.scrollX;
        const endY = toCoords.y - window.scrollY;

        const destEls = document.elementsFromPoint(endX, endY);
        const destEl = destEls.find(e => {
            const c = String(e.className || "");
            return !c.includes('solver') && !c.includes('highlight') && (c.includes('piece') || c.includes('square'));
        }) || destEls[0] || sourceEl;

        dispatchAll(destEl, 'move', endX, endY, 1);
        dispatchAll(destEl, 'up', endX, endY, 0);

        // 5. Finalize with Click (Fallback)
        destEl.dispatchEvent(new MouseEvent('click', {
            bubbles: true, cancelable: true, view: window,
            clientX: endX, clientY: endY, buttons: 0
        }));
    }, dragDuration);
}

function removeHighlights() {
    const existing = document.querySelectorAll('.solver-highlight');
    existing.forEach(el => el.remove());
    const existingArrows = document.querySelectorAll('.solver-arrow');
    existingArrows.forEach(el => el.remove());
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
        console.log("Solver: Manual Reset Triggered");
        lastFen = "";
        analyzeBoard();
        btn.innerText = 'Checking...';
        setTimeout(() => btn.innerText = '↺ Reset', 1000);
    };

    document.body.appendChild(btn);
}

function removeResetButton() {
    const btn = document.getElementById('solver-reset-btn');
    if (btn) btn.remove();
}
