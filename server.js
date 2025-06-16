// server.js

// --- Spatial Hashing Implementation for Better Performance ---
class SpatialHash {
    constructor(cellSize) {
        this.cellSize = cellSize;
        this.buckets = new Map();
    }

    _hash(x, y) {
        const cx = Math.floor(x / this.cellSize);
        const cy = Math.floor(y / this.cellSize);
        return `${cx},${cy}`;
    }

    insert(obj) {
        const x1 = obj.x - obj.radius;
        const y1 = obj.y - obj.radius;
        const x2 = obj.x + obj.radius;
        const y2 = obj.y + obj.radius;

        const startX = Math.floor(x1 / this.cellSize);
        const endX = Math.floor(x2 / this.cellSize);
        const startY = Math.floor(y1 / this.cellSize);
        const endY = Math.floor(y2 / this.cellSize);

        obj._spatialHashes = [];
        for (let x = startX; x <= endX; x++) {
            for (let y = startY; y <= endY; y++) {
                const hash = `${x},${y}`;
                if (!this.buckets.has(hash)) {
                    this.buckets.set(hash, []);
                }
                this.buckets.get(hash).push(obj);
                obj._spatialHashes.push(hash);
            }
        }
    }

    query(x, y, radius) {
        const results = new Set();
        const x1 = x - radius;
        const y1 = y - radius;
        const x2 = x + radius;
        const y2 = y + radius;

        const startX = Math.floor(x1 / this.cellSize);
        const endX = Math.floor(x2 / this.cellSize);
        const startY = Math.floor(y1 / this.cellSize);
        const endY = Math.floor(y2 / this.cellSize);

        for (let cx = startX; cx <= endX; cx++) {
            for (let cy = startY; cy <= endY; cy++) {
                const hash = `${cx},${cy}`;
                const bucket = this.buckets.get(hash);
                if (bucket) {
                    bucket.forEach(obj => results.add(obj));
                }
            }
        }
        return Array.from(results);
    }

    clear() {
        this.buckets.clear();
    }
}

// --- Quadtree Implementation (unchanged but included for completeness) ---
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

        this.nodes[0] = new Quadtree({ x: x + subWidth, y: y, width: subWidth, height: subHeight }, this.maxObjects, this.maxLevels, nextLevel);
        this.nodes[1] = new Quadtree({ x: x, y: y, width: subWidth, height: subHeight }, this.maxObjects, this.maxLevels, nextLevel);
        this.nodes[2] = new Quadtree({ x: x, y: y + subHeight, width: subWidth, height: subHeight }, this.maxObjects, this.maxLevels, nextLevel);
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
    pingTimeout: 60000,
    pingInterval: 25000,
    upgrade: true,
    allowEIO3: true,
    // Add compression
    perMessageDeflate: {
        threshold: 1024
    }
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

// OPTIMIZATION: Performance settings
const PHYSICS_UPDATE_RATE = 60; // Hz
const NETWORK_UPDATE_RATE = 30; // Hz
const INTEREST_RADIUS = 1500; // Only send updates for objects within this radius
const SPATIAL_HASH_CELL_SIZE = 200; // Size of spatial hash cells

app.use(express.static('public'));

let players = {};
let cellIdCounter = 0;
let playerInputs = {};
let lastBroadcastState = {};
let playerInterestAreas = {}; // Track what each player can see

// OPTIMIZATION: Use spatial hash for faster lookups
const spatialHash = new SpatialHash(SPATIAL_HASH_CELL_SIZE);

function getRadiusFromScore(score) {
    const baseRadius = Math.sqrt(score + CELL_BASE_MASS);
    const scaleFactor = 1.0 + (score / 100) * 0.8;
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
        ejectionsConsumed: 0,
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
    playerInterestAreas = {};
}
initializeGameObjects();

// OPTIMIZATION: Calculate player's interest area (what they can see)
function calculateInterestArea(playerId) {
    const playerCells = players[playerId];
    if (!playerCells || playerCells.length === 0) return null;

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    playerCells.forEach(cell => {
        minX = Math.min(minX, cell.x - INTEREST_RADIUS);
        maxX = Math.max(maxX, cell.x + INTEREST_RADIUS);
        minY = Math.min(minY, cell.y - INTEREST_RADIUS);
        maxY = Math.max(maxY, cell.y + INTEREST_RADIUS);
    });

    return { minX, maxX, minY, maxY };
}

