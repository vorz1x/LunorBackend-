const WebSocket = require('ws');
const jwt = require('./utils/jwt');
const redis = require('./adapters/redis');
const { User, Party, Notification } = require('./models');

const wss = new WebSocket.Server({ port: 4000 });

// Store active connections
const connections = new Map();

wss.on('connection', async (ws, req) => {
  console.log('New WebSocket connection');
  
  // Authentication
  const token = new URL(req.url, 'ws://localhost').searchParams.get('token');
  let user = null;
  
  if (token) {
    try {
      const decoded = jwt.verify(token);
      const sessionUserId = await redis.get(`session:${token}`);
      
      if (sessionUserId && sessionUserId === decoded.userId) {
        user = await User.findById(decoded.userId);
        if (user) {
          connections.set(user._id.toString(), ws);
          ws.userId = user._id.toString();
          console.log(`User ${user.username} connected via WebSocket`);
          
          // Update user online status
          user.isOnline = true;
          await user.save();
        }
      }
    } catch (error) {
      console.error('WebSocket auth error:', error);
    }
  }

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'party_status_update':
          if (user && user.currentParty) {
            // Broadcast party status to all party members
            const party = await Party.findById(user.currentParty)
              .populate('members.user');
            
            if (party) {
              party.members.forEach(member => {
                const memberWs = connections.get(member.user._id.toString());
                if (memberWs && memberWs !== ws) {
                  memberWs.send(JSON.stringify({
                    type: 'party_update',
                    data: { status: data.status, updatedBy: user.username }
                  }));
                }
              });
            }
          }
          break;
          
        case 'friend_status_update':
          if (user) {
            // Notify friends of status change
            const userWithFriends = await User.findById(user._id).populate('friends');
            userWithFriends.friends.forEach(friend => {
              const friendWs = connections.get(friend._id.toString());
              if (friendWs) {
                friendWs.send(JSON.stringify({
                  type: 'friend_status_update',
                  data: { 
                    userId: user._id,
                    username: user.username,
                    isOnline: data.isOnline || true
                  }
                }));
              }
            });
          }
          break;
          
        case 'notification_read':
          // Handle real-time notification read status
          if (user && data.notificationId) {
            await Notification.findOneAndUpdate(
              { _id: data.notificationId, recipient: user._id },
              { isRead: true, readAt: new Date() }
            );
          }
          break;
          
        case 'heartbeat':
          // Respond to client heartbeat
          ws.send(JSON.stringify({ type: 'heartbeat_ack' }));
          break;
          
        default:
          console.log('Unknown WebSocket message type:', data.type);
      }
    } catch (error) {
      console.error('WebSocket message error:', error);
    }
  });
  
  ws.on('close', async () => {
    if (user) {
      console.log(`User ${user.username} disconnected`);
      connections.delete(user._id.toString());
      
      // Update user online status
      user.isOnline = false;
      user.lastSeen = new Date();
      await user.save();
      
      // Notify friends of offline status
      const userWithFriends = await User.findById(user._id).populate('friends');
      userWithFriends.friends.forEach(friend => {
        const friendWs = connections.get(friend._id.toString());
        if (friendWs) {
          friendWs.send(JSON.stringify({
            type: 'friend_status_update',
            data: { 
              userId: user._id,
              username: user.username,
              isOnline: false,
              lastSeen: user.lastSeen
            }
          }));
        }
      });
    }
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Helper function to send notification to user
const sendNotificationToUser = (userId, notification) => {
  const ws = connections.get(userId.toString());
  if (ws) {
    ws.send(JSON.stringify({
      type: 'new_notification',
      data: notification
    }));
  }
};

// Helper function to broadcast to party members
const broadcastToParty = async (partyId, message, excludeUserId = null) => {
  try {
    const party = await Party.findById(partyId).populate('members.user');
    if (party) {
      party.members.forEach(member => {
        if (excludeUserId && member.user._id.toString() === excludeUserId.toString()) {
          return;
        }
        
        const memberWs = connections.get(member.user._id.toString());
        if (memberWs) {
          memberWs.send(JSON.stringify(message));
        }
      });
    }
  } catch (error) {
    console.error('Broadcast to party error:', error);
  }
};

// Helper function to broadcast to friends
const broadcastToFriends = async (userId, message) => {
  try {
    const user = await User.findById(userId).populate('friends');
    if (user) {
      user.friends.forEach(friend => {
        const friendWs = connections.get(friend._id.toString());
        if (friendWs) {
          friendWs.send(JSON.stringify(message));
        }
      });
    }
  } catch (error) {
    console.error('Broadcast to friends error:', error);
  }
};

module.exports = {
  wss,
  sendNotificationToUser,
  broadcastToParty,
  broadcastToFriends
};