// public/game.js

// --- Global variables ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let socket;
let selfId = null;
let players = {};
let imageCache = {}; // --- FIX: Cache for player images
let world = { width: 4000, height: 4000 };
const MINIMAP_SIZE = 200;
const MINIMAP_MARGIN = 20;
const MINIMAP_DOT_SIZE = 4;
const DUD_PLAYER_ID = 'duds';

const CAMERA_DEAD_ZONE_RADIUS = 100;
let camera = { x: 0, y: 0 };
let mousePos = { x: 0, y: 0 };

// --- DOM Elements ---
const startScreen = document.getElementById('start-screen');
const nicknameInput = document.getElementById('nickname-input');
const colorPicker = document.getElementById('color-picker');
const imagePicker = document.getElementById('image-picker'); // --- FIX: Reference to image input
const playButton = document.getElementById('play-button');
const errorMessage = document.getElementById('error-message');
const finalScoreElement = document.getElementById('final-score');

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
    socket = io();

    socket.on('connect', () => {
        selfId = socket.id;
        socket.emit('joinGame', { nickname, color, image: imageDataUrl });
    });

    socket.on('initialState', (state) => {
        players = state.players;
        world = state.world;
        processAndLoadImages(players);
        const selfCells = players[selfId];
        if (selfCells && selfCells.length > 0) {
            camera.x = selfCells[0].x;
            camera.y = selfCells[0].y;
        }
    });

    socket.on('newPlayer', (p) => {
        players[p.id] = p.data;
        processAndLoadImages({ [p.id]: p.data });
    });
    socket.on('playerDisconnected', (id) => {
        delete players[id];
        delete imageCache[id];
    });
    socket.on('gameState', (updatedPlayers) => { players = updatedPlayers; });
    socket.on('youDied', (data) => {
        showStartScreen(data.score);
    });
}

window.addEventListener('mousemove', (e) => {
    mousePos.x = e.clientX;
    mousePos.y = e.clientY;
});

window.addEventListener('keydown', (e) => {
    if (!socket || !socket.connected) return;

    const selfCells = players[selfId];
    if (!selfCells || selfCells.length === 0) return;

    // Calculate mouse direction relative to the player's center of mass
    const worldMouseX = mousePos.x - canvas.width / 2 + camera.x;
    const worldMouseY = mousePos.y - canvas.height / 2 + camera.y;
    
    let totalMass = 0; let playerCenterX = 0; let playerCenterY = 0;
    selfCells.forEach(cell => {
        const mass = cell.radius ** 2; totalMass += mass;
        playerCenterX += cell.x * mass; playerCenterY += cell.y * mass;
    });
    playerCenterX /= totalMass; playerCenterY /= totalMass;
    
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
    }
});

