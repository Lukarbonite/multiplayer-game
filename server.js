// server.js

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = 3000;
const WORLD_WIDTH = 4000;
const WORLD_HEIGHT = 4000;
const PELLET_COUNT = 300;
const PELLET_RADIUS = 5;
const VIRUS_COUNT = 20;

const PLAYER_START_SCORE = 1;
const CELL_BASE_MASS = 399; 
const PELLET_SCORE_VALUE = 5;
const PLAYER_MIN_SPLIT_SCORE = 50;
const CELL_CONSUME_THRESHOLD = 0.5;

const PLAYER_MERGE_TIME = 15000;
const PLAYER_SPLIT_LAUNCH_DECAY = 0.94;

// --- FIX: Added constants for ejecting mass ---
const PLAYER_MIN_EJECT_SCORE = 50;
const EJECTED_MASS_SCORE = 10;
const EJECTED_MASS_RADIUS = 10;

// --- FIX: Added constants for Viruses ---
const VIRUS_SCORE = 100;
const VIRUS_COLOR = '#33ff33';
const VIRUS_CONSUME_SCORE_GAIN_SPLIT = 10;
const EJECT_LAUNCH_SPEED = 400;

const DUD_PLAYER_ID = 'duds';

app.use(express.static('public'));

let players = {};
// let pellets = []; // This array is no longer needed.
let cellIdCounter = 0;

function getRadiusFromScore(score) {
    return Math.sqrt(score + CELL_BASE_MASS);
}

function getRandomColor() {
  const letters = '0123456789ABCDEF';
  let color = '#';
  for (let i = 0; i < 6; i++) { color += letters[Math.floor(Math.random() * 16)]; }
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
        type: 'pellet', // Identify as a pellet
        id: DUD_PLAYER_ID, // All pellets belong to the 'dud' player
        cellId: cellIdCounter++,
    };
}

// --- FIX: Added function to create viruses ---
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
        type: 'virus', // Identify as a virus
        id: DUD_PLAYER_ID,
        cellId: cellIdCounter++,
    };
}

function initializeGameObjects() {
    players = {}; // Reset all players
    players[DUD_PLAYER_ID] = []; // Create the 'duds' player to hold pellets and viruses
    for (let i = 0; i < PELLET_COUNT; i++) { players[DUD_PLAYER_ID].push(createPellet()); }
    for (let i = 0; i < VIRUS_COUNT; i++) { players[DUD_PLAYER_ID].push(createVirus()); }
}
initializeGameObjects();

io.on('connection', (socket) => {
  console.log('User connected, waiting for join:', socket.id);

  socket.on('joinGame', (data) => {
    console.log(`Player ${data.nickname} (${socket.id}) joined.`);
    const halfWidth = WORLD_WIDTH / 2;
    const halfHeight = WORLD_HEIGHT / 2;
    players[socket.id] = [{
      x: Math.floor(Math.random() * WORLD_WIDTH) - halfWidth,
      y: Math.floor(Math.random() * WORLD_HEIGHT) - halfHeight,
      score: PLAYER_START_SCORE,
      radius: getRadiusFromScore(PLAYER_START_SCORE),
      color: data.color || '#ffffff',
      nickname: data.nickname || 'Player',
      id: socket.id,
      cellId: cellIdCounter++,
      vx: 0,
      vy: 0,
      image: data.image || null, // Store the image data URL
    }];
    socket.emit('initialState', { players, world: { width: WORLD_WIDTH, height: WORLD_HEIGHT } });
    socket.broadcast.emit('newPlayer', { id: socket.id, data: players[socket.id] });
  });

  socket.on('disconnect', () => {
    if (players[socket.id]) {
      console.log(`Player ${players[socket.id][0].nickname} disconnected.`);
      delete players[socket.id];
      io.emit('playerDisconnected', socket.id);
    } else {
      console.log('User disconnected before joining.');
    }
  });

  socket.on('playerMovement', (movementData) => {
    const playerCells = players[socket.id];
    if (playerCells) {
      movementData.forEach(clientCell => {
        const serverCell = playerCells.find(c => c.cellId === clientCell.cellId);
        if (serverCell) {
          serverCell.x = clientCell.x;
          serverCell.y = clientCell.y;
        }
      });
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
    for (let i = 0; i < cellsToSplit; i++) {
        const cell = playerCells[i];
        if (cell.score >= PLAYER_MIN_SPLIT_SCORE && playerCells.length < 16) {
            const halfScore = cell.score / 2;
            cell.score = halfScore;
            const newRadius = getRadiusFromScore(halfScore);
            cell.radius = newRadius;
            const launchSpeed = newRadius * 15;
            const newCell = { ...cell, cellId: cellIdCounter++, score: halfScore, radius: newRadius, x: cell.x + dx * (newRadius + 5), y: cell.y + dy * (newRadius + 5), mergeCooldown: Date.now() + PLAYER_MERGE_TIME, launch_vx: dx * launchSpeed, launch_vy: dy * launchSpeed };
            cell.mergeCooldown = Date.now() + PLAYER_MERGE_TIME;
            playerCells.push(newCell);
        }
    }
  });

  // --- FIX: Added listener for ejecting mass ---
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
          x: cell.x + dx * (cell.radius + 5), // Position it just outside the new radius
          y: cell.y + dy * (cell.radius + 5),
          score: EJECTED_MASS_SCORE,
          radius: EJECTED_MASS_RADIUS,
          color: cell.image ? cell.color : cell.color, // Use player's color for the dud
          image: cell.image, // Pass image along to ejected mass
          nickname: '',
          id: DUD_PLAYER_ID,
          cellId: cellIdCounter++,
          launch_vx: dx * EJECT_LAUNCH_SPEED,
          launch_vy: dy * EJECT_LAUNCH_SPEED,
        };
        players[DUD_PLAYER_ID].push(newDud);
      }
    });
  });
});

