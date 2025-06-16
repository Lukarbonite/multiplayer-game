// public/game.js

// --- Global variables ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let socket;
let selfId = null;
let players = {};
let imageCache = {};
let world = { width: 4000, height: 4000 };
let gameReady = false;
let baseRadius = 20;
let debugMode = false;
let customZoomMultiplier = 1.0;
let activeInputTarget = null;
let cellMap = new Map(); // For efficient cell lookup by cellId

// Performance monitoring
let frameCount = 0;
let fps = 0;
let lastFpsUpdate = 0;
let lastFrameTime = 0;
let frameTimeAccumulator = 0;

// Render caching
let leaderboardCache = null;
let leaderboardCacheTime = 0;
let leaderboardData = [];
const LEADERBOARD_CACHE_DURATION = 500; // Update leaderboard every 500ms

// --- Binary Serialization ---
const C2S_OPCODES = {
    JOIN_GAME: 0,
    PLAYER_INPUT_MOUSE: 1,
    PLAYER_INPUT_CONTROLLER: 2,
    SPLIT: 3,
    EJECT_MASS: 4,
    CHAT_MESSAGE: 5,
    SET_MASS: 6,
    PING: 7,
};

const S2C_OPCODES = {
    INITIAL_STATE: 0,
    GAME_STATE_UPDATE: 1,
    LEADERBOARD_UPDATE: 2,
    YOU_DIED: 3,
    CHAT_MESSAGE: 4,
    SYSTEM_MESSAGE: 5,
    PONG: 6,
    PLAYER_DISCONNECTED: 7,
    JOIN_ERROR: 8,
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function writeString(view, offset, str) {
    const encoded = textEncoder.encode(str);
    view.setUint16(offset, encoded.length, true);
    offset += 2;
    encoded.forEach((byte, i) => {
        view.setUint8(offset + i, byte);
    });
    return offset + encoded.length;
}

function readString(view, offset) {
    const length = view.getUint16(offset, true);
    offset += 2;
    const buffer = new Uint8Array(view.buffer, view.byteOffset + offset, length);
    return {
        value: textDecoder.decode(buffer),
        newOffset: offset + length
    };
}

function decodeCell(view, offset) {
    let currentOffset = offset;
    const cell = {};

    cell.cellId = view.getUint32(currentOffset, true); currentOffset += 4;
    cell.x = view.getInt16(currentOffset, true); currentOffset += 2;
    cell.y = view.getInt16(currentOffset, true); currentOffset += 2;
    cell.score = view.getUint32(currentOffset, true); currentOffset += 4;
    cell.radius = view.getUint16(currentOffset, true) / 10; currentOffset += 2;

    const colorData = readString(view, currentOffset);
    cell.color = colorData.value;
    currentOffset = colorData.newOffset;

    const nicknameData = readString(view, currentOffset);
    cell.nickname = nicknameData.value;
    currentOffset = nicknameData.newOffset;

    const typeId = view.getUint8(currentOffset); currentOffset += 1;
    if (typeId === 0) cell.type = 'player';
    else if (typeId === 1) cell.type = 'pellet';
    else if (typeId === 2) cell.type = 'virus';
    else if (typeId === 3) cell.type = 'ejected';

    const hasImage = view.getUint8(currentOffset++) === 1;
    if (hasImage) {
        const imageData = readString(view, currentOffset);
        cell.image = imageData.value;
        currentOffset = imageData.newOffset;
    }

    cell.mergeCooldown = view.getFloat64(currentOffset, true); currentOffset += 8;

    if (cell.type === 'ejected') {
        const ownerData = readString(view, currentOffset);
        cell.ownerId = ownerData.value;
        currentOffset = ownerData.newOffset;
    }

    return { cell, newOffset: currentOffset };
}

function encodeJoinGame(data) {
    const nicknameBytes = textEncoder.encode(data.nickname);
    const colorBytes = textEncoder.encode(data.color);
    const imageBytes = data.image ? textEncoder.encode(data.image) : new Uint8Array(0);
    const tokenBytes = data.playerToken ? textEncoder.encode(data.playerToken) : new Uint8Array(0);

    let bufferSize = 1 + (2 + nicknameBytes.length) + (2 + colorBytes.length) + 1 + 1;
    if (data.image) bufferSize += (2 + imageBytes.length);
    if (data.playerToken) bufferSize += (2 + tokenBytes.length);

    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);
    let offset = 0;

    view.setUint8(offset, C2S_OPCODES.JOIN_GAME); offset += 1;
    offset = writeString(view, offset, data.nickname);
    offset = writeString(view, offset, data.color);

    view.setUint8(offset, data.image ? 1 : 0); offset += 1;
    if (data.image) {
        offset = writeString(view, offset, data.image);
    }
    view.setUint8(offset, data.playerToken ? 1 : 0); offset += 1;
    if (data.playerToken) {
        offset = writeString(view, offset, data.playerToken);
    }
    return buffer;
}


// Performance Settings
let settings = {
    highResolution: !isMobileDevice(),
    highQualityGraphics: true,
    showNicknames: true,
    showImages: true,
    frameRateLimit: 60, // Frame rate limit
    renderDistance: 1500, // Render distance
    particleEffects: true, // Particle effects
    smoothCells: true, // Smooth cell rendering
    rememberScore: true, // Remember player score
    gamepadSensitivity: 0.9, // Controller sensitivity (lower is more sensitive)
};

// --- Keybinds ---
const DEFAULT_BINDS = {
    keyboard: {
        split: { type: 'key', value: 'Space', display: 'Space' },
        ejectMass: { type: 'key', value: 'KeyW', display: 'W' },
        openChat: { type: 'key', value: 'Enter', display: 'Enter' },
        toggleChat: { type: 'key', value: 'KeyC', display: 'CTRL + C', ctrlKey: true },
        debug: { type: 'key', value: 'Backquote', display: '`' },
    },
    controller: {
        split: { type: 'button', value: 0, display: 'A Button' },
        ejectMass: { type: 'button', value: 1, display: 'B Button' },
        toggleChat: { type: 'button', value: 3, display: 'Y Button' },
        openChat: { type: 'button', value: 9, display: 'Start' },
        debug: { type: 'button', value: 8, display: 'Back' },
        zoomIn: { type: 'button', value: 5, display: 'RB' },
        zoomOut: { type: 'button', value: 4, display: 'LB' },
    }
};
let keybinds = JSON.parse(JSON.stringify(DEFAULT_BINDS)); // Deep copy
let listeningForBind = null; // { action, device }

// Xbox 360 Controller variables
let gamepadConnected = false;
let gamepadIndex = -1;
let gamepadDeadzone = 0.15;
let gamepadButtonStates = {};
let gamepadVibrationSupported = false;

// Start screen navigation
let focusableElements = [];
let currentFocusIndex = -1;
let lastStickInputTime = 0;
const STICK_INPUT_DELAY = 150; // ms

const MINIMAP_SIZE = 200;
const MINIMAP_SIZE_MOBILE = 120;
const MINIMAP_MARGIN = 20;
const MINIMAP_DOT_SIZE = 4;
const DUD_PLAYER_ID = 'duds';
const CAMERA_DEAD_ZONE_RADIUS = 100;
let camera = { x: 0, y: 0, zoom: 1.0 };
let mousePos = { x: 0, y: 0 };

let currentPing = 0;
let lastPingTime = 0;

// --- DOM Elements ---
const startScreen = document.getElementById('start-screen');
const nicknameInput = document.getElementById('nickname-input');
const colorPicker = document.getElementById('color-picker');
const imagePicker = document.getElementById('image-picker');
const playButton = document.getElementById('play-button');
const errorMessage = document.getElementById('error-message');
const finalScoreElement = document.getElementById('final-score');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');

// Performance Settings Elements
const settingResolution = document.getElementById('setting-resolution');
const settingGraphics = document.getElementById('setting-graphics');
const settingNicknames = document.getElementById('setting-nicknames');
const settingImages = document.getElementById('setting-images');
const settingFrameRate = document.getElementById('setting-framerate');
const settingRenderDistance = document.getElementById('setting-renderdistance');
const settingParticles = document.getElementById('setting-particles');
const settingSmoothCells = document.getElementById('setting-smoothcells');
const settingRememberScore = document.getElementById('setting-remember-score');

// Keybinds Elements
const keybindTabToggle = document.getElementById('keybind-tab-toggle');
const keyboardBindsPanel = document.getElementById('keyboard-binds');
const controllerBindsPanel = document.getElementById('controller-binds');
const resetBindsButton = document.getElementById('reset-binds-button');

// Mobile keyboard elements
const mobileKeyboard = document.getElementById('mobile-keyboard');
const keyboardClose = document.getElementById('keyboard-close');
const keyboardKeys = document.getElementById('keyboard-keys');

// --- Settings Management ---
function saveSettings() {
    try {
        localStorage.setItem('agarGameSettings', JSON.stringify(settings));
    } catch (e) {
        console.error("Could not save settings to localStorage.", e);
    }
}

function loadSettings() {
    try {
        const savedSettings = localStorage.getItem('agarGameSettings');
        if (savedSettings) {
            const parsedSettings = JSON.parse(savedSettings);
            settings = { ...settings, ...parsedSettings };
        }
    } catch (e) {
        console.error("Could not load settings from localStorage.", e);
        // Reset to default if parsing fails
        settings = {
            highResolution: !isMobileDevice(),
            highQualityGraphics: true,
            showNicknames: true,
            showImages: true,
            frameRateLimit: 60,
            renderDistance: 1500,
            particleEffects: true,
            smoothCells: true,
            rememberScore: true,
            gamepadSensitivity: 0.9,
        };
    }
    updateSettingsUI();
}

function saveKeybinds() {
    try {
        localStorage.setItem('agarGameKeybinds', JSON.stringify(keybinds));
    } catch (e) {
        console.error("Could not save keybinds to localStorage.", e);
    }
}

function loadKeybinds() {
    try {
        const savedBinds = localStorage.getItem('agarGameKeybinds');
        if (savedBinds) {
            const parsedBinds = JSON.parse(savedBinds);
            // Merge saved binds with defaults to ensure new actions get a default bind
            keybinds.keyboard = { ...DEFAULT_BINDS.keyboard, ...parsedBinds.keyboard };
            keybinds.controller = { ...DEFAULT_BINDS.controller, ...parsedBinds.controller };
        }
    } catch (e) {
        console.error("Could not load keybinds from localStorage.", e);
        keybinds = JSON.parse(JSON.stringify(DEFAULT_BINDS)); // Reset on error
    }
    updateKeybindsUI();
}

