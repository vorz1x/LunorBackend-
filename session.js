const redis = require('./adapters/redis');

// Simple UUID v4 implementation to avoid external dependency
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

class GameSession {
  constructor(sessionId, players) {
    this.sessionId = sessionId || uuidv4();
    this.players = players || [];
    this.status = 'waiting'; // waiting, active, finished
    this.createdAt = new Date().toISOString();
    this.startedAt = null;
    this.endedAt = null;
    this.currentZone = 1;
    this.maxZones = 12;
    this.playerStates = {};
    
    // Initialize player states
    this.players.forEach(playerId => {
      this.playerStates[playerId] = {
        isAlive: true,
        kills: 0,
        position: { x: 0, y: 0, z: 0 },
        lastUpdate: new Date().toISOString(),
        weapons: [],
        health: 100,
        shield: 0
      };
    });
  }

  async save() {
    const key = `session:${this.sessionId}`;
    await redis.set(key, JSON.stringify(this.toJSON()), { ex: 3600 }); // 1 hour expiry
    return this;
  }

  static async load(sessionId) {
    const key = `session:${sessionId}`;
    const data = await redis.get(key);
    if (!data) return null;
    
    const sessionData = JSON.parse(data);
    const session = new GameSession();
    Object.assign(session, sessionData);
    return session;
  }

  async start() {
    this.status = 'active';
    this.startedAt = new Date().toISOString();
    await this.save();
    return this;
  }

  async updatePlayerState(playerId, updates) {
    if (!this.playerStates[playerId]) {
      throw new Error(`Player ${playerId} not in session`);
    }
    
    Object.assign(this.playerStates[playerId], updates);
    this.playerStates[playerId].lastUpdate = new Date().toISOString();
    await this.save();
    return this.playerStates[playerId];
  }

  async eliminatePlayer(playerId, killerId = null) {
    if (this.playerStates[playerId]) {
      this.playerStates[playerId].isAlive = false;
      this.playerStates[playerId].eliminatedAt = new Date().toISOString();
      
      if (killerId && this.playerStates[killerId]) {
        this.playerStates[killerId].kills += 1;
      }
      
      await this.save();
    }
    
    // Check if match should end
    const alivePlayers = this.getAlivePlayers();
    if (alivePlayers.length <= 1) {
      await this.endMatch();
    }
  }

  getAlivePlayers() {
    return this.players.filter(playerId => 
      this.playerStates[playerId] && this.playerStates[playerId].isAlive
    );
  }

  async progressZone() {
    if (this.currentZone < this.maxZones) {
      this.currentZone += 1;
      await this.save();
    }
    
    // End match after final zone
    if (this.currentZone >= this.maxZones) {
      await this.endMatch();
    }
    
    return this.currentZone;
  }

  async endMatch() {
    this.status = 'finished';
    this.endedAt = new Date().toISOString();
    
    // Determine winner
    const alivePlayers = this.getAlivePlayers();
    const winner = alivePlayers.length > 0 ? alivePlayers[0] : null;
    
    const matchResults = {
      sessionId: this.sessionId,
      winner,
      duration: new Date(this.endedAt) - new Date(this.startedAt),
      playerResults: {}
    };
    
    // Create results for each player
    this.players.forEach(playerId => {
      const playerState = this.playerStates[playerId];
      matchResults.playerResults[playerId] = {
        won: playerId === winner,
        kills: playerState.kills,
        died: !playerState.isAlive,
        placement: this.calculatePlacement(playerId)
      };
    });
    
    await this.save();
    return matchResults;
  }

  calculatePlacement(playerId) {
    const playerState = this.playerStates[playerId];
    if (playerState.isAlive) return 1;
    
    // For eliminated players, calculate based on elimination order
    // This is simplified - in a real game you'd track elimination timestamps
    const eliminatedPlayers = this.players.filter(id => 
      !this.playerStates[id].isAlive
    );
    return eliminatedPlayers.length + 1;
  }

  toJSON() {
    return {
      sessionId: this.sessionId,
      players: this.players,
      status: this.status,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      currentZone: this.currentZone,
      maxZones: this.maxZones,
      playerStates: this.playerStates
    };
  }

  static async getActiveSessions() {
    const keys = await redis.keys('session:*');
    const sessions = [];
    
    for (const key of keys) {
      const sessionData = JSON.parse(await redis.get(key));
      if (sessionData.status === 'active') {
        sessions.push(sessionData);
      }
    }
    
    return sessions;
  }

  static async createSession(players) {
    const session = new GameSession(null, players);
    await session.save();
    return session;
  }
}

module.exports = { GameSession };