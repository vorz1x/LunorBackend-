const WebSocket = require('ws');
const redis = require('./adapters/redis');
const { matchmaker } = require('./matchmaker');
const { GameSession } = require('./session');
const { AntiCheat } = require('./anticheat');
const { Stats } = require('./models/stats');

const wss = new WebSocket.Server({ port: 4000 });
const antiCheat = new AntiCheat();

// Start matchmaker service
matchmaker.startMatchmaking();

// Track connected players
const connectedPlayers = new Map();

wss.on('connection', (ws, req) => {
  let playerId = null;
  let currentSession = null;
  let lastPosition = null;
  let lastUpdateTime = Date.now();
  let shotTimestamps = [];

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'PLAYER_CONNECT':
          playerId = data.playerId;
          connectedPlayers.set(playerId, { ws, playerId, sessionId: null });
          console.log(`Player ${playerId} connected`);
          
          // Check for pending match notifications
          const notification = await matchmaker.getPlayerNotification(playerId);
          if (notification && notification.type === 'MATCH_READY') {
            ws.send(JSON.stringify(notification));
          }
          break;

        case 'JOIN_MATCHMAKING':
          if (playerId) {
            await matchmaker.addPlayer(playerId, data.playerData || {});
            ws.send(JSON.stringify({ type: 'MATCHMAKING_JOINED', status: 'waiting' }));
          }
          break;

        case 'LEAVE_MATCHMAKING':
          if (playerId) {
            await matchmaker.removePlayer(playerId);
            ws.send(JSON.stringify({ type: 'MATCHMAKING_LEFT' }));
          }
          break;

        case 'JOIN_SESSION':
          if (data.sessionId) {
            currentSession = await GameSession.load(data.sessionId);
            if (currentSession && currentSession.players.includes(playerId)) {
              connectedPlayers.get(playerId).sessionId = data.sessionId;
              
              // Start session if all players joined
              if (currentSession.status === 'waiting') {
                const connectedInSession = Array.from(connectedPlayers.values())
                  .filter(p => p.sessionId === data.sessionId);
                
                if (connectedInSession.length >= currentSession.players.length) {
                  await currentSession.start();
                  broadcastToSession(data.sessionId, { 
                    type: 'MATCH_STARTED', 
                    sessionId: data.sessionId,
                    players: currentSession.players 
                  });
                }
              }
              
              ws.send(JSON.stringify({ 
                type: 'SESSION_JOINED', 
                sessionId: data.sessionId,
                gameState: currentSession.toJSON()
              }));
            }
          }
          break;

        case 'PLAYER_UPDATE':
          if (currentSession && playerId) {
            await handlePlayerUpdate(data, playerId, currentSession);
          }
          break;

        case 'PLAYER_SHOOT':
          if (currentSession && playerId) {
            await handlePlayerShoot(data, playerId, currentSession);
          }
          break;

        case 'PLAYER_KILL':
          if (currentSession && playerId) {
            await handlePlayerKill(data, playerId, currentSession);
          }
          break;

        case 'GET_STATS':
          if (playerId) {
            const stats = new Stats(playerId);
            const playerStats = await stats.get();
            ws.send(JSON.stringify({ type: 'PLAYER_STATS', stats: playerStats }));
          }
          break;

        default:
          console.log('Unknown message type:', data.type);
      }
    } catch (error) {
      console.error('Error handling message:', error);
      ws.send(JSON.stringify({ type: 'ERROR', message: error.message }));
    }
  });

  ws.on('close', () => {
    if (playerId) {
      console.log(`Player ${playerId} disconnected`);
      connectedPlayers.delete(playerId);
      matchmaker.removePlayer(playerId);
    }
  });

  // Send initial connection response
  ws.send(JSON.stringify({ type: 'CONNECTED', timestamp: Date.now() }));
});

