const { Party, User, Notification } = require('../models');
const { broadcastToParty } = require('../socket');

const PartyUtils = {
  // Clean up expired party invites
  cleanupExpiredInvites: async () => {
    try {
      const now = new Date();
      const parties = await Party.find({
        'pendingInvites.expiresAt': { $lt: now }
      });

      for (const party of parties) {
        const originalCount = party.pendingInvites.length;
        party.pendingInvites = party.pendingInvites.filter(
          invite => invite.expiresAt > now
        );
        
        if (party.pendingInvites.length !== originalCount) {
          await party.save();
        }
      }
    } catch (error) {
      console.error('Cleanup expired invites error:', error);
    }
  },

  // Disband empty parties
  disbandEmptyParties: async () => {
    try {
      const emptyParties = await Party.find({
        $or: [
          { members: { $size: 0 } },
          { members: null }
        ]
      });

      for (const party of emptyParties) {
        await Party.findByIdAndDelete(party._id);
        console.log(`Disbanded empty party: ${party.name}`);
      }
    } catch (error) {
      console.error('Disband empty parties error:', error);
    }
  },

  // Auto-assign new leader if current leader leaves
  reassignLeaderIfNeeded: async (partyId, leavingUserId) => {
    try {
      const party = await Party.findById(partyId);
      if (!party) return null;

      if (party.leader.toString() === leavingUserId.toString()) {
        const remainingMembers = party.members.filter(
          member => member.user.toString() !== leavingUserId.toString()
        );

        if (remainingMembers.length > 0) {
          const newLeader = remainingMembers[0];
          party.leader = newLeader.user;
          newLeader.role = 'leader';
          await party.save();

          // Notify new leader
          await Notification.create({
            recipient: newLeader.user,
            type: 'party_leader_changed',
            title: 'Party Leadership',
            message: 'You are now the party leader'
          });

          // Broadcast to party
          await broadcastToParty(partyId, {
            type: 'party_leader_changed',
            data: { newLeaderId: newLeader.user }
          });

          return newLeader.user;
        }
      }
      return null;
    } catch (error) {
      console.error('Reassign leader error:', error);
      return null;
    }
  },

  // Generate unique invite code
  generateInviteCode: () => {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  },

  // Validate party settings
  validatePartySettings: (settings) => {
    const errors = [];
    
    if (settings.maxSize < 2 || settings.maxSize > 8) {
      errors.push('Max size must be between 2 and 8');
    }
    
    const validGameModes = ['solo', 'duo', 'squad', 'lategame-arena'];
    if (settings.gameMode && !validGameModes.includes(settings.gameMode)) {
      errors.push('Invalid game mode');
    }
    
    return errors;
  },

  // Get party statistics
  getPartyStats: async (partyId) => {
    try {
      const party = await Party.findById(partyId)
        .populate('members.user', 'level experience');
      
      if (!party) return null;

      const totalLevel = party.members.reduce((sum, member) => sum + member.user.level, 0);
      const averageLevel = totalLevel / party.members.length;
      const totalExperience = party.members.reduce((sum, member) => sum + member.user.experience, 0);

      return {
        memberCount: party.members.length,
        averageLevel: Math.round(averageLevel * 100) / 100,
        totalExperience,
        createdAt: party.createdAt,
        status: party.status
      };
    } catch (error) {
      console.error('Get party stats error:', error);
      return null;
    }
  }
};

module.exports = PartyUtils;