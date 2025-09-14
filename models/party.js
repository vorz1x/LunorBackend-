const mongoose = require('mongoose');

const partySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  leader: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  members: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    joinedAt: {
      type: Date,
      default: Date.now
    },
    role: {
      type: String,
      enum: ['leader', 'member'],
      default: 'member'
    }
  }],
  maxSize: {
    type: Number,
    default: 4,
    min: 2,
    max: 8
  },
  isPrivate: {
    type: Boolean,
    default: false
  },
  inviteCode: {
    type: String,
    unique: true,
    sparse: true
  },
  pendingInvites: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
    }
  }],
  status: {
    type: String,
    enum: ['lobby', 'matchmaking', 'in-game'],
    default: 'lobby'
  },
  gameMode: {
    type: String,
    enum: ['solo', 'duo', 'squad', 'lategame-arena'],
    default: 'squad'
  },
  matchmakingRegion: {
    type: String,
    default: 'auto'
  },
  settings: {
    allowJoinInProgress: {
      type: Boolean,
      default: true
    },
    autoFill: {
      type: Boolean,
      default: true
    },
    voiceChat: {
      type: Boolean,
      default: true
    }
  }
}, {
  timestamps: true
});

// Index for efficient queries
partySchema.index({ leader: 1 });
partySchema.index({ 'members.user': 1 });
partySchema.index({ inviteCode: 1 });
partySchema.index({ status: 1 });

// Virtual for current member count
partySchema.virtual('memberCount').get(function() {
  return this.members.length;
});

// Virtual for available slots
partySchema.virtual('availableSlots').get(function() {
  return this.maxSize - this.members.length;
});

// Method to check if user is party leader
partySchema.methods.isLeader = function(userId) {
  return this.leader.toString() === userId.toString();
};

// Method to check if user is party member
partySchema.methods.isMember = function(userId) {
  return this.members.some(member => member.user.toString() === userId.toString());
};

// Method to check if party is full
partySchema.methods.isFull = function() {
  return this.members.length >= this.maxSize;
};

const Party = mongoose.model('Party', partySchema);

module.exports = { Party };