const { SlashCommandBuilder } = require('discord.js');
const { NoSubscriberBehavior, VoiceConnectionStatus, AudioPlayerStatus, StreamType, createAudioPlayer, createAudioResource, entersState, joinVoiceChannel, getVoiceConnection } = require('@discordjs/voice');
const { buzzers } = require('../../config.json');
const { createReadStream } = require('node:fs');
const path = require('path');
const { Readable, PassThrough } = require('stream');
const { AudioConfig, SpeechConfig, SpeechSynthesizer, SpeechSynthesisOutputFormat } = require('microsoft-cognitiveservices-speech-sdk');
require('dotenv').config();

const audioFolder = path.join(__dirname, '../..', 'public', 'audio');
const speechConfig = SpeechConfig.fromSubscription(process.env.AZURE_KEY, process.env.AZURE_REGION);
const audioConfig = AudioConfig.fromAudioFileOutput(path.join(audioFolder, 'questions', 'quesiton1.ogg'));

speechConfig.SpeechSynthesisVoiceName = 'en-US-DavisNeural';

module.exports = {
	data: new SlashCommandBuilder()
		.setName('buzzercheck')
		.setDescription('Check buzzers'),

	async execute(interaction) {
		const user = await interaction.member.fetch();
		const channel = user.voice?.channel;

		if (!channel) {
			return interaction.reply('Not in a channel!');
		}

		await interaction.deferReply();
		const buzzerCheck = createAudioPlayer({
			behaviors: {
				noSubscriber: NoSubscriberBehavior.Pause,
			},
		});

		const connection = joinVoiceChannel({
			channelId: channel.id,
			guildId: channel.guild.id,
			adapterCreator: channel.guild.voiceAdapterCreator,
		});

		connection.subscribe(buzzerCheck);

		connection.on(VoiceConnectionStatus.Ready, () => {
			console.log('ready');

			buzzerCheck.on(AudioPlayerStatus.Idle, () => {
				synthesize('Question 1', speechConfig, audioConfig);
				connection.destroy();
			});
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

async function synthesize(text, speech, audio) {
	const synthesizer = new SpeechSynthesizer(speech, audio);

	synthesizer.speakTextAsync(text,
		(res) => {
			console.log('Synthesized!');
			const { audioData } = res;
			const bufferStream = new PassThrough();
			bufferStream.end(Buffer.from(audioData));
			synthesizer.close();
		},
		(err) => {
			console.log(err);
			synthesizer.close();
		});
}

function playNextState(player, num) {
	player.play(createAudioResource(createReadStream(path.join(audioFolder, 'buzzers', buzzers[num]))), {
		inputType: StreamType.OggOpus
	});
}