// --- Game Loop ---
function gameLoop() {
    if (!socket || !socket.connected) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = '30px Arial'; ctx.fillStyle = 'white'; ctx.textAlign = 'center';
        ctx.fillText('Waiting to connect...', canvas.width / 2, canvas.height / 2);
        requestAnimationFrame(gameLoop);
        return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const selfCells = players[selfId];

    if (selfCells && selfCells.length > 0) {
        const worldMouseX = mousePos.x - canvas.width / 2 + camera.x;
        const worldMouseY = mousePos.y - canvas.height / 2 + camera.y;
        const speed = 5;
        selfCells.forEach(currentCell => {
            let isBlocked = false;
            for (const otherCell of selfCells) {
                if (currentCell.cellId === otherCell.cellId) continue;
                const distance = Math.hypot(currentCell.x - otherCell.x, currentCell.y - otherCell.y);
                const areTouching = distance < currentCell.radius + otherCell.radius;
                if (areTouching) {
                    if (otherCell.radius > currentCell.radius) { isBlocked = true; break; } 
                    else if (otherCell.radius === currentCell.radius) {
                        const distCurrentToMouse = Math.hypot(worldMouseX - currentCell.x, worldMouseY - currentCell.y);
                        const distOtherToMouse = Math.hypot(worldMouseX - otherCell.x, worldMouseY - otherCell.y);
                        if (distOtherToMouse < distCurrentToMouse) { isBlocked = true; break; }
                    }
                }
            }
            if (!isBlocked) {
                const dirX = worldMouseX - currentCell.x; const dirY = worldMouseY - currentCell.y;
                const len = Math.hypot(dirX, dirY);
                // --- FIX: Only move the cell if the mouse is outside its radius. ---
                if (len > currentCell.radius) { 
                    const normalizedX = dirX / len; const normalizedY = dirY / len;
                    const speedFactor = 20 / currentCell.radius;
                    currentCell.x += normalizedX * speed * speedFactor; currentCell.y += normalizedY * speed * speedFactor;
                }
            }
        });
        socket.emit('playerMovement', selfCells);

        let totalMass = 0; let playerCenterX = 0; let playerCenterY = 0;
        selfCells.forEach(cell => {
            const mass = cell.radius ** 2; totalMass += mass;
            playerCenterX += cell.x * mass; playerCenterY += cell.y * mass;
        });
        playerCenterX /= totalMass; playerCenterY /= totalMass;

        const dx = playerCenterX - camera.x; const dy = playerCenterY - camera.y;
        const distance = Math.hypot(dx, dy);
        if (distance > CAMERA_DEAD_ZONE_RADIUS) {
            const overflow = distance - CAMERA_DEAD_ZONE_RADIUS;
            camera.x += (dx / distance) * overflow; camera.y += (dy / distance) * overflow;
        }
        
        ctx.save();
        ctx.translate(canvas.width / 2 - camera.x, canvas.height / 2 - camera.y);
        drawGrid();
        ctx.strokeStyle = '#E0E0E0'; ctx.lineWidth = 15;
        ctx.strokeRect(-world.width / 2, -world.height / 2, world.width, world.height);
        
        const allSortedCells = Object.values(players).flat().sort((a,b) => a.radius - b.radius);
        allSortedCells.forEach(cell => {
            if (cell.animationOffset === undefined) { cell.animationOffset = Math.random() * 2 * Math.PI; }
            drawSquishyCell(ctx, cell, [], world);
            if (cell.id !== DUD_PLAYER_ID) {
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

        drawLeaderboard();
        drawMinimap(selfCells);
        ctx.font = '20px Arial'; ctx.fillStyle = 'white'; ctx.textAlign = 'right';
        const coordsText = `X: ${Math.round(camera.x)}, Y: ${Math.round(camera.y)}`;
        ctx.fillText(coordsText, canvas.width - MINIMAP_MARGIN, canvas.height - MINIMAP_SIZE - MINIMAP_MARGIN - 10);
    } else {
        ctx.font = '30px Arial'; ctx.fillStyle = 'white'; ctx.textAlign = 'center';
        ctx.fillText('Waiting for server...', canvas.width / 2, canvas.height / 2);
    }
    requestAnimationFrame(gameLoop);
}

// --- Initial Setup & Helper Functions ---
function resizeCanvas() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
window.addEventListener('resize', resizeCanvas);
resizeCanvas(); //Call this once to set the initial canvas size.
requestAnimationFrame(gameLoop);

function drawGrid() {
    const gridSize = 50; ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
    const halfWidth = world.width / 2; const halfHeight = world.height / 2;
    for (let x = -halfWidth; x <= halfWidth; x += gridSize) {
        ctx.beginPath(); ctx.moveTo(x, -halfHeight); ctx.lineTo(x, halfHeight); ctx.stroke();
    }
    for (let y = -halfHeight; y <= halfHeight; y += gridSize) {
        ctx.beginPath(); ctx.moveTo(-halfWidth, y); ctx.lineTo(halfWidth, y); ctx.stroke();
    }
}

function drawSquishyCell(ctx, cell, siblings, world) {
    const { x, y, radius, color, animationOffset } = cell;
    const numPoints = 20; const points = []; const time = Date.now() / 400;
    let totalSquishX = 0; let totalSquishY = 0; const SQUISH_FORCE_WALL = 1.5;
    const halfWorldW = world.width / 2; const halfWorldH = world.height / 2; let overlap;

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
        const p1 = points[i]; const p2 = points[(i + 1) % numPoints];
        const midpointX = (p1.x + p2.x) / 2; const midpointY = (p1.y + p2.y) / 2;
        ctx.quadraticCurveTo(p1.x, p1.y, midpointX, midpointY);
    }
    ctx.closePath();
    
    // Ejected mass can also have an image now
    const img = (cell.id === DUD_PLAYER_ID && cell.image) ? imageCache[cell.image] : imageCache[cell.id];
    if (img && img.complete && img.naturalHeight !== 0) {
        ctx.save();
        ctx.clip(); // Use the path we just defined as a clipping region
        ctx.drawImage(img, x - radius, y - radius, radius * 2, radius * 2);
        ctx.restore(); // Remove the clipping region
    } else {
        ctx.fillStyle = color;
        ctx.fill();
    }
}

function drawMinimap(playerCells) {
    const mapX = canvas.width - MINIMAP_SIZE - MINIMAP_MARGIN; const mapY = canvas.height - MINIMAP_SIZE - MINIMAP_MARGIN;
    ctx.fillStyle = 'rgba(100, 100, 100, 0.7)'; ctx.fillRect(mapX, mapY, MINIMAP_SIZE, MINIMAP_SIZE);
    ctx.strokeStyle = '#E0E0E0'; ctx.lineWidth = 2; ctx.strokeRect(mapX, mapY, MINIMAP_SIZE, MINIMAP_SIZE);
    playerCells.forEach(cell => {
        const playerMapX = mapX + ((cell.x + world.width / 2) / world.width) * MINIMAP_SIZE;
        const playerMapY = mapY + ((cell.y + world.height / 2) / world.height) * MINIMAP_SIZE;
        const img = imageCache[cell.id];
        if (img && img.complete && img.naturalHeight !== 0) {
            ctx.drawImage(img, playerMapX - MINIMAP_DOT_SIZE, playerMapY - MINIMAP_DOT_SIZE, MINIMAP_DOT_SIZE * 2, MINIMAP_DOT_SIZE * 2);
        } else {
            ctx.fillStyle = cell.color; ctx.beginPath(); ctx.arc(playerMapX, playerMapY, MINIMAP_DOT_SIZE, 0, 2 * Math.PI); ctx.fill();
        }
    });
}

function drawLeaderboard() {
    const leaderboardX = canvas.width - 220; const leaderboardY = 20; const entryHeight = 25; const titleHeight = 30; const maxEntries = 5;
    const playerScores = Object.entries(players).filter(([id, _]) => id !== DUD_PLAYER_ID).map(([id, cells]) => {
        const totalScore = cells.reduce((sum, cell) => sum + (cell.score || 0), 0);
        return { id: id, nickname: cells[0]?.nickname || '...', score: Math.max(1, Math.round(totalScore)) };
    });
    const sortedPlayers = playerScores.sort((a, b) => b.score - a.score);
    const displayCount = Math.min(sortedPlayers.length, maxEntries);
    ctx.fillStyle = 'rgba(100, 100, 100, 0.7)'; ctx.fillRect(leaderboardX, leaderboardY, 200, titleHeight + (displayCount * entryHeight));
    ctx.font = 'bold 20px Arial'; ctx.fillStyle = 'white'; ctx.textAlign = 'center';
    ctx.fillText('Leaderboard', leaderboardX + 100, leaderboardY + 22);
    for (let i = 0; i < displayCount; i++) {
        const player = sortedPlayers[i]; const rank = i + 1;
        ctx.fillStyle = (player.id === selfId) ? '#f1c40f' : 'white'; ctx.font = '16px Arial';
        ctx.textAlign = 'left'; ctx.fillText(`${rank}. ${player.nickname}`, leaderboardX + 10, leaderboardY + titleHeight + (i * entryHeight) + 15);
        ctx.textAlign = 'right'; ctx.fillText(player.score, leaderboardX + 190, leaderboardY + titleHeight + (i * entryHeight) + 15);
    }
}