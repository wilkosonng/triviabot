const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, SlashCommandBuilder } = require('discord.js');
const { stringSimilarity } = require('string-similarity-js');
const { ListEmbed } = require('../helpers/embeds.js');

const navRow = new ActionRowBuilder()
	.setComponents(
		new ButtonBuilder()
			.setCustomId('prev')
			.setStyle(ButtonStyle.Secondary)
			.setEmoji('⬅️'),
		new ButtonBuilder()
			.setCustomId('next')
			.setStyle(ButtonStyle.Secondary)
			.setEmoji('➡️'));

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
		const keyword = interaction.options.getString('title')?.toLowerCase();

		if (keyword) {
			currSets = currSets.filter((set) => stringSimilarity(set[0], keyword) > 0.5 || set[0].toLowerCase().includes(keyword));
		}

		if (!currSets.length) {
			return interaction.reply({
				content: 'No sets matching query found!'
			});
		}

		const maxPage = Math.ceil(currSets.length / 10);
		let page = Math.min(interaction.options.getInteger('page') ?? 1, maxPage);

		const msg = await interaction.reply({
			embeds: [ListEmbed(page, maxPage, keyword, currSets)],
			components: maxPage > 1 ? [navRow] : []
		});

		if (maxPage > 1) {
			const collector = msg.createMessageComponentCollector({
				componentType: ComponentType.Button,
				time: maxPage * 15_000
			});

			collector.on('collect', (buttonInteraction) => {
				if (buttonInteraction.customId === 'prev') {
					page = (page - 1) < 1 ? maxPage : page - 1;
				} else {
					page = (page + 1) > maxPage ? 1 : page + 1;
				}
				buttonInteraction.update({
					embeds: [ListEmbed(page, maxPage, keyword, currSets)],
				});
			});

			collector.on('end', () => {
				return msg.edit({
					components: []
				});
			});
		}
	}
};