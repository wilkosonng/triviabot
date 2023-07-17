const { SlashCommandBuilder } = require('discord.js');
const { stringSimilarity } = require('string-similarity-js');
const { ListEmbed } = require('../helpers/embeds.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('listsets')
		.setDescription('Lists a page of available trivia sets')
		.addIntegerOption(option =>
			option
				.setName('page')
				.setDescription('What page of question sets to search? 1 by default.')
				.setMinValue(1)
				.setRequired(false))
		.addStringOption(option =>
			option
				.setName('title')
				.setDescription('Search for specific sets via their name.')
				.setRequired(false)),
	async execute(interaction, currSets) {
		const keyword = interaction.options.getString('name')?.toLowerCase();

		if (keyword) {
			currSets = currSets.filter((set) => stringSimilarity(set[0], keyword) > 0.5 || set[0].toLowerCase().includes(keyword));
		}

		if (!currSets.length) {
			return interaction.reply({
				content: 'No sets matching query found!'
			});
		}

		const maxPage = Math.ceil(currSets.length / 10);
		const page = Math.min(interaction.options.getInteger('page') ?? 1, maxPage);

		return interaction.reply({
			embeds: [ListEmbed(page, maxPage, keyword, currSets)]
		});
	}
};