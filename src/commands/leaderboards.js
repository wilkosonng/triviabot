const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, SlashCommandBuilder } = require('discord.js');
const { GeneralLeaderboardEmbed } = require('../helpers/embeds');

const navRow = new ActionRowBuilder()
	.setComponents(
		new ButtonBuilder()
			.setCustomId('prev')
			.setStyle(ButtonStyle.Secondary)
			.setEmoji('⬅️'),
		new ButtonBuilder()
			.setCustomId('switch')
			.setStyle(ButtonStyle.Secondary)
			.setEmoji('🔄'),
		new ButtonBuilder()
			.setCustomId('next')
			.setStyle(ButtonStyle.Secondary)
			.setEmoji('➡️'));

const nav = ['alltime', 'daily', 'weekly', 'monthly'];

module.exports = {
	data: new SlashCommandBuilder()
		.setName('leaderboards')
		.setDescription('Lists the current leaderboards')
		.addIntegerOption(option =>
			option
				.setName('page')
				.setDescription('What page of leaderboards to start at? 1 by default.')
				.setMinValue(1)
				.setRequired(false))
		.addStringOption(option =>
			option
				.setName('type')
				.setDescription('Which leaderboard to bring up? All Time by default.')
				.setRequired(false)
				.addChoices(
					{ name: 'Daily', value: 'daily' },
					{ name: 'Weekly', value: 'weekly' },
					{ name: 'Monthly', value: 'monthly' },
					{ name: 'All Time', value: 'alltime' }
				)),

	async execute(interaction, leaderboards) {
		let type = interaction.options.getString('type') ?? 'alltime';
		let currIndex = nav.indexOf(type);
		let currBoard = getCurrBoard(leaderboards, type);
		let maxPage = Math.ceil(currBoard.length / 10);
		let page = Math.min(interaction.options.getInteger('page') ?? 1, maxPage);

		const msg = await interaction.reply({
			embeds: [GeneralLeaderboardEmbed(page, maxPage, currBoard, type)],
			components: [navRow]
		});

		const collector = msg.createMessageComponentCollector({
			componentType: ComponentType.Button,
			time: maxPage * 25_000 + 15_000
		});

		collector.on('collect', (buttonInteraction) => {
			if (buttonInteraction.customId === 'prev') {
				page = (page - 1) < 1 ? maxPage : page - 1;
			} else if (buttonInteraction.customId === 'next') {
				page = (page + 1) > maxPage ? 1 : page + 1;
			} else {
				// Handle leaderboard type swap.
				currIndex = (currIndex + 1) % nav.length;
				type = nav[currIndex];
				currBoard = getCurrBoard(leaderboards, type);
				maxPage = Math.ceil(currBoard.length / 10);
				page = Math.min(maxPage, page);
			}
			buttonInteraction.update({
				embeds: [GeneralLeaderboardEmbed(page, maxPage, currBoard, type)],
			});
		});

		collector.on('end', () => {
			return msg.edit({
				components: []
			});
		});

	}
};

function getCurrBoard(leaderboards, type) {
	return leaderboards[type] === '' ? [] : Object.entries(leaderboards[type]);
}