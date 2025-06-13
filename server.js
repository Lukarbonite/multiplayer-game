// server.js

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    // Optimize Socket.IO for lower latency but allow fallbacks
    pingTimeout: 60000,
    pingInterval: 25000,
    // Removed transports restriction to allow fallback to polling if needed
    upgrade: true,
    allowEIO3: true
});

const PORT = 3000;
const WORLD_WIDTH = 4000;
const WORLD_HEIGHT = 4000;
const PELLET_COUNT = 400;
const PELLET_RADIUS = 5;
const VIRUS_COUNT = 20;

const PLAYER_START_SCORE = 1;
const CELL_BASE_MASS = 399;
const PELLET_SCORE_VALUE = 5;
const PLAYER_MIN_SPLIT_SCORE = 50;
const CELL_CONSUME_THRESHOLD = 0.5;

const PLAYER_MERGE_TIME = 15000;
const PLAYER_SPLIT_LAUNCH_DECAY = 0.94;
const PLAYER_MIN_EJECT_SCORE = 50;
const EJECTED_MASS_SCORE = 10;
const EJECTED_MASS_RADIUS = 10;

const VIRUS_SCORE = 100;
const VIRUS_COLOR = '#33ff33';
const VIRUS_CONSUME_SCORE_GAIN_SPLIT = 10;
const EJECT_LAUNCH_SPEED = 400;

const DUD_PLAYER_ID = 'duds';

app.use(express.static('public'));

let players = {};
let cellIdCounter = 0;
let playerInputs = {};
let lastBroadcastState = {};

function getRadiusFromScore(score) {
    const baseRadius = Math.sqrt(score + CELL_BASE_MASS);
    // Dynamic scaling: small cells stay closer to original size, large cells grow dramatically
    const scaleFactor = 1.0 + (score / 100) * 0.8; // Grows from 1.0x to 1.8x as score increases
    return baseRadius * Math.min(scaleFactor, 1.8);
}

function getRandomColor() {
    const letters = '0123456789ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
}

function createPellet() {
    const halfWidth = WORLD_WIDTH / 2;
    const halfHeight = WORLD_HEIGHT / 2;
    return {
        x: Math.floor(Math.random() * WORLD_WIDTH) - halfWidth,
        y: Math.floor(Math.random() * WORLD_HEIGHT) - halfHeight,
        score: PELLET_SCORE_VALUE,
        radius: PELLET_RADIUS,
        color: getRandomColor(),
        nickname: '',
        type: 'pellet',
        id: DUD_PLAYER_ID,
        cellId: cellIdCounter++,
    };
}

function createVirus() {
    const halfWidth = WORLD_WIDTH / 2;
    const halfHeight = WORLD_HEIGHT / 2;
    const score = VIRUS_SCORE;
    return {
        x: Math.floor(Math.random() * WORLD_WIDTH) - halfWidth,
        y: Math.floor(Math.random() * WORLD_HEIGHT) - halfHeight,
        score: score,
        radius: getRadiusFromScore(score),
        color: VIRUS_COLOR,
        nickname: '',
        type: 'virus',
        id: DUD_PLAYER_ID,
        cellId: cellIdCounter++,
    };
}