// Server Game Loop
setInterval(() => {
    for (const playerId in players) {
        for (const cell of players[playerId]) {
            if (cell.launch_vx) {
                cell.x += cell.launch_vx * (1 / 60);
                cell.y += cell.launch_vy * (1 / 60);
                cell.launch_vx *= PLAYER_SPLIT_LAUNCH_DECAY;
                cell.launch_vy *= PLAYER_SPLIT_LAUNCH_DECAY;
                if (Math.hypot(cell.launch_vx, cell.launch_vy) < 1) {
                    delete cell.launch_vx; delete cell.launch_vy;
                }
            }
        }
    }

    const allCells = Object.values(players).flat();
    const eatenCellIds = new Set();

    for (let i = 0; i < allCells.length; i++) {
        for (let j = i + 1; j < allCells.length; j++) {
            const c1 = allCells[i]; const c2 = allCells[j];
            // --- FIX: Logic below is heavily modified for virus interaction ---
            if (c1.id === c2.id) continue;
            if (eatenCellIds.has(c1.cellId) || eatenCellIds.has(c2.cellId)) continue;
            
            const distance = Math.hypot(c1.x - c2.x, c1.y - c2.y);
            let bigger, smaller;
            if (c1.radius > c2.radius) { bigger = c1; smaller = c2; } else { bigger = c2; smaller = c1; }

            // Viruses cannot eat players
            if (bigger.type === 'virus' && smaller.id !== DUD_PLAYER_ID) {
                continue;
            }
            
            const requiredDistance = bigger.radius - (smaller.radius * CELL_CONSUME_THRESHOLD);
            if (distance < requiredDistance && bigger.radius > smaller.radius * 1.1) {
                // A consumption event is happening

                // Case 1: Player eats a virus
                if (bigger.id !== DUD_PLAYER_ID && smaller.type === 'virus') {
                    const ownerCells = players[bigger.id];

                    if (ownerCells.length < 16) {
                        // --- EXPLOSION LOGIC ---
                        const cellToExplode = ownerCells.find(c => c.cellId === bigger.cellId);
                        if (cellToExplode) {
                            cellToExplode.score += VIRUS_CONSUME_SCORE_GAIN_SPLIT;
                            let cellsToCreate = 16 - ownerCells.length;
                            const maxSplitsFromOne = 7; // Prevent creating too many tiny cells at once
                            cellsToCreate = Math.min(cellsToCreate, maxSplitsFromOne);
                            const scoreAfterSplit = cellToExplode.score / (cellsToCreate + 1);

                            if (scoreAfterSplit >= 1 && cellsToCreate > 0) {
                                const finalScore = scoreAfterSplit;
                                const newRadius = getRadiusFromScore(finalScore);
                                cellToExplode.score = finalScore;
                                cellToExplode.radius = newRadius;
                                cellToExplode.mergeCooldown = Date.now() + PLAYER_MERGE_TIME;
                                
                                for (let k = 0; k < cellsToCreate; k++) {
                                    const angle = Math.random() * 2 * Math.PI;
                                    const dx = Math.cos(angle);
                                    const dy = Math.sin(angle);
                                    const launchSpeed = newRadius * 15;
                                    ownerCells.push({
                                        ...cellToExplode,
                                        cellId: cellIdCounter++, score: finalScore, radius: newRadius,
                                        x: cellToExplode.x, y: cellToExplode.y,
                                        mergeCooldown: Date.now() + PLAYER_MERGE_TIME,
                                        launch_vx: dx * launchSpeed, launch_vy: dy * launchSpeed,
                                    });
                                }
                            } else {
                                cellToExplode.radius = getRadiusFromScore(cellToExplode.score);
                            }
                        }
                    } else {
                        // --- NORMAL VIRUS CONSUMPTION (>16 cells) ---
                        bigger.score += smaller.score; // gain 100 points
                        bigger.radius = getRadiusFromScore(bigger.score);
                    }
                } else {
                    // Case 2: Generic consumption (player-eats-player, player-eats-pellet)
                    bigger.score += smaller.score;
                    bigger.radius = getRadiusFromScore(bigger.score);
                }

                // This logic runs for ALL consumptions to remove the 'smaller' cell
                eatenCellIds.add(smaller.cellId);
                const ownerId = smaller.id;
                if (players[ownerId]) {
                    players[ownerId] = players[ownerId].filter(c => c.cellId !== smaller.cellId);
                    if (players[ownerId].length === 0 && ownerId !== DUD_PLAYER_ID) {
                        const finalScore = Math.round(smaller.score); // Score of the last cell
                        io.to(ownerId).emit('youDied', { score: Math.max(1, finalScore) });
                        delete players[ownerId];
                        io.emit('playerDisconnected', ownerId);
                    }
                }
                // --- End of modified logic ---
            }
        }
    }

    for (const playerId in players) {
        if (playerId === DUD_PLAYER_ID) continue; // Duds don't have merge/repulsion logic
        const playerCells = players[playerId];
        
        for (let i = 0; i < playerCells.length; i++) {
            for (let j = i + 1; j < playerCells.length; j++) {
                const c1 = playerCells[i]; const c2 = playerCells[j];
                const now = Date.now();
                const distance = Math.hypot(c1.x - c2.x, c1.y - c2.y);
                if (c1.mergeCooldown <= now && c2.mergeCooldown <= now) {
                    if (distance < c1.radius || distance < c2.radius) {
                        c1.score += c2.score; c1.radius = getRadiusFromScore(c1.score); playerCells.splice(j, 1); j--;
                    }
                } else {
                    const totalRadius = c1.radius + c2.radius;
                    if (distance < totalRadius) {
                        const overlap = totalRadius - distance; const mass1 = c1.score + CELL_BASE_MASS; const mass2 = c2.score + CELL_BASE_MASS; const totalMass = mass1 + mass2; const move1 = (overlap * mass2 / totalMass); const move2 = (overlap * mass1 / totalMass); const dx = (c1.x - c2.x) / (distance || 1); const dy = (c1.y - c2.y) / (distance || 1);
                        c1.x += dx * move1; c1.y += dy * move1; c2.x -= dx * move2; c2.y -= dy * move2;
                    }
                }
            }
        }
        const halfWidth = WORLD_WIDTH / 2; const halfHeight = WORLD_HEIGHT / 2;
        for (const cell of playerCells) {
             cell.x = Math.max(-halfWidth + cell.radius, Math.min(halfWidth - cell.radius, cell.x));
             cell.y = Math.max(-halfHeight + cell.radius, Math.min(halfHeight - cell.radius, cell.y));
        }
    }
    
    // --- FIX: Updated respawn logic for pellets and viruses ---
    const dudCells = players[DUD_PLAYER_ID] || [];
    const pelletCount = dudCells.filter(c => c.type === 'pellet').length;
    if (pelletCount < PELLET_COUNT) {
        players[DUD_PLAYER_ID].push(createPellet());
    }
    const virusCount = dudCells.filter(c => c.type === 'virus').length;
    if (virusCount < VIRUS_COUNT) {
        players[DUD_PLAYER_ID].push(createVirus());
    }

    io.emit('gameState', players);
}, 1000 / 60);

server.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});