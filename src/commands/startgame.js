const { SlashCommandBuilder, Events, EmbedBuilder } = require('discord.js');
const { teams, teamEmojis } = require('../../config.json');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, get } = require('firebase/database');
const { playGame } = require('../game/playGame');
require('dotenv').config();

const firebaseApp = initializeApp(JSON.parse(process.env.FIREBASE_CREDS));
const database = getDatabase(firebaseApp);
const currGames = new Map();

module.exports = {
	data: new SlashCommandBuilder()
		.setName('start')
		.setDescription('Starts a game of trivia in the current channel.')
		.addStringOption(option =>
			option
				.setName('questionset')
				.setDescription('Which question set to use? Random by default.')
				.setAutocomplete(true)
				.setRequired(false))
		.addBooleanOption(option =>
			option
				.setName('shuffle')
				.setDescription('Shuffle questions? True by default.')
				.setRequired(false))
		.addIntegerOption(option =>
			option
				.setName('teams')
				.setDescription('How many teams to play (1-4)? 1 by default.')
				.setMinValue(1)
				.setMaxValue(4)
				.setRequired(false))
		.addBooleanOption(option =>
			option
				.setName('losepoints')
				.setDescription('Lose points on wrong answer? True by default.')
				.setRequired(false)),

	async execute(interaction) {
		await interaction.deferReply();

		if (currGames.has(interaction.channel)) {
			await interaction.editReply('Error: Game has already started in this channel!');
			return;
		}

		let set = interaction.options?.getString('questionset');
		const numTeams = interaction.options?.getInteger('teams') ?? 1;
		const losePoints = interaction.options?.getBoolean('losepoints') ?? true;
		const shuffle = interaction.options?.getBoolean('shuffle') ?? true;
		const channel = interaction.channel;
		const host = interaction.user;
		const teamInfo = new Map();
		const players = new Map();
		let questions, description, collector;
		let titleExists = false;

		currGames.set(channel, {});
		for (let i = 0; i < numTeams; i++) {
			teamInfo.set(teamEmojis[i], {
				players: new Set(),
				score: 0
			});
		}

		try {
			// If the set is undefined, chooses a random set.
			if (set == null) {
				await get(ref(database, 'questionSets')).then((snapshot) => {
					if (snapshot.exists()) {
						const sets = snapshot.val();
						const setNames = Object.keys(sets);
						if (sets.length !== 0) {
							set = setNames[Math.random() * setNames.length | 0];
							description = sets[set].description;
							titleExists = true;
						}
					} else {
						return interaction.editReply({
							content: 'No question sets in database.',
						});
					}
				});
			}
			// Checks if title exists
			await get(ref(database, `questionSets/${set}`)).then((snapshot) => {
				if (snapshot.exists()) {
					description = snapshot.val().description;
					titleExists = true;
				}
			});
		} catch (error) {
			console.log(error);
			return interaction.editReply({
				content: 'Database reference error.',
			});
		}

		// If it doesn't, return with an error.
		if (!titleExists) {
			return interaction.editReply({
				content: `No question set of name ${set}.`,
			});
		} else {
			await get(ref(database, `questionLists/${set}/questions`)).then((snapshot) => {
				if (snapshot.exists()) {
					questions = snapshot.val();
					if (shuffle) {
						randomize(questions);
					}
				}
			});
		}

		try {
			// Ah yes, socket timeout.
			channel.send({
				embeds: [generateStartEmbed()]
			}).then(async (message) => {
				for (let i = 0; i < numTeams; i++) {
					await message.react(message.client.emojis.cache.get(teamEmojis[i]));
				}

				collector = message.createReactionCollector({
					filter: (reaction, user) => !user.bot && teamEmojis.includes(reaction.emoji.id),
					time: 120_000
				});

				collector.on('collect', (reaction, user) => {
					const newTeam = reaction.emoji.id;
					const player = user.id;

					if (players.has(player)) {
						const oldTeam = players.get(player)['team'];
						if (oldTeam === newTeam) {
							return;
						}
						teamInfo.get(oldTeam).players.delete(player);
					}

					teamInfo.get(newTeam).players.add(player);
					players.set(player, {
						team: newTeam,
						score: 0
					});

					message.edit(
						{
							embeds: [generateStartEmbed()]
						}
					);
					channel.send(`${user.tag} has joined the ${teams[teamEmojis.indexOf(reaction.emoji.id)]} team!`);
				});
			});

			interaction.client.addListener(Events.MessageCreate, gameStartListener);
		} catch (error) {
			console.error(error);
			return;
		}

		function generateStartEmbed() {
			const msg = new EmbedBuilder()
				.setColor(0xD1576D)
				.setTitle(`🧠 ${set} ※ React to join! 🧠`)
				.setDescription(description);

			for (let i = 0; i < numTeams; i++) {
				let teamPlayers = '';

				teamInfo.get(teamEmojis[i]).players.forEach((e) => {
					teamPlayers += `<@${e}>\n`;
				});

				msg.addFields(
					{
						name: teams[i],
						value: teamPlayers === '' ? 'None' : teamPlayers
					}
				);
			}

			return msg;
		}

		// Adds listeners for the ready endtrivia triggers
		function gameStartListener(message) {
			if (message.author?.bot || message.channel !== channel) {
				return;
			}
			const msg = message.content.toLowerCase();

			if (msg === 'endtrivia') {
				interaction.client.removeListener(Events.MessageCreate, gameStartListener);
				currGames.delete(channel);
				collector.stop();
				message.reply('Game ended');
			} else if (message.author?.id === host?.id && msg === 'ready') {
				interaction.client.removeListener(Events.MessageCreate, gameStartListener);
				collector.stop();
				playGame(currGames.get(channel));
			}

			console.log(`Found message: ${message.content} from ${message.author?.id}!`);
			return;
		}

		// Defines a shuffle algorithm to randomize questions.
		function randomize(arr) {
			for (let i = arr.length - 1; i > 0; --i) {
				const j = Math.random() * (i + 1) | 0;
				[arr[i], arr[j]] = [arr[j], arr[i]];
			}
		}


		await interaction.editReply('Game successfully started! Type \`ready\` once all users have joined or \`endtrivia\` to end the game!');
		return;
	}
};