function updateKeybindsUI() {
    const actionLabels = {
        split: 'Split', ejectMass: 'Eject Mass', openChat: 'Open Chat',
        toggleChat: 'Toggle Chat', debug: 'Toggle Debug',
        zoomIn: 'Zoom In', zoomOut: 'Zoom Out'
    };

    const createBindItem = (panel, device, action, bind) => {
        const item = document.createElement('div');
        item.className = 'bind-item';

        const label = document.createElement('label');
        label.textContent = actionLabels[action] || action;
        item.appendChild(label);

        const button = document.createElement('button');
        button.className = 'bind-button';
        button.dataset.action = action;
        button.dataset.device = device;
        button.textContent = bind.display;
        item.appendChild(button);

        panel.appendChild(item);
    };

    keyboardBindsPanel.innerHTML = '';
    controllerBindsPanel.innerHTML = '';

    for (const [action, bind] of Object.entries(keybinds.keyboard)) {
        createBindItem(keyboardBindsPanel, 'keyboard', action, bind);
    }
    for (const [action, bind] of Object.entries(keybinds.controller)) {
        createBindItem(controllerBindsPanel, 'controller', action, bind);
    }
}

function setupKeybindsListeners() {
    const keyboardLabel = keybindTabToggle.querySelector('.keyboard-label');
    const controllerLabel = keybindTabToggle.querySelector('.controller-label');

    keybindTabToggle.addEventListener('click', () => {
        const isKeyboardCurrentlyActive = keyboardBindsPanel.classList.contains('active');
        const switchToController = isKeyboardCurrentlyActive;
        keyboardBindsPanel.classList.toggle('active', !switchToController);
        controllerBindsPanel.classList.toggle('active', switchToController);
        keyboardLabel.classList.toggle('active', !switchToController);
        controllerLabel.classList.toggle('active', switchToController);
        if (listeningForBind) {
            listeningForBind = null;
            updateKeybindsUI();
        }
        updateFocusableElements();
    });

    resetBindsButton.addEventListener('click', () => {
        if (confirm('Are you sure you want to reset all keybinds to their default values?')) {
            keybinds = JSON.parse(JSON.stringify(DEFAULT_BINDS));
            saveKeybinds();
            updateKeybindsUI();
        }
    });

    document.getElementById('keybinds-settings').addEventListener('click', (e) => {
        if (e.target.classList.contains('bind-button')) {
            if (listeningForBind) {
                updateKeybindsUI();
            }
            const action = e.target.dataset.action;
            const device = e.target.dataset.device;
            if (device === 'controller' && !gamepadConnected) {
                alert('Please connect an Xbox controller to set controller binds.');
                return;
            }
            listeningForBind = { action, device };
            e.target.textContent = 'Press a key/button...';
            e.target.classList.add('listening');
            if (device === 'keyboard') {
                window.addEventListener('keydown', captureKey, { once: true, capture: true });
            }
        }
    });
}

function captureKey(e) {
    if (!listeningForBind || listeningForBind.device !== 'keyboard') return;
    e.preventDefault();
    e.stopPropagation();

    const { action } = listeningForBind;
    const parts = [];
    if (e.ctrlKey) parts.push('CTRL');
    if (e.shiftKey) parts.push('SHIFT');
    if (e.altKey) parts.push('ALT');

    let keyDisplay = e.key.toUpperCase();
    if (e.code === 'Space') keyDisplay = 'Space';
    if (e.code === 'Backquote') keyDisplay = '`';
    parts.push(keyDisplay);

    keybinds.keyboard[action] = {
        type: 'key',
        value: e.code,
        display: parts.join(' + '),
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey
    };

    saveKeybinds();
    listeningForBind = null;
    updateKeybindsUI();
}

function captureControllerButton(buttonIndex) {
    if (!listeningForBind || listeningForBind.device !== 'controller') return;

    const buttonNames = {
        0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT',
        8: 'Back', 9: 'Start', 10: 'LS', 11: 'RS', 12: 'D-Pad Up',
        13: 'D-Pad Down', 14: 'D-Pad Left', 15: 'D-Pad Right'
    };

    const { action } = listeningForBind;
    keybinds.controller[action] = {
        type: 'button',
        value: buttonIndex,
        display: buttonNames[buttonIndex] || `Button ${buttonIndex}`
    };
    saveKeybinds();
    listeningForBind = null;
    updateKeybindsUI();
    triggerControllerVibration(100, 0.5, 0.5);
}

function updateSettingsUI() {
    if (settingResolution) settingResolution.checked = settings.highResolution;
    if (settingGraphics) settingGraphics.checked = settings.highQualityGraphics;
    if (settingNicknames) settingNicknames.checked = settings.showNicknames;
    if (settingImages) settingImages.checked = settings.showImages;
    if (settingFrameRate) settingFrameRate.value = settings.frameRateLimit;
    if (settingRenderDistance) settingRenderDistance.value = settings.renderDistance;
    if (settingParticles) settingParticles.checked = settings.particleEffects;
    if (settingSmoothCells) settingSmoothCells.checked = settings.smoothCells;
    if (settingRememberScore) settingRememberScore.checked = settings.rememberScore;
}

function setupSettingsListeners() {
    if (settingResolution) {
        settingResolution.addEventListener('change', () => {
            settings.highResolution = settingResolution.checked;
            saveSettings();
            resizeCanvas();
        });
    }
    if (settingGraphics) {
        settingGraphics.addEventListener('change', () => {
            settings.highQualityGraphics = settingGraphics.checked;
            saveSettings();
        });
    }
    if (settingNicknames) {
        settingNicknames.addEventListener('change', () => {
            settings.showNicknames = settingNicknames.checked;
            saveSettings();
        });
    }
    if (settingImages) {
        settingImages.addEventListener('change', () => {
            settings.showImages = settingImages.checked;
            saveSettings();
        });
    }
    if (settingFrameRate) {
        settingFrameRate.addEventListener('change', () => {
            settings.frameRateLimit = parseInt(settingFrameRate.value);
            saveSettings();
        });
    }
    if (settingRenderDistance) {
        settingRenderDistance.addEventListener('change', () => {
            settings.renderDistance = parseInt(settingRenderDistance.value);
            saveSettings();
        });
    }
    if (settingParticles) {
        settingParticles.addEventListener('change', () => {
            settings.particleEffects = settingParticles.checked;
            saveSettings();
        });
    }
    if (settingSmoothCells) {
        settingSmoothCells.addEventListener('change', () => {
            settings.smoothCells = settingSmoothCells.checked;
            saveSettings();
        });
    }
    if (settingRememberScore) {
        settingRememberScore.addEventListener('change', () => {
            settings.rememberScore = settingRememberScore.checked;
            saveSettings();
        });
    }
}

// --- Xbox 360 Controller Setup ---
function setupGamepadSupport() {
    if (!('getGamepads' in navigator)) return;
    window.addEventListener('gamepadconnected', (e) => {
        const gamepadId = e.gamepad.id.toLowerCase();
        if (gamepadId.includes('xbox') || gamepadId.includes('xinput') || gamepadId.includes('360')) {
            gamepadConnected = true;
            gamepadIndex = e.gamepad.index;
            gamepadVibrationSupported = e.gamepad.vibrationActuator !== undefined;
            gamepadButtonStates = {};
            for (let i = 0; i < e.gamepad.buttons.length; i++) {
                gamepadButtonStates[i] = false;
            }
            if (!gameReady) updateFocusableElements();
            addSystemMessage('Xbox 360 controller connected!');
        }
    });
    window.addEventListener('gamepaddisconnected', (e) => {
        if (e.gamepad.index === gamepadIndex) {
            gamepadConnected = false;
            gamepadIndex = -1;
            gamepadButtonStates = {};
            if (!gameReady) updateFocusableElements();
            addSystemMessage('Xbox 360 controller disconnected');
        }
    });
    pollGamepad();
}

function pollGamepad() {
    const gamepads = navigator.getGamepads();
    if (gamepadConnected && gamepads[gamepadIndex]) {
        const gamepad = gamepads[gamepadIndex];
        if (startScreen.style.display !== 'none') {
            handleGamepadOnStartScreen(gamepad);
        } else if (gameReady && socket && socket.connected) {
            handleGamepadInput(gamepad);
        }
    }
    requestAnimationFrame(pollGamepad);
}

function handleGamepadOnStartScreen(gamepad) {
    const now = performance.now();
    if (now - lastStickInputTime > STICK_INPUT_DELAY) {
        const stickX = gamepad.axes[0];
        const stickY = gamepad.axes[1];
        const navDeadzone = 0.5;
        let direction = null;
        if (stickY < -navDeadzone) direction = 'up';
        else if (stickY > navDeadzone) direction = 'down';
        else if (stickX < -navDeadzone) direction = 'left';
        else if (stickX > navDeadzone) direction = 'right';
        if (direction) {
            findNextFocus(direction);
            lastStickInputTime = now;
        }
    }
    for (let i = 0; i < gamepad.buttons.length; i++) {
        const isPressed = gamepad.buttons[i].pressed;
        const wasPressed = gamepadButtonStates[i] || false;
        if (isPressed && !wasPressed) {
            if (listeningForBind && listeningForBind.device === 'controller') {
                captureControllerButton(i);
                break;
            }
            if (i === 0 && currentFocusIndex > -1 && focusableElements[currentFocusIndex]) {
                focusableElements[currentFocusIndex].click();
            }
        }
        gamepadButtonStates[i] = isPressed;
    }
}

function findNextFocus(direction) {
    if (currentFocusIndex < 0 || focusableElements.length < 2) {
        currentFocusIndex = 0;
        updateFocusVisuals();
        return;
    }
    const currentEl = focusableElements[currentFocusIndex];
    const currentRect = currentEl.getBoundingClientRect();
    let bestCandidateIndex = -1;
    let bestCandidateScore = Infinity;
    for (let i = 0; i < focusableElements.length; i++) {
        if (i === currentFocusIndex) continue;
        const candidateEl = focusableElements[i];
        const candidateRect = candidateEl.getBoundingClientRect();
        let primaryDist = 0, secondaryDist = 0, isCandidate = false;
        switch (direction) {
            case 'down':
                if (candidateRect.top > currentRect.top) {
                    primaryDist = candidateRect.top - currentRect.bottom;
                    secondaryDist = Math.abs((currentRect.left + currentRect.width / 2) - (candidateRect.left + candidateRect.width / 2));
                    isCandidate = true;
                }
                break;
            case 'up':
                if (candidateRect.bottom < currentRect.bottom) {
                    primaryDist = currentRect.top - candidateRect.bottom;
                    secondaryDist = Math.abs((currentRect.left + currentRect.width / 2) - (candidateRect.left + candidateRect.width / 2));
                    isCandidate = true;
                }
                break;
            case 'right':
                if (candidateRect.left > currentRect.left) {
                    primaryDist = candidateRect.left - currentRect.right;
                    secondaryDist = Math.abs((currentRect.top + currentRect.height / 2) - (candidateRect.top + candidateRect.height / 2));
                    isCandidate = true;
                }
                break;
            case 'left':
                if (candidateRect.right < currentRect.right) {
                    primaryDist = currentRect.left - candidateRect.right;
                    secondaryDist = Math.abs((currentRect.top + currentRect.height / 2) - (candidateRect.top + candidateRect.height / 2));
                    isCandidate = true;
                }
                break;
        }
        if (isCandidate) {
            if (primaryDist < 0) primaryDist = 0;
            const score = primaryDist + (secondaryDist * 3);
            if (score < bestCandidateScore) {
                bestCandidateScore = score;
                bestCandidateIndex = i;
            }
        }
    }
    if (bestCandidateIndex !== -1) {
        currentFocusIndex = bestCandidateIndex;
        updateFocusVisuals();
    }
}

