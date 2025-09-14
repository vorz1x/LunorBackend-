const redis = require('./adapters/redis');

class AntiCheat {
  constructor() {
    this.suspiciousActivities = new Map();
    this.maxSpeedThreshold = 20; // units per second
    this.teleportThreshold = 100; // max distance in single update
    this.rapidFireThreshold = 100; // max shots per second
  }

  async detectSpeedHack(playerId, oldPosition, newPosition, deltaTime) {
    if (!oldPosition || !newPosition || deltaTime <= 0) {
      return { suspicious: false, reason: 'Invalid position data' };
    }

    const distance = this.calculateDistance(oldPosition, newPosition);
    const speed = distance / (deltaTime / 1000); // units per second

    if (speed > this.maxSpeedThreshold) {
      await this.logSuspiciousActivity(playerId, 'SPEED_HACK', {
        speed,
        threshold: this.maxSpeedThreshold,
        distance,
        deltaTime,
        oldPosition,
        newPosition
      });

      return {
        suspicious: true,
        reason: `Excessive speed detected: ${speed.toFixed(2)} units/sec (threshold: ${this.maxSpeedThreshold})`,
        severity: 'HIGH'
      };
    }

    return { suspicious: false };
  }

  async detectTeleportHack(playerId, oldPosition, newPosition) {
    if (!oldPosition || !newPosition) {
      return { suspicious: false, reason: 'Invalid position data' };
    }

    const distance = this.calculateDistance(oldPosition, newPosition);

    if (distance > this.teleportThreshold) {
      await this.logSuspiciousActivity(playerId, 'TELEPORT_HACK', {
        distance,
        threshold: this.teleportThreshold,
        oldPosition,
        newPosition
      });

      return {
        suspicious: true,
        reason: `Teleportation detected: ${distance.toFixed(2)} units (threshold: ${this.teleportThreshold})`,
        severity: 'CRITICAL'
      };
    }

    return { suspicious: false };
  }

  async detectRapidFire(playerId, shotTimestamps) {
    if (!shotTimestamps || shotTimestamps.length < 2) {
      return { suspicious: false };
    }

    // Check last second of shots
    const now = Date.now();
    const recentShots = shotTimestamps.filter(timestamp => 
      now - timestamp <= 1000
    );

    if (recentShots.length > this.rapidFireThreshold) {
      await this.logSuspiciousActivity(playerId, 'RAPID_FIRE', {
        shotsPerSecond: recentShots.length,
        threshold: this.rapidFireThreshold,
        timestamps: recentShots
      });

      return {
        suspicious: true,
        reason: `Rapid fire detected: ${recentShots.length} shots/sec (threshold: ${this.rapidFireThreshold})`,
        severity: 'HIGH'
      };
    }

    return { suspicious: false };
  }

  async detectWallHack(playerId, playerPosition, targetPosition, hasLineOfSight) {
    // Simplified wall hack detection - in reality this would need map geometry
    if (!hasLineOfSight) {
      const distance = this.calculateDistance(playerPosition, targetPosition);
      
      // If player is shooting through walls at long distances
      if (distance > 50) {
        await this.logSuspiciousActivity(playerId, 'POSSIBLE_WALLHACK', {
          playerPosition,
          targetPosition,
          distance,
          hasLineOfSight: false
        });

        return {
          suspicious: true,
          reason: `Possible wall hack: shooting through obstacles at ${distance.toFixed(2)} units`,
          severity: 'MEDIUM'
        };
      }
    }

    return { suspicious: false };
  }

  async detectAimbot(playerId, aimAccuracy, recentHits) {
    // Simple aimbot detection based on abnormal accuracy
    if (recentHits.length < 10) return { suspicious: false };

    const hitRate = recentHits.filter(hit => hit.isHeadshot).length / recentHits.length;
    const averageDistance = recentHits.reduce((sum, hit) => sum + hit.distance, 0) / recentHits.length;

    // Suspiciously high headshot rate at long distances
    if (hitRate > 0.8 && averageDistance > 100) {
      await this.logSuspiciousActivity(playerId, 'POSSIBLE_AIMBOT', {
        headshotRate: hitRate,
        averageDistance,
        totalHits: recentHits.length
      });

      return {
        suspicious: true,
        reason: `Possible aimbot: ${(hitRate * 100).toFixed(1)}% headshot rate at ${averageDistance.toFixed(1)} units`,
        severity: 'HIGH'
      };
    }

    return { suspicious: false };
  }

  async logSuspiciousActivity(playerId, activityType, details) {
    const activity = {
      playerId,
      type: activityType,
      timestamp: new Date().toISOString(),
      details,
      reported: false
    };

    // Store in Redis with expiry
    const key = `anticheat:${playerId}:${Date.now()}`;
    await redis.set(key, JSON.stringify(activity), { ex: 86400 }); // 24 hours

    // Track player's total suspicious activities
    const playerKey = `anticheat:player:${playerId}`;
    const playerActivities = await redis.get(playerKey);
    const activities = playerActivities ? JSON.parse(playerActivities) : [];
    activities.push(activity);
    
    // Keep only last 100 activities per player
    if (activities.length > 100) {
      activities.splice(0, activities.length - 100);
    }
    
    await redis.set(playerKey, JSON.stringify(activities), { ex: 86400 });

    // Auto-flag if too many suspicious activities
    if (activities.filter(a => a.timestamp > new Date(Date.now() - 3600000).toISOString()).length >= 5) {
      await this.flagPlayerForReview(playerId, activities);
    }

    console.log(`[ANTICHEAT] ${activityType} detected for player ${playerId}:`, details);
    return activity;
  }

  async flagPlayerForReview(playerId, activities) {
    const flagKey = `anticheat:flagged:${playerId}`;
    const flagData = {
      playerId,
      flaggedAt: new Date().toISOString(),
      reason: 'Multiple suspicious activities',
      activities: activities.slice(-10), // Last 10 activities
      status: 'pending_review'
    };

    await redis.set(flagKey, JSON.stringify(flagData), { ex: 604800 }); // 1 week
    console.log(`[ANTICHEAT] Player ${playerId} flagged for review`);
    return flagData;
  }

  calculateDistance(pos1, pos2) {
    const dx = pos2.x - pos1.x;
    const dy = pos2.y - pos1.y;
    const dz = pos2.z - pos1.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  async getPlayerSuspiciousActivities(playerId) {
    const playerKey = `anticheat:player:${playerId}`;
    const activities = await redis.get(playerKey);
    return activities ? JSON.parse(activities) : [];
  }

  async getFlaggedPlayers() {
    const keys = await redis.keys('anticheat:flagged:*');
    const flaggedPlayers = [];
    
    for (const key of keys) {
      const flagData = JSON.parse(await redis.get(key));
      flaggedPlayers.push(flagData);
    }
    
    return flaggedPlayers;
  }

  async clearPlayerFlags(playerId) {
    const flagKey = `anticheat:flagged:${playerId}`;
    const playerKey = `anticheat:player:${playerId}`;
    
    await redis.del(flagKey);
    await redis.del(playerKey);
    
    // Clear individual activity logs
    const activityKeys = await redis.keys(`anticheat:${playerId}:*`);
    for (const key of activityKeys) {
      await redis.del(key);
    }
    
    console.log(`[ANTICHEAT] Cleared flags for player ${playerId}`);
  }
}

module.exports = { AntiCheat };