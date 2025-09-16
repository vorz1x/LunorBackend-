const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null // null for system notifications
  },
  type: {
    type: String,
    required: true,
    enum: [
      'friend_request',
      'friend_request_accepted',
      'friend_request_declined',
      'party_invite',
      'party_join',
      'party_leave',
      'party_kick',
      'party_leader_changed',
      'party_disbanded',
      'match_found',
      'system_announcement',
      'achievement_unlocked',
      'level_up'
    ]
  },
  title: {
    type: String,
    required: true,
    maxlength: 100
  },
  message: {
    type: String,
    required: true,
    maxlength: 500
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  isRead: {
    type: Boolean,
    default: false
  },
  readAt: {
    type: Date,
    default: null
  },
  priority: {
    type: String,
    enum: ['low', 'normal', 'high', 'urgent'],
    default: 'normal'
  },
  actionRequired: {
    type: Boolean,
    default: false
  },
  actionData: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
  }
}, {
  timestamps: true
});

// Index for efficient queries
notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, isRead: 1 });
notificationSchema.index({ type: 1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Static method to create different types of notifications
notificationSchema.statics.createFriendRequest = function(recipientId, senderId, senderUsername) {
  return this.create({
    recipient: recipientId,
    sender: senderId,
    type: 'friend_request',
    title: 'Friend Request',
    message: `${senderUsername} sent you a friend request`,
    actionRequired: true,
    actionData: {
      requestId: senderId,
      actions: ['accept', 'decline']
    }
  });
};

notificationSchema.statics.createPartyInvite = function(recipientId, senderId, senderUsername, partyId) {
  return this.create({
    recipient: recipientId,
    sender: senderId,
    type: 'party_invite',
    title: 'Party Invitation',
    message: `${senderUsername} invited you to join their party`,
    actionRequired: true,
    actionData: {
      partyId: partyId,
      actions: ['accept', 'decline']
    },
    expiresAt: new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
  });
};

notificationSchema.statics.createSystemNotification = function(recipientId, title, message, data = {}) {
  return this.create({
    recipient: recipientId,
    type: 'system_announcement',
    title: title,
    message: message,
    data: data,
    priority: 'normal'
  });
};

// Method to mark as read
notificationSchema.methods.markAsRead = function() {
  this.isRead = true;
  this.readAt = new Date();
  return this.save();
};

const Notification = mongoose.model('Notification', notificationSchema);

module.exports = { Notification };