function handleGamepadInput(gamepad) {
    if (!players[selfId] || players[selfId].length === 0) return;
    const leftStickX = gamepad.axes[0];
    const leftStickY = gamepad.axes[1];
    const rawMagnitude = Math.hypot(leftStickX, leftStickY);
    if (rawMagnitude > gamepadDeadzone) {
        const directionX = leftStickX / rawMagnitude;
        const directionY = leftStickY / rawMagnitude;
        const adjustedMagnitude = (rawMagnitude - gamepadDeadzone) / (1 - gamepadDeadzone);
        const finalMagnitude = Math.min(1.0, adjustedMagnitude / settings.gamepadSensitivity);
        const buffer = new ArrayBuffer(1 + 4 + 4 + 4);
        const view = new DataView(buffer);
        view.setUint8(0, C2S_OPCODES.PLAYER_INPUT_CONTROLLER);
        view.setFloat32(1, directionX, true);
        view.setFloat32(5, directionY, true);
        view.setFloat32(9, finalMagnitude, true);
        socket.send(buffer);
    } else {
        const buffer = new ArrayBuffer(1 + 4 + 4 + 4);
        const view = new DataView(buffer);
        view.setUint8(0, C2S_OPCODES.PLAYER_INPUT_CONTROLLER);
        view.setFloat32(1, 0, true);
        view.setFloat32(5, 0, true);
        view.setFloat32(9, 0, true);
        socket.send(buffer);
    }
    const rightStickX = gamepad.axes[2];
    const rightStickY = gamepad.axes[3];
    const rightMagnitude = Math.hypot(rightStickX, rightStickY);
    if (rightMagnitude > gamepadDeadzone) {
        const normalizedMagnitude = (rightMagnitude - gamepadDeadzone) / (1 - gamepadDeadzone);
        const normalizedX = (rightStickX / rightMagnitude) * normalizedMagnitude;
        const normalizedY = (rightStickY / rightMagnitude) * normalizedMagnitude;
        const aimScale = 200 / camera.zoom;
        const aimX = camera.x + normalizedX * aimScale;
        const aimY = camera.y + normalizedY * aimScale;
        mousePos.x = (aimX - camera.x) * camera.zoom + canvas.width / 2;
        mousePos.y = (aimY - camera.y) * camera.zoom + canvas.height / 2;
    }
    for (let i = 0; i < gamepad.buttons.length; i++) {
        const isPressed = gamepad.buttons[i].pressed;
        const wasPressed = gamepadButtonStates[i] || false;
        if (isPressed && !wasPressed) {
            handleGamepadButton(i);
        }
        gamepadButtonStates[i] = isPressed;
    }
    const leftTrigger = gamepad.buttons[6] ? gamepad.buttons[6].value : 0;
    const rightTrigger = gamepad.buttons[7] ? gamepad.buttons[7].value : 0;
    if (leftTrigger > 0.1) customZoomMultiplier = Math.max(1.0, customZoomMultiplier - leftTrigger * 0.02);
    if (rightTrigger > 0.1) customZoomMultiplier = Math.min(5.0, customZoomMultiplier + rightTrigger * 0.02);
}

function handleGamepadButton(buttonIndex) {
    const action = Object.keys(keybinds.controller).find(
        key => keybinds.controller[key].value === buttonIndex
    );
    if (!action) return;
    if (!players[selfId] || players[selfId].length === 0) return;
    const worldMouseX = (mousePos.x - canvas.width / 2) / camera.zoom + camera.x;
    const worldMouseY = (mousePos.y - canvas.height / 2) / camera.zoom + camera.y;

    switch (action) {
        case 'split': {
            const buffer = new ArrayBuffer(1 + 4 + 4);
            const view = new DataView(buffer);
            view.setUint8(0, C2S_OPCODES.SPLIT);
            view.setFloat32(1, worldMouseX, true);
            view.setFloat32(5, worldMouseY, true);
            socket.send(buffer);
            triggerControllerVibration(200, 0.3, 0.3);
            break;
        }
        case 'ejectMass': {
            const buffer = new ArrayBuffer(1 + 4 + 4);
            const view = new DataView(buffer);
            view.setUint8(0, C2S_OPCODES.EJECT_MASS);
            view.setFloat32(1, worldMouseX, true);
            view.setFloat32(5, worldMouseY, true);
            socket.send(buffer);
            triggerControllerVibration(150, 0.2, 0.2);
            break;
        }
        case 'toggleChat':
            toggleChat(false);
            break;
        case 'openChat':
            if (isMobileDevice()) {
                activeInputTarget = chatInput;
                showMobileKeyboard();
            } else {
                toggleChat(true);
            }
            break;
        case 'debug':
            debugMode = !debugMode;
            addSystemMessage(`Debug mode ${debugMode ? 'enabled' : 'disabled'}`);
            break;
        case 'zoomOut':
            customZoomMultiplier = Math.max(1.0, customZoomMultiplier - 0.2);
            addSystemMessage(`Zoom: ${customZoomMultiplier.toFixed(1)}x`);
            break;
        case 'zoomIn':
            customZoomMultiplier = Math.min(5.0, customZoomMultiplier + 0.2);
            addSystemMessage(`Zoom: ${customZoomMultiplier.toFixed(1)}x`);
            break;
    }
}

function triggerControllerVibration(duration = 200, weakMagnitude = 0.3, strongMagnitude = 0.3) {
    if (!gamepadVibrationSupported || !gamepadConnected) return;
    const gamepads = navigator.getGamepads();
    const gamepad = gamepads[gamepadIndex];
    if (gamepad && gamepad.vibrationActuator) {
        gamepad.vibrationActuator.playEffect('dual-rumble', {
            startDelay: 0,
            duration: duration,
            weakMagnitude: weakMagnitude,
            strongMagnitude: strongMagnitude
        }).catch(err => {
            gamepadVibrationSupported = false;
        });
    }
}

// --- Mobile Keyboard Setup ---
function setupMobileKeyboard() {
    const phantomButtons = document.querySelectorAll('#keyboard-send, #keyboard-clear, #keyboard-buttons, .keyboard-buttons');
    phantomButtons.forEach(button => button.remove());

    const keyboardKeysContainer = document.getElementById('keyboard-keys');
    keyboardKeysContainer.innerHTML = '';

    const keys = [
        '1', '2', '3', '4', '5', '6', '7', '8', '9', '0',
        'q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p',
        'a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', '⌫',
        'z', 'x', 'c', 'v', 'b', 'n', 'm', '!', '?', '.',
        '/', 'space', 'send', 'clear'
    ];

    keys.forEach(key => {
        const keyElement = document.createElement('button');
        keyElement.className = 'keyboard-key';
        keyElement.textContent = key;
        if (key === 'space') keyElement.classList.add('space');
        else if (key === '⌫') keyElement.classList.add('backspace');
        else if (key === 'send') keyElement.classList.add('send');
        else if (key === 'clear') keyElement.classList.add('clear');
        keyElement.addEventListener('click', () => handleKeyPress(key));
        keyboardKeysContainer.appendChild(keyElement);
    });

    keyboardClose.addEventListener('click', hideMobileKeyboard);
    updateSendButtonState();
}

function handleKeyPress(key) {
    if (!activeInputTarget) return;
    const currentText = activeInputTarget.value;
    const maxLength = parseInt(activeInputTarget.getAttribute('maxlength')) || 100;
    if (key === '⌫') activeInputTarget.value = currentText.slice(0, -1);
    else if (key === 'space') { if (currentText.length < maxLength) activeInputTarget.value = currentText + ' '; }
    else if (key === 'send') { handleKeyboardConfirm(); return; }
    else if (key === 'clear') activeInputTarget.value = '';
    else { if (currentText.length < maxLength) activeInputTarget.value = currentText + key; }
    updateSendButtonState();
}

function updateSendButtonState() {
    if (!activeInputTarget) return;
    const hasText = activeInputTarget.value.trim().length > 0;
    const sendButton = document.querySelector('.keyboard-key.send');
    if (sendButton) sendButton.disabled = !hasText;
}

function showMobileKeyboard() {
    if (!activeInputTarget) return;
    mobileKeyboard.classList.add('show');
    const sendButton = document.querySelector('.keyboard-key.send');
    if (sendButton) {
        if (activeInputTarget === nicknameInput) sendButton.textContent = 'done';
        else sendButton.textContent = 'send';
    }
    updateSendButtonState();
    if (isMobileDevice()) {
        chatInput.classList.toggle('keyboard-mode', activeInputTarget === chatInput);
    }
}

function hideMobileKeyboard() {
    mobileKeyboard.classList.remove('show');
    if (isMobileDevice()) {
        chatInput.classList.remove('keyboard-mode');
    }
    activeInputTarget = null;
}

function handleKeyboardConfirm() {
    if (!activeInputTarget) return;
    if (activeInputTarget === chatInput) {
        const message = chatInput.value.trim();
        if (message && socket && socket.connected) {
            if (message.startsWith('/')) {
                handleChatCommand(message);
            } else {
                const msgBytes = textEncoder.encode(message);
                const buffer = new ArrayBuffer(1 + 2 + msgBytes.length);
                const view = new DataView(buffer);
                view.setUint8(0, C2S_OPCODES.CHAT_MESSAGE);
                writeString(view, 1, message);
                socket.send(buffer);
            }
            chatInput.value = '';
        }
    }
    hideMobileKeyboard();
}

// --- Start Screen & Game Initialization Logic ---
function getPlayerToken() {
    const tokenKey = 'agarGamePlayerToken';
    let token = localStorage.getItem(tokenKey);
    if (!token) {
        token = 'player_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        try { localStorage.setItem(tokenKey, token); }
        catch(e) { console.error("Could not save player token to localStorage", e); return null; }
    }
    return token;
}

playButton.addEventListener('click', () => {
    const nickname = nicknameInput.value.trim();
    if (nickname.length === 0) {
        errorMessage.textContent = 'Please enter a nickname.';
        errorMessage.classList.remove('hidden');
        return;
    }
    playButton.disabled = true;
    playButton.textContent = 'Connecting...';
    errorMessage.classList.add('hidden');
    finalScoreElement.classList.add('hidden');

    const imageFile = imagePicker.files[0];
    if (imageFile) {
        if (imageFile.size > 2 * 1024 * 1024) {
            errorMessage.textContent = 'Image is too large (max 2MB).';
            errorMessage.classList.remove('hidden');
            playButton.disabled = false;
            return;
        }
        processImageFile(imageFile)
            .then(processedImageData => {
                startScreen.style.display = 'none';
                initializeGame(nickname, colorPicker.value, processedImageData);
            })
            .catch(error => {
                errorMessage.textContent = 'Failed to process image. Try a smaller image or play without one.';
                errorMessage.classList.remove('hidden');
                playButton.disabled = false;
                playButton.textContent = 'Play';
            });
    } else {
        startScreen.style.display = 'none';
        initializeGame(nickname, colorPicker.value, null);
    }
});

function processImageFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    let { width, height } = img;
                    const maxSize = isMobileDevice() ? 200 : 400;
                    if (width > maxSize || height > maxSize) {
                        const ratio = Math.min(maxSize / width, maxSize / height);
                        width = Math.floor(width * ratio);
                        height = Math.floor(height * ratio);
                    }
                    canvas.width = width;
                    canvas.height = height;
                    ctx.drawImage(img, 0, 0, width, height);
                    const quality = isMobileDevice() ? 0.7 : 0.8;
                    const dataUrl = canvas.toDataURL('image/jpeg', quality);
                    const sizeInBytes = dataUrl.length * 0.75;
                    const maxDataUrlSize = isMobileDevice() ? 500 * 1024 : 1024 * 1024;
                    if (sizeInBytes > maxDataUrlSize) {
                        reject(new Error('Processed image is still too large'));
                        return;
                    }
                    resolve(dataUrl);
                } catch (error) { reject(error); }
            };
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = e.target.result;
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}

function showStartScreen(score) {
    startScreen.style.display = 'flex';
    updateFocusableElements();
    const chatConsoleEl = document.getElementById('chat-console');
    if (chatConsoleEl) chatConsoleEl.classList.add('hidden');
    hideMobileKeyboard();

    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        chatInput.removeAttribute('readonly');
        chatInput.removeAttribute('inputmode');
        chatInput.style.caretColor = 'auto';
        chatInput.classList.remove('keyboard-mode');
    }

    if (score) {
        finalScoreElement.textContent = `Your final score: ${score}`;
        finalScoreElement.classList.remove('hidden');
        playButton.textContent = 'Play Again';
    } else {
        finalScoreElement.classList.add('hidden');
        playButton.textContent = 'Play';
    }
    playButton.disabled = false;
    imagePicker.value = '';
    players = {};
    cellMap.clear(); // Clear the cell map
    imageCache = {};
    gameReady = false;
    debugMode = false;
    customZoomMultiplier = isMobileDevice() ? 0.25 : 1.0;
    if (socket) {
        socket.disconnect();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    setupChatToggle();
    setupGamepadSupport();
    loadSettings();
    setupSettingsListeners();
    loadKeybinds();
    setupKeybindsListeners();

    if (isMobileDevice()) {
        forceMobileChatSize();
        setupMobileKeyboard();
    }
    updateFocusableElements();
});

function processAndLoadImages(playerData) {
    Object.values(playerData).flat().forEach(cell => {
        if (cell.image && !imageCache[cell.id]) {
            const img = new Image();
            img.src = cell.image;
            imageCache[cell.id] = img;
        }
    });
}

function initializeGame(nickname, color, imageDataUrl) {
    const connectionTimeout = setTimeout(() => {
        showStartScreen();
        errorMessage.textContent = 'Connection failed. Please try again.';
        errorMessage.classList.remove('hidden');
    }, 10000);

    try {
        socket = io({
            timeout: 5000,
            maxHttpBufferSize: isMobileDevice() ? 1e6 : 1e7
        });
        socket.io.engine.binaryType = 'arraybuffer';
    } catch (error) {
        clearTimeout(connectionTimeout);
        showStartScreen();
        errorMessage.textContent = 'Failed to connect. Please try again.';
        errorMessage.classList.remove('hidden');
        return;
    }

    socket.on('connect', () => {
        selfId = socket.id;
        measurePing();
        setInterval(measurePing, 2000);
        const joinData = { nickname, color, image: imageDataUrl };
        if (settings.rememberScore) {
            joinData.playerToken = getPlayerToken();
        }
        socket.send(encodeJoinGame(joinData));
    });

    socket.on('message', (data) => {
        if (!(data instanceof ArrayBuffer)) {
            console.warn("Received non-binary message, ignoring.", data);
            return;
        }
        const view = new DataView(data);
        const opcode = view.getUint8(0);
        let offset = 1;

        switch (opcode) {
            case S2C_OPCODES.INITIAL_STATE: {
                clearTimeout(connectionTimeout);
                world.width = view.getUint16(offset, true); offset += 2;
                world.height = view.getUint16(offset, true); offset += 2;
                players = {};
                cellMap.clear();
                const playerCount = view.getUint16(offset, true); offset += 2;
                for (let i = 0; i < playerCount; i++) {
                    const playerIdData = readString(view, offset);
                    const playerId = playerIdData.value;
                    offset = playerIdData.newOffset;
                    players[playerId] = [];
                    const cellCount = view.getUint16(offset, true); offset += 2;
                    for (let j = 0; j < cellCount; j++) {
                        const cellData = decodeCell(view, offset);
                        const cell = cellData.cell;
                        cell.id = playerId;
                        offset = cellData.newOffset;
                        cell.serverX = cell.x;
                        cell.serverY = cell.y;
                        players[playerId].push(cell);
                        cellMap.set(cell.cellId, cell);
                    }
                }
                processAndLoadImages(players);
                const selfCells = players[selfId];
                if (selfCells && selfCells.length > 0) {
                    camera.x = selfCells[0].x;
                    camera.y = selfCells[0].y;
                    camera.zoom = 4.0;
                    baseRadius = selfCells[0].radius * 4;
                    mousePos.x = selfCells[0].x;
                    mousePos.y = selfCells[0].y;
                }
                gameReady = true;
                document.getElementById('chat-console').classList.remove('hidden');
                break;
            }
            case S2C_OPCODES.GAME_STATE_UPDATE: {
                if (!gameReady) return;
                // Updated cells (Delta-compressed)
                const updatedCellCount = view.getUint16(offset, true); offset += 2;
                for(let i=0; i<updatedCellCount; i++) {
                    const cellId = view.getUint32(offset, true); offset += 4;
                    const deltaMask = view.getUint8(offset, true); offset += 1;
                    const cellToUpdate = cellMap.get(cellId);

                    if (cellToUpdate) {
                        if (deltaMask & 1) { // x
                            cellToUpdate.serverX = view.getInt16(offset, true); offset += 2;
                        }
                        if (deltaMask & 2) { // y
                            cellToUpdate.serverY = view.getInt16(offset, true); offset += 2;
                        }
                        if (deltaMask & 4) { // radius
                            cellToUpdate.radius = view.getUint16(offset, true) / 10; offset += 2;
                        }
                        if (deltaMask & 8) { // score
                            cellToUpdate.score = view.getUint32(offset, true); offset += 4;
                        }
                        if (deltaMask & 16) { // mergeCooldown
                            cellToUpdate.mergeCooldown = view.getFloat64(offset, true); offset += 8;
                        }
                    } else {
                        // Cell is not known, skip its data to avoid crashing
                        console.warn(`Received update for unknown cellId: ${cellId}`);
                        if (deltaMask & 1) offset += 2;
                        if (deltaMask & 2) offset += 2;
                        if (deltaMask & 4) offset += 2;
                        if (deltaMask & 8) offset += 4;
                        if (deltaMask & 16) offset += 8;
                    }
                }
                // New cells
                const newCellCount = view.getUint16(offset, true); offset += 2;
                for (let i = 0; i < newCellCount; i++) {
                    const idData = readString(view, offset);
                    const id = idData.value;
                    offset = idData.newOffset;

                    const cellData = decodeCell(view, offset);
                    const newCell = cellData.cell;
                    offset = cellData.newOffset;
                    newCell.id = id;

                    if (!players[newCell.id]) players[newCell.id] = [];
                    if (!cellMap.has(newCell.cellId)) {
                        newCell.serverX = newCell.x;
                        newCell.serverY = newCell.y;
                        players[newCell.id].push(newCell);
                        cellMap.set(newCell.cellId, newCell);
                        if (newCell.image && !imageCache[newCell.id]) {
                            const img = new Image();
                            img.src = newCell.image;
                            imageCache[newCell.id] = img;
                        }
                    }
                }
                // Eaten cells
                const eatenCellCount = view.getUint16(offset, true); offset += 2;
                for (let i = 0; i < eatenCellCount; i++) {
                    const eatenId = view.getUint32(offset, true); offset += 4;
                    const cellToRemove = cellMap.get(eatenId);
                    if (cellToRemove) {
                        const ownerId = cellToRemove.id;
                        if(players[ownerId]) {
                            const index = players[ownerId].findIndex(c => c.cellId === eatenId);
                            if (index > -1) {
                                players[ownerId].splice(index, 1);
                                if (players[ownerId].length === 0 && ownerId !== DUD_PLAYER_ID) {
                                    delete players[ownerId];
                                }
                            }
                        }
                        cellMap.delete(eatenId);
                    }
                }
                break;
            }
            case S2C_OPCODES.LEADERBOARD_UPDATE: {
                const newLeaderboard = [];
                const count = view.getUint8(offset++);
                for(let i=0; i<count; i++) {
                    const idData = readString(view, offset);
                    offset = idData.newOffset;
                    const nicknameData = readString(view, offset);
                    offset = nicknameData.newOffset;
                    const score = view.getUint32(offset, true); offset += 4;
                    newLeaderboard.push({ id: idData.value, nickname: nicknameData.value, score });
                }
                leaderboardData = newLeaderboard;
                leaderboardCache = null;
                break;
            }
            case S2C_OPCODES.YOU_DIED: {
                const score = view.getUint32(offset, true);
                showStartScreen(score);
                break;
            }
            case S2C_OPCODES.CHAT_MESSAGE: {
                const pIdData = readString(view, offset); offset = pIdData.newOffset;
                const nickData = readString(view, offset); offset = nickData.newOffset;
                const msgData = readString(view, offset);
                addChatMessage(nickData.value, msgData.value, pIdData.value === selfId);
                break;
            }
            case S2C_OPCODES.SYSTEM_MESSAGE: {
                const msgData = readString(view, offset);
                addSystemMessage(msgData.value);
                break;
            }
            case S2C_OPCODES.PONG: {
                currentPing = Date.now() - lastPingTime;
                break;
            }
            case S2C_OPCODES.PLAYER_DISCONNECTED: {
                const idData = readString(view, offset);
                const playerId = idData.value;
                if (players[playerId]) {
                    players[playerId].forEach(cell => cellMap.delete(cell.cellId));
                    delete players[playerId];
                    delete imageCache[playerId];
                }
                break;
            }
        }
    });

    socket.on('connect_error', (error) => {
        clearTimeout(connectionTimeout);
        showStartScreen();
        errorMessage.textContent = 'Connection failed. Please try again.';
        errorMessage.classList.remove('hidden');
    });

    socket.on('disconnect', (reason) => {
        clearTimeout(connectionTimeout);
        showStartScreen();
        if (reason === 'io client disconnect') return;
        errorMessage.textContent = 'Lost connection to server.';
        errorMessage.classList.remove('hidden');
    });
}

window.addEventListener('mousemove', (e) => {
    if (!isMobileDevice() && !gamepadConnected) {
        mousePos.x = e.clientX;
        mousePos.y = e.clientY;
    }
});

