const { SlashCommandBuilder } = require('discord.js');
const { NoSubscriberBehavior, VoiceConnectionStatus, AudioPlayerStatus, StreamType, createAudioPlayer, createAudioResource, entersState, joinVoiceChannel, getVoiceConnection } = require('@discordjs/voice');
const { buzzers } = require('../../config.json');
const path = require('path');
const { Readable } = require('stream');
const { TextToSpeechClient } = require('@google-cloud/text-to-speech');
require('dotenv').config();

const audioFolder = path.join(__dirname, '../..', 'public', 'audio');

// Initializes TTS API access
const ttsClient = new TextToSpeechClient({ credentials: JSON.parse(process.env.GOOGLE_CREDS) });

module.exports = {
	data: new SlashCommandBuilder()
		.setName('soundtest')
		.setDescription('Tests sound')
		.addStringOption(option =>
			option
				.setName('text')
				.setDescription('What text to speak?')
				.setRequired(true)),

	async execute(interaction) {
		const text = interaction.options.getString('text');
		const user = await interaction.member.fetch();
		const channel = user.voice?.channel;

		if (!channel) {
			return interaction.reply('You must be in a voice channel in order to use this command!');
		}

		await interaction.deferReply();

		const player = createAudioPlayer({
			behaviors: {
				noSubscriber: NoSubscriberBehavior.Pause,
			},
		});

		const connection = joinVoiceChannel({
			channelId: channel.id,
			guildId: channel.guild.id,
			adapterCreator: channel.guild.voiceAdapterCreator,
		});

		connection.subscribe(player);

		connection.on(VoiceConnectionStatus.Ready, async () => {
			console.log('ready');

			const [response] = await ttsClient.synthesizeSpeech({
				input: { text: text },
				voice: { languageCode: 'en-US', name: 'en-US-Standard-J', ssmlGender: 'MALE' },
				audioConfig: { audioEncoding: 'OGG_OPUS' },
			});
			player.play(createAudioResource(Readable.from(response.audioContent)));
		});

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
	}
};