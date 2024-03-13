const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { NoSubscriberBehavior, VoiceConnectionStatus, createAudioPlayer, entersState, joinVoiceChannel, getVoiceConnection } = require('@discordjs/voice');
const { teams, teamEmojis } = require('../../config.json');
const { playVoiceGame } = require('../game/playvoicegame');
const { awaitAudioPlayerReady, randomize, updateLeaderboards } = require('../helpers/helpers');
const { StartEmbed } = require('../helpers/embeds');
const { existsSync, mkdirSync } = require('fs');
const { join } = require('path');
const { ref, get } = require('firebase/database');
const { stringSimilarity } = require('string-similarity-js');
const { TextToSpeechClient } = require('@google-cloud/text-to-speech');
require('dotenv').config();

const cacheFolder = join(__dirname, '../..', 'cache');

// Initializes TTS API access
const ttsClient = new TextToSpeechClient({ credentials: JSON.parse(process.env.GOOGLE_CREDS) });

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
		.setName('startvoicegame')
		.setDescription('Starts a voice game of trivia in the user\'s current voice channel.')
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

	async execute(interaction, database, currSets, currGames, currGuilds) {
		await interaction.deferReply();

		let set = interaction.options?.getString('questionset');
		const numTeams = interaction.options?.getInteger('teams') ?? 1;
		const ranked = interaction.options?.getBoolean('ranked') ?? false;
		const losePoints = interaction.options?.getBoolean('losepoints') ?? true;
		const shuffle = interaction.options?.getBoolean('shuffle') ?? true;
		const channel = interaction.options?.getChannel('channel') ?? interaction.channel;
		const numSeconds = interaction.options?.getInteger('time') ?? 10;
		const startChannel = interaction.channel;
		const guildId = interaction.guildId;
		const teamInfo = new Map();
		const players = new Map();
		let questions, description, joinCollector, connection, audioPlayer;

		const user = await interaction.member.fetch();
		const voiceChannel = user.voice?.channel;

		// Ensures the user is in a proper voice channel.
		if (!voiceChannel) {
			return interaction.editReply('You must be in a voice channel in order to use this command!');
		}

		// Avoids duplicate games in the channel.
		if (currGames.has(channel.id)) {
			await interaction.editReply('Error: Game has already started in this channel!');
			return;
		}

		// Checks that the bot has permissions for the voice channel,
		if (!voiceChannel.permissionsFor(interaction.client.user.id).has(PermissionsBitField.Flags.ViewChannel)) {
			return await interaction.editReply('Error: No permissions to view voice channel!');
		}

		if (!voiceChannel.permissionsFor(interaction.client.user.id).has(PermissionsBitField.Flags.Speak)) {
			return await interaction.editReply('No permissions to speak in voice channel!');
		}

		// Checks that the bot has permissions for the channel,
		if (!channel.permissionsFor(interaction.client.user.id).has(PermissionsBitField.Flags.ViewChannel)) {
			return await interaction.editReply('Error: No permissions to view text channel!');
		}

		if (!channel.permissionsFor(interaction.client.user.id).has(PermissionsBitField.Flags.SendMessages)) {
			return await interaction.editReply('Error: No permissions to send messages in text channel!');
		}

		// If the game is ranked, checks if the user has permission to start a ranked game.
		if (ranked && !interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
			return await interaction.editReply('Error: User does not have permissions to start a ranked game!');
		}

		// Avoids duplicate voice games in the same guild.
		if (currGuilds.has(guildId)) {
			await interaction.editReply('Error: Voice game has already started in this guild!');
			return;
		}

		// Adds game to list of ongoing games.
		currGames.add(channel.id);
		currGuilds.add(guildId);

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
					questions = [...snapshot.val().entries()];
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
			// Sends and activates the embed for game information and joining
			const msg = await channel.send({
				embeds: [StartEmbed(set, description, numTeams, teamInfo)],
				components: [rows[numTeams]]
			});

			joinCollector = msg.createMessageComponentCollector({
				filter: (buttonInteraction) => !buttonInteraction.user.bot,
				componentType: ComponentType.Button,
				time: 300_000
			});

			// Sets up voice behavior and joins the proper voice channel.
			audioPlayer = createAudioPlayer({
				behaviors: {
					noSubscriber: NoSubscriberBehavior.Pause,
				},
			});

			connection = joinVoiceChannel({
				channelId: voiceChannel.id,
				guildId: guildId,
				adapterCreator: voiceChannel.guild.voiceAdapterCreator,
			});

			connection.subscribe(audioPlayer);

			connection.on(VoiceConnectionStatus.Disconnected, async () => {
				try {
					await Promise.race([
						entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
						entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
					]);
					// Seems to be reconnecting to a new channel - ignore disconnect
				} catch (error) {
					// Seems to be a real disconnect which SHOULDN'T be recovered from
					connection.destroy();
				}
			});

			// Handles user interactions to join or leave the game.
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
						const setPath = join(cacheFolder, set);
						startCollector.stop();
						joinCollector.stop();

						// Check if the set exists in cache; if it doesn't, creates the directory.
						if (!existsSync(setPath)) {
							mkdirSync(setPath);
						}

						msg.reply('Game starting... Type `endtrivia` to end the game, `playerlb` to access player scores, and `teamlb` to access team scores!');
						await playVoiceGame(channel, startChannel, teamInfo, players, losePoints, numSeconds, set, questions, description, connection, audioPlayer, ttsClient, setPath);
						endGame();

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
			currGuilds.delete(guildId);

			awaitAudioPlayerReady(audioPlayer, () => {
				audioPlayer.stop();
				if (getVoiceConnection(guildId)) {
					getVoiceConnection(guildId).destroy();
				}
			});
		}

		await interaction.editReply('Game successfully started! Type \`ready\` once all users have joined or \`endtrivia\` to end the game!');
		return;
	}
};