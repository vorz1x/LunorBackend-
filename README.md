# Lunor Backend - Party, Friends, and Notification Systems

## Overview

This backend implementation provides a complete Party, Friends, and Notification system for the Lunor game backend. The system is built with Node.js, Express, MongoDB, and WebSocket for real-time features.

## Features Implemented

### 🎉 Party System
- **Create, join, leave parties** with proper validation
- **Party leader management** with invite and kick capabilities
- **Matchmaking system** that can be initiated by party leaders
- **Real-time party updates** via WebSocket
- **Party settings management** (max size, game mode, etc.)
- **Private parties** with invite codes
- **Automatic cleanup** of empty parties and expired invites

### 👥 Friends System
- **Send, accept, reject friend requests** with proper state management
- **Friends list management** with online status tracking
- **Friend search functionality** with friendship status indicators
- **Mutual friends detection** and friend suggestions
- **Real-time status updates** when friends come online/offline
- **Automatic cleanup** of expired friend requests

### 🔔 Notification System
- **Multi-type notifications** (friend requests, party invites, system messages)
- **Actionable notifications** that can be responded to directly
- **Real-time delivery** via WebSocket
- **Read/unread status management** with timestamps
- **Notification categories** with different priority levels
- **Automatic expiration** of old notifications

## API Endpoints

### Authentication (`/api/auth`)
- `POST /create` - Register new user
- `POST /login` - User login
- `POST /logout` - User logout

### Party Management (`/api/party`)
- `GET /current` - Get current user's party
- `POST /create` - Create new party
- `POST /join` - Join existing party
- `POST /leave` - Leave current party
- `POST /invite` - Invite user to party (leader only)
- `POST /kick/:userId` - Kick user from party (leader only)
- `POST /matchmaking/start` - Start matchmaking (leader only)
- `PATCH /settings` - Update party settings (leader only)

### Friends Management (`/api/friends`)
- `GET /` - Get friends list
- `GET /requests` - Get pending friend requests
- `GET /requests/sent` - Get sent friend requests
- `GET /online` - Get online friends
- `GET /search` - Search users
- `POST /request` - Send friend request
- `POST /request/respond` - Accept/decline friend request
- `DELETE /:friendId` - Remove friend

### Notifications (`/api/notifications`)
- `GET /` - Get user notifications
- `GET /summary` - Get notification summary
- `PATCH /read` - Mark notifications as read
- `PATCH /read/all` - Mark all notifications as read
- `DELETE /` - Delete notifications
- `POST /:notificationId/respond` - Respond to actionable notification

## WebSocket Events

### Client → Server
- `party_status_update` - Update party status
- `friend_status_update` - Update friend status
- `notification_read` - Mark notification as read
- `heartbeat` - Keep connection alive

### Server → Client
- `party_update` - Party information changed
- `friend_status_update` - Friend online status changed
- `new_notification` - New notification received
- `heartbeat_ack` - Heartbeat response

## Data Models

### User Model
```javascript
{
  email: String,
  username: String,
  password: String (hashed),
  discordId: String,
  vbucks: Number,
  level: Number,
  experience: Number,
  friends: [ObjectId],
  pendingFriendRequests: [{ from: ObjectId, createdAt: Date }],
  sentFriendRequests: [{ to: ObjectId, createdAt: Date }],
  currentParty: ObjectId,
  isOnline: Boolean,
  lastSeen: Date,
  profileSettings: { displayName, avatar, privacy }
}
```

### Party Model
```javascript
{
  name: String,
  leader: ObjectId,
  members: [{ user: ObjectId, joinedAt: Date, role: String }],
  maxSize: Number,
  isPrivate: Boolean,
  inviteCode: String,
  pendingInvites: [{ user: ObjectId, invitedBy: ObjectId, expiresAt: Date }],
  status: String, // 'lobby', 'matchmaking', 'in-game'
  gameMode: String,
  settings: { allowJoinInProgress, autoFill, voiceChat }
}
```

### Notification Model
```javascript
{
  recipient: ObjectId,
  sender: ObjectId,
  type: String,
  title: String,
  message: String,
  data: Object,
  isRead: Boolean,
  actionRequired: Boolean,
  actionData: Object,
  priority: String,
  expiresAt: Date
}
```

## Sample Usage

### 1. User Registration and Login
```bash
# Register user
curl -X POST http://localhost:3551/api/auth/create \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","username":"player1","password":"password123"}'

# Login
curl -X POST http://localhost:3551/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"player1","password":"password123"}'
```

### 2. Party Management
```bash
# Create party (requires auth token)
curl -X POST http://localhost:3551/api/party/create \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Epic Squad","maxSize":4,"gameMode":"squad"}'

# Invite friend to party
curl -X POST http://localhost:3551/api/party/invite \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"friend1"}'
```

### 3. Friend System
```bash
# Send friend request
curl -X POST http://localhost:3551/api/friends/request \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"newfriend"}'

# Accept friend request
curl -X POST http://localhost:3551/api/friends/request/respond \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"requesterId":"USER_ID","action":"accept"}'
```

### 4. WebSocket Connection
```javascript
const ws = new WebSocket('ws://localhost:4000?token=YOUR_JWT_TOKEN');

ws.on('message', (data) => {
  const message = JSON.parse(data);
  
  switch(message.type) {
    case 'new_notification':
      console.log('New notification:', message.data);
      break;
    case 'party_update':
      console.log('Party updated:', message.data);
      break;
    case 'friend_status_update':
      console.log('Friend status changed:', message.data);
      break;
  }
});
```

## Configuration

Update `config.js` with your database connections:

```javascript
module.exports = {
  ip: "127.0.0.1",
  port: 3551,
  mongo: { uri: "mongodb://localhost/lunor" },
  redis: { host: "127.0.0.1", port: 6379 },
  jwtSecret: "your-secret-key"
};
```

## Installation and Setup

1. Install dependencies:
```bash
npm install
```

2. Start MongoDB and Redis services

3. Run the server:
```bash
npm start
# or for development
npm run dev
```

4. WebSocket server runs on port 4000
5. HTTP API server runs on the configured port (default: 3551)

## Integration Points

The system is designed to integrate seamlessly with:
- **Game lobby systems** for party matchmaking
- **Chat systems** for friend communication
- **Achievement systems** for notifications
- **Discord bots** for external notifications
- **Admin panels** for system management

## Security Features

- **JWT authentication** with Redis session storage
- **Input validation** using Joi schemas
- **Rate limiting** on API endpoints
- **Helmet security** headers
- **CORS protection** with configurable origins
- **Password hashing** with bcrypt

## Scalability Features

- **MongoDB indexes** for efficient queries
- **Redis caching** for sessions and real-time data
- **WebSocket connection management** with user mapping
- **Automatic cleanup** of expired data
- **Pagination** for large datasets
- **Connection pooling** and proper error handling