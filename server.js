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

// --- Quadtree Implementation ---
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
    ACK: 8, // Acknowledge receipt of a reliable packet
};

const S2C_OPCODES = {
    INITIAL_STATE: 0,
    GAME_STATE_UPDATE: 1, // Note: This is now only used as an identifier for payload type
    LEADERBOARD_UPDATE: 2,
    YOU_DIED: 3,
    CHAT_MESSAGE: 4,
    SYSTEM_MESSAGE: 5,
    PONG: 6,
    PLAYER_DISCONNECTED: 7,
    JOIN_ERROR: 8,
    RELIABLE_UPDATE: 9, // Wrapper for game state updates
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// Performance settings
const PHYSICS_UPDATE_RATE = 60; // Hz
const NETWORK_UPDATE_RATE = 30; // Hz
const INTEREST_RADIUS = 1500; // Only send updates for objects within this radius
const SPATIAL_HASH_CELL_SIZE = 200; // Size of spatial hash cells

// Reliable Protocol Settings
const reliableSocketManager = {};
const RETRANSMIT_TIMEOUT = 250; // ms to wait before re-sending a packet
const MAX_RETRIES = 15; // Max times to re-send before disconnecting client
const wrtc = require('@roamhq/wrtc');
const peerConnections = {}; // socket.id -> { pc, dataChannel }

app.use(express.static('public'));

let players = {};
let cellIdCounter = 0;
let playerInputs = {};
let lastBroadcastState = {};
let playerInterestAreas = {}; // Track what each player can see

let savedScores = {}; // Cache for disconnected players' scores, keyed by a persistent token
let socketIdToPlayerToken = {}; // Map socket.id to the player's persistent token

// Use spatial hash for faster lookups
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

// Calculate player's interest area (what they can see)
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

// Check if object is within player's interest area
function isInInterestArea(obj, interestArea) {
    if (!interestArea) return false;
    return obj.x >= interestArea.minX && obj.x <= interestArea.maxX &&
        obj.y >= interestArea.minY && obj.y <= interestArea.maxY;
}

io.on('connection', (socket) => {
    console.log('User connected via TCP:', socket.id);

    // --- WebRTC Signaling Setup ---
    const pc = new wrtc.RTCPeerConnection({
        iceServers: [
            // You would use public STUN servers in a real application
            { urls: 'stun:stun.l.google.com:19302' }
        ]
    });
    peerConnections[socket.id] = { pc: pc, dataChannel: null };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('webrtc-candidate', event.candidate);
        }
    };

    pc.ondatachannel = (event) => {
        const dataChannel = event.channel;
        console.log(`Data channel "${dataChannel.label}" established for ${socket.id}`);
        peerConnections[socket.id].dataChannel = dataChannel;

        dataChannel.onopen = () => {
            console.log(`Data channel for ${socket.id} is open.`);
        };

        dataChannel.onclose = () => {
            console.log(`Data channel for ${socket.id} closed.`);
        };

        dataChannel.onerror = (error) => {
            console.error(`Data channel error for ${socket.id}:`, error);
        };

        // This is where we receive game data from the client over UDP
        dataChannel.onmessage = (msg) => {
            try {
                const data = msg.data;
                // The client sends an ArrayBuffer, which is what we receive here.
                if (data instanceof ArrayBuffer && data.byteLength > 0) {
                    const view = new DataView(data);
                    const opcode = view.getUint8(0);
                    let offset = 1;

                    // Only handle high-frequency game inputs and ACKs here
                    switch (opcode) {
                        case C2S_OPCODES.PLAYER_INPUT_MOUSE: {
                            if (!players[socket.id]) break;
                            playerInputs[socket.id] = {
                                worldMouseX: view.getFloat32(offset, true),
                                worldMouseY: view.getFloat32(offset + 4, true),
                                inputType: 'mouse'
                            };
                            break;
                        }

                        case C2S_OPCODES.PLAYER_INPUT_CONTROLLER: {
                            if (!players[socket.id]) break;
                            playerInputs[socket.id] = {
                                dx: view.getFloat32(offset, true),
                                dy: view.getFloat32(offset + 4, true),
                                magnitude: view.getFloat32(offset + 8, true),
                                inputType: 'controller'
                            };
                            break;
                        }

                        case C2S_OPCODES.SPLIT: {
                            const playerCells = players[socket.id];
                            if (!playerCells) break;
                            const mouseX = view.getFloat32(offset, true);
                            const mouseY = view.getFloat32(offset + 4, true);

                            const splittableCells = playerCells
                                .filter(cell => cell.score >= PLAYER_MIN_SPLIT_SCORE)
                                .sort((a, b) => b.score - a.score);

                            for (const cell of splittableCells) {
                                if (playerCells.length >= 16) break;

                                let dx = mouseX - cell.x;
                                let dy = mouseY - cell.y;
                                const len = Math.hypot(dx, dy);
                                if (len > 0) { dx /= len; dy /= len; } else { dx = 0; dy = -1; }

                                const score1 = Math.floor(cell.score / 2);
                                const score2 = cell.score - score1;
                                cell.score = score1;
                                const newRadius = getRadiusFromScore(score1);
                                cell.radius = newRadius;
                                const launchSpeed = newRadius * 15;

                                const newCell = {
                                    ...cell, cellId: cellIdCounter++, score: score2, radius: getRadiusFromScore(score2),
                                    x: cell.x + dx * (newRadius + 5), y: cell.y + dy * (newRadius + 5),
                                    mergeCooldown: Date.now() + PLAYER_MERGE_TIME,
                                    launch_vx: dx * launchSpeed, launch_vy: dy * launchSpeed
                                };
                                cell.mergeCooldown = Date.now() + PLAYER_MERGE_TIME;
                                playerCells.push(newCell);
                            }
                            break;
                        }

                        case C2S_OPCODES.EJECT_MASS: {
                            const playerCells = players[socket.id];
                            if (!playerCells) break;
                            const mouseX = view.getFloat32(offset, true);
                            const mouseY = view.getFloat32(offset + 4, true);

                            playerCells.forEach(cell => {
                                if (cell.score >= PLAYER_MIN_EJECT_SCORE) {
                                    let dx = mouseX - cell.x;
                                    let dy = mouseY - cell.y;
                                    const len = Math.hypot(dx, dy);
                                    if (len > 0) { dx /= len; dy /= len; } else { dx = 0; dy = -1; }

                                    cell.score -= EJECTED_MASS_SCORE;
                                    cell.radius = getRadiusFromScore(cell.score);

                                    const newDud = {
                                        x: cell.x + dx * (cell.radius + 5), y: cell.y + dy * (cell.radius + 5),
                                        score: EJECTED_MASS_SCORE, radius: EJECTED_MASS_RADIUS, color: cell.color, nickname: '',
                                        type: 'ejected', id: DUD_PLAYER_ID, ownerId: cell.id, cellId: cellIdCounter++,
                                        launch_vx: dx * EJECT_LAUNCH_SPEED, launch_vy: dy * EJECT_LAUNCH_SPEED,
                                    };
                                    players[DUD_PLAYER_ID].push(newDud);
                                }
                            });
                            break;
                        }

                        case C2S_OPCODES.ACK: {
                            const socketState = reliableSocketManager[socket.id];
                            if (socketState) {
                                const ackedSeq = view.getUint32(offset, true);
                                for (const seq of socketState.unacked.keys()) {
                                    if (seq <= ackedSeq) {
                                        socketState.unacked.delete(seq);
                                    }
                                }
                                socketState.lastAckedByClient = Math.max(socketState.lastAckedByClient, ackedSeq);
                            }
                            break;
                        }
                    }
                }
            } catch (e) {
                console.error('Error processing binary message from data channel:', e);
            }
        };
    };

    socket.on('webrtc-offer', async (offer) => {
        try {
            await pc.setRemoteDescription(offer);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('webrtc-answer', pc.localDescription);
        } catch (error) {
            console.error('Error handling WebRTC offer:', error);
        }
    });

    socket.on('webrtc-candidate', (candidate) => {
        try {
            pc.addIceCandidate(candidate).catch(e => {}); // Ignore benign errors
        } catch (error) {
            console.error('Error adding ICE candidate:', error);
        }
    });
    // --- End WebRTC Signaling ---


    // Initialize state for our custom reliable protocol
    reliableSocketManager[socket.id] = {
        seq: 0, // Next sequence number to send
        unacked: new Map(), // Unacknowledged packets { buffer, timestamp, retries }
        lastAckedByClient: -1, // Last sequence number acked by the client
    };

    // This handler now only manages low-frequency/control messages over TCP
    socket.on('message', (data) => {
        try {
            if (!(data instanceof Buffer)) {
                console.warn('Received non-buffer message, which is not expected. Ignoring.');
                return;
            }

            const view = new DataView(data.buffer, data.byteOffset, data.length);
            const opcode = view.getUint8(0);
            let offset = 1;

            switch (opcode) {
                case C2S_OPCODES.JOIN_GAME: {
                    const nicknameData = readString(view, offset);
                    offset = nicknameData.newOffset;
                    const colorData = readString(view, offset);
                    offset = colorData.newOffset;
                    const hasImage = view.getUint8(offset++) === 1;
                    let imageDataUrl = null;
                    if (hasImage) {
                        const imageData = readString(view, offset);
                        offset = imageData.newOffset;
                        imageDataUrl = imageData.value;
                    }
                    const hasToken = view.getUint8(offset++) === 1;
                    let playerToken = null;
                    if (hasToken) {
                        const tokenData = readString(view, offset);
                        offset = tokenData.newOffset;
                        playerToken = tokenData.value;
                    }

                    console.log(`Player ${nicknameData.value} (${socket.id}) joined successfully.`);
                    const halfWidth = WORLD_WIDTH / 2;
                    const halfHeight = WORLD_HEIGHT / 2;

                    let startScore = PLAYER_START_SCORE;
                    if (playerToken) {
                        socketIdToPlayerToken[socket.id] = playerToken;
                        if (savedScores[playerToken]) {
                            startScore = savedScores[playerToken];
                            delete savedScores[playerToken];
                        }
                    }

                    players[socket.id] = [{
                        x: Math.floor(Math.random() * WORLD_WIDTH) - halfWidth,
                        y: Math.floor(Math.random() * WORLD_HEIGHT) - halfHeight,
                        score: startScore,
                        radius: getRadiusFromScore(startScore),
                        color: colorData.value || '#ffffff',
                        nickname: nicknameData.value || 'Player',
                        type: 'player',
                        id: socket.id,
                        cellId: cellIdCounter++,
                        vx: 0, vy: 0,
                        image: imageDataUrl || null,
                        mergeCooldown: Date.now() + PLAYER_MERGE_TIME,
                    }];
                    playerInputs[socket.id] = {
                        worldMouseX: players[socket.id][0].x,
                        worldMouseY: players[socket.id][0].y
                    };

                    const interestArea = calculateInterestArea(socket.id);
                    const visiblePlayers = {};
                    for (const [pId, cells] of Object.entries(players)) {
                        const visibleCells = cells.filter(cell => isInInterestArea(cell, interestArea));
                        if (visibleCells.length > 0) {
                            visiblePlayers[pId] = visibleCells;
                        }
                    }

                    const initialState = {
                        players: visiblePlayers,
                        world: { width: WORLD_WIDTH, height: WORLD_HEIGHT }
                    };
                    socket.send(encodeInitialState(initialState));

                    io.send(encodeSystemMessage({ message: `${nicknameData.value} joined the game` }));
                    break;
                }

                case C2S_OPCODES.CHAT_MESSAGE: {
                    if (players[socket.id]) {
                        const messageData = readString(view, offset);
                        const message = messageData.value.trim().substring(0, 100);
                        if (message.length > 0) {
                            const player = players[socket.id][0];
                            console.log(`Chat from ${player.nickname}: ${message}`);
                            const chatData = { playerId: socket.id, nickname: player.nickname, message: message };
                            io.send(encodeChatMessage(chatData));
                        }
                    }
                    break;
                }

                case C2S_OPCODES.SET_MASS: {
                    const playerCells = players[socket.id];
                    if (!playerCells) break;

                    const newMass = Math.max(1, Math.min(1000000, view.getFloat32(offset, true)));
                    const player = playerCells[0];
                    console.log(`Setting mass for ${player.nickname} to ${newMass}`);

                    playerCells.forEach(cell => {
                        cell.score = newMass;
                        cell.radius = getRadiusFromScore(newMass);
                    });

                    const buffer = new ArrayBuffer(1 + 2 + textEncoder.encode(`Mass set to ${newMass}`).length);
                    const msgView = new DataView(buffer);
                    msgView.setUint8(0, S2C_OPCODES.SYSTEM_MESSAGE);
                    writeString(msgView, 1, `Mass set to ${newMass}`);
                    socket.send(buffer);

                    io.send(encodeSystemMessage({ message: `${player.nickname} set their mass to ${newMass}` }));
                    break;
                }

                case C2S_OPCODES.PING: {
                    const buffer = new ArrayBuffer(1);
                    const pongView = new DataView(buffer);
                    pongView.setUint8(0, S2C_OPCODES.PONG);
                    socket.send(buffer);
                    break;
                }
            }
        } catch (e) {
            console.error('Error processing binary message from TCP:', e);
        }
    });

    socket.on('disconnect', (reason) => {
        console.log(`Socket ${socket.id} disconnected. Reason: ${reason}`);

        // Clean up WebRTC connection
        if (peerConnections[socket.id]) {
            peerConnections[socket.id].pc.close();
            delete peerConnections[socket.id];
        }

        delete reliableSocketManager[socket.id];

        if (players[socket.id]) {
            const playerNickname = players[socket.id][0].nickname;
            console.log(`Player ${playerNickname} disconnected.`);

            const playerToken = socketIdToPlayerToken[socket.id];
            if (playerToken && players[socket.id] && players[socket.id].length > 0) {
                const totalScore = players[socket.id].reduce((sum, cell) => sum + (cell.score || 0), 0);
                if (totalScore > PLAYER_START_SCORE) {
                    savedScores[playerToken] = Math.round(totalScore);
                }
            }

            delete players[socket.id];
            delete playerInputs[socket.id];
            delete playerInterestAreas[socket.id];

            const buffer = new ArrayBuffer(1 + 2 + textEncoder.encode(socket.id).length);
            const view = new DataView(buffer);
            view.setUint8(0, S2C_OPCODES.PLAYER_DISCONNECTED);
            writeString(view, 1, socket.id);
            io.send(buffer);

            io.send(encodeSystemMessage({ message: `${playerNickname} left the game` }));

            if (playerToken) {
                delete socketIdToPlayerToken[socket.id];
            }
        }
    });

    socket.on('connect_error', (error) => {
        console.log('Connection error:', error);
    });
});

