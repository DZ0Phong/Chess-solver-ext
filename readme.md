# ♟️ Grandmaster AI - Chess Solver Extension

A powerful, high-performance Chrome/Edge extension that integrates the **Stockfish** chess engine directly into your browser to assist with gameplay analysis in real-time.

![Extension Preview](src/assets/icon.png)

## 🚀 Key Features

### 🧠 Advanced Engine Integration
- **Powered by Stockfish**: Runs a WASM-optimized version of Stockfish directly in an offscreen document for maximum performance.
- **Real-time Analysis**: Calculates the best moves instantly as you play.
- **Smart Orientation**: Automatically detects if you are playing as White or Black and adjusts logic accordingly.

### ⚡ Dynamic Speed Modes
Choose your playstyle with three distinct modes:
1.  **⚡ GM Mode (Bullet 1min)**:
    *   **Speed**: Superhuman (50-200ms delay).
    *   **Logic**: Uses **Fast Click-Click** technology to bypass drag animations.
    *   **Engine**: MAX Skill Level (3000+ ELO), 0.5s think time.
2.  **🎯 Master Mode (Rapid/Blitz)**:
    *   **Speed**: Human-like (800ms - 2s delay).
    *   **Logic**: Uses **Natural Drag-and-Drop** simulation.
    *   **Engine**: Balanced Skill Level (~2000 ELO), 1s think time.
3.  **🔍 Analysis Mode**:
    *   **Speed**: Slow & Deep.
    *   **Logic**: High-precision calculations for learning.
    *   **Engine**: MAX Skill Level, 2s+ think time.

### 🛡️ Stealth & Utility
- **Auto Move**: Automatically executes the best move for you.
- **Visuals Control**: Option to hide arrows/highlights for stealth recording.
- **Robust Auto-Recovery**: Automatically detects game restarts, disconnects, or board glitches and re-initializes without page refresh.
- **Console-Safe**: Optimized coordinate system ensures move accuracy even when opening/resizing the DevTools console.

## 🛠️ Installation

1.  **Clone the Repository**
    ```bash
    git clone https://github.com/DZ0Phong/Chess-solver-ext.git
    ```
2.  **Open Extension Management**
    *   Chrome: `chrome://extensions`
    *   Edge: `edge://extensions`
3.  **Enable Developer Mode**
    *   Toggle the switch in the top right corner.
4.  **Load Unpacked**
    *   Click "Load unpacked" and select the `Chess-solver-ext` folder.

## 🎮 How to Use

1.  Go to [Chess.com](https://www.chess.com/play/computer) (or supported analysis boards).
2.  Click the extension icon (**Grandmaster AI**) in the toolbar.
3.  **Toggle "Activate Solver"** to start the engine.
4.  Select your **Speed Mode** (GM, Master, or Analysis).
5.  Enable **"Auto Move"** if you want the bot to play for you.

## 📂 Project Structure

```text
Chess-solver-ext/
├── src/
│   ├── background/      # Service Worker (orchestrator)
│   ├── content/         # UI interaction & DOM manipulation
│   ├── offscreen/       # Stockfish Worker container
│   ├── lib/             # Stockfish engine files
│   ├── popup/           # Extension popup UI
│   └── assets/          # Icons and images
├── manifest.json        # Extension configuration
└── readme.md            # Documentation
```

## ⚠️ Disclaimer
This tool is for **educational and analysis purposes only**. Using chess assistance tools during rated games against human opponents violates fair play policies of most chess platforms and can lead to account bans. Please use responsibly.