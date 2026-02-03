document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('toggle-btn');
    const autoMoveCheck = document.getElementById('auto-move-check');
    const hideVisualsCheck = document.getElementById('hide-visuals-check');
    const visualsControl = document.getElementById('visuals-control');
    const statusText = document.getElementById('status-text');
    const engineStatus = document.getElementById('engine-status');

    // Load saved state
    chrome.storage.local.get(['solverEnabled', 'autoMoveEnabled', 'hideVisuals'], (result) => {
        if (result.solverEnabled) {
            updateUI(true);
        }
        if (result.autoMoveEnabled) {
            autoMoveCheck.checked = true;
            enableVisualsControl(true);
        } else {
            enableVisualsControl(false);
        }

        // Fix Persistence: Check hideVisuals only if autoMove is enabled, or simply load it regardless 
        // (but effective only if autoMove is ON visually).
        // User logic: "hide visuals" is an option available ONLY when auto move is ON.
        if (result.hideVisuals && result.autoMoveEnabled) {
            hideVisualsCheck.checked = true;
        }
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
