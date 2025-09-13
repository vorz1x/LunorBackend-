const { Client, GatewayIntentBits, Partials } = require("discord.js");
const config = require("./config");
const userCommands = require("./commands/user");
const adminCommands = require("./commands/admin");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.User, Partials.Message, Partials.Channel]
});

client.once("ready", () => console.log("Lunor Discord Bot Online"));

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (config.discord.adminRoles.includes(interaction.member.roles.cache.first()?.id)) {
    await adminCommands.handle(interaction);
  } else {
    await userCommands.handle(interaction);
  }
});

client.login(config.discord.token);