window.addEventListener('keydown', (e) => {
    if (listeningForBind) return;
    if (!socket || !socket.connected || !gameReady) return;
    if (!isMobileDevice() && (document.activeElement === chatInput || document.activeElement === nicknameInput)) return;

    const action = Object.keys(keybinds.keyboard).find(key => {
        const bind = keybinds.keyboard[key];
        return bind.value === e.code && !!bind.ctrlKey === e.ctrlKey && !!bind.shiftKey === e.shiftKey && !!bind.altKey === e.altKey;
    });

    if (!action) return;
    e.preventDefault();

    if (!players[selfId] || players[selfId].length === 0) return;
    const worldMouseX = (mousePos.x - canvas.width / 2) / camera.zoom + camera.x;
    const worldMouseY = (mousePos.y - canvas.height / 2) / camera.zoom + camera.y;

    switch (action) {
        case 'split': {
            const buffer = new ArrayBuffer(1 + 4 + 4);
            const view = new DataView(buffer);
            view.setUint8(0, C2S_OPCODES.SPLIT);
            view.setFloat32(1, worldMouseX, true);
            view.setFloat32(5, worldMouseY, true);
            socket.send(buffer);
            break;
        }
        case 'ejectMass': {
            const buffer = new ArrayBuffer(1 + 4 + 4);
            const view = new DataView(buffer);
            view.setUint8(0, C2S_OPCODES.EJECT_MASS);
            view.setFloat32(1, worldMouseX, true);
            view.setFloat32(5, worldMouseY, true);
            socket.send(buffer);
            break;
        }
        case 'openChat':
            if (isMobileDevice()) {
                activeInputTarget = chatInput;
                showMobileKeyboard();
            } else {
                chatInput.focus();
            }
            break;
        case 'toggleChat':
            toggleChat(true);
            break;
        case 'debug':
            debugMode = !debugMode;
            addSystemMessage(`Debug mode ${debugMode ? 'enabled' : 'disabled'}`);
            break;
    }
});

// --- Chat & Nickname Event Listeners ---
chatInput.addEventListener('click', (e) => {
    if (isMobileDevice()) { e.preventDefault(); activeInputTarget = chatInput; showMobileKeyboard(); }
});
nicknameInput.addEventListener('click', (e) => {
    if (isMobileDevice()) { e.preventDefault(); activeInputTarget = nicknameInput; showMobileKeyboard(); }
});

chatInput.addEventListener('keydown', (e) => {
    if (e.code === 'Enter') {
        e.preventDefault();
        if (isMobileDevice()) {
            activeInputTarget = chatInput;
            showMobileKeyboard();
        } else {
            const message = chatInput.value.trim();
            if (message && socket && socket.connected) {
                if (message.startsWith('/')) {
                    handleChatCommand(message);
                } else {
                    const msgBytes = textEncoder.encode(message);
                    const buffer = new ArrayBuffer(1 + 2 + msgBytes.length);
                    const view = new DataView(buffer);
                    view.setUint8(0, C2S_OPCODES.CHAT_MESSAGE);
                    writeString(view, 1, message);
                    socket.send(buffer);
                }
                chatInput.value = '';
                chatInput.blur();
            }
        }
    } else if (e.code === 'Escape') { e.preventDefault(); chatInput.blur(); }
});

// --- Chat Commands Handler ---
function handleChatCommand(command) {
    const parts = command.toLowerCase().split(' ');
    const cmd = parts[0];

    switch (cmd) {
        case '/debug':
            debugMode = !debugMode;
            addSystemMessage(`Debug mode ${debugMode ? 'enabled' : 'disabled'}`);
            return true;
        case '/mass':
            const massValue = parseFloat(parts[1]);
            if (isNaN(massValue) || massValue <= 0) {
                addSystemMessage('Usage: /mass <number> (e.g., /mass 100)');
                return true;
            }
            if (massValue > 1000000) {
                addSystemMessage('Maximum mass is 1000000');
                return true;
            }
            const buffer = new ArrayBuffer(1 + 4);
            const view = new DataView(buffer);
            view.setUint8(0, C2S_OPCODES.SET_MASS);
            view.setFloat32(1, massValue, true);
            socket.send(buffer);
            addSystemMessage(`Setting mass to ${massValue}...`);
            return true;
        case '/zoom':
            const zoomValue = parseFloat(parts[1]);
            if (isNaN(zoomValue) || zoomValue <= 0) {
                addSystemMessage('Usage: /zoom <number> (e.g., /zoom 1.5)');
                return true;
            }
            if (zoomValue > 10 || zoomValue < 0.1) {
                addSystemMessage('Zoom must be between 0.1 and 10');
                return true;
            }
            customZoomMultiplier = zoomValue;
            addSystemMessage(`Zoom multiplier set to ${zoomValue}x`);
            return true;
        case '/sensitivity':
        case '/sens':
            const sensitivityValue = parseFloat(parts[1]);
            if (isNaN(sensitivityValue) || sensitivityValue < 0.1 || sensitivityValue > 1.0) {
                addSystemMessage('Usage: /sensitivity <number 0.1-1.0>');
                addSystemMessage('A lower value means higher sensitivity (max speed reached earlier).');
                return true;
            }
            settings.gamepadSensitivity = sensitivityValue;
            saveSettings();
            addSystemMessage(`Controller sensitivity set to ${settings.gamepadSensitivity.toFixed(2)}`);
            return true;
        case '/controller':
            if (gamepadConnected) {
                addSystemMessage('Xbox 360 controller is connected');
                addSystemMessage('Controls: Left stick = Move, Right Stick = Aim, A = Split, B = Eject');
                addSystemMessage('Y = Toggle chat, Start = Open chat, Back = Debug');
                addSystemMessage('LB/RB = Zoom, Triggers = Gradual zoom');
                addSystemMessage('D-pad Up/Down = Adjust Deadzone, D-pad Left/Right = Adjust Sensitivity');
            } else {
                addSystemMessage('No Xbox 360 controller detected');
                addSystemMessage('Connect your controller and it will be detected automatically');
            }
            return true;
        case '/fps':
            addSystemMessage(`Current FPS: ${fps}, Frame time: ${frameTimeAccumulator.toFixed(1)}ms`);
            return true;
        case '/help':
            addSystemMessage('Available commands:');
            addSystemMessage('/debug - Toggle debug information display');
            addSystemMessage('/mass <number> - Set your mass (1-1000000)');
            addSystemMessage('/zoom <number> - Set zoom multiplier (0.1-10)');
            addSystemMessage('/sensitivity <number> - Set controller sensitivity (0.1-1.0)');
            addSystemMessage('/controller - Show controller status and controls');
            addSystemMessage('/fps - Show current frame rate');
            addSystemMessage('/help - Show this help message');
            addSystemMessage('');
            addSystemMessage('Game controls:');
            addSystemMessage('Mouse/Left stick - Move your cell');
            addSystemMessage('Space/A button - Split cells');
            addSystemMessage('W/B button - Eject mass');
            addSystemMessage('Enter/Start - Open chat');
            addSystemMessage('Ctrl+C/Y button - Toggle chat visibility');
            return true;
        default:
            addSystemMessage(`Unknown command: ${cmd}. Type /help for available commands.`);
            return true;
    }
}

// --- Touch Controls ---
let joystick = { startX: 0, startY: 0, currentX: 0, currentY: 0, baseRadius: 60, stickRadius: 40, active: false, id: null };
let splitButton = { x: 0, y: 0, radius: 40, active: false };
let ejectButton = { x: 0, y: 0, radius: 40, active: false };

function setupTouchControls() {
    const cssWidth = parseInt(canvas.style.width);
    const cssHeight = parseInt(canvas.style.height);
    splitButton.x = cssWidth - splitButton.radius - 20;
    splitButton.y = cssHeight - splitButton.radius - 20;
    ejectButton.x = cssWidth - ejectButton.radius - 20;
    ejectButton.y = cssHeight - ejectButton.radius - 20 - (splitButton.radius * 2 + 10);

    canvas.addEventListener('touchstart', (e) => {
        if (!gameReady) return;
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];
            if (Math.hypot(touch.clientX - splitButton.x, touch.clientY - splitButton.y) < splitButton.radius) {
                splitButton.active = true;
                handleSplitOrEject('split');
                return;
            }
            if (Math.hypot(touch.clientX - ejectButton.x, touch.clientY - ejectButton.y) < ejectButton.radius) {
                ejectButton.active = true;
                handleSplitOrEject('ejectMass');
                return;
            }
            if (!joystick.active) {
                joystick.startX = touch.clientX;
                joystick.startY = touch.clientY;
                joystick.currentX = touch.clientX;
                joystick.currentY = touch.clientY;
                joystick.active = true;
                joystick.id = touch.identifier;
            }
        }
    });
    canvas.addEventListener('touchmove', (e) => {
        if (!gameReady) return;
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];
            if (touch.identifier === joystick.id && joystick.active) {
                joystick.currentX = touch.clientX;
                joystick.currentY = touch.clientY;
            }
        }
    });
    canvas.addEventListener('touchend', (e) => {
        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];
            if (touch.identifier === joystick.id) {
                joystick.active = false;
                joystick.id = null;
                if (players[selfId] && players[selfId].length > 0) {
                    mousePos.x = players[selfId][0].x;
                    mousePos.y = players[selfId][0].y;
                }
            }
        }
        splitButton.active = false;
        ejectButton.active = false;
    });

    function handleSplitOrEject(action) {
        if (!players[selfId] || players[selfId].length === 0) return;
        let worldMouseX, worldMouseY;
        if (joystick.active) {
            const stickOffsetX = joystick.currentX - joystick.startX;
            const stickOffsetY = joystick.currentY - joystick.startY;
            const stickDistance = Math.hypot(stickOffsetX, stickOffsetY);
            if (stickDistance > 10) {
                const maxStickDistance = joystick.baseRadius;
                const normalizedStickX = stickOffsetX / maxStickDistance;
                const normalizedStickY = stickOffsetY / maxStickDistance;
                const effectiveMovementScale = 300 / camera.zoom;
                worldMouseX = camera.x + normalizedStickX * effectiveMovementScale;
                worldMouseY = camera.y + normalizedStickY * effectiveMovementScale;
            } else {
                let totalMass = 0, playerCenterX = 0, playerCenterY = 0;
                players[selfId].forEach(cell => {
                    const mass = cell.radius ** 2;
                    totalMass += mass;
                    playerCenterX += cell.x * mass;
                    playerCenterY += cell.y * mass;
                });
                if (totalMass > 0) {
                    playerCenterX /= totalMass;
                    playerCenterY /= totalMass;
                }
                worldMouseX = playerCenterX;
                worldMouseY = playerCenterY - 100;
            }
        } else {
            worldMouseX = (mousePos.x - canvas.width / 2) / camera.zoom + camera.x;
            worldMouseY = (mousePos.y - canvas.height / 2) / camera.zoom + camera.y;
        }
        const opcode = action === 'split' ? C2S_OPCODES.SPLIT : C2S_OPCODES.EJECT_MASS;
        const buffer = new ArrayBuffer(1 + 4 + 4);
        const view = new DataView(buffer);
        view.setUint8(0, opcode);
        view.setFloat32(1, worldMouseX, true);
        view.setFloat32(5, worldMouseY, true);
        socket.send(buffer);
    }
}

// Frame rate limiting
let lastRenderTime = 0;

