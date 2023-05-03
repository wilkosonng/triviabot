const { SlashCommandBuilder, EmbedBuilder, bold, underscore, time, userMention } = require('discord.js');
const { firebaseCreds } = require('../../config.json');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, get } = require('firebase/database');

const firebaseApp = initializeApp(firebaseCreds);
const database = getDatabase(firebaseApp);

module.exports = {
	data: new SlashCommandBuilder()
		.setName('questioninfo')
		.setDescription('Provides information on a question set')
		.addStringOption(option =>
			option
				.setName('title')
				.setDescription('The title of the question set you wish to remove')
				.setRequired(true)),

	async execute(interaction) {
		await interaction.deferReply();

		const title = interaction.options.getString('title');

		let titleExists = false;
		let dataRes = null;
		let questRes = null;

		try {
			// Checks if title exists

			await get(ref(database, `questionSets/${title}`)).then((snapshot) => {
				if (snapshot.exists()) {
					titleExists = true;
					dataRes = snapshot.val();
				}
			});
		} catch (error) {
			return interaction.editReply({
				content: 'Database reference error.',
			});
		}

		// If it doesn't, return with an error.

		if (!titleExists) {
			return interaction.editReply({
				content: `No question set of name ${title}.`,
			});
		} else {
			await get(ref(database, `questionLists/${title}/questions`)).then((snapshot) => {
				if (snapshot.exists()) {
					questRes = snapshot.val();
				}
			});
		}

		// Attempts to create a summary embed for the question set information

		try {
			const summary = new EmbedBuilder()
				.setColor(0xD1576D)
				.setTitle(title)
				.setDescription(dataRes.description)
				.addFields(
					{ name: bold(underscore('Topic Creator')), value: userMention(dataRes.owner) },
					{ name: bold(underscore('Number of Questions')), value: questRes.length.toString() },
					{ name: bold(underscore('Date Created')), value: time(Math.trunc(dataRes.timestamp / 1000)) },
				)
				.setTimestamp();

			interaction.channel.send({
				embeds: [summary],
			});

			return interaction.editReply({
				content: 'Question set found!',
			});
		} catch (error) {
			console.log(error);
			return interaction.editReply({
				content: 'Failure to summarize question set info!',
			});
		}
	}
};