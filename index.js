const { Client, Events, GatewayIntentBits, Collection } = require('discord.js');
const { initializeApp } = require('firebase/app');
const { getAuth, signInWithEmailAndPassword, signOut } = require('firebase/auth');
const { getDatabase, onValue, ref } = require('firebase/database');
const fs = require('fs');
const path = require('path');

require('dotenv').config();

const firebaseApp = initializeApp(JSON.parse(process.env.FIREBASE_CREDS));
const database = getDatabase(firebaseApp);
const auth = getAuth(firebaseApp);

let sets = {};

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.GuildMessageReactions,
		GatewayIntentBits.MessageContent,
	],
	disableEveryone: true,
});

client.commands = new Collection();

const commandsPath = path.join(__dirname, 'src', 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
	const command = require(path.join(commandsPath, file));

	if ('data' in command && 'execute' in command) {
		client.commands.set(command.data.name, command);
	}
}

client.once(Events.ClientReady, async clientObject => {
	// Signs into the database.
	await signInWithEmailAndPassword(auth, process.env.FIREBASE_EMAIL, process.env.FIREBASE_PASSWORD)
		.then(() => {
			console.log();
		})
		.catch((error) => {
			console.log(error);
		});

	onValue(ref(database, 'questionSets'), (snapshot) => {
		sets = snapshot.val() ?? {};
		console.log('Question Sets Updated:');
		console.log(Object.keys(sets));
	});

	console.log(`Bot ready to test knowledge! Username: ${clientObject.user.username}.`);
});

// Command handler
client.on(Events.InteractionCreate, async interaction => {
	if (interaction.isChatInputCommand()) {
		if (interaction.channel.isDMBased()) {
			return;
		}

		const commandName = interaction.commandName;
		const command = interaction.client.commands.get(commandName);

		if (!command) {
			console.error(`No command matching ${commandName} was found.`);
			return;
		}

		try {
			if (commandName === 'listquestions') {
				return await command.execute(interaction, sets);
			}
			await command.execute(interaction);
		} catch (error) {
			console.error(error);
			interaction.channel.send('Oopsies, something went wrong! Please contact the bot developer.');
		}
	}
});

// Autocomplete handler
client.on(Events.InteractionCreate, async interaction => {
	if (!interaction.isAutocomplete()) {
		return;
	}

	const command = interaction.client.commands.get(interaction.commandName);

	if (!command) {
		console.error(`No command matching ${interaction.commandName} was found.`);
		return;
	}

	try {
		await command.autocomplete(interaction, Object.keys(sets));
	} catch (error) {
		console.error(error);
	}
});

// Makes sure the bot exits cleanly
process.on('uncaughtException', (error) => {
	console.error(error);
	process.exit(1);
});

process.on('SIGINT', () => {
	process.exit(1);
});

process.on('exit', () => {
	console.log('Exiting Bot');
	signOut(auth);
});

client.login(process.env.TRIVIA_BOT_TOKEN);