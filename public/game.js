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

const MINIMAP_SIZE = 200; // Default minimap size
const MINIMAP_SIZE_MOBILE = 120; // Smaller minimap size for mobile
const MINIMAP_MARGIN = 20; // Default minimap margin
const MINIMAP_DOT_SIZE = 4; // Default minimap dot size
const DUD_PLAYER_ID = 'duds'; // ID for non-player objects
const CAMERA_DEAD_ZONE_RADIUS = 100; // Camera dead zone radius
let camera = { x: 0, y: 0, zoom: 1.0 }; // Camera position and zoom
let mousePos = { x: 0, y: 0 }; // Mouse position

// --- DOM Elements ---
const startScreen = document.getElementById('start-screen'); // Start screen element
const nicknameInput = document.getElementById('nickname-input'); // Nickname input field
const colorPicker = document.getElementById('color-picker'); // Color picker input
const imagePicker = document.getElementById('image-picker'); // Image picker input
const playButton = document.getElementById('play-button'); // Play button
const errorMessage = document.getElementById('error-message'); // Error message element
const finalScoreElement = document.getElementById('final-score'); // Final score display
const chatConsole = document.getElementById('chat-console'); // Chat console
const chatMessages = document.getElementById('chat-messages'); // Chat messages container
const chatInput = document.getElementById('chat-input'); // Chat input field
// Don't declare chatToggle here since it might not exist yet


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
        const reader = new FileReader();
        reader.onload = (e) => {
            startScreen.style.display = 'none';
            initializeGame(nickname, colorPicker.value, e.target.result);
        };
        if (imageFile.size > 2 * 1024 * 1024) { // 2MB limit
            errorMessage.textContent = 'Image is too large (max 2MB).';
            errorMessage.classList.remove('hidden');
            playButton.disabled = false;
            playButton.textContent = 'Play';
            return;
        }
        reader.readAsDataURL(imageFile);
    } else {
        startScreen.style.display = 'none';
        initializeGame(nickname, colorPicker.value, null);
    }
});

function showStartScreen(score) {
    startScreen.style.display = 'flex';
    chatConsole.classList.add('hidden'); // Hide chat when returning to start screen
    if (score) {
        finalScoreElement.textContent = `Your final score: ${score}`;
        finalScoreElement.classList.remove('hidden');
        playButton.textContent = 'Play Again';
    } else {
        finalScoreElement.classList.add('hidden');
        playButton.textContent = 'Play';
    }
    playButton.disabled = false;
    imagePicker.value = ''; // Clear file input
    players = {};
    imageCache = {}; // Clear image cache
    gameReady = false;
    debugMode = false; // Reset debug mode when returning to start screen
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

function initializeGame(nickname, color, imageDataUrl) {
    console.log('Initializing game connection...');

    // Set a timeout to reset if connection takes too long
    const connectionTimeout = setTimeout(() => {
        console.error('Connection timeout - resetting...');
        showStartScreen();
    }, 10000); // 10 second timeout

    socket = io();

    socket.on('connect', () => {
        console.log('Socket connected successfully:', socket.id);
        selfId = socket.id;
        console.log('Sending joinGame event...');
        socket.emit('joinGame', { nickname, color, image: imageDataUrl });
    });

    socket.on('connect_error', (error) => {
        console.error('Connection error:', error);
        clearTimeout(connectionTimeout);
        showStartScreen();
    });

    socket.on('disconnect', (reason) => {
        console.log('Disconnected:', reason);
        clearTimeout(connectionTimeout);
        showStartScreen();
    });

    socket.on('initialState', (state) => {
        console.log('Received initialState:', state);
        clearTimeout(connectionTimeout); // Clear timeout on successful connection

        players = state.players;
        world = state.world;

        // Initialize server position tracking for all initial cells
        Object.values(players).flat().forEach(cell => {
            cell.serverX = cell.x;
            cell.serverY = cell.y;
        });

        processAndLoadImages(players);
        const selfCells = players[selfId];
        if (selfCells && selfCells.length > 0) {
            camera.x = selfCells[0].x;
            camera.y = selfCells[0].y;
            camera.zoom = 4.0; // Start zoomed in at 4x
            baseRadius = selfCells[0].radius * 4; // Set base to 4x starting radius for 4x initial zoom
            // Initialize mousePos to current player position on join for smooth start
            mousePos.x = selfCells[0].x;
            mousePos.y = selfCells[0].y;
        }
        console.log('Game ready!');
        gameReady = true;
        chatConsole.classList.remove('hidden'); // Show chat when game starts
    });

    // Chat message handlers
    socket.on('chatMessage', (data) => {
        addChatMessage(data.nickname, data.message, data.playerId === selfId);
    });

    socket.on('systemMessage', (data) => {
        addSystemMessage(data.message);
    });

    socket.on('playerDisconnected', (id) => {
        delete players[id];
        delete imageCache[id];
    });
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
                // Initialize server position tracking for new cells
                newCell.serverX = newCell.x;
                newCell.serverY = newCell.y;
                players[newCell.id].push(newCell);
            }
        }

        for (const updatedCell of updatePackage.updatedCells) {
            if (!players[updatedCell.id]) continue;

            const cellToUpdate = players[updatedCell.id].find(c => c.cellId === updatedCell.cellId);
            if (cellToUpdate) {
                // Store server position as target for interpolation
                cellToUpdate.serverX = updatedCell.x;
                cellToUpdate.serverY = updatedCell.y;

                // If this is the first server update, snap to position
                if (cellToUpdate.serverX === undefined || cellToUpdate.serverY === undefined) {
                    cellToUpdate.x = updatedCell.x;
                    cellToUpdate.y = updatedCell.y;
                }

                // Always update non-position properties immediately
                cellToUpdate.radius = updatedCell.radius;
                cellToUpdate.score = updatedCell.score;

                // Update merge cooldown from server
                if (updatedCell.mergeCooldown !== undefined) {
                    cellToUpdate.mergeCooldown = updatedCell.mergeCooldown;
                }
            }
        }
    });
    socket.on('youDied', (data) => {
        showStartScreen(data.score);
    });
}

