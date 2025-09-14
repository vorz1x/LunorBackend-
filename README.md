# LunorBackend - Enhanced Game Server

A comprehensive backend system for Fortnite/Lunor with integrated matchmaking, anti-cheat detection, and player statistics tracking.

## 🚀 Features

- **Game Session Management**: Complete lifecycle management for multiplayer matches
- **Smart Matchmaking**: Automatic player queuing and skill-based matching 
- **Real-time Anti-Cheat**: Detection for speed hacks, teleportation, rapid fire, and more
- **Player Statistics**: Comprehensive tracking of wins, kills, deaths, and performance metrics
- **WebSocket Communication**: Real-time game state synchronization
- **Redis Integration**: Persistent data storage with mock fallback for development

## 🏗️ Architecture

```
socket.js         - Main WebSocket server with all integrations
matchmaker.js     - Player queuing and match formation system
session.js        - Game session lifecycle management
anticheat.js      - Real-time cheat detection engine  
models/stats.js   - Player statistics tracking
adapters/redis.js - Data persistence layer with mock fallback
```

## 🚦 Quick Start

1. **Install Dependencies** (optional - will use mocks if not available):
   ```bash
   npm install ws redis
   ```

2. **Start the Server**:
   ```bash
   node socket.js
   ```
   
   Server runs on `ws://localhost:4000`

3. **Check Available Features**:
   ```bash
   cat FEATURE_CHECKLIST.md
   ```

## 📡 WebSocket API

### Connection Messages

- `PLAYER_CONNECT` - Connect to the server
- `JOIN_MATCHMAKING` - Enter matchmaking queue
- `LEAVE_MATCHMAKING` - Exit matchmaking queue
- `JOIN_SESSION` - Join a specific game session

### Game Messages

- `PLAYER_UPDATE` - Send position and state updates
- `PLAYER_SHOOT` - Fire weapon (triggers anti-cheat checks)
- `PLAYER_KILL` - Eliminate another player
- `GET_STATS` - Request player statistics

### Server Responses

- `CONNECTED` - Connection established
- `MATCHMAKING_JOINED` - Added to queue
- `MATCH_READY` - Match found, session created
- `SESSION_JOINED` - Successfully joined game session
- `MATCH_STARTED` - Game session has begun
- `PLAYER_STATE_UPDATE` - Other player position updates
- `ANTICHEAT_ALERT` - Suspicious activity detected
- `MATCH_ENDED` - Game finished with results

## 🛡️ Anti-Cheat Features

The system automatically monitors for:

- **Speed Hacking**: Movement faster than physically possible
- **Teleportation**: Instantaneous position changes
- **Rapid Fire**: Shooting faster than weapon capabilities
- **Aimbot**: Abnormally high accuracy at long distances
- **Wall Hacking**: Shooting through obstacles

Violations are logged and players are automatically flagged for review after multiple infractions.

## 📊 Statistics Tracking

Player stats are automatically updated at match end:

- Matches played and wins
- Kills and deaths with K/D ratio
- Win rate percentage
- Last played timestamp
- Leaderboard rankings

## 🎯 Matchmaking

The matchmaker groups players by:

- Game mode (solo, duo, squad)
- Region for optimal latency
- Skill level for balanced matches
- Queue time for fair matching

Matches are automatically created when sufficient players are available.

## 🔧 Configuration

Edit `config.js` to modify:

- Server ports and SSL settings
- Redis connection parameters
- Discord bot integration
- Anti-cheat thresholds
- File paths for game data

## 📋 Integration

The backend integrates three key systems as requested:

1. **Matchmaker → Sessions**: When players are matched, game sessions are automatically created
2. **Game Updates → Anti-Cheat**: All player movements and actions trigger real-time cheat detection
3. **Match End → Statistics**: Player stats are automatically updated when matches conclude

## 🎮 Development

The system includes mock implementations for dependencies, allowing development without external services:

- Mock Redis client when Redis is unavailable
- Graceful handling of missing WebSocket dependencies
- Comprehensive logging for debugging

## 📈 Monitoring

- Console logging for all major events
- Anti-cheat violation tracking
- Match formation and completion metrics
- Player connection and queue statistics

---

For a complete list of features and development status, see [FEATURE_CHECKLIST.md](FEATURE_CHECKLIST.md).