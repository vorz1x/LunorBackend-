const router = require('express').Router();
const { User } = require('../models/user');
const { Notification } = require('../models/notification');
const { authenticate } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');

// Get user's friends list
router.get('/', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('friends', 'username isOnline lastSeen profileSettings.displayName')
      .select('friends');

    res.json({ friends: user.friends });
  } catch (error) {
    console.error('Get friends error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get pending friend requests (received)
router.get('/requests', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('pendingFriendRequests.from', 'username profileSettings.displayName')
      .select('pendingFriendRequests');

    res.json({ requests: user.pendingFriendRequests });
  } catch (error) {
    console.error('Get friend requests error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get sent friend requests
router.get('/requests/sent', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('sentFriendRequests.to', 'username profileSettings.displayName')
      .select('sentFriendRequests');

    res.json({ sentRequests: user.sentFriendRequests });
  } catch (error) {
    console.error('Get sent friend requests error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Send friend request
router.post('/request', authenticate, validate(schemas.sendFriendRequest), async (req, res) => {
  try {
    const { username } = req.body;

    // Find target user
    const targetUser = await User.findOne({ username });
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if trying to send request to self
    if (targetUser._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ error: 'Cannot send friend request to yourself' });
    }

    // Check if already friends
    if (req.user.friends.includes(targetUser._id)) {
      return res.status(400).json({ error: 'You are already friends with this user' });
    }

    // Check if request already sent
    const existingRequest = req.user.sentFriendRequests.find(
      request => request.to.toString() === targetUser._id.toString()
    );
    if (existingRequest) {
      return res.status(400).json({ error: 'Friend request already sent' });
    }

    // Check if target user already sent request to current user
    const incomingRequest = req.user.pendingFriendRequests.find(
      request => request.from.toString() === targetUser._id.toString()
    );
    if (incomingRequest) {
      return res.status(400).json({ error: 'This user has already sent you a friend request' });
    }

    // Add to sender's sent requests
    req.user.sentFriendRequests.push({
      to: targetUser._id
    });
    await req.user.save();

    // Add to target's pending requests
    targetUser.pendingFriendRequests.push({
      from: req.user._id
    });
    await targetUser.save();

    // Create notification for target user
    await Notification.createFriendRequest(
      targetUser._id,
      req.user._id,
      req.user.username
    );

    res.json({
      ok: true,
      message: 'Friend request sent successfully'
    });
  } catch (error) {
    console.error('Send friend request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Respond to friend request (accept/decline)
router.post('/request/respond', authenticate, validate(schemas.respondToFriendRequest), async (req, res) => {
  try {
    const { requesterId, action } = req.body;

    // Find the pending request
    const requestIndex = req.user.pendingFriendRequests.findIndex(
      request => request.from.toString() === requesterId
    );

    if (requestIndex === -1) {
      return res.status(404).json({ error: 'Friend request not found' });
    }

    // Get requester user
    const requester = await User.findById(requesterId);
    if (!requester) {
      return res.status(404).json({ error: 'Requester not found' });
    }

    // Remove from pending requests
    req.user.pendingFriendRequests.splice(requestIndex, 1);

    // Remove from requester's sent requests
    const sentRequestIndex = requester.sentFriendRequests.findIndex(
      request => request.to.toString() === req.user._id.toString()
    );
    if (sentRequestIndex !== -1) {
      requester.sentFriendRequests.splice(sentRequestIndex, 1);
    }

    if (action === 'accept') {
      // Add to both users' friends lists
      req.user.friends.push(requesterId);
      requester.friends.push(req.user._id);

      // Create notification for requester
      await Notification.create({
        recipient: requesterId,
        sender: req.user._id,
        type: 'friend_request_accepted',
        title: 'Friend Request Accepted',
        message: `${req.user.username} accepted your friend request`
      });
    } else {
      // Create notification for requester
      await Notification.create({
        recipient: requesterId,
        sender: req.user._id,
        type: 'friend_request_declined',
        title: 'Friend Request Declined',
        message: `${req.user.username} declined your friend request`
      });
    }

    await req.user.save();
    await requester.save();

    res.json({
      ok: true,
      message: `Friend request ${action}ed successfully`
    });
  } catch (error) {
    console.error('Respond to friend request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Remove friend
router.delete('/:friendId', authenticate, async (req, res) => {
  try {
    const { friendId } = req.params;

    // Check if they are friends
    if (!req.user.friends.includes(friendId)) {
      return res.status(400).json({ error: 'You are not friends with this user' });
    }

    // Remove from current user's friends list
    req.user.friends = req.user.friends.filter(
      friend => friend.toString() !== friendId
    );

    // Remove from friend's friends list
    const friend = await User.findById(friendId);
    if (friend) {
      friend.friends = friend.friends.filter(
        friendOfFriend => friendOfFriend.toString() !== req.user._id.toString()
      );
      await friend.save();
    }

    await req.user.save();

    res.json({
      ok: true,
      message: 'Friend removed successfully'
    });
  } catch (error) {
    console.error('Remove friend error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Search users for friends
router.get('/search', authenticate, async (req, res) => {
  try {
    const { query, limit = 10 } = req.query;

    if (!query || query.trim().length < 2) {
      return res.status(400).json({ error: 'Query must be at least 2 characters' });
    }

    const users = await User.find({
      $and: [
        { _id: { $ne: req.user._id } }, // Exclude current user
        {
          $or: [
            { username: { $regex: query, $options: 'i' } },
            { 'profileSettings.displayName': { $regex: query, $options: 'i' } }
          ]
        }
      ]
    })
    .select('username profileSettings.displayName isOnline')
    .limit(parseInt(limit));

    // Add friendship status to each user
    const usersWithStatus = users.map(user => {
      const isFriend = req.user.friends.includes(user._id);
      const requestSent = req.user.sentFriendRequests.some(
        request => request.to.toString() === user._id.toString()
      );
      const requestReceived = req.user.pendingFriendRequests.some(
        request => request.from.toString() === user._id.toString()
      );

      return {
        ...user.toObject(),
        friendshipStatus: isFriend ? 'friends' : 
                         requestSent ? 'request_sent' :
                         requestReceived ? 'request_received' : 'none'
      };
    });

    res.json({ users: usersWithStatus });
  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get online friends
router.get('/online', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate({
        path: 'friends',
        match: { isOnline: true },
        select: 'username isOnline profileSettings.displayName currentParty'
      })
      .select('friends');

    res.json({ onlineFriends: user.friends });
  } catch (error) {
    console.error('Get online friends error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;