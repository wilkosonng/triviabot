const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { ref, get } = require('firebase/database');
const { stringSimilarity } = require('string-similarity-js');
const { deleteSet } = require('../helpers/helpers');
const { join } = require('path');
const { rmSync } = require('fs');
require('dotenv').config;

const cacheFolder = join(__dirname, '../..', 'cache');

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

	async execute(interaction, database, currSets, voiceSets) {
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

		// Checks if there is an active voice game for the set.
		if (voiceSets.has(title)) {
			return interaction.editReply({
				content: 'Cannot remove a set with an ongoing voice game!'
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

		// Checks if the user has sufficient permissions.
		if (owner === user.id || user.permissions.has(PermissionsBitField.Flags.Administrator)) {
			if (deleteSet(database, title)) {
				// If operation is successful, check if it has cached audio files and delete them.
				try {
					rmSync(join(cacheFolder, title), { recursive: true, force: true });
				} catch (err) {
					if (err.code !== 'ENOENT') {
						console.log(`Could not delete cache of ${title}`);
						console.error(err);
					}
				}

				return interaction.editReply({
					content: `Successfully removed question set ${title}!`,
				});
			} else {
				return interaction.editReply({
					content: 'Failed to remove question set!',
				});
			}
		} else {
			return interaction.editReply({
				content: 'Insufficient permissions to delete question set: must be creator or admin.',
			});
		}
	}
};