const jwt = require('jsonwebtoken');
const config = require('../config');

const sign = (payload, expiresIn = '24h') => {
  return jwt.sign(payload, config.jwtSecret, { expiresIn });
};

const verify = (token) => {
  return jwt.verify(token, config.jwtSecret);
};

module.exports = {
  sign,
  verify
};