function initializeGameObjects() {
    players = {};
    players[DUD_PLAYER_ID] = [];
    for (let i = 0; i < PELLET_COUNT; i++) {
        players[DUD_PLAYER_ID].push(createPellet());
    }
    for (let i = 0; i < VIRUS_COUNT; i++) {
        players[DUD_PLAYER_ID].push(createVirus());
    }
    lastBroadcastState = {};
}
initializeGameObjects();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('joinGame', (data) => {
        console.log(`Player ${data.nickname} (${socket.id}) joined successfully.`);
        const halfWidth = WORLD_WIDTH / 2;
        const halfHeight = WORLD_HEIGHT / 2;
        players[socket.id] = [{
            x: Math.floor(Math.random() * WORLD_WIDTH) - halfWidth,
            y: Math.floor(Math.random() * WORLD_HEIGHT) - halfHeight,
            score: PLAYER_START_SCORE,
            radius: getRadiusFromScore(PLAYER_START_SCORE),
            color: data.color || '#ffffff',
            nickname: data.nickname || 'Player',
            type: 'player', // FIX: Add missing type property
            id: socket.id,
            cellId: cellIdCounter++,
            vx: 0,
            vy: 0,
            image: data.image || null,
            mergeCooldown: Date.now() + PLAYER_MERGE_TIME,
        }];
        playerInputs[socket.id] = {
            worldMouseX: players[socket.id][0].x,
            worldMouseY: players[socket.id][0].y
        };

        console.log(`Sending initialState to ${socket.id}`);
        socket.emit('initialState', {
            players: players,
            world: {
                width: WORLD_WIDTH,
                height: WORLD_HEIGHT
            }
        });

        // Send system message to all players about new player joining
        io.emit('systemMessage', {
            message: `${data.nickname} joined the game`,
            timestamp: Date.now()
        });
    });

    socket.on('disconnect', (reason) => {
        console.log(`Socket ${socket.id} disconnected. Reason: ${reason}`);
        if (players[socket.id]) {
            const playerNickname = players[socket.id][0].nickname;
            console.log(`Player ${playerNickname} disconnected.`);

            delete players[socket.id];
            delete playerInputs[socket.id];
            io.emit('playerDisconnected', socket.id);

            // Send system message about player leaving
            io.emit('systemMessage', {
                message: `${playerNickname} left the game`,
                timestamp: Date.now()
            });
        }
    });

    socket.on('connect_error', (error) => {
        console.log('Connection error:', error);
    });

    socket.on('chatMessage', (data) => {
        if (players[socket.id] && data.message && data.message.trim().length > 0) {
            const player = players[socket.id][0]; // Get first cell for nickname
            const message = data.message.trim().substring(0, 100); // Limit message length

            console.log(`Chat from ${player.nickname}: ${message}`);

            // Broadcast message to all players
            io.emit('chatMessage', {
                playerId: socket.id,
                nickname: player.nickname,
                message: message,
                timestamp: Date.now()
            });
        }
    });

    socket.on('playerInput', (input) => {
        const {
            worldMouseX,
            worldMouseY
        } = input;
        if (typeof worldMouseX === 'number' && typeof worldMouseY === 'number') {
            playerInputs[socket.id] = {
                worldMouseX,
                worldMouseY
            };
        }
    });

    socket.on('split', (data) => {
        const playerCells = players[socket.id];
        if (!playerCells || !data || !data.direction) return;
        const dir = data.direction;
        const len = Math.hypot(dir.x, dir.y);
        if (len === 0) return;
        const dx = dir.x / len;
        const dy = dir.y / len;
        const cellsToSplit = playerCells.length;

        for (let i = cellsToSplit - 1; i >= 0; i--) {
            const cell = playerCells[i];
            if (cell.score >= PLAYER_MIN_SPLIT_SCORE && playerCells.length < 16) {
                const halfScore = cell.score / 2;
                cell.score = halfScore;

                const newRadius = getRadiusFromScore(halfScore);
                cell.radius = newRadius;
                const launchSpeed = newRadius * 15;
                const newCell = {
                    ...cell,
                    cellId: cellIdCounter++,
                    score: halfScore,
                    radius: newRadius,
                    x: cell.x + dx * (newRadius + 5),
                    y: cell.y + dy * (newRadius + 5),
                    mergeCooldown: Date.now() + PLAYER_MERGE_TIME,
                    launch_vx: dx * launchSpeed,
                    launch_vy: dy * launchSpeed
                };
                cell.mergeCooldown = Date.now() + PLAYER_MERGE_TIME;
                playerCells.push(newCell);
            }
        }
    });

    socket.on('ejectMass', (data) => {
        const playerCells = players[socket.id];
        if (!playerCells || !data || !data.direction) return;
        const dir = data.direction;
        const len = Math.hypot(dir.x, dir.y);
        if (len === 0) return;
        const dx = dir.x / len;
        const dy = dir.y / len;
        playerCells.forEach(cell => {
            if (cell.score >= PLAYER_MIN_EJECT_SCORE) {
                cell.score -= EJECTED_MASS_SCORE;
                cell.radius = getRadiusFromScore(cell.score);
                const newDud = {
                    x: cell.x + dx * (cell.radius + 5),
                    y: cell.y + dy * (cell.radius + 5),
                    score: EJECTED_MASS_SCORE,
                    radius: EJECTED_MASS_RADIUS,
                    color: cell.color,
                    nickname: '',
                    type: 'ejected', // Add type for ejected mass
                    id: DUD_PLAYER_ID,
                    ownerId: cell.id,
                    cellId: cellIdCounter++,
                    launch_vx: dx * EJECT_LAUNCH_SPEED,
                    launch_vy: dy * EJECT_LAUNCH_SPEED,
                };
                players[DUD_PLAYER_ID].push(newDud);
            }
        });
    });
});

