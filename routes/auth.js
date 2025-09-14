const router = require('express').Router();
const { User } = require('../models/user');
const bcrypt = require('../utils/bcrypt');
const jwt = require('../utils/jwt');
const redis = require('../adapters/redis');
const { validate, schemas } = require('../middleware/validation');

// User registration
router.post('/create', validate(schemas.register), async (req, res) => {
  try {
    const { email, username, password, discordId } = req.body;
    
    if (await User.findOne({ username })) {
      return res.status(409).json({ error: "Username exists" });
    }
    
    if (discordId && await User.findOne({ discordId })) {
      return res.status(409).json({ error: "Account exists for Discord ID" });
    }
    
    const hash = await bcrypt.hash(password);
    const user = new User({ 
      email, 
      username, 
      password: hash, 
      discordId, 
      vbucks: 0 
    });
    
    await user.save();
    res.json({ ok: true, message: "User created successfully" });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// User login
router.post('/login', validate(schemas.login), async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    
    const token = jwt.sign({ userId: user._id });
    await redis.set(`session:${token}`, user._id.toString(), { ex: 60 * 60 * 24 });
    
    // Update user online status
    user.isOnline = true;
    user.lastSeen = new Date();
    await user.save();
    
    res.json({ 
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        vbucks: user.vbucks,
        level: user.level
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// User logout
router.post('/logout', async (req, res) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (token) {
      const decoded = jwt.verify(token);
      await redis.del(`session:${token}`);
      
      // Update user online status
      const user = await User.findById(decoded.userId);
      if (user) {
        user.isOnline = false;
        user.lastSeen = new Date();
        await user.save();
      }
    }
    
    res.json({ ok: true, message: "Logged out successfully" });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;