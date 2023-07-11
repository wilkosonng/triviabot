const { SlashCommandBuilder } = require('discord.js');
const { teams, teamEmojis } = require('../../config.json');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, get } = require('firebase/database');
const { playGame } = require('../game/playgame');
const { stringSimilarity } = require('string-similarity-js');
const { StartEmbed } = require('../helpers/embeds.js');
require('dotenv').config();

const firebaseApp = initializeApp(JSON.parse(process.env.FIREBASE_CREDS));
const database = getDatabase(firebaseApp);
const currGames = new Set();

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

	async autocomplete(interaction, questionSets) {
		const focused = interaction.options.getFocused().toLowerCase();
		const choices = questionSets.filter((set) => set.toLowerCase().startsWith(focused) || stringSimilarity(focused, set) > 0.5);
		await interaction.respond(choices.map((set) => ({ name: set, value: set })));
	},

	async execute(interaction) {
		await interaction.deferReply();

		if (currGames.has(interaction.channel.id)) {
			await interaction.editReply('Error: Game has already started in this channel!');
			return;
		}

		let set = interaction.options?.getString('questionset');
		const numTeams = interaction.options?.getInteger('teams') ?? 1;
		const losePoints = interaction.options?.getBoolean('losepoints') ?? true;
		const shuffle = interaction.options?.getBoolean('shuffle') ?? true;
		const channel = interaction.channel;
		const teamInfo = new Map();
		const players = new Map();
		let questions, description, reactionCollector;
		let titleExists = false;

		currGames.add(channel.id);
		for (let i = 0; i < numTeams; i++) {
			teamInfo.set(teamEmojis[i], {
				name: teams[i],
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
			console.error(error);
			return interaction.editReply({
				content: 'Database reference error.',
			});
		}

		// If it doesn't, return with an error.
		if (set == null) {
			currGames.delete(channel.id);
			return interaction.editReply({
				content: 'No question sets found in database.',
			});
		} else if (!titleExists) {
			currGames.delete(channel.id);
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
			await channel.send({
				embeds: [StartEmbed(set, description, numTeams, teamInfo)]
			})
				.then(async (msg) => {
					for (let i = 0; i < numTeams; i++) {
						await msg.react(msg.client.emojis.cache.get(teamEmojis[i]));
					}

					await msg.react('❌');

					reactionCollector = msg.createReactionCollector({
						filter: (reaction, user) => !user.bot && (reaction.emoji.name === '❌' || teamEmojis.includes(reaction.emoji.id)),
						time: 120_000
					});

					reactionCollector.on('collect', (reaction, user) => {
						const newTeam = reaction.emoji.id;
						const player = user.id;

						if (players.has(player)) {
							const oldTeam = players.get(player)['team'];

							if (oldTeam === newTeam) {
								return;
							}

							teamInfo.get(oldTeam).players.delete(player);
						}

						if (reaction.emoji.name === '❌') {
							players.delete(player);
							msg.edit(
								{
									embeds: [StartEmbed(set, description, numTeams, teamInfo)]
								}
							);
							return;
						}

						teamInfo.get(newTeam).players.add(player);
						players.set(player, {
							name: user.username,
							team: newTeam,
							score: 0
						});

						msg.edit(
							{
								embeds: [StartEmbed(set, description, numTeams, teamInfo)]
							}
						);
					});
				});

		} catch (error) {
			console.error(error);
			currGames.delete(channel.id);
			return interaction.editReply({
				content: 'Oops, something went wrong when preparing the set.',
			});
		}

		const startCollector = channel.createMessageCollector({
			filter: (msg) => msg.author?.id === interaction.user.id && (msg.content.toLowerCase() === 'endtrivia' || (msg.content.toLowerCase() === 'ready')),
			time: 180_000
		});

		startCollector.on('collect', async (msg) => {
			const lowercaseMsg = msg.content.toLowerCase();
			switch (lowercaseMsg) {
				case 'ready': {
					if (players.size) {
						startCollector.stop();
						reactionCollector.stop();
						msg.reply('Game starting... Type `endtrivia` to end the game, `playerlb` to access player scores, `teamlb` to access team scores, and `buzz` to buzz in for a question!');
						await playGame(channel, teamInfo, players, losePoints, set, questions);
						currGames.delete(channel.id);
					} else {
						channel.send('Need at least one player to start!');
					}
					break;
				};
				case 'endtrivia': {
					endGame();
					msg.reply('Game ended');
					break;
				};
			}
		});

		startCollector.on('end', (_, reason) => {
			switch (reason) {
				case 'time': {
					channel.send('Game timed out');
					break;
				}
				case 'user': {
					return;
				}
				default: {
					channel.send('Oops, something went wrong!');
					break;
				}
			}
			endGame();
		});

		// Thanos time
		function endGame() {
			startCollector.stop();
			reactionCollector.stop();
			currGames.delete(channel.id);
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