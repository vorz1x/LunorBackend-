const router = require('express').Router();
const { User } = require('../models/user');
const bcrypt = require('../utils/bcrypt');
const jwt = require('../utils/jwt');
const redis = require('../adapters/redis');

// User registration
router.post('/create', async (req, res) => {
  const { email, username, password, discordId } = req.body;
  if (await User.findOne({ username })) return res.status(409).json({ error: "Username exists" });
  if (discordId && await User.findOne({ discordId })) return res.status(409).json({ error: "Account exists for Discord ID" });
  const hash = await bcrypt.hash(password);
  const user = new User({ email, username, password: hash, discordId, vbucks: 0 });
  await user.save();
  res.json({ ok: true });
});

// User login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: "Invalid credentials" });
  const token = jwt.sign({ userId: user._id });
  await redis.set(`session:${token}`, user._id, { ex: 60 * 60 * 24 });
  res.json({ token });
});

module.exports = router;