// Separate physics update from network update
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
            if (input.inputType === 'controller' && input.magnitude > 0) {
                // New controller-based movement (direction & magnitude)
                playerCells.forEach(cell => {
                    const speed = 5; // Base speed
                    const speedFactor = 20 / cell.radius; // Mass penalty
                    const maxSpeed = speed * speedFactor;
                    const currentSpeed = maxSpeed * input.magnitude; // Apply stick magnitude

                    cell.x += input.dx * currentSpeed * deltaTime * 60;
                    cell.y += input.dy * currentSpeed * deltaTime * 60;
                });
            } else if (input.inputType === 'mouse' || input.inputType === undefined) {
                // Existing mouse-based movement (move towards a point) and legacy support
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

    // Build spatial hash
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

        } if (consumption.type === 'regularConsumption') {
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
                    const finalScore = Math.max(1, Math.round(smaller.score));
                    const buffer = new ArrayBuffer(1 + 4);
                    const view = new DataView(buffer);
                    view.setUint8(0, S2C_OPCODES.YOU_DIED);
                    view.setUint32(1, finalScore, true);
                    io.to(smallerOwnerId).emit('message', buffer);

                    delete players[smallerOwnerId];
                    delete playerInputs[smallerOwnerId];

                    const disconnectBuffer = new ArrayBuffer(1 + 2 + textEncoder.encode(smallerOwnerId).length);
                    const disconnectView = new DataView(disconnectBuffer);
                    disconnectView.setUint8(0, S2C_OPCODES.PLAYER_DISCONNECTED);
                    writeString(disconnectView, 1, smallerOwnerId);
                    io.send(disconnectBuffer);
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

function encodeCell(view, offset, cell) {
    let currentOffset = offset;
    view.setUint32(currentOffset, cell.cellId, true); currentOffset += 4;
    view.setInt16(currentOffset, Math.round(cell.x), true); currentOffset += 2;
    view.setInt16(currentOffset, Math.round(cell.y), true); currentOffset += 2;
    view.setUint32(currentOffset, Math.round(cell.score), true); currentOffset += 4;
    view.setUint16(currentOffset, Math.round(cell.radius * 10), true); currentOffset += 2;

    currentOffset = writeString(view, currentOffset, cell.color || '#ffffff');
    currentOffset = writeString(view, currentOffset, cell.nickname || '');

    let typeId = 0; // player
    if (cell.type === 'pellet') typeId = 1;
    else if (cell.type === 'virus') typeId = 2;
    else if (cell.type === 'ejected') typeId = 3;
    view.setUint8(currentOffset, typeId); currentOffset += 1;

    const hasImage = !!(cell.image && cell.type === 'player');
    view.setUint8(currentOffset, hasImage ? 1 : 0); currentOffset += 1;
    if (hasImage) {
        currentOffset = writeString(view, currentOffset, cell.image);
    }
    view.setFloat64(currentOffset, cell.mergeCooldown || 0, true); currentOffset += 8;

    // For ejected mass, include ownerId
    if(cell.type === 'ejected') {
        currentOffset = writeString(view, currentOffset, cell.ownerId || '');
    }
    return currentOffset;
}

function encodeInitialState(state) {
    let bufferSize = 1 + 2 + 2 + 2; // opcode, world, playerCount
    for (const [playerId, cells] of Object.entries(state.players)) {
        bufferSize += 2 + textEncoder.encode(playerId).length; // playerId
        bufferSize += 2; // cellCount
        for (const cell of cells) {
            bufferSize += 4 + 2 + 2 + 4 + 2 + (2 + textEncoder.encode(cell.color || '#ffffff').length) + (2 + textEncoder.encode(cell.nickname || '').length) + 1 + 1 + 8 + (2 + textEncoder.encode(cell.ownerId || '').length);
            if (cell.image && cell.type === 'player') {
                bufferSize += 2 + textEncoder.encode(cell.image).length;
            }
        }
    }

    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);
    let offset = 0;

    view.setUint8(offset, S2C_OPCODES.INITIAL_STATE); offset += 1;
    view.setUint16(offset, state.world.width, true); offset += 2;
    view.setUint16(offset, state.world.height, true); offset += 2;

    view.setUint16(offset, Object.keys(state.players).length, true); offset += 2;
    for (const [playerId, cells] of Object.entries(state.players)) {
        offset = writeString(view, offset, playerId);
        view.setUint16(offset, cells.length, true); offset += 2;
        for (const cell of cells) {
            offset = encodeCell(view, offset, cell);
        }
    }
    return buffer;
}

