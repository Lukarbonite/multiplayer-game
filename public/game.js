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
let baseRadius = 20; // Store the starting radius for zoom calculations
let debugMode = false; // Debug mode toggle (default off)
let customZoomMultiplier = 1.0; // Custom zoom multiplier for /zoom command
let activeInputTarget = null; // MODIFIED: Tracks which input the mobile keyboard is for

const MINIMAP_SIZE = 200; // Default minimap size
const MINIMAP_SIZE_MOBILE = 120; // Smaller minimap size for mobile
const MINIMAP_MARGIN = 20; // Default minimap margin
const MINIMAP_DOT_SIZE = 4; // Default minimap dot size
const DUD_PLAYER_ID = 'duds'; // ID for non-player objects
const CAMERA_DEAD_ZONE_RADIUS = 100; // Camera dead zone radius
let camera = { x: 0, y: 0, zoom: 1.0 }; // Camera position and zoom
let mousePos = { x: 0, y: 0 }; // Mouse position

let currentPing = 0; // Current ping in milliseconds
let lastPingTime = 0; // Last time ping was measured

// --- DOM Elements ---
const startScreen = document.getElementById('start-screen'); // Start screen element
const nicknameInput = document.getElementById('nickname-input'); // Nickname input field
const colorPicker = document.getElementById('color-picker'); // Color picker input
const imagePicker = document.getElementById('image-picker'); // Image picker input
const playButton = document.getElementById('play-button'); // Play button
const errorMessage = document.getElementById('error-message'); // Error message element
const finalScoreElement = document.getElementById('final-score'); // Final score display
// MODIFIED: Removed global chatConsole variable to prevent script load race conditions.
const chatMessages = document.getElementById('chat-messages'); // Chat messages container
const chatInput = document.getElementById('chat-input'); // Chat input field

// Mobile keyboard elements
const mobileKeyboard = document.getElementById('mobile-keyboard');
const keyboardClose = document.getElementById('keyboard-close');
const keyboardKeys = document.getElementById('keyboard-keys');

// --- Mobile Keyboard Setup ---
function setupMobileKeyboard() {
    const phantomButtons = document.querySelectorAll('#keyboard-send, #keyboard-clear, #keyboard-buttons, .keyboard-buttons');
    phantomButtons.forEach(button => button.remove());

    const keyboardKeysContainer = document.getElementById('keyboard-keys');
    keyboardKeysContainer.innerHTML = '';

    // MODIFIED: Keys are now lowercase
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

        if (key === 'space') {
            keyElement.classList.add('space');
        } else if (key === '⌫') {
            keyElement.classList.add('backspace');
        } else if (key === 'send') {
            keyElement.classList.add('send');
        } else if (key === 'clear') {
            keyElement.classList.add('clear');
        }

        keyElement.addEventListener('click', () => {
            handleKeyPress(key);
        });

        keyboardKeysContainer.appendChild(keyElement);
    });

    keyboardClose.addEventListener('click', hideMobileKeyboard);
    updateSendButtonState();
}

function handleKeyPress(key) {
    if (!activeInputTarget) return; // Only type if an input is active
    const currentText = activeInputTarget.value;
    const maxLength = parseInt(activeInputTarget.getAttribute('maxlength')) || 100;

    if (key === '⌫') {
        activeInputTarget.value = currentText.slice(0, -1);
    } else if (key === 'space') {
        if (currentText.length < maxLength) {
            activeInputTarget.value = currentText + ' ';
        }
    } else if (key === 'send') {
        handleKeyboardConfirm();
        return;
    } else if (key === 'clear') {
        activeInputTarget.value = '';
    } else {
        if (currentText.length < maxLength) {
            activeInputTarget.value = currentText + key;
        }
    }

    updateSendButtonState();
}

function updateSendButtonState() {
    if (!activeInputTarget) return;
    const hasText = activeInputTarget.value.trim().length > 0;
    const sendButton = document.querySelector('.keyboard-key.send');
    if (sendButton) {
        sendButton.disabled = !hasText;
    }
}

