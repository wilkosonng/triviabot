const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { teams, teamEmojis } = require('../../config.json');
const { ref, get } = require('firebase/database');
const { playGame } = require('../game/playgame');
const { stringSimilarity } = require('string-similarity-js');
const { updateLeaderboards, randomize } = require('../helpers/helpers');
const { StartEmbed } = require('../helpers/embeds');

require('dotenv').config();

// Sets up action rows for joining the game
const rows = [new ActionRowBuilder()];

teamEmojis.forEach((emoji, i) => {
	rows.push(ActionRowBuilder.from(rows[i])
		.addComponents(
			new ButtonBuilder()
				.setCustomId(`${i}`)
				.setStyle(ButtonStyle.Primary)
				.setEmoji(emoji))
	);
});

rows.map(row => row.addComponents(
	new ButtonBuilder()
		.setCustomId('leave')
		.setStyle(ButtonStyle.Secondary)
		.setEmoji('❌')
));

module.exports = {
	data: new SlashCommandBuilder()
		.setName('startgame')
		.setDescription('Starts a game of trivia in the current channel.')
		.addStringOption(option =>
			option
				.setName('questionset')
				.setDescription('Which question set to use? Random by default.')
				.setAutocomplete(true)
				.setRequired(false))
		.addBooleanOption(option =>
			option
				.setName('ranked')
				.setDescription('Ranked game? Ranked games count towards leaderboards. False by default (requires admin).')
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
				.setRequired(false))
		.addIntegerOption(option =>
			option
				.setName('time')
				.setMinValue(1)
				.setMaxValue(60)
				.setDescription('Number of seconds (1-60) to answer each question. 10 seconds by default.')
				.setRequired(false))
		.addChannelOption(option =>
			option
				.setName('channel')
				.setDescription('Channel to play in. Current channel by default.')
				.setRequired(false)),

	// Autocompletes question sets
	async autocomplete(interaction, questionSets) {
		const focused = interaction.options.getFocused().toLowerCase();
		const choices = questionSets.filter((set) => set.toLowerCase().startsWith(focused) || stringSimilarity(focused, set) > 0.5);
		await interaction.respond(choices.map((set) => ({ name: set, value: set })));
	},

	async execute(interaction, database, currSets, currGames) {
		await interaction.deferReply();

		let set = interaction.options?.getString('questionset');
		const numTeams = interaction.options?.getInteger('teams') ?? 1;
		const ranked = interaction.options?.getBoolean('ranked') ?? false;
		const losePoints = interaction.options?.getBoolean('losepoints') ?? true;
		const shuffle = interaction.options?.getBoolean('shuffle') ?? true;
		const channel = interaction.options?.getChannel('channel') ?? interaction.channel;
		const numSeconds = interaction.options?.getInteger('time') ?? 10;
		const startChannel = interaction.channel;
		const teamInfo = new Map();
		const players = new Map();
		let questions, description, joinCollector;

		// Avoids duplicate games in the channel.
		if (currGames.has(channel.id)) {
			await interaction.editReply('Error: Game has already started in this channel!');
			return;
		}

		// Checks that the bot has permissions for the channel,
		if (!channel.permissionsFor(interaction.client.user.id).has(PermissionsBitField.Flags.ViewChannel)) {
			return await interaction.editReply('Error: No permissions to view channel!');
		}

		if (!channel.permissionsFor(interaction.client.user.id).has(PermissionsBitField.Flags.SendMessages)) {
			return await interaction.editReply('Error: No permissions to send messages in channel!');
		}

		// If the game is ranked, checks if the user has permission to start a ranked game.
		if (ranked && !interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
			return await interaction.editReply('Error: User does not have permissions to start a ranked game!');
		}

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
				set = currSets[Math.random() * currSets.length | 0];
			} else if (!currSets.includes(set)) {
				currGames.delete(channel.id);
				return interaction.editReply({
					content: `No question set of name ${set}.`
				});
			}

			// Gets set metadata.
			await get(ref(database, `questionSets/${set}`)).then((snapshot) => {
				if (snapshot.exists()) {
					description = snapshot.val().description;
				}
			});

			// Get set questions.
			await get(ref(database, `questionLists/${set}/questions`)).then((snapshot) => {
				if (snapshot.exists()) {
					questions = snapshot.val();
					if (shuffle) {
						randomize(questions);
					}
				}
			});
		} catch (error) {
			console.error(error);
			return interaction.editReply({
				content: 'Database reference error.',
			});
		}

		try {
			// Ah yes, socket timeout.
			const msg = await channel.send({
				embeds: [StartEmbed(set, description, numTeams, teamInfo)],
				components: [rows[numTeams]]
			});

			joinCollector = msg.createMessageComponentCollector({
				filter: (buttonInteraction) => !buttonInteraction.user.bot,
				componentType: ComponentType.Button,
				time: 300_000
			});

			joinCollector.on('collect', (buttonInteraction) => {
				const customId = buttonInteraction.customId;
				const newTeam = customId === 'leave' ? null : teamEmojis[parseInt(customId)];
				const player = buttonInteraction.user.id;
				const username = buttonInteraction.user.username;
				const joined = players.has(player);

				if (joined) {
					// If the player has already joined, return if it is the same team.
					const oldTeam = players.get(player)['team'];

					if (oldTeam === newTeam) {
						return buttonInteraction.reply({
							content: `Already joined ${teams[parseInt(customId)]} team!`,
							ephemeral: true
						});
					}

					teamInfo.get(oldTeam).players.delete(player);
				}

				if (customId === 'leave') {
					// If the player is in a team, delete them - else, reply that they have not yet joined.
					players.delete(player);

					return joined ?
						buttonInteraction.update(
							{
								embeds: [StartEmbed(set, description, numTeams, teamInfo)
									.setFooter({ text: `${username} has left the game!` })]
							}
						) :
						buttonInteraction.reply({
							content: 'You have yet to join a team!',
							ephemeral: true
						});
				}

				// Otherwise, process the join and update the embed.
				teamInfo.get(newTeam).players.add(player);
				players.set(player, {
					name: username,
					team: newTeam,
					score: 0
				});

				return buttonInteraction.update(
					{
						embeds: [StartEmbed(set, description, numTeams, teamInfo)
							.setFooter({ text: `${username} has ${joined ? 'changed to' : 'joined'} ${teams[parseInt(customId)]}!` })]
					}
				);
			});

			joinCollector.on('end', () => {
				msg.edit({
					components: []
				});
			});
		} catch (error) {
			console.error(error);
			currGames.delete(channel.id);
			return interaction.editReply({
				content: 'Oops, something went wrong when preparing the set.',
			});
		}

		const startCollector = startChannel.createMessageCollector({
			filter: (msg) => msg.author?.id === interaction.user.id && (msg.content.toLowerCase() === 'endtrivia' || (msg.content.toLowerCase() === 'ready')),
			time: 180_000
		});

		// Handles chat commands for control flow purposes.
		startCollector.on('collect', async (msg) => {
			const lowercaseMsg = msg.content.toLowerCase();
			switch (lowercaseMsg) {
				case 'ready':
					if (players.size) {
						startCollector.stop();
						joinCollector.stop();
						msg.reply('Game starting... Type `endtrivia` to end the game, `playerlb` to access player scores, `teamlb` to access team scores, and `buzz` to buzz in for a question!');
						await playGame(channel, startChannel, teamInfo, players, losePoints, numSeconds, set, questions);
						currGames.delete(channel.id);

						// If the game was ranked, updates the leaderboards.
						if (ranked) {
							updateLeaderboards(database, players);
						}
					} else {
						channel.send('Need at least one player to start!');
					}
					break;
				case 'endtrivia':
					endGame();
					msg.reply('Game ended');
					break;
			}
		});

		// Cleans up on game timeout or something going wrong.
		startCollector.on('end', (_, reason) => {
			switch (reason) {
				case 'time':
					channel.send('Game timed out');
					break;
				case 'user':
					return;
				default:
					channel.send('Oops, something went wrong!');
					break;
			}
			endGame();
		});

		// Thanos time
		function endGame() {
			startCollector.stop();
			joinCollector.stop();
			currGames.delete(channel.id);
		}

		await interaction.editReply('Game successfully started! Type \`ready\` once all users have joined or \`endtrivia\` to end the game!');
		return;
	}
};