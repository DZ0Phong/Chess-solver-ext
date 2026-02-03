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
    startBoardObserver();
    startMoveListObserver(); // Start watching moves specifically
    startPoller(); // Start failsafe
}

function disableSolver() {
    isEnabled = false;
    console.log("Solver: Disabled");
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
                highlightMove(response.bestMove);
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
    const grid = Array(8).fill(null).map(() => Array(8).fill(null));
    const pieces = board.querySelectorAll('.piece');
    pieces.forEach(piece => {
        const classNames = piece.className;
        const squareMatch = classNames.match(/square-(\d)(\d)/);
        if (squareMatch) {
            const file = parseInt(squareMatch[1], 10) - 1;
            const rank = parseInt(squareMatch[2], 10) - 1;
            const typeMatch = classNames.match(/\b([wb])([prnbqk])\b/);
            if (typeMatch) {
                const color = typeMatch[1];
                let type = typeMatch[2];
                if (color === 'w') type = type.toUpperCase();
                grid[7 - rank][file] = type;
            }
        }
    });

    let fenRows = [];
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
            } else {
                emptyCount++;
            }
        }
        if (emptyCount > 0) rowStr += emptyCount;
        fenRows.push(rowStr);
    }

    return {
        fen: `${fenRows.join('/')} w - - 0 1`,
        grid: grid
    };
}

// --- Visuals ---

function highlightMove(move) {
    removeHighlights();
    const playerColor = getPlayerColor();
    const isFlipped = playerColor === 'b';
    if (currentTurn !== playerColor) return;

    if (!move || move.length < 4) return;

    const from = move.substring(0, 2);
    const to = move.substring(2, 4);

    if (!boardElement) return;
    const rect = boardElement.getBoundingClientRect();
    const squareSize = rect.width / 8;

    if (!isVisualsHidden) {
        createHighlight(from, 'from');
        createHighlight(to, 'to');
        drawArrow(from, to, isFlipped, rect, squareSize);
    }

    if (isAutoMoveEnabled) {
        console.log(`Solver: Auto Move Initiated. Turn: ${currentTurn}`);
        setTimeout(() => {
            simulateMove(from, to, isFlipped, rect, squareSize);
        }, 200 + Math.random() * 100);
    }
}

function createHighlight(square, type) {
    if (!boardElement) return null;
    const isFlipped = getPlayerColor() === 'b';
    const fileMap = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 };
    const file = fileMap[square[0]];
    const rank = parseInt(square[1]);
    const rect = boardElement.getBoundingClientRect();
    const squareSize = rect.width / 8;

    const overlay = document.createElement('div');
    overlay.className = `solver-highlight highlight-${type}`;
    overlay.style.position = 'absolute';
    overlay.style.width = `${squareSize}px`;
    overlay.style.height = `${squareSize}px`;
    overlay.style.zIndex = '10000';
    overlay.style.pointerEvents = 'none';

    if (type === 'from') {
        overlay.style.backgroundColor = 'yellow';
        overlay.style.borderRadius = '50%';
        overlay.style.opacity = '0.5';
    } else {
        overlay.style.backgroundColor = 'transparent';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.fontSize = `${squareSize * 0.8}px`;
        overlay.style.fontWeight = 'bold';
        overlay.style.color = 'green';
        overlay.style.textShadow = '0 0 5px white';
        overlay.innerText = 'X';
    }

    let leftOffset, topOffset;
    if (!isFlipped) {
        leftOffset = (file - 1) * squareSize;
        topOffset = (8 - rank) * squareSize;
    } else {
        leftOffset = (8 - file) * squareSize;
        topOffset = (rank - 1) * squareSize;
    }

    const finalLeft = rect.left + window.scrollX + leftOffset;
    const finalTop = rect.top + window.scrollY + topOffset;

    overlay.style.left = `${finalLeft}px`;
    overlay.style.top = `${finalTop}px`;

    if (!isVisualsHidden) {
        document.body.appendChild(overlay);
    }
    return overlay;
}

