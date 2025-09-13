const WebSocket = require('ws');
const redis = require('../adapters/redis');
const { zoneProgression, spawnRules, dropOnDeath, lategameArena } = require('./zone');

const wss = new WebSocket.Server({ port: 4000 });

wss.on('connection', ws => {
  ws.on('message', msg => {
    // handle pickups, equips, kills, drops
    // enforce spawn/loadout rules
    // call backend for atomic updates
  });
  // send zone updates, match end after 12th zone
});

module.exports = wss;