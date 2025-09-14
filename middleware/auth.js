const jwt = require('../utils/jwt');
const redis = require('../adapters/redis');
const { User } = require('../models/user');

const authenticate = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'Access denied. No token provided.' });
    }

    // Verify JWT token
    const decoded = jwt.verify(token);
    
    // Check if session exists in Redis
    const sessionUserId = await redis.get(`session:${token}`);
    if (!sessionUserId || sessionUserId !== decoded.userId) {
      return res.status(401).json({ error: 'Invalid or expired session.' });
    }

    // Get user from database
    const user = await User.findById(decoded.userId).select('-password');
    if (!user) {
      return res.status(401).json({ error: 'User not found.' });
    }

    // Attach user to request object
    req.user = user;
    req.token = token;
    
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(401).json({ error: 'Invalid token.' });
  }
};

// Optional authentication (doesn't fail if no token)
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (token) {
      const decoded = jwt.verify(token);
      const sessionUserId = await redis.get(`session:${token}`);
      
      if (sessionUserId && sessionUserId === decoded.userId) {
        const user = await User.findById(decoded.userId).select('-password');
        if (user) {
          req.user = user;
          req.token = token;
        }
      }
    }
    
    next();
  } catch (error) {
    // Ignore errors in optional auth
    next();
  }
};

module.exports = {
  authenticate,
  optionalAuth
};