function encodeGameStateUpdatePayload(updatePackage) {
    // This function creates the payload for a game state update, WITHOUT the opcode.
    // The opcode is added by the reliable wrapper.
    let bufferSize = 2 + 2 + 2; // counts
    updatePackage.updatedCells.forEach(cell => {
        bufferSize += 4 + 1; // cellId, deltaMask
        if (cell.deltaMask & 1) bufferSize += 2; // x
        if (cell.deltaMask & 2) bufferSize += 2; // y
        if (cell.deltaMask & 4) bufferSize += 2; // radius
        if (cell.deltaMask & 8) bufferSize += 4; // score
        if (cell.deltaMask & 16) bufferSize += 8; // mergeCooldown
    });
    updatePackage.newCells.forEach(cell => {
        // Add size for the cell's owner ID, then the cell data itself
        bufferSize += (2 + textEncoder.encode(cell.id).length);
        bufferSize += 4 + 2 + 2 + 4 + 2 + (2 + textEncoder.encode(cell.color || '#ffffff').length) + (2 + textEncoder.encode(cell.nickname || '').length) + 1 + 1 + 8 + (2 + textEncoder.encode(cell.ownerId || '').length);
        if (cell.image && cell.type === 'player') {
            bufferSize += 2 + textEncoder.encode(cell.image).length;
        }
    });
    bufferSize += updatePackage.eatenCellIds.length * 4;

    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);
    let offset = 0;

    // NO OPCODE HERE - This is just the payload
    // view.setUint8(offset, S2C_OPCODES.GAME_STATE_UPDATE); offset += 1;

    // Updated cells (Delta-compressed)
    view.setUint16(offset, updatePackage.updatedCells.length, true); offset += 2;
    updatePackage.updatedCells.forEach(cell => {
        view.setUint32(offset, cell.cellId, true); offset += 4;
        view.setUint8(offset, cell.deltaMask, true); offset += 1;

        if (cell.deltaMask & 1) { // x
            view.setInt16(offset, cell.x, true); offset += 2;
        }
        if (cell.deltaMask & 2) { // y
            view.setInt16(offset, cell.y, true); offset += 2;
        }
        if (cell.deltaMask & 4) { // radius
            view.setUint16(offset, cell.radius, true); offset += 2;
        }
        if (cell.deltaMask & 8) { // score
            view.setUint32(offset, cell.score, true); offset += 4;
        }
        if (cell.deltaMask & 16) { // mergeCooldown
            view.setFloat64(offset, cell.mergeCooldown, true); offset += 8;
        }
    });

    // New cells
    view.setUint16(offset, updatePackage.newCells.length, true); offset += 2;
    updatePackage.newCells.forEach(cell => {
        offset = writeString(view, offset, cell.id); // Write owner ID before cell data
        offset = encodeCell(view, offset, cell);
    });

    // Eaten cells
    view.setUint16(offset, updatePackage.eatenCellIds.length, true); offset += 2;
    updatePackage.eatenCellIds.forEach(id => {
        view.setUint32(offset, id, true); offset += 4;
    });

    return buffer;
}