// --- Game Loop ---
function gameLoop(currentTime) {
    const deltaTime = currentTime - lastFrameTime;
    lastFrameTime = currentTime;
    frameCount++;
    if (currentTime - lastFpsUpdate > 1000) {
        fps = frameCount;
        frameTimeAccumulator = deltaTime;
        frameCount = 0;
        lastFpsUpdate = currentTime;
    }
    const frameDelay = 1000 / settings.frameRateLimit;
    if (currentTime - lastRenderTime < frameDelay) {
        requestAnimationFrame(gameLoop);
        return;
    }
    lastRenderTime = currentTime;

    const cssWidth = parseInt(canvas.style.width) || window.innerWidth;
    const cssHeight = parseInt(canvas.style.height) || window.innerHeight;

    if (!gameReady) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = '30px Arial'; ctx.fillStyle = 'white'; ctx.textAlign = 'center';
        ctx.fillText('Connecting...', cssWidth / 2, cssHeight / 2);
        requestAnimationFrame(gameLoop);
        return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const selfCells = players[selfId];
    if (selfCells && selfCells.length > 0) {
        let targetX = mousePos.x;
        let targetY = mousePos.y;
        let shouldSendInput = true;
        if (isMobileDevice() && joystick.active && !gamepadConnected) {
            const stickOffsetX = joystick.currentX - joystick.startX;
            const stickOffsetY = joystick.currentY - joystick.startY;
            const stickDistance = Math.hypot(stickOffsetX, stickOffsetY);
            if (stickDistance > 10) {
                const maxStickDistance = joystick.baseRadius;
                const normalizedStickX = stickOffsetX / maxStickDistance;
                const normalizedStickY = stickOffsetY / maxStickDistance;
                const effectiveMovementScale = 300 / camera.zoom;
                targetX = camera.x + normalizedStickX * effectiveMovementScale;
                targetY = camera.y + normalizedStickY * effectiveMovementScale;
            } else {
                shouldSendInput = false;
            }
        } else if (!isMobileDevice() && !gamepadConnected) {
            targetX = (mousePos.x - cssWidth / 2) / camera.zoom + camera.x;
            targetY = (mousePos.y - cssHeight / 2) / camera.zoom + camera.y;
        } else if (!gamepadConnected) {
            shouldSendInput = false;
        }

        if (shouldSendInput && !gamepadConnected) {
            const buffer = new ArrayBuffer(1 + 4 + 4);
            const view = new DataView(buffer);
            view.setUint8(0, C2S_OPCODES.PLAYER_INPUT_MOUSE);
            view.setFloat32(1, targetX, true);
            view.setFloat32(5, targetY, true);
            socket.send(buffer);
        }

        if (shouldSendInput && !gamepadConnected) {
            const speed = 1;
            selfCells.forEach(currentCell => {
                const dirX = targetX - currentCell.x;
                const dirY = targetY - currentCell.y;
                const len = Math.hypot(dirX, dirY);
                if (len > currentCell.radius * 3) {
                    const normalizedX = dirX / len;
                    const normalizedY = dirY / len;
                    const speedFactor = 5 / currentCell.radius;
                    const predictionMove = normalizedX * speed * speedFactor * 0.1;
                    const predictionMoveY = normalizedY * speed * speedFactor * 0.1;
                    currentCell.x += predictionMove;
                    currentCell.y += predictionMoveY;
                }
            });
        }

        const allCells = Object.values(players).flat();
        allCells.forEach(cell => {
            if (cell.serverX !== undefined && cell.serverY !== undefined) {
                const lerpSpeed = 0.25;
                const distanceToServer = Math.hypot(cell.serverX - cell.x, cell.serverY - cell.y);
                cell.x += (cell.serverX - cell.x) * lerpSpeed;
                cell.y += (cell.serverY - cell.y) * lerpSpeed;
                if (distanceToServer < 0.3) {
                    cell.x = cell.serverX;
                    cell.y = cell.serverY;
                }
            }
        });

        let totalMass = 0, playerCenterX = 0, playerCenterY = 0, largestRadius = 0;
        selfCells.forEach(cell => {
            const mass = cell.radius ** 2; totalMass += mass;
            playerCenterX += cell.x * mass; playerCenterY += cell.y * mass;
            largestRadius = Math.max(largestRadius, cell.radius);
        });
        if (totalMass > 0) { playerCenterX /= totalMass; playerCenterY /= totalMass; }

        const targetZoom = (baseRadius / largestRadius) * customZoomMultiplier;
        const minZoom = 0.1;
        const maxZoom = 2.0 * customZoomMultiplier;
        const clampedZoom = Math.max(minZoom, Math.min(maxZoom, targetZoom));
        const zoomSpeed = 0.05;
        camera.zoom += (clampedZoom - camera.zoom) * zoomSpeed;

        const dx = playerCenterX - camera.x;
        const dy = playerCenterY - camera.y;
        const distance = Math.hypot(dx, dy);
        if (distance > CAMERA_DEAD_ZONE_RADIUS) {
            const overflow = distance - CAMERA_DEAD_ZONE_RADIUS;
            const moveX = (dx / distance) * overflow;
            const moveY = (dy / distance) * overflow;
            const cameraCatchUpSpeed = 0.15;
            camera.x += moveX * cameraCatchUpSpeed;
            camera.y += moveY * cameraCatchUpSpeed;
        }
    }

    ctx.save();
    ctx.translate(cssWidth / 2, cssHeight / 2);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    const dpr = settings.highResolution ? (window.devicePixelRatio || 1) : 1;
    const viewWidth = (cssWidth * dpr) / camera.zoom;
    const viewHeight = (cssHeight * dpr) / camera.zoom;
    const renderDistance = settings.renderDistance / camera.zoom;
    const viewLeft = camera.x - renderDistance;
    const viewRight = camera.x + renderDistance;
    const viewTop = camera.y - renderDistance;
    const viewBottom = camera.y + renderDistance;

    drawGrid(viewLeft, viewRight, viewTop, viewBottom);
    ctx.strokeStyle = '#E0E0E0'; ctx.lineWidth = 15;
    ctx.strokeRect(-world.width / 2, -world.height / 2, world.width, world.height);

    const allSortedCells = Object.values(players).flat().sort((a, b) => a.radius - b.radius);
    allSortedCells.forEach(cell => {
        if (cell.x + cell.radius < viewLeft || cell.x - cell.radius > viewRight ||
            cell.y + cell.radius < viewTop || cell.y - cell.radius > viewBottom) {
            return;
        }
        if (cell.animationOffset === undefined) cell.animationOffset = Math.random() * 2 * Math.PI;
        if (settings.smoothCells) drawSquishyCell(ctx, cell, [], world);
        else drawSimpleCell(ctx, cell);

        if (settings.showNicknames && cell.id !== DUD_PLAYER_ID && cell.nickname) {
            const fontSize = Math.max(10, cell.radius * 0.3);
            const onscreenRadius = cell.radius * camera.zoom;
            if (onscreenRadius > 10) {
                ctx.fillStyle = 'white';
                ctx.font = `bold ${fontSize}px Arial`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.strokeStyle = 'black';
                ctx.lineWidth = 2;
                ctx.strokeText(cell.nickname, cell.x, cell.y);
                ctx.fillText(cell.nickname, cell.x, cell.y);
            }
        }
    });
    ctx.restore();

    drawLeaderboard(cssWidth, cssHeight);
    if (selfCells && selfCells.length > 0) {
        drawMinimap(selfCells, cssWidth, cssHeight);
    }
    const currentMinimapSize = getCurrentMinimapSize();
    let minimapCenterX, minimapTopY;
    if (isMobileDevice()) {
        minimapCenterX = cssWidth - splitButton.radius * 2 - 40 - currentMinimapSize - MINIMAP_MARGIN + (currentMinimapSize / 2);
        minimapTopY = cssHeight - currentMinimapSize - MINIMAP_MARGIN;
        ctx.font = '10px Arial';
    } else {
        minimapCenterX = cssWidth - currentMinimapSize - MINIMAP_MARGIN + (currentMinimapSize / 2);
        minimapTopY = cssHeight - currentMinimapSize - MINIMAP_MARGIN;
        ctx.font = '20px Arial';
    }
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    const coordsText = `X: ${Math.round(camera.x)}, Y: ${Math.round(camera.y)}`;
    ctx.fillText(coordsText, minimapCenterX, minimapTopY - 10);

    ctx.font = '8pt Arial';
    ctx.fillStyle = currentPing > 100 ? '#ff6666' : currentPing > 50 ? '#ffaa00' : '#66ff66';
    ctx.textAlign = 'left';
    const pingText = `Ping: ${currentPing}ms | FPS: ${fps}`;
    ctx.fillText(pingText, 10, cssHeight - 30);
    if (gamepadConnected) {
        ctx.fillStyle = '#66ff66';
        ctx.fillText('Xbox Controller: Connected', 10, cssHeight - 10);
    }
    if (isMobileDevice() && !gamepadConnected) drawTouchControls();
    if (debugMode) drawDebugUI(cssHeight);

    requestAnimationFrame(gameLoop);
}

// --- Debug UI Function ---
function drawDebugUI(cssHeight) {
    if (!selfId || !players[selfId] || players[selfId].length === 0) return;
    const selfCells = players[selfId];
    const debugX = 20;
    const debugY = cssHeight - 450;
    const lineHeight = 20;
    const now = Date.now();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    const debugHeight = (selfCells.length + 9) * lineHeight + 10;
    ctx.fillRect(debugX - 5, debugY - 5, 350, debugHeight);
    ctx.font = 'bold 16px Arial';
    ctx.fillStyle = '#00ff00';
    ctx.textAlign = 'left';
    ctx.fillText('Debug: Cell Cooldowns & Sync', debugX, debugY + lineHeight);
    ctx.font = '14px monospace';
    selfCells.forEach((cell, index) => {
        const y = debugY + (index + 2) * lineHeight;
        const cooldownRemaining = Math.max(0, cell.mergeCooldown - now);
        const cooldownSeconds = (cooldownRemaining / 1000).toFixed(1);
        const serverDistance = cell.serverX !== undefined ? Math.hypot(cell.x - cell.serverX, cell.y - cell.serverY) : 0;
        ctx.fillStyle = cooldownRemaining > 0 ? '#ff6666' : '#66ff66';
        const cellInfo = `Cell ${cell.cellId}: ${cooldownSeconds}s | Sync: ${serverDistance.toFixed(1)}px`;
        ctx.fillText(cellInfo, debugX, y);
    });
    const avgSyncDistance = selfCells.reduce((sum, cell) => sum + (cell.serverX !== undefined ? Math.hypot(cell.x - cell.serverX, cell.y - cell.serverY) : 0), 0) / selfCells.length;
    ctx.fillStyle = avgSyncDistance > 5 ? '#ffaa00' : '#66ff66';
    ctx.fillText(`Avg Sync Distance: ${avgSyncDistance.toFixed(1)}px`, debugX, debugY + (selfCells.length + 2) * lineHeight);
    const largestRadius = Math.max(...selfCells.map(cell => cell.radius));
    ctx.fillStyle = '#00aaff';
    ctx.fillText(`Zoom: ${camera.zoom.toFixed(2)}x | Largest: ${largestRadius.toFixed(1)}px | Base: ${baseRadius.toFixed(1)}px`, debugX, debugY + (selfCells.length + 3) * lineHeight);
    ctx.fillStyle = '#ffaa00';
    ctx.fillText(`Zoom Multiplier: ${customZoomMultiplier.toFixed(2)}x`, debugX, debugY + (selfCells.length + 4) * lineHeight);
    ctx.fillStyle = gamepadConnected ? '#66ff66' : '#ff6666';
    ctx.fillText(`Controller: ${gamepadConnected ? 'Connected' : 'Disconnected'}`, debugX, debugY + (selfCells.length + 5) * lineHeight);
    if (gamepadConnected) {
        ctx.fillStyle = '#00aaff';
        ctx.fillText(`Deadzone: ${gamepadDeadzone.toFixed(2)} | Vibration: ${gamepadVibrationSupported ? 'Yes' : 'No'}`, debugX, debugY + (selfCells.length + 6) * lineHeight);
    }
    ctx.fillStyle = '#ffaa00';
    ctx.fillText(`Frame time: ${frameTimeAccumulator.toFixed(1)}ms | Frame limit: ${settings.frameRateLimit}fps`, debugX, debugY + (selfCells.length + 7) * lineHeight);
    ctx.fillText(`Render distance: ${settings.renderDistance}px`, debugX, debugY + (selfCells.length + 8) * lineHeight);
}

