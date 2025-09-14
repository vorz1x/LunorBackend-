const router = require('express').Router();
const { Notification } = require('../models/notification');
const { User } = require('../models/user');
const { Party } = require('../models/party');
const { authenticate } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');

// Get user's notifications
router.get('/', authenticate, async (req, res) => {
  try {
    const { page = 1, limit = 20, unreadOnly = false } = req.query;
    const skip = (page - 1) * limit;

    const query = { recipient: req.user._id };
    if (unreadOnly === 'true') {
      query.isRead = false;
    }

    const notifications = await Notification.find(query)
      .populate('sender', 'username profileSettings.displayName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Notification.countDocuments(query);
    const unreadCount = await Notification.countDocuments({
      recipient: req.user._id,
      isRead: false
    });

    res.json({
      notifications,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      },
      unreadCount
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Mark notifications as read
router.patch('/read', authenticate, validate(schemas.markNotificationRead), async (req, res) => {
  try {
    const { notificationIds } = req.body;

    const result = await Notification.updateMany(
      {
        _id: { $in: notificationIds },
        recipient: req.user._id,
        isRead: false
      },
      {
        isRead: true,
        readAt: new Date()
      }
    );

    res.json({
      ok: true,
      message: `${result.modifiedCount} notifications marked as read`
    });
  } catch (error) {
    console.error('Mark notifications as read error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Mark all notifications as read
router.patch('/read/all', authenticate, async (req, res) => {
  try {
    const result = await Notification.updateMany(
      {
        recipient: req.user._id,
        isRead: false
      },
      {
        isRead: true,
        readAt: new Date()
      }
    );

    res.json({
      ok: true,
      message: `${result.modifiedCount} notifications marked as read`
    });
  } catch (error) {
    console.error('Mark all notifications as read error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete notifications
router.delete('/', authenticate, async (req, res) => {
  try {
    const { notificationIds } = req.body;

    if (!Array.isArray(notificationIds) || notificationIds.length === 0) {
      return res.status(400).json({ error: 'Invalid notification IDs' });
    }

    const result = await Notification.deleteMany({
      _id: { $in: notificationIds },
      recipient: req.user._id
    });

    res.json({
      ok: true,
      message: `${result.deletedCount} notifications deleted`
    });
  } catch (error) {
    console.error('Delete notifications error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Respond to notification (for actionable notifications)
router.post('/:notificationId/respond', authenticate, validate(schemas.respondToNotification), async (req, res) => {
  try {
    const { notificationId } = req.params;
    const { action, data = {} } = req.body;

    const notification = await Notification.findOne({
      _id: notificationId,
      recipient: req.user._id,
      actionRequired: true
    });

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found or not actionable' });
    }

    let result = {};

    switch (notification.type) {
      case 'friend_request':
        if (!['accept', 'decline'].includes(action)) {
          return res.status(400).json({ error: 'Invalid action for friend request' });
        }

        // Get the requester
        const requester = await User.findById(notification.sender);
        if (!requester) {
          return res.status(404).json({ error: 'Requester not found' });
        }

        // Remove from pending requests
        const requestIndex = req.user.pendingFriendRequests.findIndex(
          request => request.from.toString() === notification.sender.toString()
        );
        if (requestIndex !== -1) {
          req.user.pendingFriendRequests.splice(requestIndex, 1);
        }

        // Remove from requester's sent requests
        const sentRequestIndex = requester.sentFriendRequests.findIndex(
          request => request.to.toString() === req.user._id.toString()
        );
        if (sentRequestIndex !== -1) {
          requester.sentFriendRequests.splice(sentRequestIndex, 1);
        }

        if (action === 'accept') {
          // Add to both users' friends lists
          req.user.friends.push(notification.sender);
          requester.friends.push(req.user._id);

          // Create notification for requester
          await Notification.create({
            recipient: notification.sender,
            sender: req.user._id,
            type: 'friend_request_accepted',
            title: 'Friend Request Accepted',
            message: `${req.user.username} accepted your friend request`
          });

          result.message = 'Friend request accepted';
        } else {
          result.message = 'Friend request declined';
        }

        await req.user.save();
        await requester.save();
        break;

      case 'party_invite':
        if (!['accept', 'decline'].includes(action)) {
          return res.status(400).json({ error: 'Invalid action for party invite' });
        }

        const partyId = notification.actionData.partyId;
        const party = await Party.findById(partyId);

        if (!party) {
          result.message = 'Party no longer exists';
          break;
        }

        // Remove from pending invites
        party.pendingInvites = party.pendingInvites.filter(
          invite => invite.user.toString() !== req.user._id.toString()
        );

        if (action === 'accept') {
          // Check if user is already in a party
          if (req.user.currentParty) {
            result.message = 'You are already in a party';
            break;
          }

          // Check if party is full
          if (party.isFull()) {
            result.message = 'Party is full';
            break;
          }

          // Add user to party
          party.members.push({
            user: req.user._id,
            role: 'member'
          });

          // Update user's current party
          req.user.currentParty = party._id;
          await req.user.save();

          // Notify party leader
          await Notification.create({
            recipient: party.leader,
            sender: req.user._id,
            type: 'party_join',
            title: 'Player Joined Party',
            message: `${req.user.username} joined your party`
          });

          result.message = 'Joined party successfully';
        } else {
          result.message = 'Party invitation declined';
        }

        await party.save();
        break;

      default:
        return res.status(400).json({ error: 'Notification type does not support actions' });
    }

    // Mark notification as read and remove action requirement
    notification.isRead = true;
    notification.readAt = new Date();
    notification.actionRequired = false;
    await notification.save();

    res.json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error('Respond to notification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get notification summary
router.get('/summary', authenticate, async (req, res) => {
  try {
    const [
      unreadCount,
      actionRequiredCount,
      friendRequestCount,
      partyInviteCount
    ] = await Promise.all([
      Notification.countDocuments({
        recipient: req.user._id,
        isRead: false
      }),
      Notification.countDocuments({
        recipient: req.user._id,
        actionRequired: true
      }),
      Notification.countDocuments({
        recipient: req.user._id,
        type: 'friend_request',
        actionRequired: true
      }),
      Notification.countDocuments({
        recipient: req.user._id,
        type: 'party_invite',
        actionRequired: true
      })
    ]);

    res.json({
      unreadCount,
      actionRequiredCount,
      friendRequestCount,
      partyInviteCount
    });
  } catch (error) {
    console.error('Get notification summary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Clean up expired notifications (admin utility)
router.delete('/cleanup', authenticate, async (req, res) => {
  try {
    const result = await Notification.deleteMany({
      expiresAt: { $lt: new Date() }
    });

    res.json({
      ok: true,
      message: `${result.deletedCount} expired notifications cleaned up`
    });
  } catch (error) {
    console.error('Cleanup notifications error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;