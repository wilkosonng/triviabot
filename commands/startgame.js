const { SlashCommandBuilder, Events, EmbedBuilder } = require('discord.js');
const similarity = require('string-similarity');
const sheets = require('google-spreadsheet');
const { firebaseCreds, threshold } = require('../config.json');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, set, get } = require('firebase/database');

const firebaseApp = initializeApp(firebaseCreds);
const database = getDatabase(firebaseApp);

module.exports = {
	data: new SlashCommandBuilder()
		.setName('start')
		.setDescription('Starts a game of trivia')
		.addStringOption(option =>
			option
				.setName('questionset')
				.setDescription('Which question set to use (random by default).')
				.setAutocomplete(true)
				.setRequired(false)),

	async execute(interaction) {
		const set = interaction.options.getString('questionSet');
		const user = interaction.user;
		const leaderboard = new Map();

		interaction.client.addListener(Events.MessageCreate, answerListener);

		async function answerListener(message) {
			if (message.author.bot) return;
			if (message.content.toLowerCase() === 'endtrivia') {
				interaction.client.removeListener(Events.MessageCreate, answerListener);
				return;
			}

			console.log(`Found message: ${message.content} from ${message.author}!`);
		}

		// Defines a tolerance for how similar a submission must be to an answer to be "correct"
		function answerThreshold(str) {
			return 0.95 * Math.pow(Math.E, -(threshold / str.length()));
		}
	},
};