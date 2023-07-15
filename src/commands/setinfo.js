const { SlashCommandBuilder } = require('discord.js');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, get } = require('firebase/database');
const { stringSimilarity } = require('string-similarity-js');
const { QuestionInfoEmbed } = require('../helpers/embeds.js');
require('dotenv').config();

const firebaseApp = initializeApp(JSON.parse(process.env.FIREBASE_CREDS));
const database = getDatabase(firebaseApp);

module.exports = {
	data: new SlashCommandBuilder()
		.setName('setinfo')
		.setDescription('Provides information on a question set')
		.addStringOption(option =>
			option
				.setName('title')
				.setDescription('The title of the question set you wish to view.')
				.setRequired(true)
				.setAutocomplete(true)),

	async autocomplete(interaction, questionSets) {
		const focused = interaction.options.getFocused().toLowerCase();
		const choices = questionSets.filter((set) => set.toLowerCase().startsWith(focused) || stringSimilarity(focused, set) > 0.5);
		await interaction.respond(choices.map((set) => ({ name: set, value: set })));
	},

	async execute(interaction) {
		await interaction.deferReply();

		const title = interaction.options.getString('title');

		let titleExists = false;
		let dataRes;
		let questRes;

		try {
			// Checks if title exists
			await get(ref(database, `questionSets/${title}`)).then((snapshot) => {
				if (snapshot.exists()) {
					titleExists = true;
					dataRes = snapshot.val();
				}
			});
		} catch (error) {
			return interaction.editReply({
				content: 'Database reference error.',
			});
		}

		// If it doesn't, return with an error.
		if (!titleExists) {
			return interaction.editReply({
				content: `No question set of name ${title}.`,
			});
		} else {
			await get(ref(database, `questionLists/${title}/questions`)).then((snapshot) => {
				if (snapshot.exists()) {
					questRes = snapshot.val();
				}
			});
		}

		// Attempts to create a summary embed for the question set information
		try {
			const summary = QuestionInfoEmbed(title, questRes.length, dataRes);

			interaction.channel.send({
				embeds: [summary],
			});

			return interaction.editReply({
				content: 'Question set found!',
			});
		} catch (error) {
			console.log(error);
			return interaction.editReply({
				content: 'Failure to summarize question set info!',
			});
		}
	}
};