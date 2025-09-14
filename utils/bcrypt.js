const bcrypt = require('bcryptjs');

const hash = async (password, saltRounds = 12) => {
  return await bcrypt.hash(password, saltRounds);
};

const compare = async (password, hash) => {
  return await bcrypt.compare(password, hash);
};

module.exports = {
  hash,
  compare
};