function encodeLeaderboardUpdate(leaderboard) {
    let bufferSize = 1 + 1; // opcode, count
    leaderboard.forEach(p => {
        bufferSize += (2 + textEncoder.encode(p.id).length) + (2 + textEncoder.encode(p.nickname).length) + 4;
    });
    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);
    let offset = 0;
    view.setUint8(offset, S2C_OPCODES.LEADERBOARD_UPDATE); offset += 1;
    view.setUint8(offset, leaderboard.length); offset += 1;
    leaderboard.forEach(p => {
        offset = writeString(view, offset, p.id);
        offset = writeString(view, offset, p.nickname);
        view.setUint32(offset, p.score, true); offset += 4;
    });
    return buffer;
}

function encodeSystemMessage(message) {
    const messageBytes = textEncoder.encode(message.message);
    const buffer = new ArrayBuffer(1 + 2 + messageBytes.length);
    const view = new DataView(buffer);
    view.setUint8(0, S2C_OPCODES.SYSTEM_MESSAGE);
    writeString(view, 1, message.message);
    return buffer;
}

function encodeChatMessage(data) {
    let bufferSize = 1; // opcode
    bufferSize += (2 + textEncoder.encode(data.playerId).length);
    bufferSize += (2 + textEncoder.encode(data.nickname).length);
    bufferSize += (2 + textEncoder.encode(data.message).length);
    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);
    let offset = 0;
    view.setUint8(offset, S2C_OPCODES.CHAT_MESSAGE); offset += 1;
    offset = writeString(view, offset, data.playerId);
    offset = writeString(view, offset, data.nickname);
    offset = writeString(view, offset, data.message);
    return buffer;
}

