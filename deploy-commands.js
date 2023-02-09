const { REST, Routes } = require('discord.js');
const { clientID, guildID } = require('./config.json');
const fs = require('node:fs');
require('dotenv').config();

const commands = [];
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
	const command = require(`./commands/${file}`);
	commands.push(command.data.toJSON());
}

const rest = new REST({
	version: '10',
}).setToken(process.env.TRIVIA_BOT_TOKEN);

(async () => {
	try {
		const data = await rest.put(
			Routes.applicationGuildCommands(clientID, guildID),
			{ body: commands },
		);
	}
	catch (error) {
		console.log(error);
	}
})();