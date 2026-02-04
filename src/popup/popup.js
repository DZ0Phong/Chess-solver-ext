document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('toggle-btn');
    const autoMoveCheck = document.getElementById('auto-move-check');
    const hideVisualsCheck = document.getElementById('hide-visuals-check');
    const visualsControl = document.getElementById('visuals-control');
    const statusText = document.getElementById('status-text');
    const engineStatus = document.getElementById('engine-status');

    // Speed Mode Elements
    const speedModeSelect = document.getElementById('speed-mode-select');
    const minDelayInput = document.getElementById('min-delay');
    const maxDelayInput = document.getElementById('max-delay');

    // Default delay presets for each mode (in ms)
    const DELAY_PRESETS = {
        gm: { min: 300, max: 800 },       // Bullet 1min (UI display only, actual is faster)
        master: { min: 1000, max: 2500 },  // Rapid 3-5min (default)
        analysis: { min: 3500, max: 5000 } // Deep Analysis (User requested slow down)
    };

    // Load saved state
    chrome.storage.local.get(['solverEnabled', 'autoMoveEnabled', 'hideVisuals', 'speedMode', 'minDelay', 'maxDelay'], (result) => {
        if (result.solverEnabled) {
            updateUI(true);
        }
        if (result.autoMoveEnabled) {
            autoMoveCheck.checked = true;
            enableVisualsControl(true);
        } else {
            enableVisualsControl(false);
        }

        // Fix Persistence: Check hideVisuals only if autoMove is enabled
        if (result.hideVisuals && result.autoMoveEnabled) {
            hideVisualsCheck.checked = true;
        }

        // Load speed mode settings
        const savedMode = result.speedMode || 'master';
        speedModeSelect.value = savedMode;

        // Load delay values (use saved or default for mode)
        const presets = DELAY_PRESETS[savedMode];
        minDelayInput.value = result.minDelay ?? presets.min;
        maxDelayInput.value = result.maxDelay ?? presets.max;
    });

    // Listen for Engine Status
    engineStatus.textContent = "Ready (Local)";
    engineStatus.style.color = "green";

    toggleBtn.addEventListener('click', () => {
        chrome.storage.local.get(['solverEnabled'], (result) => {
            const newState = !result.solverEnabled;
            chrome.storage.local.set({ solverEnabled: newState }, () => {
                updateUI(newState);
                notifyContentScript({ type: "TOGGLE_SOLVER", enabled: newState });
            });
        });
    });

    autoMoveCheck.addEventListener('change', (e) => {
        const isAuto = e.target.checked;
        enableVisualsControl(isAuto);

        let hideVisuals = hideVisualsCheck.checked;
        if (!isAuto) {
            hideVisuals = false;
            hideVisualsCheck.checked = false;
        }

        chrome.storage.local.set({
            autoMoveEnabled: isAuto,
            hideVisuals: hideVisuals
        }, () => {
            notifyContentScript({ type: "TOGGLE_AUTO_MOVE", enabled: isAuto });
            notifyContentScript({ type: "TOGGLE_VISUALS", hidden: hideVisuals });
        });
    });

    hideVisualsCheck.addEventListener('change', (e) => {
        const isHidden = e.target.checked;
        chrome.storage.local.set({ hideVisuals: isHidden }, () => {
            notifyContentScript({ type: "TOGGLE_VISUALS", hidden: isHidden });
        });
    });

    // Speed Mode Change
    speedModeSelect.addEventListener('change', (e) => {
        const mode = e.target.value;
        const presets = DELAY_PRESETS[mode];

        // Update inputs with new presets
        minDelayInput.value = presets.min;
        maxDelayInput.value = presets.max;

        // Save and notify
        chrome.storage.local.set({
            speedMode: mode,
            minDelay: presets.min,
            maxDelay: presets.max
        }, () => {
            notifyContentScript({
                type: "UPDATE_DELAY_SETTINGS",
                speedMode: mode,
                minDelay: presets.min,
                maxDelay: presets.max
            });
        });
    });

    // Delay Input Changes (custom values)
    const saveDelaySettings = () => {
        const minDelay = parseInt(minDelayInput.value) || 500;
        const maxDelay = parseInt(maxDelayInput.value) || 1500;

        chrome.storage.local.set({ minDelay, maxDelay }, () => {
            notifyContentScript({
                type: "UPDATE_DELAY_SETTINGS",
                minDelay,
                maxDelay
            });
        });
    };

    minDelayInput.addEventListener('change', saveDelaySettings);
    maxDelayInput.addEventListener('change', saveDelaySettings);

    function updateUI(enabled) {
        if (enabled) {
            statusText.textContent = "Active";
            statusText.classList.remove('inactive');
            statusText.classList.add('active');

            toggleBtn.textContent = "Deactivate Solver";
            toggleBtn.classList.add('active-state');
        } else {
            statusText.textContent = "Inactive";
            statusText.classList.remove('active');
            statusText.classList.add('inactive');

            toggleBtn.textContent = "Activate Solver";
            toggleBtn.classList.remove('active-state');
        }
    }

    function enableVisualsControl(enable) {
        if (enable) {
            visualsControl.classList.remove('disabled-control');
        } else {
            visualsControl.classList.add('disabled-control');
        }
    }

    function notifyContentScript(message) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.id) {
                chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
                    if (chrome.runtime.lastError) {
                        console.log("Solver: Message failed (Content Script not ready?)", chrome.runtime.lastError.message);
                    }
                });
            }
        });
    }
});
