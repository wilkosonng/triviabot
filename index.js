const { Client, Events, GatewayIntentBits, Collection } = require('discord.js');
const { firebaseCreds, firebaseLogin } = require('./config.json');
const { initializeApp } = require('firebase/app');
const { getAuth, signInWithEmailAndPassword, signOut } = require('firebase/auth');
const { getDatabase, onValue, ref } = require('firebase/database');
const fs = require('fs');
const path = require('path');

require('dotenv').config();

const firebaseApp = initializeApp(firebaseCreds);
const database = getDatabase(firebaseApp);
const auth = getAuth(firebaseApp);

let sets;

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent,
	],
	disableEveryone: true,
});

client.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
	const filePath = path.join(commandsPath, file);
	const command = require(filePath);

	if ('data' in command && 'execute' in command) {
		client.commands.set(command.data.name, command);
	}
}

client.once(Events.ClientReady, async clientObject => {
	// Signs into the database.
	await signInWithEmailAndPassword(auth, firebaseLogin.email, firebaseLogin.password)
		.then(() => {
			console.log();
		})
		.catch((error) => {
			console.log(error);
		});

	onValue(ref(database, 'questionSets'), (snapshot) => {
		sets = snapshot.val() ?? {};
		console.log(Object.keys(sets));
	});

	console.log(`Bot ready to test knowledge! Tag: ${clientObject.user.tag}.`);
});

client.on(Events.InteractionCreate, async interaction => {
	if (interaction.isChatInputCommand()) {
		if (interaction.channel.isDMBased()) {
			return;
		}

		const command = interaction.client.commands.get(interaction.commandName);

		if (!command) {
			console.error(`No command matching ${interaction.commandName} was found.`);
			return;
		}

		try {
			await command.execute(interaction);
		}
		catch (error) {
			console.error(error);
			await interaction.reply({
				content: 'There was an error while executing this command!',
				ephemeral: true,
			});
		}
	}
	else if (interaction.isAutocomplete) {
		const command = interaction.client.commands.get(interaction.commandName);
		console.log('Attempting autocomplete!');

	} else {
		return;
	}
});

process.on('uncaughtException', () => {
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