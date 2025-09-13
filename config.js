module.exports = {
  ip: "26.148.96.40",
  port: 3551,
  ssl: {
    key: "/etc/ssl/private/server.key",
    cert: "/etc/ssl/certs/server.crt"
  },
  redis: { host: "127.0.0.1", port: 6379 },
  mongo: { uri: "mongodb://localhost/fortnite" },
  postgres: { uri: "postgresql://user:password@localhost:5432/fortnite" },
  discord: {
    adminRoles: [
      "1034938833420169296",
      "1400236698968785053",
      "1338728213978943538",
      "943107204280619028"
    ]
  },
  jwtSecret: "supersecretjwt",
  catalogFile: "./catalog_config.json",
  donatorPacksFile: "./donator_packs.json",
  weaponIdsFile: "./c1s9_weapon_ids.json",
  questsFile: "./quests_config.json"
};