window.addEventListener('mousemove', (e) => {
    // Only update mousePos for desktop control
    if (!isMobileDevice()) {
        mousePos.x = e.clientX;
        mousePos.y = e.clientY;
    }
});

window.addEventListener('keydown', (e) => {
    if (!socket || !socket.connected || !gameReady || isMobileDevice()) return;

    // If chat input is focused, don't process game controls
    if (document.activeElement === chatInput) return;

    const selfCells = players[selfId];
    if (!selfCells || selfCells.length === 0) return;

    const worldMouseX = (mousePos.x - canvas.width / 2) / camera.zoom + camera.x;
    const worldMouseY = (mousePos.y - canvas.height / 2) / camera.zoom + camera.y;

    let totalMass = 0; let playerCenterX = 0; let playerCenterY = 0;
    selfCells.forEach(cell => {
        const mass = cell.radius ** 2; totalMass += mass;
        playerCenterX += cell.x * mass; playerCenterY += cell.y * mass;
    });
    if (totalMass > 0) {
        playerCenterX /= totalMass;
        playerCenterY /= totalMass;
    }

    let dx = worldMouseX - playerCenterX; let dy = worldMouseY - playerCenterY;
    const len = Math.hypot(dx, dy);
    if (len > 0) { dx /= len; dy /= len; } else { dx = 0; dy = -1; }
    const direction = { x: dx, y: dy };

    if (e.code === 'Space') {
        e.preventDefault();
        socket.emit('split', { direction });
    } else if (e.code === 'KeyW') {
        e.preventDefault();
        socket.emit('ejectMass', { direction });
    } else if (e.code === 'Enter') {
        e.preventDefault();
        chatInput.focus();
    } else if (e.code === 'KeyC' && e.ctrlKey) {
        e.preventDefault();
        toggleChat(); // Ctrl+C to toggle chat (manual fallback)
    }
});

// --- Chat Event Listeners ---
document.addEventListener('DOMContentLoaded', () => {
    const chatToggleBtn = document.getElementById('chat-toggle');
    if (chatToggleBtn) {
        chatToggleBtn.addEventListener('click', () => {
            console.log('Chat toggle clicked'); // Debug log
            chatConsole.classList.toggle('collapsed');
            chatToggleBtn.textContent = chatConsole.classList.contains('collapsed') ? '+' : '−';
        });
    }
});

