// server.js

// --- Quadtree Implementation for Collision Detection ---
class Quadtree {
    constructor(bounds, maxObjects = 10, maxLevels = 5, level = 0) {
        this.bounds = bounds;
        this.maxObjects = maxObjects;
        this.maxLevels = maxLevels;
        this.level = level;
        this.objects = [];
        this.nodes = [];
    }

    split() {
        const nextLevel = this.level + 1;
        const subWidth = this.bounds.width / 2;
        const subHeight = this.bounds.height / 2;
        const x = this.bounds.x;
        const y = this.bounds.y;

        // top right
        this.nodes[0] = new Quadtree({ x: x + subWidth, y: y, width: subWidth, height: subHeight }, this.maxObjects, this.maxLevels, nextLevel);
        // top left
        this.nodes[1] = new Quadtree({ x: x, y: y, width: subWidth, height: subHeight }, this.maxObjects, this.maxLevels, nextLevel);
        // bottom left
        this.nodes[2] = new Quadtree({ x: x, y: y + subHeight, width: subWidth, height: subHeight }, this.maxObjects, this.maxLevels, nextLevel);
        // bottom right
        this.nodes[3] = new Quadtree({ x: x + subWidth, y: y + subHeight, width: subWidth, height: subHeight }, this.maxObjects, this.maxLevels, nextLevel);
    }

    getIndex(rect) {
        let index = -1;
        const verticalMidpoint = this.bounds.x + (this.bounds.width / 2);
        const horizontalMidpoint = this.bounds.y + (this.bounds.height / 2);

        const topQuadrant = (rect.y < horizontalMidpoint && rect.y + rect.height < horizontalMidpoint);
        const bottomQuadrant = (rect.y > horizontalMidpoint);

        if (rect.x < verticalMidpoint && rect.x + rect.width < verticalMidpoint) {
            if (topQuadrant) { index = 1; }
            else if (bottomQuadrant) { index = 2; }
        }
        else if (rect.x > verticalMidpoint) {
            if (topQuadrant) { index = 0; }
            else if (bottomQuadrant) { index = 3; }
        }
        return index;
    }

    insert(rect) {
        if (this.nodes.length) {
            const index = this.getIndex(rect);
            if (index !== -1) {
                this.nodes[index].insert(rect);
                return;
            }
        }

        this.objects.push(rect);

        if (this.objects.length > this.maxObjects && this.level < this.maxLevels) {
            if (!this.nodes.length) {
                this.split();
            }

            let i = 0;
            while (i < this.objects.length) {
                const index = this.getIndex(this.objects[i]);
                if (index !== -1) {
                    this.nodes[index].insert(this.objects.splice(i, 1)[0]);
                } else {
                    i++;
                }
            }
        }
    }

    retrieve(returnObjects, rect) {
        const index = this.getIndex(rect);
        if (index !== -1 && this.nodes.length) {
            this.nodes[index].retrieve(returnObjects, rect);
        }
        returnObjects.push(...this.objects);
        return returnObjects;
    }

    clear() {
        this.objects = [];
        for (let i = 0; i < this.nodes.length; i++) {
            if (this.nodes.length) {
                this.nodes[i].clear();
            }
        }
        this.nodes = [];
    }
}


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
const PELLET_COUNT = 1000;
const PELLET_RADIUS = 10;
const VIRUS_COUNT = 50;

const PLAYER_START_SCORE = 10;
const CELL_BASE_MASS = 399;
const PELLET_SCORE_VALUE = 1;
const PLAYER_MIN_SPLIT_SCORE = 2;
const CELL_CONSUME_THRESHOLD = 0.5;

const PLAYER_MERGE_TIME = 15000;
const PLAYER_SPLIT_LAUNCH_DECAY = 0.94;
const PLAYER_MIN_EJECT_SCORE = 11;
const EJECTED_MASS_SCORE = 10;
const EJECTED_MASS_RADIUS = 10;

