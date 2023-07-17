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

	async execute(interaction, currSets) {
		await interaction.deferReply();

		const title = interaction.options.getString('title');

		let dataRes;
		let questRes;

		// Checks if title exists
		if (!currSets.includes(title)) {
			return interaction.editReply({
				content: `No question set of name ${title}.`
			});
		}

		try {
			// Gets question set info
			await get(ref(database, `questionSets/${title}`)).then((snapshot) => {
				if (snapshot.exists()) {
					dataRes = snapshot.val();
				}
			});

			await get(ref(database, `questionLists/${title}/questions`)).then((snapshot) => {
				if (snapshot.exists()) {
					questRes = snapshot.val();
				}
			});
		} catch (error) {
			return interaction.editReply({
				content: 'Database reference error.',
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