// Network broadcast with interest management
setInterval(() => {
    if (Object.keys(players).length <= 1) return; // Only duds

    // Update interest areas for all players
    Object.keys(players).forEach(playerId => {
        if (playerId !== DUD_PLAYER_ID) {
            playerInterestAreas[playerId] = calculateInterestArea(playerId);
        }
    });

    // Send updates to each player based on their interest area
    for (const playerId in players) {
        if (playerId === DUD_PLAYER_ID) continue;

        // Use the WebRTC data channel if available and open
        const pcInfo = peerConnections[playerId];
        const dataChannel = pcInfo ? pcInfo.dataChannel : null;

        if (!dataChannel || dataChannel.readyState !== 'open') {
            continue; // Skip if UDP channel isn't ready
        }

        const interestArea = playerInterestAreas[playerId];
        if (!interestArea) continue;

        const updatePackage = {
            updatedCells: [],
            newCells: [],
            eatenCellIds: [],
        };

        const playerLastState = lastBroadcastState[playerId] || {};
        const currentCellIds = new Set();

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
                let deltaMask = 0;
                const updatedCellData = { cellId: cell.cellId };

                const quantizedX = Math.round(cell.x);
                const quantizedY = Math.round(cell.y);
                const quantizedRadius = Math.round(cell.radius * 10);
                const quantizedScore = Math.round(cell.score);
                const mergeCooldown = cell.mergeCooldown || 0;

                if (quantizedX !== oldCellState.x) {
                    deltaMask |= 1;
                    updatedCellData.x = quantizedX;
                }
                if (quantizedY !== oldCellState.y) {
                    deltaMask |= 2;
                    updatedCellData.y = quantizedY;
                }
                if (quantizedRadius !== oldCellState.radius) {
                    deltaMask |= 4;
                    updatedCellData.radius = quantizedRadius;
                }
                if (quantizedScore !== oldCellState.score) {
                    deltaMask |= 8;
                    updatedCellData.score = quantizedScore;
                }
                if (mergeCooldown !== oldCellState.mergeCooldown) {
                    deltaMask |= 16;
                    updatedCellData.mergeCooldown = mergeCooldown;
                }

                if (deltaMask > 0) {
                    updatedCellData.deltaMask = deltaMask;
                    updatePackage.updatedCells.push(updatedCellData);
                }
            }
        }

        for (const cellId in playerLastState) {
            if (!currentCellIds.has(parseInt(cellId))) {
                updatePackage.eatenCellIds.push(parseInt(cellId));
            }
        }

        if (updatePackage.newCells.length > 0 || updatePackage.updatedCells.length > 0 || updatePackage.eatenCellIds.length > 0) {
            const payload = encodeGameStateUpdatePayload(updatePackage);

            const socketState = reliableSocketManager[playerId];
            if (socketState) {
                const seq = socketState.seq++;
                const reliablePacket = new ArrayBuffer(1 + 4 + payload.byteLength);
                const view = new DataView(reliablePacket);
                view.setUint8(0, S2C_OPCODES.RELIABLE_UPDATE);
                view.setUint32(1, seq, true);
                new Uint8Array(reliablePacket, 5).set(new Uint8Array(payload));

                socketState.unacked.set(seq, {
                    buffer: reliablePacket,
                    timestamp: Date.now(),
                    retries: 0
                });

                dataChannel.send(Buffer.from(reliablePacket));
            }
        }

        const newPlayerState = {};
        allCurrentCells.forEach(cell => {
            if (isInInterestArea(cell, interestArea)) {
                newPlayerState[cell.cellId] = {
                    x: Math.round(cell.x),
                    y: Math.round(cell.y),
                    radius: Math.round(cell.radius * 10),
                    score: Math.round(cell.score),
                    mergeCooldown: cell.mergeCooldown || 0,
                };
            }
        });
        lastBroadcastState[playerId] = newPlayerState;
    }
}, 1000 / NETWORK_UPDATE_RATE);

