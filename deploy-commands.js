const { REST, Routes } = require('discord.js');
const { clientID } = require('./config.json');
const fs = require('fs');
const path = require('path');
require('dotenv').config();


const commands = [];
const commandsPath = path.join(__dirname, 'src', 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
	const command = require(path.join(commandsPath, file));
	commands.push(command.data.toJSON());
}

const rest = new REST({
	version: '10',
}).setToken(process.env.TRIVIA_BOT_TOKEN);

(async () => {
	try {
		await rest.put(
			Routes.applicationCommands(clientID),
			{ body: commands },
		);
	} catch (error) {
		console.log(error);
	}
})();