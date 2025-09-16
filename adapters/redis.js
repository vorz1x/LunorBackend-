const redis = require('redis');
const config = require('../config');

let client;

const connectRedis = async () => {
  try {
    client = redis.createClient({
      host: config.redis.host,
      port: config.redis.port
    });
    
    client.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });
    
    await client.connect();
    console.log('Redis connected successfully');
  } catch (error) {
    console.error('Redis connection error:', error);
  }
};

const get = async (key) => {
  return await client.get(key);
};

const set = async (key, value, options = {}) => {
  return await client.set(key, value, options);
};

const del = async (key) => {
  return await client.del(key);
};

module.exports = {
  connectRedis,
  get,
  set,
  del
};