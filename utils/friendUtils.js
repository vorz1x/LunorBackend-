const { User, Notification } = require('../models');
const { broadcastToFriends } = require('../socket');

const FriendUtils = {
  // Clean up expired friend requests
  cleanupExpiredRequests: async () => {
    try {
      const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days

      const users = await User.find({
        $or: [
          { 'pendingFriendRequests.createdAt': { $lt: cutoffDate } },
          { 'sentFriendRequests.createdAt': { $lt: cutoffDate } }
        ]
      });

      for (const user of users) {
        const originalPending = user.pendingFriendRequests.length;
        const originalSent = user.sentFriendRequests.length;

        user.pendingFriendRequests = user.pendingFriendRequests.filter(
          request => request.createdAt > cutoffDate
        );
        user.sentFriendRequests = user.sentFriendRequests.filter(
          request => request.createdAt > cutoffDate
        );

        if (user.pendingFriendRequests.length !== originalPending ||
            user.sentFriendRequests.length !== originalSent) {
          await user.save();
        }
      }
    } catch (error) {
      console.error('Cleanup expired friend requests error:', error);
    }
  },

  // Get mutual friends between two users
  getMutualFriends: async (userId1, userId2) => {
    try {
      const [user1, user2] = await Promise.all([
        User.findById(userId1).populate('friends', 'username'),
        User.findById(userId2).populate('friends', 'username')
      ]);

      if (!user1 || !user2) return [];

      const user1FriendIds = user1.friends.map(f => f._id.toString());
      const mutualFriends = user2.friends.filter(friend => 
        user1FriendIds.includes(friend._id.toString())
      );

      return mutualFriends;
    } catch (error) {
      console.error('Get mutual friends error:', error);
      return [];
    }
  },

  // Get friend suggestions based on mutual friends
  getFriendSuggestions: async (userId, limit = 10) => {
    try {
      const user = await User.findById(userId).populate('friends');
      if (!user) return [];

      const friendIds = user.friends.map(f => f._id.toString());
      const pendingRequestIds = user.pendingFriendRequests.map(r => r.from.toString());
      const sentRequestIds = user.sentFriendRequests.map(r => r.to.toString());

      // Find users who are friends with user's friends but not with the user
      const suggestions = await User.aggregate([
        {
          $match: {
            _id: { $ne: user._id },
            friends: { $in: friendIds },
            _id: { $nin: [...friendIds, ...pendingRequestIds, ...sentRequestIds] }
          }
        },
        {
          $addFields: {
            mutualFriendsCount: {
              $size: {
                $setIntersection: ['$friends', friendIds]
              }
            }
          }
        },
        {
          $sort: { mutualFriendsCount: -1, createdAt: -1 }
        },
        {
          $limit: limit
        },
        {
          $project: {
            username: 1,
            'profileSettings.displayName': 1,
            isOnline: 1,
            level: 1,
            mutualFriendsCount: 1
          }
        }
      ]);

      return suggestions;
    } catch (error) {
      console.error('Get friend suggestions error:', error);
      return [];
    }
  },

  // Check friendship status between two users
  getFriendshipStatus: async (userId1, userId2) => {
    try {
      const [user1, user2] = await Promise.all([
        User.findById(userId1),
        User.findById(userId2)
      ]);

      if (!user1 || !user2) return 'unknown';

      // Check if they are friends
      if (user1.friends.includes(userId2)) {
        return 'friends';
      }

      // Check if user1 sent request to user2
      const sentRequest = user1.sentFriendRequests.find(
        request => request.to.toString() === userId2.toString()
      );
      if (sentRequest) {
        return 'request_sent';
      }

      // Check if user2 sent request to user1
      const receivedRequest = user1.pendingFriendRequests.find(
        request => request.from.toString() === userId2.toString()
      );
      if (receivedRequest) {
        return 'request_received';
      }

      return 'none';
    } catch (error) {
      console.error('Get friendship status error:', error);
      return 'unknown';
    }
  },

  // Batch add friends (for admin purposes)
  batchAddFriends: async (userIds) => {
    try {
      const users = await User.find({ _id: { $in: userIds } });
      
      for (let i = 0; i < users.length; i++) {
        for (let j = i + 1; j < users.length; j++) {
          const user1 = users[i];
          const user2 = users[j];

          // Add each other as friends if not already
          if (!user1.friends.includes(user2._id)) {
            user1.friends.push(user2._id);
          }
          if (!user2.friends.includes(user1._id)) {
            user2.friends.push(user1._id);
          }
        }
      }

      // Save all users
      await Promise.all(users.map(user => user.save()));
      
      return { success: true, friendshipsCreated: users.length * (users.length - 1) / 2 };
    } catch (error) {
      console.error('Batch add friends error:', error);
      return { success: false, error: error.message };
    }
  },

  // Get friendship statistics for a user
  getFriendshipStats: async (userId) => {
    try {
      const user = await User.findById(userId)
        .populate('friends', 'isOnline level')
        .populate('pendingFriendRequests.from', 'username')
        .populate('sentFriendRequests.to', 'username');

      if (!user) return null;

      const onlineFriends = user.friends.filter(friend => friend.isOnline).length;
      const averageFriendLevel = user.friends.length > 0 ? 
        user.friends.reduce((sum, friend) => sum + friend.level, 0) / user.friends.length : 0;

      return {
        totalFriends: user.friends.length,
        onlineFriends,
        pendingRequests: user.pendingFriendRequests.length,
        sentRequests: user.sentFriendRequests.length,
        averageFriendLevel: Math.round(averageFriendLevel * 100) / 100
      };
    } catch (error) {
      console.error('Get friendship stats error:', error);
      return null;
    }
  }
};

module.exports = FriendUtils;