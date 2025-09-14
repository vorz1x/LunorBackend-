const Joi = require('joi');

const validate = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.details.map(detail => detail.message)
      });
    }
    next();
  };
};

// Validation schemas
const schemas = {
  // Auth schemas
  register: Joi.object({
    email: Joi.string().email().required(),
    username: Joi.string().alphanum().min(3).max(20).required(),
    password: Joi.string().min(6).required(),
    discordId: Joi.string().optional()
  }),

  login: Joi.object({
    username: Joi.string().required(),
    password: Joi.string().required()
  }),

  // Party schemas
  createParty: Joi.object({
    name: Joi.string().max(50).required(),
    maxSize: Joi.number().min(2).max(8).default(4),
    isPrivate: Joi.boolean().default(false),
    gameMode: Joi.string().valid('solo', 'duo', 'squad', 'lategame-arena').default('squad')
  }),

  joinParty: Joi.object({
    partyId: Joi.string().required()
  }),

  inviteToParty: Joi.object({
    username: Joi.string().required()
  }),

  updatePartySettings: Joi.object({
    maxSize: Joi.number().min(2).max(8).optional(),
    gameMode: Joi.string().valid('solo', 'duo', 'squad', 'lategame-arena').optional(),
    allowJoinInProgress: Joi.boolean().optional(),
    autoFill: Joi.boolean().optional(),
    voiceChat: Joi.boolean().optional()
  }),

  // Friend schemas
  sendFriendRequest: Joi.object({
    username: Joi.string().required()
  }),

  respondToFriendRequest: Joi.object({
    requesterId: Joi.string().required(),
    action: Joi.string().valid('accept', 'decline').required()
  }),

  // Notification schemas
  markNotificationRead: Joi.object({
    notificationIds: Joi.array().items(Joi.string()).min(1).required()
  }),

  respondToNotification: Joi.object({
    action: Joi.string().required(),
    data: Joi.object().optional()
  })
};

module.exports = {
  validate,
  schemas
};