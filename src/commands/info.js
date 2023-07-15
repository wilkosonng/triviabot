const { SlashCommandBuilder } = require('discord.js');
const { InfoEmbed } = require('../helpers/embeds.js');
const { stringSimilarity } = require('string-similarity-js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('info')
		.setDescription('Get info on the bot and its commands.')
		.addStringOption(option =>
			option
				.setName('command')
				.setDescription('The command to acquire info about. If unfilled, provides general information on the bot.')
				.setRequired(false)
				.setAutocomplete(true)),

	async autocomplete(interaction, commands) {
		const focused = interaction.options.getFocused().toLowerCase();
		const choices = commands.filter((command) => command.toLowerCase().startsWith(focused) || stringSimilarity(focused, command) > 0.5);
		await interaction.respond(choices.map((set) => ({ name: set, value: set })));
	},

	async execute(interaction, commands) {
		const command = interaction.options.getString('command')?.toLowerCase();

		if (command != null && commands.indexOf(command) === -1) {
			return interaction.reply('Command not found');
		} else {
			return interaction.reply({
				embeds: [InfoEmbed(command)]
			});
		}
	}
};