// Alternative event listener setup (in case DOMContentLoaded doesn't work)
setTimeout(() => {
    const chatToggleBtn = document.getElementById('chat-toggle');
    if (chatToggleBtn && !chatToggleBtn.hasAttribute('data-listener-added')) {
        chatToggleBtn.setAttribute('data-listener-added', 'true');
        chatToggleBtn.addEventListener('click', () => {
            console.log('Chat toggle clicked (fallback)'); // Debug log
            chatConsole.classList.toggle('collapsed');
            chatToggleBtn.textContent = chatConsole.classList.contains('collapsed') ? '+' : '−';
        });
    }
}, 1000);

// --- Chat Commands Handler ---
function handleChatCommand(command) {
    const parts = command.toLowerCase().split(' ');
    const cmd = parts[0];

    switch (cmd) {
        case '/debug':
            debugMode = !debugMode;
            addSystemMessage(`Debug mode ${debugMode ? 'enabled' : 'disabled'}`);
            return true;

        case '/help':
            addSystemMessage('Available commands:');
            addSystemMessage('/debug - Toggle debug information display');
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

chatInput.addEventListener('keydown', (e) => {
    if (e.code === 'Enter') {
        e.preventDefault();
        const message = chatInput.value.trim();
        if (message && socket && socket.connected) {
            // Check if it's a command
            if (message.startsWith('/')) {
                handleChatCommand(message);
            } else {
                // Send regular chat message
                socket.emit('chatMessage', { message });
            }
            chatInput.value = '';
            chatInput.blur(); // Remove focus after sending
        }
    } else if (e.code === 'Escape') {
        e.preventDefault();
        chatInput.blur();
    }
});

// Prevent chat input from interfering with game
chatInput.addEventListener('focus', () => {
    // Disable game controls when typing
});

chatInput.addEventListener('blur', () => {
    // Re-enable game controls when not typing
});

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
    // Initial button positions (will be updated on resize)
    splitButton.x = canvas.width - splitButton.radius - 20;
    splitButton.y = canvas.height - splitButton.radius - 20;

    ejectButton.x = canvas.width - ejectButton.radius - 20;
    ejectButton.y = canvas.height - ejectButton.radius - 20 - (splitButton.radius * 2 + 10);

    canvas.addEventListener('touchstart', (e) => {
        if (!gameReady) return;
        e.preventDefault(); // Prevent default touch behavior (scrolling, zooming)

        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];

            // Check for button presses first
            if (Math.hypot(touch.clientX - splitButton.x, touch.clientY - splitButton.y) < splitButton.radius) {
                splitButton.active = true;
                handleSplitOrEject('split');
                return; // Consume the touch for the button
            }
            if (Math.hypot(touch.clientX - ejectButton.x, touch.clientY - ejectButton.y) < ejectButton.radius) {
                ejectButton.active = true;
                handleSplitOrEject('ejectMass');
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
    // Basic guard to wait for the server connection
    if (!gameReady) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = '30px Arial'; ctx.fillStyle = 'white'; ctx.textAlign = 'center';
        ctx.fillText('Connecting...', canvas.width / 2, canvas.height / 2);
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
            targetX = (mousePos.x - canvas.width / 2) / camera.zoom + camera.x;
            targetY = (mousePos.y - canvas.height / 2) / camera.zoom + camera.y;
        } else {
            // Mobile device but joystick is not active - don't send any input
            shouldSendInput = false;
        }

        // Only send player input when we actually want the player to move
        if (shouldSendInput) {
            socket.emit('playerInput', { worldMouseX: targetX, worldMouseY: targetY });
        }

        // Very light client-side prediction for immediate responsiveness
        // Only apply prediction when we're actually sending input to server
        if (shouldSendInput) {
            const speed = 1; // Very reduced prediction speed
            selfCells.forEach(currentCell => {
                const dirX = targetX - currentCell.x;
                const dirY = targetY - currentCell.y;
                const len = Math.hypot(dirX, dirY);

                // Minimal prediction only for initial responsiveness
                if (len > currentCell.radius * 3) { // Large dead zone
                    const normalizedX = dirX / len;
                    const normalizedY = dirY / len;
                    const speedFactor = 5 / currentCell.radius; // Very reduced
                    const predictionMove = normalizedX * speed * speedFactor * 0.1; // Very light
                    const predictionMoveY = normalizedY * speed * speedFactor * 0.1;

                    // Apply very minimal prediction - just for immediate feel
                    currentCell.x += predictionMove;
                    currentCell.y += predictionMoveY;
                }
            });
        }

        // Server handles world boundary clamping - no need to duplicate here
        // Apply client-side clamping to match server logic and prevent border jitter.
        // (Removed to prevent client-server conflicts)

        // --- Position Interpolation for Smooth Movement ---
        // Lerp all cells towards their server positions for smooth visuals
        const allCells = Object.values(players).flat();
        allCells.forEach(cell => {
            if (cell.serverX !== undefined && cell.serverY !== undefined) {
                // Smooth interpolation towards server position
                const lerpSpeed = 0.3; // Adjust this value: higher = snappier, lower = smoother

                // Calculate distance to server position
                const distanceToServer = Math.hypot(cell.serverX - cell.x, cell.serverY - cell.y);

                // Use faster lerp for larger distances to prevent lag feeling
                const adaptiveLerpSpeed = distanceToServer > 20 ? 0.5 : lerpSpeed;

                cell.x += (cell.serverX - cell.x) * adaptiveLerpSpeed;
                cell.y += (cell.serverY - cell.y) * adaptiveLerpSpeed;

                // Snap to server position when very close to avoid jitter
                if (distanceToServer < 0.5) {
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
        if (totalMass > 0) {
            playerCenterX /= totalMass;
            playerCenterY /= totalMass;
        }

        // Calculate zoom to keep largest cell visually consistent
        const targetZoom = baseRadius / largestRadius;
        const minZoom = 0.1; // Minimum zoom (maximum zoom out)
        const maxZoom = 2.0;  // Maximum zoom (can zoom in if player gets smaller)
        const clampedZoom = Math.max(minZoom, Math.min(maxZoom, targetZoom));

        // Smooth zoom transition
        const zoomSpeed = 0.05;
        camera.zoom += (clampedZoom - camera.zoom) * zoomSpeed;

        const dx = playerCenterX - camera.x;
        const dy = playerCenterY - camera.y;
        const distance = Math.hypot(dx, dy);

        // Smooth camera movement to prevent dead zone jitter.
        if (distance > CAMERA_DEAD_ZONE_RADIUS) {
            const overflow = distance - CAMERA_DEAD_ZONE_RADIUS;
            const moveX = (dx / distance) * overflow;
            const moveY = (dy / distance) * overflow;
            // Faster camera response since we're now server-authoritative for positions
            const cameraCatchUpSpeed = 0.15; // Increased from 0.1
            camera.x += moveX * cameraCatchUpSpeed;
            camera.y += moveY * cameraCatchUpSpeed;
        }
    }

    // --- World and Object Rendering (ALWAYS RUNS) ---
    ctx.save();
    // Apply zoom and translation
    ctx.translate(canvas.width / 2, canvas.height / 2);
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
    drawLeaderboard();
    if (selfCells && selfCells.length > 0) {
        drawMinimap(selfCells);
    }

    // Display coordinates directly above the minimap
    const currentMinimapSize = getCurrentMinimapSize();
    ctx.font = '20px Arial';
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    const coordsText = `X: ${Math.round(camera.x)}, Y: ${Math.round(camera.y)}`;
    const minimapCenterX = canvas.width - currentMinimapSize - MINIMAP_MARGIN + (currentMinimapSize / 2);
    const minimapTopY = canvas.height - currentMinimapSize - MINIMAP_MARGIN;
    ctx.fillText(coordsText, minimapCenterX, minimapTopY - 10);

    // Render touch controls only if it's a mobile device
    if (isMobileDevice()) {
        drawTouchControls();
    }

    // --- Debug UI (only render if debug mode is enabled) ---
    if (debugMode) {
        drawDebugUI();
    }

    requestAnimationFrame(gameLoop);
}

// --- Debug UI Function ---
function drawDebugUI() {
    if (!selfId || !players[selfId]) return;

    const selfCells = players[selfId];
    if (!selfCells || selfCells.length === 0) return;

    const debugX = 20;
    const debugY = canvas.height - 280; // Increased height for zoom info
    const lineHeight = 20;
    const now = Date.now();

    // Semi-transparent background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    const debugHeight = (selfCells.length + 3) * lineHeight + 10; // Extra lines for zoom info
    ctx.fillRect(debugX - 5, debugY - 5, 350, debugHeight);

    // Title
    ctx.font = 'bold 16px Arial';
    ctx.fillStyle = '#00ff00';
    ctx.textAlign = 'left';
    ctx.fillText('Debug: Cell Cooldowns & Sync', debugX, debugY + lineHeight);

    // Cell information
    ctx.font = '14px monospace';
    selfCells.forEach((cell, index) => {
        const y = debugY + (index + 2) * lineHeight;

        // Calculate remaining cooldown
        const cooldownRemaining = Math.max(0, cell.mergeCooldown - now);
        const cooldownSeconds = (cooldownRemaining / 1000).toFixed(1);

        // Calculate distance from server position
        const serverDistance = cell.serverX !== undefined ?
            Math.hypot(cell.x - cell.serverX, cell.y - cell.serverY) : 0;

        // Color based on cooldown status
        if (cooldownRemaining > 0) {
            ctx.fillStyle = '#ff6666'; // Red when in cooldown
        } else {
            ctx.fillStyle = '#66ff66'; // Green when ready to merge
        }

        const cellInfo = `Cell ${cell.cellId}: ${cooldownSeconds}s | Sync: ${serverDistance.toFixed(1)}px`;
        ctx.fillText(cellInfo, debugX, y);
    });

    // Overall sync status
    const avgSyncDistance = selfCells.reduce((sum, cell) => {
        const dist = cell.serverX !== undefined ?
            Math.hypot(cell.x - cell.serverX, cell.y - cell.serverY) : 0;
        return sum + dist;
    }, 0) / selfCells.length;

    ctx.fillStyle = avgSyncDistance > 5 ? '#ffaa00' : '#66ff66';
    ctx.fillText(`Avg Sync Distance: ${avgSyncDistance.toFixed(1)}px`, debugX, debugY + (selfCells.length + 2) * lineHeight);

    // Zoom information
    const largestRadius = Math.max(...selfCells.map(cell => cell.radius));
    ctx.fillStyle = '#00aaff';
    ctx.fillText(`Zoom: ${camera.zoom.toFixed(2)}x | Largest: ${largestRadius.toFixed(1)}px | Base: ${baseRadius.toFixed(1)}px`,
        debugX, debugY + (selfCells.length + 3) * lineHeight);
}

// --- Initial Setup & Helper Functions ---
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    // Recalculate button and joystick positions on resize
    if (isMobileDevice()) {
        splitButton.x = canvas.width - splitButton.radius - 20;
        splitButton.y = canvas.height - splitButton.radius - 20;
        ejectButton.x = canvas.width - ejectButton.radius - 20;
        ejectButton.y = canvas.height - ejectButton.radius - 20 - (splitButton.radius * 2 + 10);

        // Adjust joystick base position dynamically
        joystick.startX = 100; // Example fixed position, adjust as needed
        joystick.startY = canvas.height - 100; // Example fixed position, adjust as needed
        if (!joystick.active) { // Reset current position if not active
            joystick.currentX = joystick.startX;
            joystick.currentY = joystick.startY;
        }
    }
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();
requestAnimationFrame(gameLoop);

// Call setupTouchControls if it's a mobile device
if (isMobileDevice()) {
    setupTouchControls();
}

function drawGrid() {
    const gridSize = 50; ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    const halfWidth = world.width / 2; const halfHeight = world.height / 2;
    for (let x = -halfWidth; x <= halfWidth; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, -halfWidth); ctx.lineTo(x, halfHeight); ctx.stroke();
    }
    for (let y = -halfHeight; y <= halfHeight; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(-halfWidth, y); ctx.lineTo(halfWidth, y); ctx.stroke();
    }
}

function drawSquishyCell(ctx, cell, siblings, world) {
    const { x, y, radius, color, animationOffset } = cell;
    const numPoints = 20; const points = []; const time = Date.now() / 400;
    let totalSquishX = 0;
    let totalSquishY = 0; const SQUISH_FORCE_WALL = 1.5;
    const halfWorldW = world.width / 2; const halfWorldH = world.height / 2;
    let overlap;

    if ((overlap = (x - radius) - (-halfWorldW)) < 0) totalSquishX -= overlap * SQUISH_FORCE_WALL;
    if ((overlap = (x + radius) - halfWorldW) > 0) totalSquishX -= overlap * SQUISH_FORCE_WALL;
    if ((overlap = (y - radius) - (-halfWorldH)) < 0) totalSquishY -= overlap * SQUISH_FORCE_WALL;
    if ((overlap = (y + radius) - halfWorldH) > 0) totalSquishY -= overlap * SQUISH_FORCE_WALL;

    const squishMagnitude = Math.hypot(totalSquishX, totalSquishY);
    const squishIntensity = Math.min(0.6, squishMagnitude / (radius * 2));
    const squishAngle = Math.atan2(totalSquishY, totalSquishX);
    const squishDirX = Math.cos(squishAngle);
    const squishDirY = Math.sin(squishAngle);
    const perpDirX = -squishDirY; const perpDirY = squishDirX;
    for (let i = 0; i < numPoints; i++) {
        const angle = (i / numPoints) * 2 * Math.PI;
        const wobble = Math.sin(angle * 5 + time + animationOffset) * 0.04 + Math.sin(angle * 3 - time * 1.2 + animationOffset) * 0.03;
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
    const lookupId = cell.id === DUD_PLAYER_ID ? cell.ownerId : cell.id;
    const img = imageCache[lookupId];
    if (img && img.complete && img.naturalHeight !== 0) {
        ctx.save();
        ctx.clip();
        ctx.drawImage(img, x - radius, y - radius, radius * 2, radius * 2);
        ctx.restore();
    } else {
        ctx.fillStyle = color;
        ctx.fill();
    }
}

function getCurrentMinimapSize() {
    return isMobileDevice() ? MINIMAP_SIZE_MOBILE : MINIMAP_SIZE;
}

function drawMinimap(playerCells) {
    const currentMinimapSize = getCurrentMinimapSize();
    const mapX = canvas.width - currentMinimapSize - MINIMAP_MARGIN;
    const mapY = canvas.height - currentMinimapSize - MINIMAP_MARGIN;
    ctx.fillStyle = 'rgba(100, 100, 100, 0.7)'; ctx.fillRect(mapX, mapY, currentMinimapSize, currentMinimapSize);
    ctx.strokeStyle = '#E0E0E0'; ctx.lineWidth = 2; ctx.strokeRect(mapX, mapY, currentMinimapSize, currentMinimapSize);
    if (!playerCells) return;
    playerCells.forEach(cell => {
        const playerMapX = mapX + ((cell.x + world.width / 2) / world.width) * currentMinimapSize;
        const playerMapY = mapY + ((cell.y + world.height / 2) / world.height) * currentMinimapSize;
        const img = imageCache[cell.id];
        if (img && img.complete && img.naturalHeight !== 0) {
            ctx.drawImage(img, playerMapX - MINIMAP_DOT_SIZE, playerMapY - MINIMAP_DOT_SIZE, MINIMAP_DOT_SIZE * 2, MINIMAP_DOT_SIZE * 2);
        } else {
            ctx.fillStyle = cell.color; ctx.beginPath(); ctx.arc(playerMapX, playerMapY, MINIMAP_DOT_SIZE, 0, 2 * Math.PI); ctx.fill();
        }
    });
}

function drawLeaderboard() {
    const leaderboardX = canvas.width - 220; const leaderboardY = 20; const entryHeight = 25;
    const titleHeight = 30; const maxEntries = 5;
    const playerScores = Object.entries(players).filter(([id, _]) => id !== DUD_PLAYER_ID && players[id].length > 0).map(([id, cells]) => {
        const totalScore = cells.reduce((sum, cell) => sum + (cell.score || 0), 0);
        return { id: id, nickname: cells[0]?.nickname || '...', score: Math.max(1, Math.round(totalScore)) };
    });
    const sortedPlayers = playerScores.sort((a, b) => b.score - a.score);
    const displayCount = Math.min(sortedPlayers.length, maxEntries);
    ctx.fillStyle = 'rgba(100, 100, 100, 0.7)';
    ctx.fillRect(leaderboardX, leaderboardY, 200, titleHeight + (displayCount * entryHeight));
    ctx.font = 'bold 20px Arial'; ctx.fillStyle = 'white'; ctx.textAlign = 'center';
    ctx.fillText('Leaderboard', leaderboardX + 100, leaderboardY + 22);
    for (let i = 0; i < displayCount; i++) {
        const player = sortedPlayers[i];
        const rank = i + 1;
        ctx.fillStyle = (player.id === selfId) ? '#f1c40f' : 'white'; ctx.font = '16px Arial';
        ctx.textAlign = 'left'; ctx.fillText(`${rank}. ${player.nickname}`, leaderboardX + 10, leaderboardY + titleHeight + (i * entryHeight) + 15);
        ctx.textAlign = 'right';
        ctx.fillText(player.score, leaderboardX + 190, leaderboardY + titleHeight + (i * entryHeight) + 15);
    }
}

// --- MODIFIED: Touch Control Drawing ---
function drawTouchControls() {
    // Draw Joystick Base
    ctx.beginPath();
    ctx.arc(joystick.startX, joystick.startY, joystick.baseRadius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(128, 128, 128, 0.5)'; // Grey, semi-transparent
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Calculate stick position, clamped within the base radius
    const stickOffsetX = joystick.currentX - joystick.startX;
    const stickOffsetY = joystick.currentY - joystick.startY;
    const stickDistance = Math.hypot(stickOffsetX, stickOffsetY);

    let stickX = joystick.currentX;
    let stickY = joystick.currentY;

    if (stickDistance > joystick.baseRadius) {
        const angle = Math.atan2(stickOffsetY, stickOffsetX);
        stickX = joystick.startX + Math.cos(angle) * joystick.baseRadius;
        stickY = joystick.startY + Math.sin(angle) * joystick.baseRadius;
    }

    // Draw Joystick Stick
    ctx.beginPath();
    ctx.arc(stickX, stickY, joystick.stickRadius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'; // White, semi-transparent
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw Split Button
    ctx.beginPath();
    ctx.arc(splitButton.x, splitButton.y, splitButton.radius, 0, Math.PI * 2);
    ctx.fillStyle = splitButton.active ? 'rgba(46, 204, 113, 0.9)' : 'rgba(46, 204, 113, 0.7)'; // Green
    ctx.fill();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = 'bold 24px Arial';
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SPLIT', splitButton.x, splitButton.y);

    // Draw Eject Button
    ctx.beginPath();
    ctx.arc(ejectButton.x, ejectButton.y, ejectButton.radius, 0, Math.PI * 2);
    ctx.fillStyle = ejectButton.active ? 'rgba(52, 152, 219, 0.9)' : 'rgba(52, 152, 219, 0.7)'; // Blue
    ctx.fill();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = 'bold 24px Arial';
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('EJECT', ejectButton.x, ejectButton.y);
}

// --- Chat Functions ---
function toggleChat() {
    const chatConsole = document.getElementById('chat-console');
    const chatToggleBtn = document.getElementById('chat-toggle');

    if (chatConsole && chatToggleBtn) {
        chatConsole.classList.toggle('collapsed');
        chatToggleBtn.textContent = chatConsole.classList.contains('collapsed') ? '+' : '−';
        console.log('Chat toggled. Collapsed:', chatConsole.classList.contains('collapsed'));
    }
}

// Make toggleChat available globally
window.toggleChat = toggleChat;

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

    chatMessages.appendChild(messageDiv);

    // Auto-scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Remove old messages if too many (keep last 50)
    while (chatMessages.children.length > 50) {
        chatMessages.removeChild(chatMessages.firstChild);
    }
}

function addSystemMessage(message) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message system';
    messageDiv.textContent = message;

    chatMessages.appendChild(messageDiv);

    // Auto-scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Remove old messages if too many
    while (chatMessages.children.length > 50) {
        chatMessages.removeChild(chatMessages.firstChild);
    }
}

// --- Mobile Device Detection ---
function isMobileDevice() {
    return (typeof window.orientation !== "undefined") || (navigator.userAgent.indexOf('IEMobile') !== -1);
}