// Game Logic Loop (runs at 60Hz)
setInterval(() => {
    // Phase 1: Player Movement
    for (const playerId in players) {
        if (playerId === DUD_PLAYER_ID) continue;
        const playerCells = players[playerId];
        const input = playerInputs[playerId];

        if (playerCells && input) {
            playerCells.forEach(cell => {
                const speed = 5;
                const speedFactor = 20 / cell.radius;

                let dx = input.worldMouseX - cell.x;
                let dy = input.worldMouseY - cell.y;
                const len = Math.hypot(dx, dy);

                if (len > cell.radius) {
                    const normalizedX = dx / len;
                    const normalizedY = dy / len;
                    cell.x += normalizedX * speed * speedFactor;
                    cell.y += normalizedY * speed * speedFactor;
                }
            });
        }
    }

    // Phase 2: Handle launched cells
    for (const playerId in players) {
        for (const cell of players[playerId]) {
            if (cell.launch_vx !== undefined && cell.launch_vy !== undefined) {
                cell.x += cell.launch_vx * (1 / 60);
                cell.y += cell.launch_vy * (1 / 60);
                cell.launch_vx *= PLAYER_SPLIT_LAUNCH_DECAY;
                cell.launch_vy *= PLAYER_SPLIT_LAUNCH_DECAY;

                if (Math.hypot(cell.launch_vx, cell.launch_vy) < 1) {
                    delete cell.launch_vx;
                    delete cell.launch_vy;
                }
            }
        }
    }

    // Phase 3: Consumption Detection
    const allCells = Object.values(players).flat();
    const consumptions = [];
    const involvedCellIds = new Set();

    for (let i = 0; i < allCells.length; i++) {
        for (let j = i + 1; j < allCells.length; j++) {
            const c1 = allCells[i];
            const c2 = allCells[j];

            if (c1.id === c2.id) continue;
            if (involvedCellIds.has(c1.cellId) || involvedCellIds.has(c2.cellId)) continue;

            const distance = Math.hypot(c1.x - c2.x, c1.y - c2.y);

            // FIX: Handle virus-player interactions properly
            if ((c1.type === 'virus' && c2.type === 'player') ||
                (c1.type === 'player' && c2.type === 'virus')) {

                const virus = c1.type === 'virus' ? c1 : c2;
                const player = c1.type === 'player' ? c1 : c2;

                // Check if player touches virus
                if (distance < virus.radius + player.radius) {
                    // Player must be large enough to trigger virus split
                    if (player.score > virus.score * 1.1) {
                        consumptions.push({
                            virus: virus,
                            player: player,
                            type: 'virusPlayerInteraction'
                        });
                        involvedCellIds.add(virus.cellId);
                        involvedCellIds.add(player.cellId);
                    }
                }
                continue; // Skip regular consumption logic for virus-player interactions
            }

            // Regular consumption logic for non-virus interactions
            let bigger, smaller;
            if (c1.radius > c2.radius) {
                bigger = c1;
                smaller = c2;
            } else {
                bigger = c2;
                smaller = c1;
            }

            const requiredDistance = bigger.radius - (smaller.radius * CELL_CONSUME_THRESHOLD);

            if (distance < requiredDistance && bigger.radius > smaller.radius * 1.1) {
                consumptions.push({ bigger, smaller, type: 'regularConsumption' });
                involvedCellIds.add(bigger.cellId);
                involvedCellIds.add(smaller.cellId);
            }
        }
    }

    // Phase 3.5: Consumption Resolution
    for (const consumption of consumptions) {
        if (consumption.type === 'virusPlayerInteraction') {
            const { virus, player } = consumption;

            // Player splits into multiple cells when touching virus
            const splitCount = Math.min(16, Math.floor(player.score / VIRUS_CONSUME_SCORE_GAIN_SPLIT));
            const newCellScore = player.score / splitCount;

            const newCells = [];
            for (let i = 0; i < splitCount; i++) {
                const angle = Math.random() * Math.PI * 2;
                const spawnDistance = player.radius + 10;
                newCells.push({
                    ...player,
                    cellId: cellIdCounter++,
                    score: newCellScore,
                    radius: getRadiusFromScore(newCellScore),
                    x: player.x + Math.cos(angle) * spawnDistance,
                    y: player.y + Math.sin(angle) * spawnDistance,
                    mergeCooldown: Date.now() + PLAYER_MERGE_TIME,
                    launch_vx: Math.cos(angle) * 50,
                    launch_vy: Math.sin(angle) * 50,
                });
            }

            // Replace the single large cell with multiple smaller ones
            const playerCells = players[player.id];
            const playerIndex = playerCells.findIndex(c => c.cellId === player.cellId);
            if (playerIndex !== -1) {
                playerCells.splice(playerIndex, 1, ...newCells);
            }

            // Remove the consumed virus
            players[DUD_PLAYER_ID] = players[DUD_PLAYER_ID].filter(c => c.cellId !== virus.cellId);

        } else { // Regular consumption
            const { bigger, smaller } = consumption;
            const ownerCells = players[bigger.id];
            if (ownerCells) {
                const biggerCell = ownerCells.find(c => c.cellId === bigger.cellId);
                if (biggerCell) {
                    biggerCell.score += smaller.score;
                    biggerCell.radius = getRadiusFromScore(biggerCell.score);
                }
            }

            // Remove the consumed cell
            const smallerOwnerId = smaller.id;
            if (players[smallerOwnerId]) {
                players[smallerOwnerId] = players[smallerOwnerId].filter(c => c.cellId !== smaller.cellId);

                if (players[smallerOwnerId].length === 0 && smallerOwnerId !== DUD_PLAYER_ID) {
                    io.to(smallerOwnerId).emit('youDied', { score: Math.max(1, Math.round(smaller.score)) });
                    delete players[smallerOwnerId];
                    delete playerInputs[smallerOwnerId];
                    io.emit('playerDisconnected', smallerOwnerId);
                }
            }
        }
    }

    // Phase 4: Handle player cell merging and repulsion
    for (const playerId in players) {
        if (playerId === DUD_PLAYER_ID) continue;
        const playerCells = players[playerId];

        for (let i = 0; i < playerCells.length; i++) {
            const c1 = playerCells[i];
            if (!c1) continue;

            for (let j = i + 1; j < playerCells.length; j++) {
                const c2 = playerCells[j];
                if (!c2) continue;

                const now = Date.now();
                const distance = Math.hypot(c1.x - c2.x, c1.y - c2.y);
                const combinedRadius = c1.radius + c2.radius;

                // Both cells are past their merge cooldown - they can merge
                if (c1.mergeCooldown <= now && c2.mergeCooldown <= now) {
                    // Determine which cell is larger
                    let bigger, smaller;
                    if (c1.radius > c2.radius) {
                        bigger = c1;
                        smaller = c2;
                    } else {
                        bigger = c2;
                        smaller = c1;
                    }

                    // Merge when larger cell touches the center of smaller cell
                    if (distance < bigger.radius) {
                        // Merge the cells (always merge into c1 for consistency)
                        const originalC1Score = c1.score;
                        c1.score += c2.score;
                        c1.radius = getRadiusFromScore(c1.score);

                        // Position merged cell at weighted center based on mass
                        const totalScore = c1.score;
                        const weight1 = originalC1Score / totalScore;
                        const weight2 = c2.score / totalScore;
                        c1.x = c1.x * weight1 + c2.x * weight2;
                        c1.y = c1.y * weight1 + c2.y * weight2;

                        // Remove the merged cell
                        playerCells.splice(j, 1);
                        j--; // Adjust index

                        // Keep the maximum cooldown of the two cells instead of resetting
                        // This prevents merge penalty when cells are reuniting
                        c1.mergeCooldown = Math.max(c1.mergeCooldown, c2.mergeCooldown);
                        continue; // Skip repulsion since we merged
                    }
                }

                // Repulsion logic - ONLY applies when cells are in cooldown
                const isInCooldown = c1.mergeCooldown > now || c2.mergeCooldown > now;

                if (isInCooldown && distance < combinedRadius) {
                    const overlap = combinedRadius - distance;

                    // Calculate masses for realistic repulsion
                    const mass1 = c1.score + CELL_BASE_MASS;
                    const mass2 = c2.score + CELL_BASE_MASS;
                    const totalMass = mass1 + mass2;

                    // Gentle repulsion only during cooldown
                    const repulsionForce = overlap * 1.5;

                    // Calculate movement based on inverse mass proportion
                    const move1 = (repulsionForce * mass2 / totalMass);
                    const move2 = (repulsionForce * mass1 / totalMass);

                    // Calculate direction
                    let dx, dy;
                    if (distance > 0.001) {
                        dx = (c1.x - c2.x) / distance;
                        dy = (c1.y - c2.y) / distance;
                    } else {
                        // If cells are exactly on top of each other, push in random directions
                        const angle = Math.random() * Math.PI * 2;
                        dx = Math.cos(angle);
                        dy = Math.sin(angle);
                    }

                    // Apply repulsion movement
                    c1.x += dx * move1;
                    c1.y += dy * move1;
                    c2.x -= dx * move2;
                    c2.y -= dy * move2;

                    // Ensure minimum separation during cooldown
                    const minSeparation = combinedRadius * 1.05;
                    const newDistance = Math.hypot(c1.x - c2.x, c1.y - c2.y);

                    if (newDistance < minSeparation) {
                        const additionalSeparation = minSeparation - newDistance;
                        const additionalMove1 = (additionalSeparation * mass2 / totalMass) * 0.2;
                        const additionalMove2 = (additionalSeparation * mass1 / totalMass) * 0.2;

                        // Recalculate direction with new positions
                        const newDx = newDistance > 0.001 ? (c1.x - c2.x) / newDistance : dx;
                        const newDy = newDistance > 0.001 ? (c1.y - c2.y) / newDistance : dy;

                        c1.x += newDx * additionalMove1;
                        c1.y += newDy * additionalMove1;
                        c2.x -= newDx * additionalMove2;
                        c2.y -= newDy * additionalMove2;
                    }
                }
            }
        }
    }

    // UNIVERSAL BOUNDARY CLAMPING - Apply to ALL cells including ejected masses
    const halfWidth = WORLD_WIDTH / 2;
    const halfHeight = WORLD_HEIGHT / 2;

    for (const playerId in players) {
        const playerCells = players[playerId];
        for (const cell of playerCells) {
            // Clamp all cells (players, ejected masses, pellets, viruses) to world boundaries
            cell.x = Math.max(-halfWidth + cell.radius, Math.min(halfWidth - cell.radius, cell.x));
            cell.y = Math.max(-halfHeight + cell.radius, Math.min(halfHeight - cell.radius, cell.y));

            // If a launched cell hits the boundary, reduce its velocity to prevent bouncing
            if (cell.launch_vx !== undefined && cell.launch_vy !== undefined) {
                // If the cell is at the boundary, dampen the velocity in that direction
                if (cell.x <= -halfWidth + cell.radius || cell.x >= halfWidth - cell.radius) {
                    cell.launch_vx *= 0.3; // Reduce horizontal velocity when hitting side walls
                }
                if (cell.y <= -halfHeight + cell.radius || cell.y >= halfHeight - cell.radius) {
                    cell.launch_vy *= 0.3; // Reduce vertical velocity when hitting top/bottom walls
                }
            }
        }
    }

    // Phase 5: Respawn duds
    const dudCells = players[DUD_PLAYER_ID] || [];
    if (dudCells.filter(c => c.type === 'pellet').length < PELLET_COUNT) {
        players[DUD_PLAYER_ID].push(createPellet());
    }
    if (dudCells.filter(c => c.type === 'virus').length < VIRUS_COUNT) {
        players[DUD_PLAYER_ID].push(createVirus());
    }
}, 1000 / 60);