async function handlePlayerUpdate(data, playerId, session) {
  const now = Date.now();
  const deltaTime = now - lastUpdateTime;
  
  // Anti-cheat checks
  if (lastPosition && data.position) {
    // Check for speed hacking
    const speedCheck = await antiCheat.detectSpeedHack(
      playerId, lastPosition, data.position, deltaTime
    );
    
    if (speedCheck.suspicious) {
      console.log(`[ANTICHEAT] ${speedCheck.reason}`);
      broadcastToSession(session.sessionId, {
        type: 'ANTICHEAT_ALERT',
        playerId,
        reason: speedCheck.reason,
        severity: speedCheck.severity
      });
    }
    
    // Check for teleport hacking
    const teleportCheck = await antiCheat.detectTeleportHack(
      playerId, lastPosition, data.position
    );
    
    if (teleportCheck.suspicious) {
      console.log(`[ANTICHEAT] ${teleportCheck.reason}`);
      broadcastToSession(session.sessionId, {
        type: 'ANTICHEAT_ALERT',
        playerId,
        reason: teleportCheck.reason,
        severity: teleportCheck.severity
      });
    }
  }
  
  // Update player state in session
  await session.updatePlayerState(playerId, {
    position: data.position,
    health: data.health,
    shield: data.shield,
    weapons: data.weapons
  });
  
  // Broadcast update to other players in session
  broadcastToSession(session.sessionId, {
    type: 'PLAYER_STATE_UPDATE',
    playerId,
    position: data.position,
    health: data.health,
    shield: data.shield
  }, playerId);
  
  lastPosition = data.position;
  lastUpdateTime = now;
}

async function handlePlayerShoot(data, playerId, session) {
  const now = Date.now();
  shotTimestamps.push(now);
  
  // Keep only last 100 shots for analysis
  if (shotTimestamps.length > 100) {
    shotTimestamps = shotTimestamps.slice(-100);
  }
  
  // Anti-cheat: Check for rapid fire
  const rapidFireCheck = await antiCheat.detectRapidFire(playerId, shotTimestamps);
  if (rapidFireCheck.suspicious) {
    console.log(`[ANTICHEAT] ${rapidFireCheck.reason}`);
    broadcastToSession(session.sessionId, {
      type: 'ANTICHEAT_ALERT',
      playerId,
      reason: rapidFireCheck.reason,
      severity: rapidFireCheck.severity
    });
  }
  
  // Broadcast shot to other players
  broadcastToSession(session.sessionId, {
    type: 'PLAYER_SHOT',
    playerId,
    weapon: data.weapon,
    direction: data.direction,
    timestamp: now
  }, playerId);
}

async function handlePlayerKill(data, playerId, currentSession) {
  const victimId = data.victimId;
  
  // Update session with elimination
  await currentSession.eliminatePlayer(victimId, playerId);
  
  // Update killer's stats
  const killerStats = new Stats(playerId);
  await killerStats.incrementKills();
  
  // Broadcast elimination
  broadcastToSession(currentSession.sessionId, {
    type: 'PLAYER_ELIMINATED',
    victimId,
    killerId: playerId,
    timestamp: Date.now()
  });
  
  // Check if match should end
  const alivePlayers = currentSession.getAlivePlayers();
  if (alivePlayers.length <= 1) {
    await endMatch(currentSession);
  }
}

async function endMatch(session) {
  const matchResults = await session.endMatch();
  
  // Update all players' stats
  for (const [playerId, result] of Object.entries(matchResults.playerResults)) {
    const stats = new Stats(playerId);
    await stats.update(result);
  }
  
  // Broadcast match end to all players
  broadcastToSession(session.sessionId, {
    type: 'MATCH_ENDED',
    results: matchResults,
    leaderboard: await getSessionLeaderboard(session)
  });
  
  console.log(`Match ${session.sessionId} ended. Winner: ${matchResults.winner}`);
}

async function getSessionLeaderboard(session) {
  const leaderboard = [];
  
  for (const playerId of session.players) {
    const playerState = session.playerStates[playerId];
    leaderboard.push({
      playerId,
      kills: playerState.kills,
      isAlive: playerState.isAlive,
      placement: session.calculatePlacement(playerId)
    });
  }
  
  return leaderboard.sort((a, b) => a.placement - b.placement);
}

function broadcastToSession(sessionId, message, excludePlayerId = null) {
  const sessionPlayers = Array.from(connectedPlayers.values())
    .filter(p => p.sessionId === sessionId && p.playerId !== excludePlayerId);
  
  const messageStr = JSON.stringify(message);
  sessionPlayers.forEach(player => {
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(messageStr);
    }
  });
}

// Zone progression timer
setInterval(async () => {
  const activeSessions = await GameSession.getActiveSessions();
  
  for (const sessionData of activeSessions) {
    const session = await GameSession.load(sessionData.sessionId);
    if (session && session.status === 'active') {
      const newZone = await session.progressZone();
      
      broadcastToSession(session.sessionId, {
        type: 'ZONE_UPDATE',
        currentZone: newZone,
        maxZones: session.maxZones
      });
      
      // End match after final zone
      if (newZone >= session.maxZones) {
        await endMatch(session);
      }
    }
  }
}, 60000); // Progress zone every minute

console.log('Lunor WebSocket server running on port 4000');
console.log('Matchmaker service started');

module.exports = wss;