const router = require('express').Router();
const { Party } = require('../models/party');
const { User } = require('../models/user');
const { Notification } = require('../models/notification');
const { authenticate } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');
const { v4: uuidv4 } = require('uuid');

// Get current user's party
router.get('/current', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate('currentParty');
    
    if (!user.currentParty) {
      return res.json({ party: null });
    }

    const party = await Party.findById(user.currentParty._id)
      .populate('members.user', 'username isOnline lastSeen')
      .populate('leader', 'username')
      .populate('pendingInvites.user', 'username')
      .populate('pendingInvites.invitedBy', 'username');

    res.json({ party });
  } catch (error) {
    console.error('Get current party error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new party
router.post('/create', authenticate, validate(schemas.createParty), async (req, res) => {
  try {
    const { name, maxSize, isPrivate, gameMode } = req.body;
    
    // Check if user is already in a party
    if (req.user.currentParty) {
      return res.status(400).json({ error: 'You are already in a party' });
    }

    const party = new Party({
      name,
      leader: req.user._id,
      members: [{
        user: req.user._id,
        role: 'leader'
      }],
      maxSize,
      isPrivate,
      gameMode,
      inviteCode: isPrivate ? uuidv4() : null
    });

    await party.save();

    // Update user's current party
    req.user.currentParty = party._id;
    await req.user.save();

    const populatedParty = await Party.findById(party._id)
      .populate('members.user', 'username isOnline lastSeen')
      .populate('leader', 'username');

    res.status(201).json({ 
      ok: true, 
      message: 'Party created successfully',
      party: populatedParty
    });
  } catch (error) {
    console.error('Create party error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Join a party
router.post('/join', authenticate, validate(schemas.joinParty), async (req, res) => {
  try {
    const { partyId } = req.body;
    
    // Check if user is already in a party
    if (req.user.currentParty) {
      return res.status(400).json({ error: 'You are already in a party' });
    }

    const party = await Party.findById(partyId);
    if (!party) {
      return res.status(404).json({ error: 'Party not found' });
    }

    // Check if party is full
    if (party.isFull()) {
      return res.status(400).json({ error: 'Party is full' });
    }

    // Check if user is already a member
    if (party.isMember(req.user._id)) {
      return res.status(400).json({ error: 'You are already in this party' });
    }

    // Add user to party
    party.members.push({
      user: req.user._id,
      role: 'member'
    });
    await party.save();

    // Update user's current party
    req.user.currentParty = party._id;
    await req.user.save();

    // Create notification for party leader
    await Notification.create({
      recipient: party.leader,
      sender: req.user._id,
      type: 'party_join',
      title: 'Player Joined Party',
      message: `${req.user.username} joined your party`
    });

    const populatedParty = await Party.findById(party._id)
      .populate('members.user', 'username isOnline lastSeen')
      .populate('leader', 'username');

    res.json({ 
      ok: true, 
      message: 'Joined party successfully',
      party: populatedParty
    });
  } catch (error) {
    console.error('Join party error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Leave party
router.post('/leave', authenticate, async (req, res) => {
  try {
    if (!req.user.currentParty) {
      return res.status(400).json({ error: 'You are not in a party' });
    }

    const party = await Party.findById(req.user.currentParty);
    if (!party) {
      return res.status(404).json({ error: 'Party not found' });
    }

    // Remove user from party
    party.members = party.members.filter(
      member => member.user.toString() !== req.user._id.toString()
    );

    // If user was the leader, assign new leader or disband party
    if (party.isLeader(req.user._id)) {
      if (party.members.length > 0) {
        // Assign new leader
        const newLeader = party.members[0];
        party.leader = newLeader.user;
        newLeader.role = 'leader';
        
        // Notify new leader
        await Notification.create({
          recipient: newLeader.user,
          type: 'party_leader_changed',
          title: 'Party Leadership',
          message: 'You are now the party leader'
        });
      } else {
        // Disband empty party
        await Party.findByIdAndDelete(party._id);
        req.user.currentParty = null;
        await req.user.save();
        
        return res.json({ 
          ok: true, 
          message: 'Left party (party disbanded)',
          party: null
        });
      }
    }

    await party.save();

    // Update user's current party
    req.user.currentParty = null;
    await req.user.save();

    // Notify remaining party members
    for (const member of party.members) {
      await Notification.create({
        recipient: member.user,
        sender: req.user._id,
        type: 'party_leave',
        title: 'Player Left Party',
        message: `${req.user.username} left the party`
      });
    }

    res.json({ 
      ok: true, 
      message: 'Left party successfully',
      party: null
    });
  } catch (error) {
    console.error('Leave party error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Invite user to party
router.post('/invite', authenticate, validate(schemas.inviteToParty), async (req, res) => {
  try {
    const { username } = req.body;
    
    if (!req.user.currentParty) {
      return res.status(400).json({ error: 'You are not in a party' });
    }

    const party = await Party.findById(req.user.currentParty);
    if (!party) {
      return res.status(404).json({ error: 'Party not found' });
    }

    // Check if user is party leader
    if (!party.isLeader(req.user._id)) {
      return res.status(403).json({ error: 'Only party leader can invite members' });
    }

    // Find user to invite
    const userToInvite = await User.findOne({ username });
    if (!userToInvite) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if user is already in a party
    if (userToInvite.currentParty) {
      return res.status(400).json({ error: 'User is already in a party' });
    }

    // Check if party is full
    if (party.isFull()) {
      return res.status(400).json({ error: 'Party is full' });
    }

    // Check if user already has pending invite
    const existingInvite = party.pendingInvites.find(
      invite => invite.user.toString() === userToInvite._id.toString()
    );
    if (existingInvite) {
      return res.status(400).json({ error: 'User already has a pending invite' });
    }

    // Add pending invite
    party.pendingInvites.push({
      user: userToInvite._id,
      invitedBy: req.user._id
    });
    await party.save();

    // Create notification for invited user
    await Notification.createPartyInvite(
      userToInvite._id,
      req.user._id,
      req.user.username,
      party._id
    );

    res.json({ 
      ok: true, 
      message: 'Invitation sent successfully'
    });
  } catch (error) {
    console.error('Invite to party error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Kick user from party
router.post('/kick/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!req.user.currentParty) {
      return res.status(400).json({ error: 'You are not in a party' });
    }

    const party = await Party.findById(req.user.currentParty);
    if (!party) {
      return res.status(404).json({ error: 'Party not found' });
    }

    // Check if user is party leader
    if (!party.isLeader(req.user._id)) {
      return res.status(403).json({ error: 'Only party leader can kick members' });
    }

    // Check if trying to kick self
    if (userId === req.user._id.toString()) {
      return res.status(400).json({ error: 'Cannot kick yourself' });
    }

    // Find member to kick
    const memberToKick = party.members.find(
      member => member.user.toString() === userId
    );
    if (!memberToKick) {
      return res.status(404).json({ error: 'User is not in this party' });
    }

    // Remove member from party
    party.members = party.members.filter(
      member => member.user.toString() !== userId
    );
    await party.save();

    // Update kicked user's current party
    await User.findByIdAndUpdate(userId, { currentParty: null });

    // Notify kicked user
    const kickedUser = await User.findById(userId);
    await Notification.create({
      recipient: userId,
      sender: req.user._id,
      type: 'party_kick',
      title: 'Kicked from Party',
      message: `You were kicked from the party by ${req.user.username}`
    });

    res.json({ 
      ok: true, 
      message: `${kickedUser.username} was kicked from the party`
    });
  } catch (error) {
    console.error('Kick from party error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start matchmaking
router.post('/matchmaking/start', authenticate, async (req, res) => {
  try {
    if (!req.user.currentParty) {
      return res.status(400).json({ error: 'You are not in a party' });
    }

    const party = await Party.findById(req.user.currentParty);
    if (!party) {
      return res.status(404).json({ error: 'Party not found' });
    }

    // Check if user is party leader
    if (!party.isLeader(req.user._id)) {
      return res.status(403).json({ error: 'Only party leader can start matchmaking' });
    }

    // Update party status
    party.status = 'matchmaking';
    await party.save();

    // Notify all party members
    for (const member of party.members) {
      await Notification.create({
        recipient: member.user,
        type: 'match_found',
        title: 'Matchmaking Started',
        message: 'Party matchmaking has started'
      });
    }

    res.json({ 
      ok: true, 
      message: 'Matchmaking started successfully'
    });
  } catch (error) {
    console.error('Start matchmaking error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update party settings
router.patch('/settings', authenticate, validate(schemas.updatePartySettings), async (req, res) => {
  try {
    if (!req.user.currentParty) {
      return res.status(400).json({ error: 'You are not in a party' });
    }

    const party = await Party.findById(req.user.currentParty);
    if (!party) {
      return res.status(404).json({ error: 'Party not found' });
    }

    // Check if user is party leader
    if (!party.isLeader(req.user._id)) {
      return res.status(403).json({ error: 'Only party leader can update settings' });
    }

    // Update allowed fields
    const allowedUpdates = ['maxSize', 'gameMode', 'allowJoinInProgress', 'autoFill', 'voiceChat'];
    const updates = {};
    
    for (const field of allowedUpdates) {
      if (req.body[field] !== undefined) {
        if (field === 'maxSize' || field === 'gameMode') {
          updates[field] = req.body[field];
        } else {
          updates[`settings.${field}`] = req.body[field];
        }
      }
    }

    await Party.findByIdAndUpdate(party._id, updates);

    const updatedParty = await Party.findById(party._id)
      .populate('members.user', 'username isOnline lastSeen')
      .populate('leader', 'username');

    res.json({ 
      ok: true, 
      message: 'Party settings updated successfully',
      party: updatedParty
    });
  } catch (error) {
    console.error('Update party settings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;