function showMobileKeyboard() {
    if (!activeInputTarget) return;
    mobileKeyboard.classList.add('show');

    // MODIFIED: Change send button text based on target
    const sendButton = document.querySelector('.keyboard-key.send');
    if (sendButton) {
        if (activeInputTarget === nicknameInput) {
            sendButton.textContent = 'done';
        } else {
            sendButton.textContent = 'send';
        }
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
    activeInputTarget = null; // Clear the target when keyboard is hidden
}

function handleKeyboardConfirm() {
    if (!activeInputTarget) return;

    if (activeInputTarget === chatInput) {
        const message = chatInput.value.trim();
        if (message && socket && socket.connected) {
            if (message.startsWith('/')) {
                handleChatCommand(message);
            } else {
                socket.emit('chatMessage', { message });
            }
            chatInput.value = '';
        }
    }
    // For nickname input, "done" just closes the keyboard.
    hideMobileKeyboard();
}

// --- Start Screen & Game Initialization Logic ---
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
        // Check file size limit
        if (imageFile.size > 2 * 1024 * 1024) { // 2MB limit
            errorMessage.textContent = 'Image is too large (max 2MB).';
            errorMessage.classList.remove('hidden');
            playButton.disabled = false;
            playButton.textContent = 'Play';
            return;
        }

        // Process image with compression for mobile devices
        processImageFile(imageFile)
            .then(processedImageData => {
                startScreen.style.display = 'none';
                initializeGame(nickname, colorPicker.value, processedImageData);
            })
            .catch(error => {
                console.error('Image processing error:', error);
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

// Add this new function to handle image processing
function processImageFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            const img = new Image();

            img.onload = () => {
                try {
                    // Create canvas for image processing
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');

                    // Determine output size - compress larger images
                    let { width, height } = img;
                    const maxSize = isMobileDevice() ? 200 : 400; // Smaller max size for mobile

                    if (width > maxSize || height > maxSize) {
                        const ratio = Math.min(maxSize / width, maxSize / height);
                        width = Math.floor(width * ratio);
                        height = Math.floor(height * ratio);
                    }

                    canvas.width = width;
                    canvas.height = height;

                    // Draw and compress the image
                    ctx.drawImage(img, 0, 0, width, height);

                    // Convert to data URL with compression
                    const quality = isMobileDevice() ? 0.7 : 0.8; // Lower quality for mobile
                    const dataUrl = canvas.toDataURL('image/jpeg', quality);

                    // Check final data URL size (base64 encoded)
                    const sizeInBytes = dataUrl.length * 0.75; // Rough estimate of base64 size
                    const maxDataUrlSize = isMobileDevice() ? 500 * 1024 : 1024 * 1024; // 500KB mobile, 1MB desktop

                    if (sizeInBytes > maxDataUrlSize) {
                        reject(new Error('Processed image is still too large'));
                        return;
                    }

                    console.log(`Image processed: ${width}x${height}, ${Math.round(sizeInBytes / 1024)}KB`);
                    resolve(dataUrl);

                } catch (error) {
                    reject(error);
                }
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
    // MODIFIED: Get chat console element locally to avoid race conditions.
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
    imageCache = {};
    gameReady = false;
    debugMode = false;
    customZoomMultiplier = isMobileDevice() ? 0.25 : 1.0;
    if (socket) {
        socket.disconnect();
    }
}

function processAndLoadImages(playerData) {
    Object.values(playerData).flat().forEach(cell => {
        if (cell.image && !imageCache[cell.id]) {
            const img = new Image();
            img.src = cell.image;
            imageCache[cell.id] = img;
        }
    });
}

// Update the initializeGame function to add better error handling
function initializeGame(nickname, color, imageDataUrl) {
    console.log('Initializing game connection...');
    const connectionTimeout = setTimeout(() => {
        console.error('Connection timeout - resetting...');
        showStartScreen();
        errorMessage.textContent = 'Connection failed. Please try again.';
        errorMessage.classList.remove('hidden');
    }, 10000);

    try {
        socket = io({
            // Add timeout and size limits for mobile
            timeout: 5000,
            maxHttpBufferSize: isMobileDevice() ? 1e6 : 1e7 // 1MB for mobile, 10MB for desktop
        });
    } catch (error) {
        console.error('Socket creation error:', error);
        clearTimeout(connectionTimeout);
        showStartScreen();
        errorMessage.textContent = 'Failed to connect. Please try again.';
        errorMessage.classList.remove('hidden');
        return;
    }

    socket.on('connect', () => {
        console.log('Socket connected successfully:', socket.id);
        selfId = socket.id;
        console.log('Sending joinGame event...');

        // Start ping measurement
        measurePing();
        // Measure ping every 2 seconds
        setInterval(measurePing, 2000);

        try {
            socket.emit('joinGame', { nickname, color, image: imageDataUrl });
        } catch (error) {
            console.error('Error sending joinGame:', error);
            clearTimeout(connectionTimeout);
            showStartScreen();
            errorMessage.textContent = 'Failed to join game. Image might be too large.';
            errorMessage.classList.remove('hidden');
        }
    });

    socket.on('connect_error', (error) => {
        console.error('Connection error:', error);
        clearTimeout(connectionTimeout);
        showStartScreen();
        errorMessage.textContent = 'Connection failed. Please try again.';
        errorMessage.classList.remove('hidden');
    });

    socket.on('joinError', (data) => {
        console.error('Join error:', data.message);
        clearTimeout(connectionTimeout);
        showStartScreen();
        errorMessage.textContent = data.message;
        errorMessage.classList.remove('hidden');
    });

    socket.on('disconnect', (reason) => {
        console.log('Disconnected:', reason);
        clearTimeout(connectionTimeout);
        showStartScreen();
        if (reason === 'io client disconnect') {
            // User initiated disconnect, don't show error
            return;
        }
        errorMessage.textContent = 'Lost connection to server.';
        errorMessage.classList.remove('hidden');
    });

    socket.on('initialState', (state) => {
        console.log('Received initialState:', state);
        clearTimeout(connectionTimeout);

        players = state.players;
        world = state.world;

        Object.values(players).flat().forEach(cell => {
            cell.serverX = cell.x;
            cell.serverY = cell.y;
        });

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
        console.log('Game ready!');
        gameReady = true;
        // MODIFIED: Get chat console element locally to avoid race conditions.
        const chatConsoleEl = document.getElementById('chat-console');
        if (chatConsoleEl) chatConsoleEl.classList.remove('hidden');

        if (isMobileDevice()) {
            forceMobileChatSize();
            setupMobileKeyboard();
        } else {
            const chatInput = document.getElementById('chat-input');
            if (chatInput) {
                chatInput.removeAttribute('readonly');
                chatInput.removeAttribute('inputmode');
                chatInput.style.caretColor = 'auto';
            }
        }
    });

    socket.on('chatMessage', (data) => addChatMessage(data.nickname, data.message, data.playerId === selfId));
    socket.on('systemMessage', (data) => addSystemMessage(data.message));
    socket.on('playerDisconnected', (id) => { delete players[id]; delete imageCache[id]; });

    socket.on('gameStateUpdate', (updatePackage) => {
        if (!gameReady) return;

        for (const eatenId of updatePackage.eatenCellIds) {
            for (const playerId in players) {
                players[playerId] = players[playerId].filter(c => c.cellId !== eatenId);
                if (players[playerId].length === 0 && playerId !== DUD_PLAYER_ID) {
                    delete players[playerId];
                }
            }
        }

        for (const newCell of updatePackage.newCells) {
            if (!players[newCell.id]) {
                players[newCell.id] = [];
            }
            if (!players[newCell.id].some(c => c.cellId === newCell.cellId)) {
                newCell.serverX = newCell.x;
                newCell.serverY = newCell.y;
                players[newCell.id].push(newCell);
            }
        }

        // Process images from new cells
        if (updatePackage.newCells.length > 0) {
            updatePackage.newCells.forEach(cell => {
                if (cell.image && !imageCache[cell.id]) {
                    const img = new Image();
                    img.src = cell.image;
                    imageCache[cell.id] = img;
                }
            });
        }

        for (const updatedCell of updatePackage.updatedCells) {
            if (!players[updatedCell.id]) continue;
            const cellToUpdate = players[updatedCell.id].find(c => c.cellId === updatedCell.cellId);
            if (cellToUpdate) {
                cellToUpdate.serverX = updatedCell.x;
                cellToUpdate.serverY = updatedCell.y;
                if (cellToUpdate.serverX === undefined || cellToUpdate.serverY === undefined) {
                    cellToUpdate.x = updatedCell.x;
                    cellToUpdate.y = updatedCell.y;
                }
                cellToUpdate.radius = updatedCell.radius;
                cellToUpdate.score = updatedCell.score;
                if (updatedCell.mergeCooldown !== undefined) {
                    cellToUpdate.mergeCooldown = updatedCell.mergeCooldown;
                }
            }
        }
    });

    socket.on('youDied', (data) => showStartScreen(data.score));

    // Handle ping response
    socket.on('pong', () => {
        const pingTime = Date.now() - lastPingTime;
        currentPing = pingTime;
    });
}

window.addEventListener('mousemove', (e) => { if (!isMobileDevice()) { mousePos.x = e.clientX; mousePos.y = e.clientY; } });

window.addEventListener('keydown', (e) => {
    if (!socket || !socket.connected || !gameReady) return;
    if (!isMobileDevice() && (document.activeElement === chatInput || document.activeElement === nicknameInput)) return;

    const selfCells = players[selfId];
    if (!selfCells || selfCells.length === 0) return;

    const worldMouseX = (mousePos.x - canvas.width / 2) / camera.zoom + camera.x;
    const worldMouseY = (mousePos.y - canvas.height / 2) / camera.zoom + camera.y;

    let totalMass = 0; let playerCenterX = 0; let playerCenterY = 0;
    selfCells.forEach(cell => { const mass = cell.radius ** 2; totalMass += mass; playerCenterX += cell.x * mass; playerCenterY += cell.y * mass; });
    if (totalMass > 0) { playerCenterX /= totalMass; playerCenterY /= totalMass; }

    let dx = worldMouseX - playerCenterX; let dy = worldMouseY - playerCenterY;
    const len = Math.hypot(dx, dy);
    if (len > 0) { dx /= len; dy /= len; } else { dx = 0; dy = -1; }
    const direction = { x: dx, y: dy };

    if (e.code === 'Space') { e.preventDefault(); socket.emit('split', { direction }); }
    else if (e.code === 'KeyW') { e.preventDefault(); socket.emit('ejectMass', { direction }); }
    else if (e.code === 'Enter') {
        e.preventDefault();
        if (isMobileDevice()) {
            activeInputTarget = chatInput;
            showMobileKeyboard();
        } else {
            chatInput.focus();
        }
    } else if (e.code === 'KeyC' && e.ctrlKey) {
        e.preventDefault();
        // MODIFIED: Call toggleChat with 'true' to focus the input on toggle-open.
        toggleChat(true);
    }
});

// --- Chat & Nickname Event Listeners ---
document.addEventListener('DOMContentLoaded', () => {
    // Set up chat toggle (this will run again but that's okay)
    setupChatToggle();

    if (isMobileDevice()) {
        forceMobileChatSize();
        setupMobileKeyboard();
    }
});

// MODIFIED: Handle both chat and nickname inputs
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
                if (message.startsWith('/')) { handleChatCommand(message); } else { socket.emit('chatMessage', { message }); }
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
            if (massValue > 10000) {
                addSystemMessage('Maximum mass is 10000');
                return true;
            }
            // Send mass change request to server
            socket.emit('setMass', { mass: massValue });
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

        case '/help':
            addSystemMessage('Available commands:');
            addSystemMessage('/debug - Toggle debug information display');
            addSystemMessage('/mass <number> - Set your mass (1-10000)');
            addSystemMessage('/zoom <number> - Set zoom multiplier (0.1-10)');
            addSystemMessage('/help - Show this help message');
            addSystemMessage('');
            addSystemMessage('Game controls:');
            addSystemMessage('Mouse - Move your cell');
            addSystemMessage('Space - Split cells');
            addSystemMessage('W - Eject mass');
            addSystemMessage('Enter - Open chat');
            addSystemMessage('Ctrl+C - Toggle chat visibility');
            return true;

        default:
            addSystemMessage(`Unknown command: ${cmd}. Type /help for available commands.`);
            return true;
    }
}

// --- Touch Controls (MODIFIED) ---
let joystick = {
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    baseRadius: 60,
    stickRadius: 40,
    active: false,
    id: null // To track the specific touch for the joystick
};

let splitButton = { x: 0, y: 0, radius: 40, active: false };
let ejectButton = { x: 0, y: 0, radius: 40, active: false };

function setupTouchControls() {
    // Get current CSS dimensions for positioning
    const cssWidth = parseInt(canvas.style.width);
    const cssHeight = parseInt(canvas.style.height);

    // Initial button positions (will be updated on resize)
    splitButton.x = cssWidth - splitButton.radius - 20;
    splitButton.y = cssHeight - splitButton.radius - 20;

    ejectButton.x = cssWidth - ejectButton.radius - 20;
    ejectButton.y = cssHeight - ejectButton.radius - 20 - (splitButton.radius * 2 + 10);

    console.log('Touch controls setup:', {
        cssWidth,
        cssHeight,
        splitButton: { x: splitButton.x, y: splitButton.y },
        ejectButton: { x: ejectButton.x, y: ejectButton.y }
    });

    canvas.addEventListener('touchstart', (e) => {
        if (!gameReady) return;
        e.preventDefault(); // Prevent default touch behavior (scrolling, zooming)

        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];

            // Check for button presses first
            if (Math.hypot(touch.clientX - splitButton.x, touch.clientY - splitButton.y) < splitButton.radius) {
                splitButton.active = true;
                handleSplitOrEject('split');
                console.log('Split button touched');
                return; // Consume the touch for the button
            }
            if (Math.hypot(touch.clientX - ejectButton.x, touch.clientY - ejectButton.y) < ejectButton.radius) {
                ejectButton.active = true;
                handleSplitOrEject('ejectMass');
                console.log('Eject button touched');
                return; // Consume the touch for the button
            }

            // If no button was pressed, activate joystick for the first touch that isn't already handled
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
                // When joystick is released, reset mousePos to current player position
                const selfCells = players[selfId];
                if (selfCells && selfCells.length > 0) {
                    mousePos.x = selfCells[0].x;
                    mousePos.y = selfCells[0].y;
                }
            }
        }
        splitButton.active = false;
        ejectButton.active = false;
    });

    function handleSplitOrEject(action) {
        const selfCells = players[selfId];
        if (!selfCells || selfCells.length === 0) return;

        // Direction for split/eject should be based on current player center to the touch point
        const worldMouseX = (mousePos.x - canvas.width / 2) / camera.zoom + camera.x;
        const worldMouseY = (mousePos.y - canvas.height / 2) / camera.zoom + camera.y;

        let totalMass = 0;
        let playerCenterX = 0;
        let playerCenterY = 0;
        selfCells.forEach(cell => {
            const mass = cell.radius ** 2;
            totalMass += mass;
            playerCenterX += cell.x * mass;
            playerCenterY += cell.y * mass;
        });
        if (totalMass > 0) {
            playerCenterX /= totalMass;
            playerCenterY /= totalMass;
        }

        let dx = worldMouseX - playerCenterX;
        let dy = worldMouseY - playerCenterY;
        const len = Math.hypot(dx, dy);
        if (len > 0) {
            dx /= len;
            dy /= len;
        } else {
            dx = 0;
            dy = -1;
        }
        const direction = { x: dx, y: dy };

        socket.emit(action, { direction });
    }
}