function drawArrow(fromSquare, toSquare, isFlipped, boardRect, squareSize) {
    const fileMap = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 };
    const f1 = fileMap[fromSquare[0]];
    const r1 = parseInt(fromSquare[1]);
    const f2 = fileMap[toSquare[0]];
    const r2 = parseInt(toSquare[1]);

    let x1, y1, x2, y2;

    if (!isFlipped) {
        x1 = (f1 - 1) * squareSize + (squareSize / 2);
        y1 = (8 - r1) * squareSize + (squareSize / 2);
        x2 = (f2 - 1) * squareSize + (squareSize / 2);
        y2 = (8 - r2) * squareSize + (squareSize / 2);
    } else {
        x1 = (8 - f1) * squareSize + (squareSize / 2);
        y1 = (r1 - 1) * squareSize + (squareSize / 2);
        x2 = (8 - f2) * squareSize + (squareSize / 2);
        y2 = (r2 - 1) * squareSize + (squareSize / 2);
    }

    const svgNs = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("class", "solver-arrow");
    svg.style.position = "absolute";
    svg.style.left = `${boardRect.left + window.scrollX}px`;
    svg.style.top = `${boardRect.top + window.scrollY}px`;
    svg.style.width = `${boardRect.width}px`;
    svg.style.height = `${boardRect.height}px`;
    svg.style.zIndex = "10001";
    svg.style.pointerEvents = "none";
    svg.style.overflow = "visible";

    const defs = document.createElementNS(svgNs, "defs");
    const marker = document.createElementNS(svgNs, "marker");
    marker.setAttribute("id", "arrowhead");
    marker.setAttribute("markerWidth", "6");
    marker.setAttribute("markerHeight", "4");
    marker.setAttribute("refX", "5");
    marker.setAttribute("refY", "2");
    marker.setAttribute("orient", "auto");
    const polygon = document.createElementNS(svgNs, "polygon");
    polygon.setAttribute("points", "0 0, 6 2, 0 4");
    polygon.setAttribute("fill", "orange");
    marker.appendChild(polygon);
    defs.appendChild(marker);
    svg.appendChild(defs);

    const line = document.createElementNS(svgNs, "line");
    line.setAttribute("x1", x1);
    line.setAttribute("y1", y1);
    line.setAttribute("x2", x2);
    line.setAttribute("y2", y2);
    line.setAttribute("stroke", "orange");
    line.setAttribute("stroke-width", squareSize * 0.12);
    line.setAttribute("stroke-opacity", "0.8");
    line.setAttribute("marker-end", "url(#arrowhead)");

    svg.appendChild(line);
    document.body.appendChild(svg);
}

function simulateMove(from, to, isFlipped, rect, squareSize) {
    const getCoords = (sq) => {
        const fileMap = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 };
        const f = fileMap[sq[0]];
        const r = parseInt(sq[1]);
        if (!f || !r) return { x: NaN, y: NaN };

        let left, top;
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
        console.warn(`Solver: Invalid Coords for ${from}->${to}`, fromCoords, toCoords);
        return;
    }

    const click = (x, y, label) => {
        // Retry logic: try center, then 5px offset
        const tryClick = (cx, cy) => {
            const elements = document.elementsFromPoint(cx - window.scrollX, cy - window.scrollY);
            const target = elements.find(el => {
                const cls = (el.className && typeof el.className === 'string') ? el.className : "";
                return !cls.includes('solver-highlight') &&
                    !cls.includes('solver-arrow') &&
                    !cls.includes('coordinates') &&
                    !cls.includes('hover-square') &&
                    !cls.includes('highlight');
            }) || elements[0];

            if (target) {
                console.log(`Solver: Clicked ${label} at ${cx}, ${cy} on`, target);
                const opts = {
                    bubbles: true, cancelable: true, view: window,
                    clientX: cx - window.scrollX, clientY: cy - window.scrollY,
                    buttons: 1, pointerId: 1, width: 1, height: 1, pressure: 0.5, isPrimary: true
                };
                target.dispatchEvent(new PointerEvent('pointerdown', opts));
                target.dispatchEvent(new MouseEvent('mousedown', opts));
                target.dispatchEvent(new PointerEvent('pointerup', opts));
                target.dispatchEvent(new MouseEvent('mouseup', opts));
                target.dispatchEvent(new MouseEvent('click', opts));
                return true;
            }
            return false;
        };

        if (!tryClick(x, y)) {
            console.warn(`Solver: Retry click ${label} with offset...`);
            if (!tryClick(x, y + 5)) {
                console.error(`Solver: Failed to find element at ${x}, ${y}`);
            }
        }
    };

    console.log(`Solver: Auto Move ${from} -> ${to}`);
    click(fromCoords.x, fromCoords.y, from);
    setTimeout(() => {
        click(toCoords.x, toCoords.y, to);
    }, 250);
}

function removeHighlights() {
    const existing = document.querySelectorAll('.solver-highlight');
    existing.forEach(el => el.remove());
    const existingArrows = document.querySelectorAll('.solver-arrow');
    existingArrows.forEach(el => el.remove());
}
