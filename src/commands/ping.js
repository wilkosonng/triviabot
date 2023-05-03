const { SlashCommandBuilder } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('ping')
		.setDescription('Get ponged back!'),
	async execute(interaction) {
		await interaction.reply({
			content: 'Pong!',
			ephemeral: true,
		});
		return;
	}
};