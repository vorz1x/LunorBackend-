const redis = require('../adapters/redis');

class Stats {
  constructor(userId) {
    this.userId = userId;
    this.key = `stats:${userId}`;
  }

  async get() {
    const stats = await redis.get(this.key);
    return stats ? JSON.parse(stats) : {
      matchesPlayed: 0,
      wins: 0,
      kills: 0,
      deaths: 0,
      lastPlayed: null,
      winRate: 0,
      kdRatio: 0
    };
  }

  async update(matchResult) {
    const currentStats = await this.get();
    
    // Update basic stats
    currentStats.matchesPlayed += 1;
    currentStats.lastPlayed = new Date().toISOString();
    
    if (matchResult.won) {
      currentStats.wins += 1;
    }
    
    if (matchResult.kills) {
      currentStats.kills += matchResult.kills;
    }
    
    if (matchResult.died) {
      currentStats.deaths += 1;
    }
    
    // Calculate derived stats
    currentStats.winRate = currentStats.matchesPlayed > 0 
      ? (currentStats.wins / currentStats.matchesPlayed * 100).toFixed(2)
      : 0;
    
    currentStats.kdRatio = currentStats.deaths > 0 
      ? (currentStats.kills / currentStats.deaths).toFixed(2)
      : currentStats.kills;

    await redis.set(this.key, JSON.stringify(currentStats));
    return currentStats;
  }

  async incrementKills() {
    const currentStats = await this.get();
    currentStats.kills += 1;
    currentStats.kdRatio = currentStats.deaths > 0 
      ? (currentStats.kills / currentStats.deaths).toFixed(2)
      : currentStats.kills;
    await redis.set(this.key, JSON.stringify(currentStats));
    return currentStats;
  }

  static async getLeaderboard(limit = 10) {
    // This would be more efficient with a proper database
    // For now, we'll implement a simple Redis-based approach
    const keys = await redis.keys('stats:*');
    const leaderboard = [];
    
    for (const key of keys) {
      const stats = JSON.parse(await redis.get(key));
      const userId = key.replace('stats:', '');
      leaderboard.push({ userId, ...stats });
    }
    
    return leaderboard
      .sort((a, b) => b.wins - a.wins)
      .slice(0, limit);
  }
}

module.exports = { Stats };