// --- Initial Setup & Helper Functions ---
function resizeCanvas() {
    const dpr = settings.highResolution ? (window.devicePixelRatio || 1) : 1;
    const displayWidth = window.innerWidth;
    const displayHeight = window.innerHeight;
    canvas.style.width = displayWidth + 'px';
    canvas.style.height = displayHeight + 'px';
    canvas.width = displayWidth * dpr;
    canvas.height = displayHeight * dpr;
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = settings.highQualityGraphics ? 'high' : 'low';
    updateFocusableElements();
    if (isMobileDevice()) {
        const cssWidth = displayWidth;
        const cssHeight = displayHeight;
        splitButton.x = cssWidth - splitButton.radius - 20;
        splitButton.y = cssHeight - splitButton.radius - 20;
        ejectButton.x = cssWidth - ejectButton.radius - 20;
        ejectButton.y = cssHeight - ejectButton.radius - 20 - (splitButton.radius * 2 + 10);
        joystick.startX = 100;
        joystick.startY = cssHeight - 100;
        if (!joystick.active) { joystick.currentX = joystick.startX; joystick.currentY = joystick.startY; }
    }
}
window.addEventListener('resize', resizeCanvas);

customZoomMultiplier = isMobileDevice() ? 0.25 : 1.0;

if (isMobileDevice()) {
    forceMobileChatSize();
    setupTouchControls();
    setupMobileKeyboard();
} else {
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        chatInput.removeAttribute('readonly');
        chatInput.removeAttribute('inputmode');
        chatInput.style.caretColor = 'auto';
    }
}

setupGamepadSupport();
loadSettings();
resizeCanvas();
requestAnimationFrame(gameLoop);

function updateFocusableElements() {
    if (startScreen.style.display === 'none') {
        focusableElements = [];
        currentFocusIndex = -1;
        return;
    }
    focusableElements = Array.from(
        startScreen.querySelectorAll('button, input, select')
    ).filter(el => el.offsetParent !== null && !el.disabled);
    if (!focusableElements.includes(document.querySelector('.gamepad-focus'))) {
        currentFocusIndex = 0;
    } else {
        currentFocusIndex = focusableElements.indexOf(document.querySelector('.gamepad-focus'));
    }
    if(gamepadConnected) updateFocusVisuals();
}

function updateFocusVisuals() {
    document.querySelectorAll('.gamepad-focus').forEach(el => el.classList.remove('gamepad-focus'));
    if (currentFocusIndex > -1 && currentFocusIndex < focusableElements.length) {
        const focusedEl = focusableElements[currentFocusIndex];
        focusedEl.classList.add('gamepad-focus');
        focusedEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }
}

function drawGrid(viewLeft, viewRight, viewTop, viewBottom) {
    const gridSize = 50;
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    const startX = Math.floor(viewLeft / gridSize) * gridSize;
    const endX = Math.ceil(viewRight / gridSize) * gridSize;
    const startY = Math.floor(viewTop / gridSize) * gridSize;
    const endY = Math.ceil(viewBottom / gridSize) * gridSize;
    for (let x = startX; x <= endX; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, startY);
        ctx.lineTo(x, endY);
        ctx.stroke();
    }
    for (let y = startY; y <= endY; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(startX, y);
        ctx.lineTo(endX, y);
        ctx.stroke();
    }
}

function drawSimpleCell(ctx, cell) {
    const img = settings.showImages ? imageCache[cell.id === DUD_PLAYER_ID ? cell.ownerId : cell.id] : null;
    ctx.beginPath();
    ctx.arc(cell.x, cell.y, cell.radius, 0, 2 * Math.PI);
    if (img && img.complete && img.naturalHeight !== 0) {
        ctx.save();
        ctx.clip();
        ctx.drawImage(img, cell.x - cell.radius, cell.y - cell.radius, cell.radius * 2, cell.radius * 2);
        ctx.restore();
    } else {
        ctx.fillStyle = cell.color;
        ctx.fill();
    }
    if (cell.type === 'player' && cell.mergeCooldown) {
        const onCooldown = cell.mergeCooldown > Date.now();
        ctx.strokeStyle = onCooldown ? 'rgba(255, 50, 50, 0.9)' : 'rgba(50, 255, 50, 0.9)';
        ctx.lineWidth = Math.min(8, Math.max(1, cell.radius * 0.05));
        ctx.stroke();
    }
}

function drawSquishyCell(ctx, cell, siblings, world) {
    const { x, y, radius, color, animationOffset, type } = cell;
    const onscreenRadius = radius * camera.zoom;
    if (!settings.highQualityGraphics && onscreenRadius < 4) {
        drawSimpleCell(ctx, cell);
        return;
    }
    const numPoints = 20; const points = []; const time = Date.now() / 400;
    let totalSquishX = 0; let totalSquishY = 0; const SQUISH_FORCE_WALL = 1.5;
    const halfWorldW = world.width / 2; const halfWorldH = world.height / 2;
    let overlap;
    if ((overlap = (x - radius) - (-halfWorldW)) < 0) totalSquishX -= overlap * SQUISH_FORCE_WALL;
    if ((overlap = (x + radius) - halfWorldW) > 0) totalSquishX -= overlap * SQUISH_FORCE_WALL;
    if ((overlap = (y - radius) - (-halfWorldH)) < 0) totalSquishY -= overlap * SQUISH_FORCE_WALL;
    if ((overlap = (y + radius) - halfWorldH) > 0) totalSquishY -= overlap * SQUISH_FORCE_WALL;
    const squishMagnitude = Math.hypot(totalSquishX, totalSquishY);
    const squishIntensity = Math.min(0.6, squishMagnitude / (radius * 2));
    const squishAngle = Math.atan2(totalSquishY, totalSquishX);
    const squishDirX = Math.cos(squishAngle); const squishDirY = Math.sin(squishAngle);
    const perpDirX = -squishDirY; const perpDirY = squishDirX;
    for (let i = 0; i < numPoints; i++) {
        const angle = (i / numPoints) * 2 * Math.PI;
        let wobble;
        if (type === 'virus') {
            wobble = Math.sin(angle * 12 + time + animationOffset) * 0.15;
        } else {
            wobble = Math.sin(angle * 5 + time + animationOffset) * 0.04 + Math.sin(angle * 3 - time * 1.2 + animationOffset) * 0.03;
        }
        const wobbledRadius = radius * (1 + wobble);
        const circlePointX = Math.cos(angle) * wobbledRadius; const circlePointY = Math.sin(angle) * wobbledRadius;
        let finalX = x + circlePointX; let finalY = y + circlePointY;
        if (squishIntensity > 0.01) {
            const projSquish = circlePointX * squishDirX + circlePointY * squishDirY;
            const projPerp = circlePointX * perpDirX + circlePointY * perpDirY;
            const scaledSquish = projSquish * (1 - squishIntensity);
            const scaledPerp = projPerp * (1 + squishIntensity);
            finalX = x + (scaledSquish * squishDirX + scaledPerp * perpDirX);
            finalY = y + (scaledSquish * squishDirY + scaledPerp * perpDirY);
        }
        points.push({ x: finalX, y: finalY });
    }
    ctx.beginPath();
    const firstMidpointX = (points[numPoints - 1].x + points[0].x) / 2;
    const firstMidpointY = (points[numPoints - 1].y + points[0].y) / 2;
    ctx.moveTo(firstMidpointX, firstMidpointY);
    for (let i = 0; i < numPoints; i++) {
        const p1 = points[i];
        const p2 = points[(i + 1) % numPoints];
        const midpointX = (p1.x + p2.x) / 2;
        const midpointY = (p1.y + p2.y) / 2;
        ctx.quadraticCurveTo(p1.x, p1.y, midpointX, midpointY);
    }
    ctx.closePath();
    const img = settings.showImages ? imageCache[cell.id === DUD_PLAYER_ID ? cell.ownerId : cell.id] : null;
    if (img && img.complete && img.naturalHeight !== 0) {
        ctx.save();
        ctx.clip();
        ctx.drawImage(img, x - radius, y - radius, radius * 2, radius * 2);
        ctx.restore();
    } else {
        ctx.fillStyle = color;
        ctx.fill();
    }
    if (cell.type === 'player' && cell.mergeCooldown) {
        const onCooldown = cell.mergeCooldown > Date.now();
        ctx.strokeStyle = onCooldown ? 'rgba(255, 50, 50, 0.9)' : 'rgba(50, 255, 50, 0.9)';
        ctx.lineWidth = Math.min(8, Math.max(1, radius * 0.05));
        ctx.stroke();
    }
}

function getCurrentMinimapSize() { return isMobileDevice() ? MINIMAP_SIZE_MOBILE * 0.66 : MINIMAP_SIZE; }

