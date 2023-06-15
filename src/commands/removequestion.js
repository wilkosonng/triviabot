const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, remove, get } = require('firebase/database');
require('dotenv').config;

const firebaseApp = initializeApp(JSON.parse(process.env.FIREBASE_CREDS));
const database = getDatabase(firebaseApp);

module.exports = {
	data: new SlashCommandBuilder()
		.setName('removequestion')
		.setDescription('Removes a question set to the topic pool (requires admin or owner)')
		.addStringOption(option =>
			option
				.setName('title')
				.setDescription('The title of the question set you wish to remove')
				.setRequired(true)),

	async execute(interaction) {
		await interaction.deferReply();

		const title = interaction.options.getString('title');
		const user = interaction.member;

		let owner = null;
		let titleExists = false;

		try {

			// Checks if title exists

			await get(ref(database, `questionSets/${title}/owner`)).then((snapshot) => {
				if (snapshot.exists()) {
					titleExists = true;
					owner = snapshot.val();
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

				await remove(ref(database, `questionList/${title}`))
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
				content: 'Successfully removed question set!',
			});
		} else {
			return interaction.editReply({
				content: 'Failed to remove question set!',
			});
		}
	}
};