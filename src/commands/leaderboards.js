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

const nav = ['alltime', 'weekly', 'monthly'];

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
				.setName('stat')
				.setDescription('Which statistic to sort the leaderboards by? Ranked Score by default.')
				.setRequired(false)
				.addChoices(
					{ name: 'Ranked Score', value: 'rankedScore' },
					{ name: 'Ranked Correct', value: 'rankedCorrect' },
					{ name: 'Ranked Incorrect', value: 'rankedIncorrect' },
					{ name: 'Ranked Timeouts', value: 'rankedTimeout' },
					{ name: 'Ranked Buzzes', value: 'rankedBuzzes' },
					{ name: 'Ranked Games Played', value: 'rankedPlayed' },
					{ name: 'Ranked Accuracy', value: 'rankedAccuracy' },
					{ name: 'Unranked Score', value: 'unrankedScore' },
					{ name: 'Unranked Correct', value: 'unrankedCorrect' },
					{ name: 'Unranked Incorrect', value: 'unrankedIncorrect' },
					{ name: 'Unranked Timeouts', value: 'unrankedTimeout' },
					{ name: 'Unranked Buzzes', value: 'unrankedBuzzes' },
					{ name: 'Unranked Games Played', value: 'unrankedPlayed' },
					{ name: 'Unranked Accuracy', value: 'unrankedAccuracy' },
				))
		.addStringOption(option =>
			option
				.setName('type')
				.setDescription('Which leaderboard to bring up? All Time by default.')
				.setRequired(false)
				.addChoices(
					{ name: 'Weekly', value: 'weekly' },
					{ name: 'Monthly', value: 'monthly' },
					{ name: 'All Time', value: 'alltime' }
				)),

	async execute(interaction, stats) {
		const stat = interaction.options.getString('stat') ?? 'rankedScore';
		let type = interaction.options.getString('type') ?? 'alltime';
		let currIndex = nav.indexOf(type);

		// Computes sorted leaderboards for each type of alltime, weekly, monthly.
		const boards = nav.map((e) => getBoard(stats, e).map(getMapping(stat)));
		boards.forEach(e => e.sort((a, b) => b[1] - a[1]));

		let currBoard = boards[currIndex];
		let maxPage = Math.ceil(currBoard.length / 10);
		let page = Math.min(interaction.options.getInteger('page') ?? 1, maxPage);

		const msg = await interaction.reply({
			embeds: [GeneralLeaderboardEmbed(page, maxPage, currBoard, type, stat)],
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
				page = (page + 1) > maxPage ? Math.min(1, maxPage) : page + 1;
			} else {
				// Handle leaderboard type swap.
				currIndex = (currIndex + 1) % nav.length;
				type = nav[currIndex];
				currBoard = boards[currIndex];
				maxPage = Math.ceil(currBoard.length / 10);
				page = Math.min(maxPage, page);
			}
			buttonInteraction.update({
				embeds: [GeneralLeaderboardEmbed(page, maxPage, currBoard, type, stat)],
			});
		});

		collector.on('end', () => {
			return msg.edit({
				components: []
			});
		});

	}
};

// Returns a function to extract the relevant value from the player statistics objects.
function getMapping(query) {
	switch (query) {
		// Primitive values that are directly stored
		case 'rankedScore':
		case 'rankedCorrect':
		case 'rankedIncorrect':
		case 'rankedTimeout':
		case 'rankedPlayed':
		case 'unrankedScore':
		case 'unrankedCorrect':
		case 'unrankedIncorrect':
		case 'unrankedTimeout':
		case 'unrankedPlayed':
			return ([p, e]) => [p, e[query]];

		// Derivative values that require additional mapping.
		case 'rankedBuzzes':
			return ([p, e]) => [p, e['rankedCorrect'] + e['rankedIncorrect'] + e['rankedTimeout']];
		case 'unrankedBuzzes':
			return ([p, e]) => [p, e['unrankedCorrect'] + e['unrankedIncorrect'] + e['unrankedTimeout']];
		case 'rankedAccuracy':
			return ([p, e]) => [p, e['rankedIncorrect'] + e['rankedTimeout'] === 0 ? (e['rankedCorrect'] > 0 ? 100 : 0)
			                                                                       : Math.round(e['rankedCorrect'] / (e['rankedCorrect'] + e['rankedIncorrect'] + e['rankedTimeout']) * 10_000) / 100];
		case 'unrankedAccuracy':
			return ([p, e]) => [p, e['unrankedIncorrect'] + e['unrankedTimeout'] === 0 ? (e['unrankedCorrect'] > 0 ? 100 : 0)
			                                                                           : Math.round(e['unrankedCorrect'] / (e['unrankedCorrect'] + e['unrankedIncorrect'] + e['unrankedTimeout']) * 10_000) / 100];
	}
}

function getBoard(leaderboards, type) {
	return leaderboards[type] === '' ? [] : Object.entries(leaderboards[type]);
}