function drawMinimap(playerCells, cssWidth, cssHeight) {
    const currentMinimapSize = getCurrentMinimapSize();
    let mapX, mapY;
    if (isMobileDevice()) {
        mapX = cssWidth - splitButton.radius * 2 - 40 - currentMinimapSize - MINIMAP_MARGIN;
        mapY = cssHeight - currentMinimapSize - MINIMAP_MARGIN;
    } else {
        mapX = cssWidth - currentMinimapSize - MINIMAP_MARGIN;
        mapY = cssHeight - currentMinimapSize - MINIMAP_MARGIN;
    }
    ctx.fillStyle = 'rgba(100, 100, 100, 0.7)';
    ctx.fillRect(mapX, mapY, currentMinimapSize, currentMinimapSize);
    ctx.strokeStyle = '#E0E0E0'; ctx.lineWidth = 2;
    ctx.strokeRect(mapX, mapY, currentMinimapSize, currentMinimapSize);

    const dpr = settings.highResolution ? (window.devicePixelRatio || 1) : 1;
    const viewWidth = (cssWidth * dpr) / camera.zoom;
    const viewHeight = (cssHeight * dpr) / camera.zoom;
    const viewTopLeftX = camera.x - viewWidth / 2;
    const viewTopLeftY = camera.y - viewHeight / 2;
    const minimapViewX = mapX + ((viewTopLeftX + world.width / 2) / world.width) * currentMinimapSize;
    const minimapViewY = mapY + ((viewTopLeftY + world.height / 2) / world.height) * currentMinimapSize;
    const minimapViewWidth = (viewWidth / world.width) * currentMinimapSize;
    const minimapViewHeight = (viewHeight / world.height) * currentMinimapSize;

    ctx.strokeStyle = '#ff0000';
    ctx.lineWidth = 1;
    ctx.strokeRect(minimapViewX, minimapViewY, minimapViewWidth, minimapViewHeight);

    if (!playerCells) return;
    playerCells.forEach(cell => {
        const playerMapX = mapX + ((cell.x + world.width / 2) / world.width) * currentMinimapSize;
        const playerMapY = mapY + ((cell.y + world.height / 2) / world.height) * currentMinimapSize;
        const img = settings.showImages ? imageCache[cell.id] : null;
        if (img && img.complete && img.naturalHeight !== 0) {
            ctx.drawImage(img, playerMapX - MINIMAP_DOT_SIZE, playerMapY - MINIMAP_DOT_SIZE, MINIMAP_DOT_SIZE * 2, MINIMAP_DOT_SIZE * 2);
        } else {
            ctx.fillStyle = cell.color; ctx.beginPath();
            ctx.arc(playerMapX, playerMapY, MINIMAP_DOT_SIZE, 0, 2 * Math.PI); ctx.fill();
        }
    });
}

function drawLeaderboard(cssWidth, cssHeight) {
    if (!leaderboardCache) {
        const offscreenCanvas = document.createElement('canvas');
        const offscreenCtx = offscreenCanvas.getContext('2d');
        let entryHeight = 25, titleHeight = 30, maxEntries = 5;
        let titleFontSize = 20, entryFontSize = 16;
        if (isMobileDevice()) {
            const maxLeaderboardHeight = cssHeight * 0.4; titleHeight = 20; entryHeight = 16;
            titleFontSize = 14; entryFontSize = 11;
            const availableHeight = maxLeaderboardHeight - titleHeight;
            maxEntries = Math.min(Math.floor(availableHeight / entryHeight), 5);
            if (titleHeight + (maxEntries * entryHeight) > maxLeaderboardHeight) {
                entryHeight = 14; titleHeight = 18; titleFontSize = 12; entryFontSize = 10;
                const newAvailableHeight = maxLeaderboardHeight - titleHeight;
                maxEntries = Math.min(Math.floor(newAvailableHeight / entryHeight), 5);
            }
        }
        const displayCount = Math.min(leaderboardData.length, maxEntries);
        offscreenCanvas.width = 200;
        offscreenCanvas.height = titleHeight + (displayCount * entryHeight);
        offscreenCtx.fillStyle = 'rgba(100, 100, 100, 0.7)';
        offscreenCtx.fillRect(0, 0, 200, offscreenCanvas.height);
        offscreenCtx.font = `bold ${titleFontSize}px Arial`; offscreenCtx.fillStyle = 'white'; offscreenCtx.textAlign = 'center';
        offscreenCtx.fillText('Leaderboard', 100, Math.round(titleHeight * 0.7));
        for (let i = 0; i < displayCount; i++) {
            const player = leaderboardData[i];
            const rank = i + 1;
            offscreenCtx.fillStyle = (player.id === selfId) ? '#f1c40f' : 'white';
            offscreenCtx.font = `${entryFontSize}px Arial`; offscreenCtx.textAlign = 'left';
            offscreenCtx.fillText(`${rank}. ${player.nickname}`, 10, titleHeight + (i * entryHeight) + Math.round(entryHeight * 0.6));
            offscreenCtx.textAlign = 'right';
            offscreenCtx.fillText(player.score, 190, titleHeight + (i * entryHeight) + Math.round(entryHeight * 0.6));
        }
        leaderboardCache = offscreenCanvas;
    }
    if (leaderboardCache) {
        const leaderboardX = cssWidth - 220;
        const leaderboardY = 20;
        ctx.drawImage(leaderboardCache, leaderboardX, leaderboardY);
    }
}

function drawTouchControls() {
    ctx.beginPath();
    ctx.arc(joystick.startX, joystick.startY, joystick.baseRadius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(128, 128, 128, 0.5)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)'; ctx.lineWidth = 2; ctx.stroke();
    const stickOffsetX = joystick.currentX - joystick.startX; const stickOffsetY = joystick.currentY - joystick.startY;
    const stickDistance = Math.hypot(stickOffsetX, stickOffsetY);
    let stickX = joystick.currentX; let stickY = joystick.currentY;
    if (stickDistance > joystick.baseRadius) {
        const angle = Math.atan2(stickOffsetY, stickOffsetX);
        stickX = joystick.startX + Math.cos(angle) * joystick.baseRadius;
        stickY = joystick.startY + Math.sin(angle) * joystick.baseRadius;
    }
    ctx.beginPath();
    ctx.arc(stickX, stickY, joystick.stickRadius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'; ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath();
    ctx.arc(splitButton.x, splitButton.y, splitButton.radius, 0, Math.PI * 2);
    ctx.fillStyle = splitButton.active ? 'rgba(46, 204, 113, 0.9)' : 'rgba(46, 204, 113, 0.7)'; ctx.fill();
    ctx.strokeStyle = 'white'; ctx.lineWidth = 2; ctx.stroke();
    ctx.font = 'bold 24px Arial'; ctx.fillStyle = 'white'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('SPLIT', splitButton.x, splitButton.y);
    ctx.beginPath();
    ctx.arc(ejectButton.x, ejectButton.y, ejectButton.radius, 0, Math.PI * 2);
    ctx.fillStyle = ejectButton.active ? 'rgba(52, 152, 219, 0.9)' : 'rgba(52, 152, 219, 0.7)'; ctx.fill();
    ctx.strokeStyle = 'white'; ctx.lineWidth = 2; ctx.stroke();
    ctx.font = 'bold 24px Arial'; ctx.fillStyle = 'white'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('EJECT', ejectButton.x, ejectButton.y);
}

function toggleChat(shouldFocus = false) {
    const chatConsoleEl = document.getElementById('chat-console');
    const chatToggleBtn = document.getElementById('chat-toggle');
    const chatInputEl = document.getElementById('chat-input');
    if (!chatConsoleEl || !chatToggleBtn) return;
    const wasCollapsed = chatConsoleEl.classList.contains('collapsed');
    chatConsoleEl.classList.toggle('collapsed');
    const isNowCollapsed = chatConsoleEl.classList.contains('collapsed');
    chatToggleBtn.textContent = isNowCollapsed ? '+' : '−';
    if (isMobileDevice()) chatConsoleEl.style.height = isNowCollapsed ? '26px' : '104px';
    if (wasCollapsed && !isNowCollapsed && shouldFocus && !isMobileDevice()) {
        if (chatInputEl) chatInputEl.focus();
    }
}
window.toggleChat = toggleChat;

function setupChatToggle() {
    const chatToggleBtn = document.getElementById('chat-toggle');
    if (chatToggleBtn) {
        chatToggleBtn.onclick = null;
        chatToggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleChat(false);
        });
        return true;
    }
    return false;
}
setupChatToggle();
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupChatToggle);
} else {
    setTimeout(setupChatToggle, 100);
}

function addChatMessage(nickname, message, isOwn = false) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${isOwn ? 'own' : ''}`;
    const nicknameSpan = document.createElement('span');
    nicknameSpan.className = 'chat-nickname';
    nicknameSpan.textContent = nickname + ': ';
    const messageSpan = document.createElement('span');
    messageSpan.className = 'chat-text';
    messageSpan.textContent = message;
    messageDiv.appendChild(nicknameSpan);
    messageDiv.appendChild(messageSpan);
    if (isMobileDevice()) messageDiv.style.marginBottom = '2px';
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    while (chatMessages.children.length > 50) { chatMessages.removeChild(chatMessages.firstChild); }
}

function addSystemMessage(message) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message system';
    messageDiv.textContent = message;
    if (isMobileDevice()) messageDiv.style.marginBottom = '2px';
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    while (chatMessages.children.length > 50) { chatMessages.removeChild(chatMessages.firstChild); }
}

function isMobileDevice() { return (typeof window.orientation !== "undefined") || (navigator.userAgent.indexOf('IEMobile') !== -1); }

function forceMobileChatSize() {
    const chatConsoleEl = document.getElementById('chat-console');
    if (chatConsoleEl) {
        chatConsoleEl.style.width = '160px';
        chatConsoleEl.style.height = '104px';
        chatConsoleEl.style.top = '10px';
        chatConsoleEl.style.left = '10px';
    }
    const chatHeader = document.getElementById('chat-header');
    if (chatHeader) { chatHeader.style.padding = '2px 4px'; chatHeader.style.minHeight = '12px'; }
    const chatTitle = document.getElementById('chat-title');
    if (chatTitle) { chatTitle.style.fontSize = '8px'; }
    const chatToggle = document.getElementById('chat-toggle');
    if (chatToggle) { chatToggle.style.fontSize = '10px'; chatToggle.style.width = '12px'; chatToggle.style.height = '12px'; }
    const chatMessages = document.getElementById('chat-messages');
    if (chatMessages) { chatMessages.style.fontSize = '8px'; chatMessages.style.maxHeight = '64px'; chatMessages.style.padding = '3px'; chatMessages.style.lineHeight = '1.2'; }
    [chatInput, nicknameInput].forEach(input => {
        if (input) {
            input.setAttribute('readonly', 'true');
            input.setAttribute('inputmode', 'none');
            input.setAttribute('autocomplete', 'off');
            input.setAttribute('autocorrect', 'off');
            input.setAttribute('autocapitalize', 'off');
            input.setAttribute('spellcheck', 'false');
            input.style.caretColor = 'transparent';
            input.style.pointerEvents = 'auto';
            input.tabIndex = -1;
        }
    });
    if(chatInput) { chatInput.style.fontSize = '8px'; chatInput.style.padding = '2px'; }
    const chatInputContainer = document.getElementById('chat-input-container');
    if (chatInputContainer) { chatInputContainer.style.padding = '3px'; }
    const chatMessageElements = document.querySelectorAll('.chat-message');
    chatMessageElements.forEach(msg => { msg.style.marginBottom = '2px'; });
    if (chatConsoleEl && chatConsoleEl.classList.contains('collapsed')) {
        chatConsoleEl.style.height = '26px';
    }
}

function measurePing() {
    if (socket && socket.connected) {
        lastPingTime = Date.now();
        const buffer = new ArrayBuffer(1);
        const view = new DataView(buffer);
        view.setUint8(0, C2S_OPCODES.PING);
        socket.send(buffer);
    }
}