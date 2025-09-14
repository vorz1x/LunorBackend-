const redis = require('./adapters/redis');
const { GameSession } = require('./session');

class Matchmaker {
  constructor() {
    this.queue = [];
    this.maxPlayersPerMatch = 10; // Configurable match size
    this.matchmakingInterval = 5000; // 5 seconds
    this.isRunning = false;
  }

  async addPlayer(playerId, playerData = {}) {
    // Check if player is already in queue
    const existingIndex = this.queue.findIndex(p => p.playerId === playerId);
    if (existingIndex !== -1) {
      console.log(`Player ${playerId} already in matchmaking queue`);
      return false;
    }

    // Add player to queue
    const queueEntry = {
      playerId,
      joinedAt: new Date().toISOString(),
      skill: playerData.skill || 1000, // Default skill rating
      region: playerData.region || 'default',
      gameMode: playerData.gameMode || 'solo'
    };

    this.queue.push(queueEntry);
    
    // Store in Redis for persistence
    await redis.set(`queue:${playerId}`, JSON.stringify(queueEntry), { ex: 300 }); // 5 min expiry
    
    console.log(`Player ${playerId} added to matchmaking queue (${this.queue.length} players waiting)`);
    
    // Try to form a match immediately
    await this.tryFormMatch();
    
    return true;
  }

  async removePlayer(playerId) {
    const index = this.queue.findIndex(p => p.playerId === playerId);
    if (index !== -1) {
      this.queue.splice(index, 1);
      await redis.del(`queue:${playerId}`);
      console.log(`Player ${playerId} removed from matchmaking queue`);
      return true;
    }
    return false;
  }

  async tryFormMatch() {
    if (this.queue.length < 2) {
      return null; // Need at least 2 players for a match
    }

    // Group players by game mode and region
    const groups = this.groupPlayersByMode();
    
    for (const [key, players] of Object.entries(groups)) {
      if (players.length >= 2) {
        // Take appropriate number of players for this match
        const playersForMatch = players.slice(0, Math.min(players.length, this.maxPlayersPerMatch));
        
        if (playersForMatch.length >= 2) {
          const match = await this.createMatch(playersForMatch);
          
          // Remove matched players from queue
          for (const player of playersForMatch) {
            await this.removePlayer(player.playerId);
          }
          
          console.log(`Match created: ${match.sessionId} with ${playersForMatch.length} players`);
          return match;
        }
      }
    }

    return null;
  }

  groupPlayersByMode() {
    const groups = {};
    
    for (const player of this.queue) {
      const key = `${player.gameMode}_${player.region}`;
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(player);
    }

    // Sort each group by skill for better matchmaking
    for (const key of Object.keys(groups)) {
      groups[key].sort((a, b) => Math.abs(a.skill - 1000) - Math.abs(b.skill - 1000));
    }

    return groups;
  }

  async createMatch(players) {
    const playerIds = players.map(p => p.playerId);
    const session = await GameSession.createSession(playerIds);
    
    // Store match metadata
    const matchData = {
      sessionId: session.sessionId,
      players: players,
      createdAt: new Date().toISOString(),
      gameMode: players[0].gameMode,
      region: players[0].region
    };
    
    await redis.set(`match:${session.sessionId}`, JSON.stringify(matchData), { ex: 3600 });
    
    // Notify players that match is ready
    for (const player of players) {
      await this.notifyPlayerMatchReady(player.playerId, session.sessionId);
    }
    
    return session;
  }

  async notifyPlayerMatchReady(playerId, sessionId) {
    // Store notification for player to pick up
    const notification = {
      type: 'MATCH_READY',
      sessionId,
      timestamp: new Date().toISOString()
    };
    
    await redis.set(`notification:${playerId}`, JSON.stringify(notification), { ex: 60 });
    console.log(`Match ready notification sent to player ${playerId} for session ${sessionId}`);
  }

  async getQueueStatus() {
    return {
      totalPlayers: this.queue.length,
      playersByMode: this.groupPlayersByMode(),
      estimatedWaitTime: this.estimateWaitTime()
    };
  }

  estimateWaitTime() {
    if (this.queue.length === 0) return 0;
    if (this.queue.length >= this.maxPlayersPerMatch) return 0;
    
    // Simple estimation based on queue size
    const playersNeeded = this.maxPlayersPerMatch - this.queue.length;
    return playersNeeded * 30; // Assume 30 seconds per additional player
  }

  async startMatchmaking() {
    if (this.isRunning) {
      console.log('Matchmaker already running');
      return;
    }

    this.isRunning = true;
    console.log('Starting matchmaker service...');
    
    // Restore queue from Redis
    await this.restoreQueueFromRedis();
    
    // Start matchmaking loop
    this.matchmakingLoop();
  }

  async stopMatchmaking() {
    this.isRunning = false;
    console.log('Matchmaker stopped');
  }

  async matchmakingLoop() {
    while (this.isRunning) {
      try {
        await this.tryFormMatch();
        await this.cleanupExpiredPlayers();
        
        // Wait before next iteration
        await new Promise(resolve => setTimeout(resolve, this.matchmakingInterval));
      } catch (error) {
        console.error('Error in matchmaking loop:', error);
        await new Promise(resolve => setTimeout(resolve, this.matchmakingInterval));
      }
    }
  }

  async cleanupExpiredPlayers() {
    const now = new Date();
    const expiredPlayers = this.queue.filter(player => {
      const joinedAt = new Date(player.joinedAt);
      return (now - joinedAt) > 300000; // 5 minutes
    });

    for (const player of expiredPlayers) {
      await this.removePlayer(player.playerId);
      console.log(`Removed expired player ${player.playerId} from queue`);
    }
  }

  async restoreQueueFromRedis() {
    const keys = await redis.keys('queue:*');
    this.queue = [];
    
    for (const key of keys) {
      const playerData = await redis.get(key);
      if (playerData) {
        const player = JSON.parse(playerData);
        this.queue.push(player);
      }
    }
    
    console.log(`Restored ${this.queue.length} players from Redis queue`);
  }

  async getPlayerNotification(playerId) {
    const notification = await redis.get(`notification:${playerId}`);
    if (notification) {
      await redis.del(`notification:${playerId}`); // Remove after reading
      return JSON.parse(notification);
    }
    return null;
  }
}

// Create singleton instance
const matchmaker = new Matchmaker();

module.exports = { Matchmaker, matchmaker };