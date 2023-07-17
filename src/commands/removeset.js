const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, remove, get } = require('firebase/database');
const { stringSimilarity } = require('string-similarity-js');
require('dotenv').config;

const firebaseApp = initializeApp(JSON.parse(process.env.FIREBASE_CREDS));
const database = getDatabase(firebaseApp);

module.exports = {
	data: new SlashCommandBuilder()
		.setName('removeset')
		.setDescription('Removes a question set to the topic pool (requires admin or owner)')
		.addStringOption(option =>
			option
				.setName('title')
				.setDescription('The title of the question set you wish to remove')
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
		const user = interaction.member;

		let owner = null;

		// Checks if title exists
		if (!currSets.includes(title)) {
			return interaction.editReply({
				content: `No question set of name ${title}.`
			});
		}

		try {
			// Gets owner data
			await get(ref(database, `questionSets/${title}/owner`)).then((snapshot) => {
				if (snapshot.exists()) {
					owner = snapshot.val();
				}
			});
		} catch (error) {
			return interaction.editReply({
				content: 'Database reference error.',
			});
		}

		let deleted = false;

		// Checks if the user has sufficient permissions.
		if (owner === user.id || user.permissions.has(PermissionsBitField.Flags.Administrator)) {
			// Attempts to remove the question set data if they do.
			await remove(ref(database, `questionSets/${title}`))
				.then(() => {
					deleted = true;
				})
				.catch((error) => {
					console.log(error);
				});

			if (deleted) {
				// Attempts to remove the question set questions if the first operation was a success.
				await remove(ref(database, `questionLists/${title}`))
					.catch((error) => {
						deleted = false;
						console.log(error);
					});
			}
		} else {
			return interaction.editReply({
				content: 'Insufficient permissions to delete question set: must be creator or admin.',
			});
		}

		// Returns with the status of if the deletion was auccess
		if (deleted) {
			return interaction.editReply({
				content: `Successfully removed question set ${title}!`,
			});
		} else {
			return interaction.editReply({
				content: 'Failed to remove question set!',
			});
		}
	}
};