// Leaderboard update loop
setInterval(() => {
    if (Object.keys(players).length <= 1) return;

    const playerScores = Object.entries(players)
        .filter(([id, pCells]) => id !== DUD_PLAYER_ID && pCells.length > 0)
        .map(([id, pCells]) => {
            return {
                id: id,
                nickname: pCells[0]?.nickname || '...',
                score: Math.max(1, Math.round(pCells.reduce((sum, cell) => sum + (cell.score || 0), 0)))
            };
        });

    const topPlayers = playerScores.sort((a, b) => b.score - a.score).slice(0, 5);

    if (topPlayers.length > 0) {
        io.send(encodeLeaderboardUpdate(topPlayers));
    }
}, 1000); // Update every second

// Retransmission loop for the reliable protocol
setInterval(() => {
    const now = Date.now();
    for (const socketId in reliableSocketManager) {
        const socketState = reliableSocketManager[socketId];
        const pcInfo = peerConnections[socketId];
        const dataChannel = pcInfo ? pcInfo.dataChannel : null;

        if (!dataChannel) {
            continue;
        }

        if (dataChannel.readyState !== 'open') {
            continue;
        }

        for (const [seq, packetInfo] of socketState.unacked.entries()) {
            if (now - packetInfo.timestamp > RETRANSMIT_TIMEOUT) {
                if (packetInfo.retries >= MAX_RETRIES) {
                    console.log(`Socket ${socketId} failed to ACK packet ${seq} after ${MAX_RETRIES} retries. Disconnecting.`);
                    const socket = io.sockets.sockets.get(socketId);
                    if (socket) socket.disconnect(true);
                    break;
                }

                dataChannel.send(Buffer.from(packetInfo.buffer));
                packetInfo.timestamp = now;
                packetInfo.retries++;
            }
        }
    }
}, 100);

server.listen(PORT, () => {
    console.log(`🚀 Server listening on port ${PORT}`);
});