// OPTIMIZATION: Check if object is within player's interest area
function isInInterestArea(obj, interestArea) {
    if (!interestArea) return false;
    return obj.x >= interestArea.minX && obj.x <= interestArea.maxX &&
        obj.y >= interestArea.minY && obj.y <= interestArea.maxY;
}

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
            type: 'player',
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

        // OPTIMIZATION: Only send visible objects on initial state
        const interestArea = calculateInterestArea(socket.id);
        const visiblePlayers = {};

        for (const [playerId, cells] of Object.entries(players)) {
            const visibleCells = cells.filter(cell => isInInterestArea(cell, interestArea));
            if (visibleCells.length > 0) {
                visiblePlayers[playerId] = visibleCells;
            }
        }

        socket.emit('initialState', {
            players: visiblePlayers,
            world: {
                width: WORLD_WIDTH,
                height: WORLD_HEIGHT
            }
        });

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
            delete playerInterestAreas[socket.id];
            io.emit('playerDisconnected', socket.id);

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
            const player = players[socket.id][0];
            const message = data.message.trim().substring(0, 100);

            console.log(`Chat from ${player.nickname}: ${message}`);

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

        const newMass = Math.max(1, Math.min(1000000, data.mass));
        const player = playerCells[0];

        console.log(`Setting mass for ${player.nickname} to ${newMass}`);

        playerCells.forEach(cell => {
            cell.score = newMass;
            cell.radius = getRadiusFromScore(newMass);
        });

        socket.emit('systemMessage', {
            message: `Mass set to ${newMass}`,
            timestamp: Date.now()
        });

        io.emit('systemMessage', {
            message: `${player.nickname} set their mass to ${newMass}`,
            timestamp: Date.now()
        });
    });

    socket.on('playerInput', (input) => {
        const { worldMouseX, worldMouseY } = input;
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

        const { mouseX, mouseY } = data;
        if (typeof mouseX !== 'number' || typeof mouseY !== 'number') return;

        const cellsToSplit = playerCells.length;

        for (let i = cellsToSplit - 1; i >= 0; i--) {
            const cell = playerCells[i];
            if (cell.score >= PLAYER_MIN_SPLIT_SCORE && playerCells.length < 16) {
                let dx = mouseX - cell.x;
                let dy = mouseY - cell.y;
                const len = Math.hypot(dx, dy);

                if (len > 0) {
                    dx /= len;
                    dy /= len;
                } else {
                    dx = 0;
                    dy = -1;
                }

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

        const { mouseX, mouseY } = data;
        if (typeof mouseX !== 'number' || typeof mouseY !== 'number') return;

        playerCells.forEach(cell => {
            if (cell.score >= PLAYER_MIN_EJECT_SCORE) {
                let dx = mouseX - cell.x;
                let dy = mouseY - cell.y;
                const len = Math.hypot(dx, dy);

                if (len > 0) {
                    dx /= len;
                    dy /= len;
                } else {
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

    socket.on('ping', () => {
        socket.emit('pong');
    });
});

// OPTIMIZATION: Separate physics update from network update
let physicsAccumulator = 0;
let lastPhysicsTime = Date.now();

// Game Physics Loop (runs at configurable rate)
setInterval(() => {
    const currentTime = Date.now();
    const deltaTime = (currentTime - lastPhysicsTime) / 1000;
    lastPhysicsTime = currentTime;

    physicsAccumulator += deltaTime;

    // Fixed timestep physics
    const physicsStep = 1 / PHYSICS_UPDATE_RATE;
    while (physicsAccumulator >= physicsStep) {
        updatePhysics(physicsStep);
        physicsAccumulator -= physicsStep;
    }
}, 1000 / PHYSICS_UPDATE_RATE);

function updatePhysics(deltaTime) {
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
                    cell.x += normalizedX * speed * speedFactor * deltaTime * 60;
                    cell.y += normalizedY * speed * speedFactor * deltaTime * 60;
                }
            });
        }
    }

    // Phase 2: Handle launched cells
    for (const playerId in players) {
        for (const cell of players[playerId]) {
            if (cell.launch_vx !== undefined && cell.launch_vy !== undefined) {
                cell.x += cell.launch_vx * deltaTime;
                cell.y += cell.launch_vy * deltaTime;
                cell.launch_vx *= PLAYER_SPLIT_LAUNCH_DECAY;
                cell.launch_vy *= PLAYER_SPLIT_LAUNCH_DECAY;

                if (Math.hypot(cell.launch_vx, cell.launch_vy) < 1) {
                    delete cell.launch_vx;
                    delete cell.launch_vy;
                }
            }
        }
    }

    // OPTIMIZATION: Build spatial hash
    spatialHash.clear();
    const allCells = Object.values(players).flat();
    for (const cell of allCells) {
        spatialHash.insert(cell);
    }

    // Phase 3: Consumption Detection (using spatial hash)
    const consumptions = [];
    const involvedCellIds = new Set();

    for (const c1 of allCells) {
        if (involvedCellIds.has(c1.cellId)) continue;

        const potentialColliders = spatialHash.query(c1.x, c1.y, c1.radius);

        for (const c2 of potentialColliders) {
            if (c1.cellId === c2.cellId) continue;
            if (involvedCellIds.has(c2.cellId)) continue;

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

            virus.ejectionsConsumed = (virus.ejectionsConsumed || 0) + 1;

            const dudPlayerCells = players[DUD_PLAYER_ID];
            const ejectionIndex = dudPlayerCells.findIndex(c => c.cellId === ejection.cellId);
            if(ejectionIndex > -1) dudPlayerCells.splice(ejectionIndex, 1);

            if (virus.ejectionsConsumed >= VIRUS_EJECTIONS_TO_SPLIT) {
                let dx, dy;

                if (ejection.launch_vx !== undefined && ejection.launch_vy !== undefined) {
                    const velocity = Math.hypot(ejection.launch_vx, ejection.launch_vy);
                    if (velocity > 0.1) {
                        dx = ejection.launch_vx / velocity;
                        dy = ejection.launch_vy / velocity;
                    } else {
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

                const launchSpeed = VIRUS_LAUNCH_SPEED;
                const newVirus = {
                    x: virus.x + dx * (virus.radius + 5),
                    y: virus.y + dy * (virus.radius + 5),
                    score: virus.score,
                    radius: virus.radius,
                    color: VIRUS_COLOR,
                    nickname: '',
                    type: 'virus',
                    id: DUD_PLAYER_ID,
                    cellId: cellIdCounter++,
                    ejectionsConsumed: 0,
                    launch_vx: dx * launchSpeed,
                    launch_vy: dy * launchSpeed
                };

                virus.ejectionsConsumed = 0;
                players[DUD_PLAYER_ID].push(newVirus);
            }
        } else if (consumption.type === 'virusPlayerInteraction') {
            const { virus, player } = consumption;
            const playerCells = players[player.id];
            const playerCellCount = playerCells.length;

            if (playerCellCount >= 16) {
                const hittingCell = playerCells.find(c => c.cellId === player.cellId);
                if (hittingCell) {
                    hittingCell.score += virus.score;
                    hittingCell.radius = getRadiusFromScore(hittingCell.score);
                }

                const dudPlayerCells = players[DUD_PLAYER_ID];
                const virusIndex = dudPlayerCells.findIndex(c => c.cellId === virus.cellId);
                if(virusIndex > -1) dudPlayerCells.splice(virusIndex, 1);

            } else {
                const hittingCell = playerCells.find(c => c.cellId === player.cellId);
                if (!hittingCell) continue;

                hittingCell.score += VIRUS_CONSUME_SCORE_GAIN_SPLIT;

                const desiredSplitCount = Math.floor(hittingCell.score / PLAYER_MIN_SPLIT_SCORE) || 2;
                const availableSlots = 16 - playerCellCount;
                const additionalCellsToCreate = Math.min(desiredSplitCount - 1, availableSlots);
                const finalSplitCount = additionalCellsToCreate + 1;

                if (finalSplitCount <= 1) {
                    const dudPlayerCells = players[DUD_PLAYER_ID];
                    const virusIndex = dudPlayerCells.findIndex(c => c.cellId === virus.cellId);
                    if(virusIndex > -1) dudPlayerCells.splice(virusIndex, 1);
                    continue;
                }

                const totalScoreToSplit = hittingCell.score;
                const baseScore = Math.floor(totalScoreToSplit / finalSplitCount);
                let remainder = totalScoreToSplit % finalSplitCount;
                const newCells = [];

                for (let i = 0; i < finalSplitCount; i++) {
                    const currentCellScore = baseScore + (remainder > 0 ? 1 : 0);
                    if (remainder > 0) {
                        remainder--;
                    }

                    const angle = Math.random() * Math.PI * 2;
                    const launchSpeed = 50 + Math.random() * 100;

                    newCells.push({
                        ...hittingCell,
                        cellId: cellIdCounter++,
                        score: currentCellScore,
                        radius: getRadiusFromScore(currentCellScore),
                        x: hittingCell.x + Math.cos(angle) * (hittingCell.radius * 0.2),
                        y: hittingCell.y + Math.sin(angle) * (hittingCell.radius * 0.2),
                        mergeCooldown: Date.now() + PLAYER_MERGE_TIME,
                        launch_vx: Math.cos(angle) * launchSpeed,
                        launch_vy: Math.sin(angle) * launchSpeed,
                    });
                }

                const playerIndex = playerCells.findIndex(c => c.cellId === hittingCell.cellId);
                if (playerIndex !== -1) {
                    playerCells.splice(playerIndex, 1, ...newCells);
                }

                const dudPlayerCells = players[DUD_PLAYER_ID];
                const virusIndex = dudPlayerCells.findIndex(c => c.cellId === virus.cellId);
                if(virusIndex > -1) dudPlayerCells.splice(virusIndex, 1);
            }

        } else {
            const { bigger, smaller } = consumption;
            const ownerCells = players[bigger.id];
            if (ownerCells) {
                const biggerCell = ownerCells.find(c => c.cellId === bigger.cellId);
                if (biggerCell) {
                    biggerCell.score += smaller.score;
                    biggerCell.radius = getRadiusFromScore(biggerCell.score);
                }
            }

            const smallerOwnerId = smaller.id;
            if (players[smallerOwnerId]) {
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

                if (c1.mergeCooldown <= now && c2.mergeCooldown <= now) {
                    let bigger, smaller;
                    if (c1.radius > c2.radius) {
                        bigger = c1;
                        smaller = c2;
                    } else {
                        bigger = c2;
                        smaller = c1;
                    }

                    if (distance < bigger.radius) {
                        const originalC1Score = c1.score;
                        c1.score += c2.score;
                        c1.radius = getRadiusFromScore(c1.score);

                        const totalScore = c1.score;
                        const weight1 = originalC1Score / totalScore;
                        const weight2 = c2.score / totalScore;
                        c1.x = c1.x * weight1 + c2.x * weight2;
                        c1.y = c1.y * weight1 + c2.y * weight2;

                        playerCells.splice(j, 1);
                        j--;

                        c1.mergeCooldown = Math.max(c1.mergeCooldown, c2.mergeCooldown);
                        continue;
                    }
                }

                const isInCooldown = c1.mergeCooldown > now || c2.mergeCooldown > now;

                if (isInCooldown && distance < combinedRadius) {
                    const overlap = combinedRadius - distance;

                    const mass1 = c1.score + CELL_BASE_MASS;
                    const mass2 = c2.score + CELL_BASE_MASS;
                    const totalMass = mass1 + mass2;

                    const repulsionForce = overlap * 1.5;

                    const move1 = (repulsionForce * mass2 / totalMass);
                    const move2 = (repulsionForce * mass1 / totalMass);

                    let dx, dy;
                    if (distance > 0.001) {
                        dx = (c1.x - c2.x) / distance;
                        dy = (c1.y - c2.y) / distance;
                    } else {
                        const angle = Math.random() * Math.PI * 2;
                        dx = Math.cos(angle);
                        dy = Math.sin(angle);
                    }

                    c1.x += dx * move1;
                    c1.y += dy * move1;
                    c2.x -= dx * move2;
                    c2.y -= dy * move2;

                    const minSeparation = combinedRadius * 1.05;
                    const newDistance = Math.hypot(c1.x - c2.x, c1.y - c2.y);

                    if (newDistance < minSeparation) {
                        const additionalSeparation = minSeparation - newDistance;
                        const additionalMove1 = (additionalSeparation * mass2 / totalMass) * 0.2;
                        const additionalMove2 = (additionalSeparation * mass1 / totalMass) * 0.2;

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

    // Universal boundary clamping
    const halfWidth = WORLD_WIDTH / 2;
    const halfHeight = WORLD_HEIGHT / 2;

    for (const playerId in players) {
        const playerCells = players[playerId];
        for (const cell of playerCells) {
            cell.x = Math.max(-halfWidth + cell.radius, Math.min(halfWidth - cell.radius, cell.x));
            cell.y = Math.max(-halfHeight + cell.radius, Math.min(halfHeight - cell.radius, cell.y));

            if (cell.launch_vx !== undefined && cell.launch_vy !== undefined) {
                if (cell.x <= -halfWidth + cell.radius || cell.x >= halfWidth - cell.radius) {
                    cell.launch_vx *= 0.3;
                }
                if (cell.y <= -halfHeight + cell.radius || cell.y >= halfHeight - cell.radius) {
                    cell.launch_vy *= 0.3;
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
}

// OPTIMIZATION: Network broadcast with interest management
setInterval(() => {
    if (Object.keys(players).length === 0) return;

    // Update interest areas for all players
    Object.keys(players).forEach(playerId => {
        if (playerId !== DUD_PLAYER_ID) {
            playerInterestAreas[playerId] = calculateInterestArea(playerId);
        }
    });

    // Send updates to each player based on their interest area
    for (const playerId in players) {
        if (playerId === DUD_PLAYER_ID) continue;

        const interestArea = playerInterestAreas[playerId];
        if (!interestArea) continue;

        const updatePackage = {
            updatedCells: [],
            newCells: [],
            eatenCellIds: [],
        };

        const playerLastState = lastBroadcastState[playerId] || {};
        const currentCellIds = new Set();

        // Check all cells within interest area
        const allCurrentCells = Object.values(players).flat();

        for (const cell of allCurrentCells) {
            if (!isInInterestArea(cell, interestArea)) continue;

            currentCellIds.add(cell.cellId);
            const oldCellState = playerLastState[cell.cellId];

            if (!oldCellState) {
                const newCell = { ...cell };
                delete newCell.launch_vx;
                delete newCell.launch_vy;
                updatePackage.newCells.push(newCell);
            } else {
                const dx = cell.x - oldCellState.x;
                const dy = cell.y - oldCellState.y;
                const dr = cell.radius - oldCellState.radius;

                if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1 || Math.abs(dr) > 0.1) {
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

        // Check for eaten cells that were previously visible
        for (const cellId in playerLastState) {
            if (!currentCellIds.has(parseInt(cellId))) {
                updatePackage.eatenCellIds.push(parseInt(cellId));
            }
        }

        if (updatePackage.newCells.length > 0 || updatePackage.updatedCells.length > 0 || updatePackage.eatenCellIds.length > 0) {
            io.to(playerId).emit('gameStateUpdate', updatePackage);
        }

        // Update the player's last broadcast state
        const newPlayerState = {};
        allCurrentCells.forEach(cell => {
            if (isInInterestArea(cell, interestArea)) {
                newPlayerState[cell.cellId] = {
                    x: cell.x,
                    y: cell.y,
                    radius: cell.radius,
                    mergeCooldown: cell.mergeCooldown,
                };
            }
        });
        lastBroadcastState[playerId] = newPlayerState;
    }
}, 1000 / NETWORK_UPDATE_RATE);

server.listen(PORT, () => {
    console.log(`🚀 Server listening on port ${PORT}`);
});