const { SlashCommandBuilder } = require('discord.js');
const { stringSimilarity } = require('string-similarity-js');
const { ListEmbed } = require('../helpers/embeds.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('listquestions')
		.setDescription('Lists a page of available trivia sets')
		.addIntegerOption(option =>
			option
				.setName('page')
				.setDescription('What page of question sets to search? 1 by default.')
				.setMinValue(1)
				.setRequired(false))
		.addStringOption(option =>
			option
				.setName('name')
				.setDescription('Search for specific sets via their name.')
				.setRequired(false)),
	async execute(interaction, sets) {
		const keyword = interaction.options.getString('name');

		if (keyword) {
			sets = sets.filter((ans) => stringSimilarity(ans[0], keyword) > 0.5);
		}

		if (!sets.length) {
			return interaction.reply({
				content: 'No sets matching query found!'
			});
		}

		const maxPage = Math.ceil(sets.length / 10);
		const page = Math.min(interaction.options.getInteger('page') ?? 1, maxPage);

		return interaction.reply({
			embeds: [ListEmbed(page, maxPage, keyword, sets)]
		});
	}
};