// Network Broadcast Loop (runs at 30Hz)
setInterval(() => {
    if (Object.keys(players).length === 0) return;

    const updatePackage = {
        updatedCells: [],
        newCells: [],
        eatenCellIds: [],
    };

    const currentCellIds = new Set();
    const allCurrentCells = Object.values(players).flat();

    for (const cell of allCurrentCells) {
        currentCellIds.add(cell.cellId);
        const oldCellState = lastBroadcastState[cell.cellId];

        const broadcastCell = { ...cell };
        delete broadcastCell.image;
        delete broadcastCell.launch_vx;
        delete broadcastCell.launch_vy;
        // Keep mergeCooldown for debug purposes on client
        // delete broadcastCell.mergeCooldown;

        if (!oldCellState) {
            updatePackage.newCells.push(broadcastCell);
        } else {
            if (Math.abs(cell.x - oldCellState.x) > 0.1 ||
                Math.abs(cell.y - oldCellState.y) > 0.1 ||
                Math.abs(cell.radius - oldCellState.radius) > 0.1) {
                updatePackage.updatedCells.push(broadcastCell);
            }
        }
    }

    for (const cellId in lastBroadcastState) {
        if (!currentCellIds.has(parseInt(cellId))) {
            updatePackage.eatenCellIds.push(parseInt(cellId));
        }
    }

    if (updatePackage.newCells.length > 0 || updatePackage.updatedCells.length > 0 || updatePackage.eatenCellIds.length > 0) {
        io.emit('gameStateUpdate', updatePackage);
    }

    lastBroadcastState = {};
    allCurrentCells.forEach(cell => {
        lastBroadcastState[cell.cellId] = {
            x: cell.x,
            y: cell.y,
            radius: cell.radius
        };
    });
}, 1000 / 30);

server.listen(PORT, () => {
    console.log(`🚀 Server listening on port ${PORT}`);
});