// --- Game Loop ---
function gameLoop() {
    // Get CSS pixel dimensions for UI positioning
    const cssWidth = parseInt(canvas.style.width) || window.innerWidth;
    const cssHeight = parseInt(canvas.style.height) || window.innerHeight;

    // Basic guard to wait for the server connection
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
        // --- Player Input and Prediction ---
        let targetX = mousePos.x;
        let targetY = mousePos.y;
        let shouldSendInput = true; // Flag to control when to send input to server

        if (isMobileDevice() && joystick.active) {
            const stickOffsetX = joystick.currentX - joystick.startX;
            const stickOffsetY = joystick.currentY - joystick.startY;
            const stickDistance = Math.hypot(stickOffsetX, stickOffsetY);

            // Only send input if joystick is moved significantly
            if (stickDistance > 10) { // Dead zone for joystick
                const maxStickDistance = joystick.baseRadius;
                const normalizedStickX = stickOffsetX / maxStickDistance;
                const normalizedStickY = stickOffsetY / maxStickDistance;

                // Scale target movement relative to camera, zoom, and player size
                const effectiveMovementScale = 300 / camera.zoom; // Adjust for zoom
                targetX = camera.x + normalizedStickX * effectiveMovementScale;
                targetY = camera.y + normalizedStickY * effectiveMovementScale;
            } else {
                // Joystick is active but not moved enough - don't send input
                shouldSendInput = false;
            }

        } else if (!isMobileDevice()) {
            // For desktop, mousePos is already relative to the canvas viewport, convert to world coordinates
            // Account for zoom when converting mouse coordinates
            targetX = (mousePos.x - cssWidth / 2) / camera.zoom + camera.x;
            targetY = (mousePos.y - cssHeight / 2) / camera.zoom + camera.y;
        } else {
            // Mobile device but joystick is not active - don't send any input
            shouldSendInput = false;
        }

        // Only send player input when we actually want the player to move
        if (shouldSendInput) {
            socket.emit('playerInput', { worldMouseX: targetX, worldMouseY: targetY });
        }

        // Very light client-side prediction for immediate responsiveness
        if (shouldSendInput) {
            const speed = 1; // Very reduced prediction speed
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

        // --- Position Interpolation for Smooth Movement ---
        const allCells = Object.values(players).flat();
        allCells.forEach(cell => {
            if (cell.serverX !== undefined && cell.serverY !== undefined) {
                const lerpSpeed = 0.25; // Slightly slower for smoother movement
                const distanceToServer = Math.hypot(cell.serverX - cell.x, cell.serverY - cell.y);

                cell.x += (cell.serverX - cell.x) * lerpSpeed;
                cell.y += (cell.serverY - cell.y) * lerpSpeed;

                if (distanceToServer < 0.3) {
                    cell.x = cell.serverX;
                    cell.y = cell.serverY;
                }
            }
        });

        // --- Camera Logic with Dynamic Zoom ---
        let totalMass = 0; let playerCenterX = 0;
        let playerCenterY = 0; let largestRadius = 0;
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

    // --- World and Object Rendering (ALWAYS RUNS) ---
    ctx.save();
    ctx.translate(cssWidth / 2, cssHeight / 2);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    drawGrid();
    ctx.strokeStyle = '#E0E0E0'; ctx.lineWidth = 15;
    ctx.strokeRect(-world.width / 2, -world.height / 2, world.width, world.height);

    const allSortedCells = Object.values(players).flat().sort((a, b) => a.radius - b.radius);
    allSortedCells.forEach(cell => {
        if (cell.animationOffset === undefined) { cell.animationOffset = Math.random() * 2 * Math.PI; }
        drawSquishyCell(ctx, cell, [], world);
        if (cell.id !== DUD_PLAYER_ID && cell.nickname) {
            const fontSize = Math.max(10, cell.radius * 0.3);
            ctx.fillStyle = 'white';
            ctx.font = `bold ${fontSize}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.strokeStyle = 'black';
            ctx.lineWidth = 2;
            ctx.strokeText(cell.nickname, cell.x, cell.y);
            ctx.fillText(cell.nickname, cell.x, cell.y);
        }
    });
    ctx.restore();

    // --- UI Rendering ---
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

    // Draw ping in bottom left corner
    ctx.font = '8pt Arial';
    ctx.fillStyle = currentPing > 100 ? '#ff6666' : currentPing > 50 ? '#ffaa00' : '#66ff66';
    ctx.textAlign = 'left';
    const pingText = `Ping: ${currentPing}ms`;
    ctx.fillText(pingText, 10, cssHeight - 10);

    if (isMobileDevice()) { drawTouchControls(); }
    if (debugMode) { drawDebugUI(cssHeight); }

    requestAnimationFrame(gameLoop);
}

// --- Debug UI Function ---
function drawDebugUI(cssHeight) {
    if (!selfId || !players[selfId] || players[selfId].length === 0) return;

    const selfCells = players[selfId];
    const debugX = 20;
    const debugY = cssHeight - 320;
    const lineHeight = 20;
    const now = Date.now();

    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    const debugHeight = (selfCells.length + 4) * lineHeight + 10;
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
}

// --- Initial Setup & Helper Functions ---
function resizeCanvas() {
    const devicePixelRatio = window.devicePixelRatio || 1;
    const displayWidth = window.innerWidth;
    const displayHeight = window.innerHeight;

    canvas.style.width = displayWidth + 'px';
    canvas.style.height = displayHeight + 'px';
    canvas.width = displayWidth * devicePixelRatio;
    canvas.height = displayHeight * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

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
resizeCanvas();

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

requestAnimationFrame(gameLoop);

function drawGrid() {
    const gridSize = 50; ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    const halfWidth = world.width / 2; const halfHeight = world.height / 2;
    for (let x = -halfWidth; x <= halfWidth; x += gridSize) { ctx.beginPath(); ctx.moveTo(x, -halfWidth); ctx.lineTo(x, halfHeight); ctx.stroke(); }
    for (let y = -halfHeight; y <= halfHeight; y += gridSize) { ctx.beginPath(); ctx.moveTo(-halfWidth, y); ctx.lineTo(halfWidth, y); ctx.stroke(); }
}

function drawSquishyCell(ctx, cell, siblings, world) {
    // Destructure 'type' to identify viruses
    const { x, y, radius, color, animationOffset, type } = cell;
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

        // MODIFIED: Custom wobble for spiky viruses
        let wobble;
        if (type === 'virus') {
            // High-frequency, high-amplitude wobble for a spiky look
            wobble = Math.sin(angle * 12 + time + animationOffset) * 0.15;
        } else {
            // Original wobble for players and food
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

    // Fill the cell body with color or image
    const lookupId = cell.id === DUD_PLAYER_ID ? cell.ownerId : cell.id;
    const img = imageCache[lookupId];
    if (img && img.complete && img.naturalHeight !== 0) {
        ctx.save();
        ctx.clip(); // Use the squishy path as a clipping mask
        ctx.drawImage(img, x - radius, y - radius, radius * 2, radius * 2);
        ctx.restore();
    } else {
        ctx.fillStyle = color;
        ctx.fill();
    }

    // For player cells, draw a border indicating merge cooldown status.
    if (cell.type === 'player' && cell.mergeCooldown) {
        const onCooldown = cell.mergeCooldown > Date.now();

        // Use semi-transparent colors for a less harsh look
        ctx.strokeStyle = onCooldown ? 'rgba(255, 50, 50, 0.9)' : 'rgba(50, 255, 50, 0.9)';

        // Border width is proportional to radius, with a minimum and maximum
        ctx.lineWidth = Math.min(8, Math.max(1, radius * 0.05));

        // Stroke the same squishy path we defined earlier
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

    // --- Draw camera view on minimap ---
    const viewWidth = cssWidth / camera.zoom;
    const viewHeight = cssHeight / camera.zoom;

    const viewTopLeftX = camera.x - viewWidth / 2;
    const viewTopLeftY = camera.y - viewHeight / 2;

    const minimapViewX = mapX + ((viewTopLeftX + world.width / 2) / world.width) * currentMinimapSize;
    const minimapViewY = mapY + ((viewTopLeftY + world.height / 2) / world.height) * currentMinimapSize;

    const minimapViewWidth = (viewWidth / world.width) * currentMinimapSize;
    const minimapViewHeight = (viewHeight / world.height) * currentMinimapSize;

    ctx.strokeStyle = '#ff0000'; // Bright red
    ctx.lineWidth = 1;
    ctx.strokeRect(minimapViewX, minimapViewY, minimapViewWidth, minimapViewHeight);
    // --- End camera view on minimap ---

    if (!playerCells) return;
    playerCells.forEach(cell => {
        const playerMapX = mapX + ((cell.x + world.width / 2) / world.width) * currentMinimapSize;
        const playerMapY = mapY + ((cell.y + world.height / 2) / world.height) * currentMinimapSize;
        const img = imageCache[cell.id];
        if (img && img.complete && img.naturalHeight !== 0) {
            ctx.drawImage(img, playerMapX - MINIMAP_DOT_SIZE, playerMapY - MINIMAP_DOT_SIZE, MINIMAP_DOT_SIZE * 2, MINIMAP_DOT_SIZE * 2);
        } else {
            ctx.fillStyle = cell.color; ctx.beginPath();
            ctx.arc(playerMapX, playerMapY, MINIMAP_DOT_SIZE, 0, 2 * Math.PI); ctx.fill();
        }
    });
}

function drawLeaderboard(cssWidth, cssHeight) {
    const leaderboardX = cssWidth - 220; const leaderboardY = 20;
    let entryHeight = 25; let titleHeight = 30; let maxEntries = 5;
    let titleFontSize = 20; let entryFontSize = 16;
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
    const playerScores = Object.entries(players).filter(([id, _]) => id !== DUD_PLAYER_ID && players[id].length > 0).map(([id, cells]) => ({ id: id, nickname: cells[0]?.nickname || '...', score: Math.max(1, Math.round(cells.reduce((sum, cell) => sum + (cell.score || 0), 0))) }));
    const sortedPlayers = playerScores.sort((a, b) => b.score - a.score);
    const displayCount = Math.min(sortedPlayers.length, maxEntries);
    ctx.fillStyle = 'rgba(100, 100, 100, 0.7)';
    ctx.fillRect(leaderboardX, leaderboardY, 200, titleHeight + (displayCount * entryHeight));
    ctx.font = `bold ${titleFontSize}px Arial`; ctx.fillStyle = 'white'; ctx.textAlign = 'center';
    ctx.fillText('Leaderboard', leaderboardX + 100, leaderboardY + Math.round(titleHeight * 0.7));
    for (let i = 0; i < displayCount; i++) {
        const player = sortedPlayers[i]; const rank = i + 1;
        ctx.fillStyle = (player.id === selfId) ? '#f1c40f' : 'white';
        ctx.font = `${entryFontSize}px Arial`; ctx.textAlign = 'left';
        ctx.fillText(`${rank}. ${player.nickname}`, leaderboardX + 10, leaderboardY + titleHeight + (i * entryHeight) + Math.round(entryHeight * 0.6));
        ctx.textAlign = 'right';
        ctx.fillText(player.score, leaderboardX + 190, leaderboardY + titleHeight + (i * entryHeight) + Math.round(entryHeight * 0.6));
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

    if (!chatConsoleEl || !chatToggleBtn) {
        console.warn('Chat elements not found:', { chatConsoleEl: !!chatConsoleEl, chatToggleBtn: !!chatToggleBtn });
        return;
    }

    const wasCollapsed = chatConsoleEl.classList.contains('collapsed');

    chatConsoleEl.classList.toggle('collapsed');
    const isNowCollapsed = chatConsoleEl.classList.contains('collapsed');

    chatToggleBtn.textContent = isNowCollapsed ? '+' : '−';

    if (isMobileDevice()) {
        chatConsoleEl.style.height = isNowCollapsed ? '26px' : '104px';
    }

    // If we just opened the chat (it was collapsed, but isn't now),
    // and we were asked to focus, and we are not on mobile, then focus the input.
    if (wasCollapsed && !isNowCollapsed && shouldFocus && !isMobileDevice()) {
        if (chatInputEl) {
            chatInputEl.focus();
        }
    }

    console.log('Chat toggled:', { wasCollapsed, isNowCollapsed });
}
window.toggleChat = toggleChat;

function setupChatToggle() {
    const chatToggleBtn = document.getElementById('chat-toggle');
    if (chatToggleBtn) {
        // Remove any existing event listeners first
        chatToggleBtn.onclick = null;

        // Add the click event listener
        chatToggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('Chat toggle clicked');
            toggleChat(false);
        });

        console.log('Chat toggle event listener attached');
        return true;
    } else {
        console.warn('Chat toggle button not found');
        return false;
    }
}

// Try to set up the chat toggle immediately
setupChatToggle();

// Also try when DOM is loaded (if it hasn't loaded yet)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupChatToggle);
} else {
    // DOM is already loaded, try again in case elements were added later
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
    if (isMobileDevice()) { messageDiv.style.marginBottom = '2px'; }
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    while (chatMessages.children.length > 50) { chatMessages.removeChild(chatMessages.firstChild); }
}

function addSystemMessage(message) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message system';
    messageDiv.textContent = message;
    if (isMobileDevice()) { messageDiv.style.marginBottom = '2px'; }
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    while (chatMessages.children.length > 50) { chatMessages.removeChild(chatMessages.firstChild); }
}

function isMobileDevice() { return (typeof window.orientation !== "undefined") || (navigator.userAgent.indexOf('IEMobile') !== -1); }

function forceMobileChatSize() {
    // MODIFIED: Get chat console element locally to avoid race conditions.
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

    // MODIFIED: Target both inputs for mobile readonly setup
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
// --- Ping Measurement Function ---
function measurePing() {
    if (socket && socket.connected) {
        lastPingTime = Date.now();
        socket.emit('ping');
    }
}