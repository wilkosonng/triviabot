const { SlashCommandBuilder, Events, EmbedBuilder } = require('discord.js');
const similarity = require('string-similarity');
const { firebaseCreds, threshold } = require('../../config.json');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, get } = require('firebase/database');

const firebaseApp = initializeApp(firebaseCreds);
const database = getDatabase(firebaseApp);
const currGame = { active: false };

module.exports = {
	data: new SlashCommandBuilder()
		.setName('start')
		.setDescription('Starts a game of trivia in the current channel.')
		.addStringOption(option =>
			option
				.setName('questionset')
				.setDescription('Which question set to use? Random by default.')
				.setAutocomplete(true)
				.setRequired(false))
		.addBooleanOption(option =>
			option
				.setName('randomize')
				.setDescription('Randomize questions? True by default.')
				.setRequired(false))
		.addIntegerOption(option =>
			option
				.setName('teams')
				.setDescription('How many teams to play (1-4)? 1 by default.')
				.setMinValue(1)
				.setMaxValue(4)
				.setRequired(false))
		.addBooleanOption(option =>
			option
				.setName('losepoints')
				.setDescription('Lose points on wrong answer? True by default.')
				.setRequired(false)),

	async execute(interaction) {
		await interaction.deferReply();

		if (currGame.active) {
			await interaction.editReply('Error: Game has already started!');
			return;
		}

		const set = interaction.options?.getString('questionset');
		const numTeams = interaction.options?.getInteger('teams') ?? 1;
		const losePoints = interaction.options?.getBoolean('losepoints') ?? true;
		const channel = interaction.channel;
		const user = interaction.user;
		const players = new Map();

		interaction.client.addListener(Events.MessageCreate, gameStartListener);

		function gameStartListener(message) {
			if (message.author?.bot) {
				return;
			}

			const msg = message.content.toLowerCase();

			if (msg === 'endtrivia') {
				interaction.client.removeListener(Events.MessageCreate, gameStartListener);
			} else if (message.author?.id === user?.id && msg === 'ready') {
				interaction.client.removeListener(Events.MessageCreate, gameStartListener);
				startGame(currGame);
			}

			console.log(`Found message: ${message.content} from ${message.author?.id}!`);
			return;
		}

		await interaction.editReply('Game successfully started! Type \`ready\` to begin!');
		return;
	}
};
