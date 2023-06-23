const { SlashCommandBuilder } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('listquestions')
		.setDescription('Lists 10 Trivia Sets')
		.addIntegerOption(option =>
			option
				.setName('page')
				.setDescription('What page of question sets to search? 1 by default.')
				.setMinValue(1)
				.setRequired(false)),
	async execute(interaction, sets) {
		console.log(sets);
	}
};