const VIRUS_SCORE = 100;
const VIRUS_COLOR = '#33ff33';
const VIRUS_CONSUME_SCORE_GAIN_SPLIT = 10;
const EJECT_LAUNCH_SPEED = 500;
const VIRUS_EJECTIONS_TO_SPLIT = 7;
const VIRUS_LAUNCH_SPEED = 800;

const DUD_PLAYER_ID = 'duds';

app.use(express.static('public'));

let players = {};
let cellIdCounter = 0;
let playerInputs = {};
let lastBroadcastState = {};
// OPTIMIZATION: Initialize Quadtree for the world
const worldBounds = { x: -WORLD_WIDTH / 2, y: -WORLD_HEIGHT / 2, width: WORLD_WIDTH, height: WORLD_HEIGHT };
const qtree = new Quadtree(worldBounds);

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
        ejectionsConsumed: 0,  // Track ejections consumed by this virus
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

    socket.on('setMass', (data) => {
        const playerCells = players[socket.id];
        if (!playerCells || !data || typeof data.mass !== 'number') return;

        const newMass = Math.max(1, Math.min(1000000, data.mass)); // Clamp between 1 and 10000
        const player = playerCells[0]; // Get first cell for nickname

        console.log(`Setting mass for ${player.nickname} to ${newMass}`);

        // Update all player cells to the new mass
        playerCells.forEach(cell => {
            cell.score = newMass;
            cell.radius = getRadiusFromScore(newMass);
        });

        // Send confirmation message to player
        socket.emit('systemMessage', {
            message: `Mass set to ${newMass}`,
            timestamp: Date.now()
        });

        // Optionally broadcast to all players that this player's mass changed
        io.emit('systemMessage', {
            message: `${player.nickname} set their mass to ${newMass}`,
            timestamp: Date.now()
        });
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
        if (!playerCells || !data) return;

        // MODIFIED: Expect mouseX and mouseY instead of direction
        const { mouseX, mouseY } = data;
        if (typeof mouseX !== 'number' || typeof mouseY !== 'number') return;

        const cellsToSplit = playerCells.length;

        for (let i = cellsToSplit - 1; i >= 0; i--) {
            const cell = playerCells[i];
            if (cell.score >= PLAYER_MIN_SPLIT_SCORE && playerCells.length < 16) {
                // MODIFIED: Calculate direction from THIS cell to mouse position
                let dx = mouseX - cell.x;
                let dy = mouseY - cell.y;
                const len = Math.hypot(dx, dy);

                if (len > 0) {
                    dx /= len;
                    dy /= len;
                } else {
                    // Fallback direction if mouse is exactly on cell
                    dx = 0;
                    dy = -1;
                }

                // Split mass into integers, giving extra to the new cell
                const score1 = Math.floor(cell.score / 2);
                const score2 = cell.score - score1;

                cell.score = score1;

                const newRadius = getRadiusFromScore(score1);
                cell.radius = newRadius;
                const launchSpeed = newRadius * 15;

                const newCell = {
                    ...cell,
                    cellId: cellIdCounter++,
                    score: score2,
                    radius: getRadiusFromScore(score2),
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
        if (!playerCells || !data) return;

        // MODIFIED: Expect mouseX and mouseY instead of direction
        const { mouseX, mouseY } = data;
        if (typeof mouseX !== 'number' || typeof mouseY !== 'number') return;

        playerCells.forEach(cell => {
            if (cell.score >= PLAYER_MIN_EJECT_SCORE) {
                // MODIFIED: Calculate direction from THIS cell to mouse position
                let dx = mouseX - cell.x;
                let dy = mouseY - cell.y;
                const len = Math.hypot(dx, dy);

                if (len > 0) {
                    dx /= len;
                    dy /= len;
                } else {
                    // Fallback direction if mouse is exactly on cell
                    dx = 0;
                    dy = -1;
                }

                cell.score -= EJECTED_MASS_SCORE;
                cell.radius = getRadiusFromScore(cell.score);

                const newDud = {
                    x: cell.x + dx * (cell.radius + 5),
                    y: cell.y + dy * (cell.radius + 5),
                    score: EJECTED_MASS_SCORE,
                    radius: EJECTED_MASS_RADIUS,
                    color: cell.color,
                    nickname: '',
                    type: 'ejected',
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

    // Handle ping requests for latency measurement
    socket.on('ping', () => {
        socket.emit('pong');
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

    // --- Phase 3: Consumption Detection (OPTIMIZED WITH QUADTREE) ---
    qtree.clear();
    const allCells = Object.values(players).flat();
    for (const cell of allCells) {
        qtree.insert({
            x: cell.x - cell.radius,
            y: cell.y - cell.radius,
            width: cell.radius * 2,
            height: cell.radius * 2,
            cell: cell // Reference to the original cell object
        });
    }

    const consumptions = [];
    const involvedCellIds = new Set();

    for (const c1 of allCells) {
        if (involvedCellIds.has(c1.cellId)) continue;

        const queryBounds = {
            x: c1.x - c1.radius,
            y: c1.y - c1.radius,
            width: c1.radius * 2,
            height: c1.radius * 2,
        };

        const potentialColliders = qtree.retrieve([], queryBounds);

        for (const potential of potentialColliders) {
            const c2 = potential.cell;

            if (c1.cellId === c2.cellId) continue; // Don't check against self
            if (involvedCellIds.has(c2.cellId)) continue;

            // Skip if same ID UNLESS it's different types within DUD_PLAYER_ID (virus vs ejection)
            if (c1.id === c2.id && !(c1.id === DUD_PLAYER_ID && c1.type !== c2.type)) continue;

            const distance = Math.hypot(c1.x - c2.x, c1.y - c2.y);

            // Handle virus-ejection interactions
            if ((c1.type === 'virus' && c2.type === 'ejected') || (c1.type === 'ejected' && c2.type === 'virus')) {
                const virus = c1.type === 'virus' ? c1 : c2;
                const ejection = c1.type === 'ejected' ? c1 : c2;
                if (distance < virus.radius) {
                    consumptions.push({ virus, ejection, type: 'virusEjectionInteraction' });
                    involvedCellIds.add(virus.cellId);
                    involvedCellIds.add(ejection.cellId);
                }
                continue;
            }

            // Handle virus-player interactions
            if ((c1.type === 'virus' && c2.type === 'player') || (c1.type === 'player' && c2.type === 'virus')) {
                const virus = c1.type === 'virus' ? c1 : c2;
                const player = c1.type === 'player' ? c1 : c2;
                if (player.score > virus.score * 1.1 && distance < player.radius) {
                    consumptions.push({ virus, player, type: 'virusPlayerInteraction' });
                    involvedCellIds.add(virus.cellId);
                    involvedCellIds.add(player.cellId);
                }
                continue;
            }

            // Regular consumption logic
            let bigger, smaller;
            if (c1.radius > c2.radius) { bigger = c1; smaller = c2; }
            else { bigger = c2; smaller = c1; }

            if (distance < bigger.radius && bigger.radius > smaller.radius * 1.1) {
                consumptions.push({ bigger, smaller, type: 'regularConsumption' });
                involvedCellIds.add(bigger.cellId);
                involvedCellIds.add(smaller.cellId);
            }
        }
    }


    // Phase 3.5: Consumption Resolution
    for (const consumption of consumptions) {
        if (consumption.type === 'virusEjectionInteraction') {
            const { virus, ejection } = consumption;

            // Increment the virus's ejection counter
            virus.ejectionsConsumed = (virus.ejectionsConsumed || 0) + 1;

            // OPTIMIZATION: Use splice instead of filter for performance
            const dudPlayerCells = players[DUD_PLAYER_ID];
            const ejectionIndex = dudPlayerCells.findIndex(c => c.cellId === ejection.cellId);
            if(ejectionIndex > -1) dudPlayerCells.splice(ejectionIndex, 1);

            // Check if virus should split (after consuming 7 ejections)
            if (virus.ejectionsConsumed >= VIRUS_EJECTIONS_TO_SPLIT) {
                // Calculate split direction based on ejection's velocity or position
                let dx, dy;

                // First try to use ejection's velocity if it exists
                if (ejection.launch_vx !== undefined && ejection.launch_vy !== undefined) {
                    const velocity = Math.hypot(ejection.launch_vx, ejection.launch_vy);
                    if (velocity > 0.1) {
                        dx = ejection.launch_vx / velocity;
                        dy = ejection.launch_vy / velocity;
                    } else {
                        // Velocity too small, use position-based direction
                        dx = ejection.x - virus.x;
                        dy = ejection.y - virus.y;
                        const len = Math.hypot(dx, dy);
                        if (len > 0) {
                            dx /= len;
                            dy /= len;
                        } else {
                            dx = 1;
                            dy = 0;
                        }
                    }
                } else {
                    // No velocity data, use position-based direction
                    dx = ejection.x - virus.x;
                    dy = ejection.y - virus.y;
                    const len = Math.hypot(dx, dy);
                    if (len > 0) {
                        dx /= len;
                        dy /= len;
                    } else {
                        dx = 1;
                        dy = 0;
                    }
                }

                // Create new virus with same mass, launched in ejection direction
                const launchSpeed = VIRUS_LAUNCH_SPEED; // Virus split speed
                const newVirus = {
                    x: virus.x + dx * (virus.radius + 5),
                    y: virus.y + dy * (virus.radius + 5),
                    score: virus.score, // Same mass as original
                    radius: virus.radius,
                    color: VIRUS_COLOR,
                    nickname: '',
                    type: 'virus',
                    id: DUD_PLAYER_ID,
                    cellId: cellIdCounter++,
                    ejectionsConsumed: 0, // Reset counter
                    launch_vx: dx * launchSpeed,
                    launch_vy: dy * launchSpeed
                };

                // Reset original virus's counter
                virus.ejectionsConsumed = 0;

                // Add new virus to the game
                players[DUD_PLAYER_ID].push(newVirus);
            }
        } else if (consumption.type === 'virusPlayerInteraction') {
            const { virus, player } = consumption;
            const playerCells = players[player.id];
            const playerCellCount = playerCells.length;

            // Case 1: Player is at or above the cell limit. Absorb virus for score.
            if (playerCellCount >= 16) {
                // Find the specific cell that hit the virus
                const hittingCell = playerCells.find(c => c.cellId === player.cellId);
                if (hittingCell) {
                    hittingCell.score += virus.score; // Gain full virus score
                    hittingCell.radius = getRadiusFromScore(hittingCell.score);
                }

                // Remove the consumed virus
                const dudPlayerCells = players[DUD_PLAYER_ID];
                const virusIndex = dudPlayerCells.findIndex(c => c.cellId === virus.cellId);
                if(virusIndex > -1) dudPlayerCells.splice(virusIndex, 1);

            } else {
                // Case 2: Player has room to split.

                // The cell that hit the virus
                const hittingCell = playerCells.find(c => c.cellId === player.cellId);
                if (!hittingCell) continue; // Should not happen, but a good guard

                hittingCell.score += VIRUS_CONSUME_SCORE_GAIN_SPLIT; // Gain 10 points for splitting

                // The number of pieces the hitting cell will shatter into.
                const desiredSplitCount = Math.floor(hittingCell.score / PLAYER_MIN_SPLIT_SCORE) || 2;

                // The number of additional cells we can create without exceeding the 16-cell limit.
                const availableSlots = 16 - playerCellCount;
                const additionalCellsToCreate = Math.min(desiredSplitCount - 1, availableSlots);
                const finalSplitCount = additionalCellsToCreate + 1;

                // If we can't even split into 2 pieces, just absorb the 10 points and don't split.
                if (finalSplitCount <= 1) {
                    const dudPlayerCells = players[DUD_PLAYER_ID];
                    const virusIndex = dudPlayerCells.findIndex(c => c.cellId === virus.cellId);
                    if(virusIndex > -1) dudPlayerCells.splice(virusIndex, 1);
                    continue; // Skip to next consumption
                }

                // MODIFIED: Split the hitting cell's mass into integers
                const totalScoreToSplit = hittingCell.score;
                const baseScore = Math.floor(totalScoreToSplit / finalSplitCount);
                let remainder = totalScoreToSplit % finalSplitCount;
                const newCells = [];

                for (let i = 0; i < finalSplitCount; i++) {
                    // Distribute the remainder mass (1 point at a time) to the first 'remainder' cells
                    const currentCellScore = baseScore + (remainder > 0 ? 1 : 0);
                    if (remainder > 0) {
                        remainder--;
                    }

                    const angle = Math.random() * Math.PI * 2;
                    const launchSpeed = 50 + Math.random() * 100;

                    newCells.push({
                        // Copy fundamental properties from the cell that was hit
                        ...hittingCell,
                        // Overwrite with new properties for the new smaller cell
                        cellId: cellIdCounter++,
                        score: currentCellScore,
                        radius: getRadiusFromScore(currentCellScore),
                        x: hittingCell.x + Math.cos(angle) * (hittingCell.radius * 0.2), // spawn closer to center
                        y: hittingCell.y + Math.sin(angle) * (hittingCell.radius * 0.2),
                        mergeCooldown: Date.now() + PLAYER_MERGE_TIME,
                        launch_vx: Math.cos(angle) * launchSpeed,
                        launch_vy: Math.sin(angle) * launchSpeed,
                    });
                }

                // Replace the single large cell with multiple smaller ones
                const playerIndex = playerCells.findIndex(c => c.cellId === hittingCell.cellId);
                if (playerIndex !== -1) {
                    playerCells.splice(playerIndex, 1, ...newCells);
                }

                // Remove the consumed virus
                const dudPlayerCells = players[DUD_PLAYER_ID];
                const virusIndex = dudPlayerCells.findIndex(c => c.cellId === virus.cellId);
                if(virusIndex > -1) dudPlayerCells.splice(virusIndex, 1);
            }

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
                // OPTIMIZATION: Use splice instead of filter
                const smallerPlayerCells = players[smallerOwnerId];
                const smallerIndex = smallerPlayerCells.findIndex(c => c.cellId === smaller.cellId);
                if (smallerIndex > -1) {
                    smallerPlayerCells.splice(smallerIndex, 1);
                }

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

// Network Broadcast Loop (runs at 30Hz) - MODIFIED FOR PERFORMANCE
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

        if (!oldCellState) {
            // NEW CELL: Send everything, including image
            const newCell = { ...cell };
            delete newCell.launch_vx;
            delete newCell.launch_vy;
            updatePackage.newCells.push(newCell);
        } else {
            // EXISTING CELL: Only send minimal changed data
            const dx = cell.x - oldCellState.x;
            const dy = cell.y - oldCellState.y;
            const dr = cell.radius - oldCellState.radius;

            if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1 || Math.abs(dr) > 0.1) {
                // OPTIMIZATION: Send a minimal update object and round values
                const updatedCellData = {
                    cellId: cell.cellId,
                    id: cell.id,
                    x: Math.round(cell.x * 10) / 10,
                    y: Math.round(cell.y * 10) / 10,
                    radius: Math.round(cell.radius * 10) / 10,
                    score: Math.round(cell.score),
                };
                if (cell.mergeCooldown !== oldCellState.mergeCooldown) {
                    updatedCellData.mergeCooldown = cell.mergeCooldown;
                }
                updatePackage.updatedCells.push(updatedCellData);
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

    // Update the last broadcast state cache
    lastBroadcastState = {};
    allCurrentCells.forEach(cell => {
        lastBroadcastState[cell.cellId] = {
            x: cell.x,
            y: cell.y,
            radius: cell.radius,
            mergeCooldown: cell.mergeCooldown,
        };
    });
}, 1000 / 30);

server.listen(PORT, () => {
    console.log(`🚀 Server listening on port ${PORT}`);
});