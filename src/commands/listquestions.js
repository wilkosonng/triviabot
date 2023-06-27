const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { stringSimilarity } = require('string-similarity-js');

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
			sets = sets.filter((ans) => stringSimilarity(ans[0], keyword) > 5);
		}

		if (!sets.length) {
			return interaction.reply({
				content: 'No sets matching query found!'
			});
		}

		const maxPage = Math.ceil(sets.length / 10);
		const page = Math.min(interaction.options.getInteger('page') ?? 1, maxPage);

		return interaction.reply({
			embeds: [generateListEmbed(page, maxPage, keyword, sets)]
		});
	}
};

function generateListEmbed(page, maxPage, keyword, questions) {
	const leftIndex = 10 * (page - 1);
	const rightIndex = Math.min(10 * page, questions.length);
	const slice = questions.slice(leftIndex, rightIndex);
	let description = keyword ? `Filtered by ${keyword}\n\n` : '';

	for ([title, info] of slice) {
		description += `\`${title}\` - <@${info.owner}>\n`;
	}

	return new EmbedBuilder()
		.setColor(0xD1576D)
		.setTitle(`Page ${page} of ${maxPage}`)
		.setDescription(description)
		.setFooter({ text: `Questions ${leftIndex + 1} to ${rightIndex}` });

}