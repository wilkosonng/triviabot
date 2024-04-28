const { buzzers, teams, teamEmojis } = require('../../config.json');
const { open, readdirSync } = require('fs');
const { utimes, writeFile } = require('fs/promises');
const { join } = require('path');
const { awaitAudioPlayerReady, judgeAnswer, processResult, wait } = require('../helpers/helpers');
const { BuzzEmbed, PlayerLeaderboardEmbed, VoiceQuestionEmbed, TeamLeaderboardEmbed } = require('../helpers/embeds');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { StreamType, createAudioResource } = require('@discordjs/voice');
const { getAudioDurationInSeconds } = require('get-audio-duration');

const audioFolder = join(__dirname, '../..', 'public', 'audio');
const commands = ['endtrivia', 'teamlb', 'tlb', 'playerlb', 'plb'];

// Sets up action row for buzzing in.
const buzzActionRow = new ActionRowBuilder()
	.addComponents(
		new ButtonBuilder()
			.setCustomId('buzz')
			.setLabel('Buzz in')
			.setStyle(ButtonStyle.Primary)
			.setEmoji(teamEmojis[0]));

// Prepares constant audio files
const buzzersFiles = buzzers.map((e) => join(audioFolder, e));
const teamFiles = teams.map((e) => join(audioFolder, `${e.toLowerCase()}team.ogg`));
const emojiMap = new Map(teamEmojis.map((e, i) => [e, i]));

const correctSound = join(audioFolder, 'correct.ogg');
const incorrectSound = join(audioFolder, 'incorrect.ogg');
const timeSound = join(audioFolder, 'time.ogg');
const nobuzzSound = join(audioFolder, 'nobuzz.ogg');

// Prepares duration measurements of constant files
let correctDuration, incorrectDuration, timeDuration, nobuzzDuration, buzzerDurations, teamDurations;

(async () => {
	incorrectDuration = Math.ceil((await getAudioDurationInSeconds(incorrectSound)) * 1_000);
	correctDuration = Math.ceil((await getAudioDurationInSeconds(correctSound)) * 1_000);
	timeDuration = Math.ceil((await getAudioDurationInSeconds(timeSound)) * 1_000);
	nobuzzDuration = Math.ceil((await getAudioDurationInSeconds(nobuzzSound)) * 1_000);
	buzzerDurations = await Promise.all(buzzersFiles.map(async (e) => Math.ceil((await getAudioDurationInSeconds(e)) * 1_000)));
	teamDurations = await Promise.all(teamFiles.map(async (e) => Math.ceil((await getAudioDurationInSeconds(e)) * 1_000)));
})();

// Starts the game passed through.
async function playVoiceGame(channel, startChannel, teamInfo, players, losePoints, numSeconds, set, questions, description, audioPlayer, ttsClient, setPath) {
	const questionStarted = [false];
	let questionNumber = 1;
	let ended = false;
	let cached = false;
	let currentGeneration;

	// Sets up and executes in-game commands.
	const commandCollector = startChannel.createMessageCollector({
		filter: (msg) => {
			const content = msg.content.toLowerCase();
			return commands.includes(content);
		}
	});

	commandCollector.on('collect', (msg => {
		const command = msg.content.toLowerCase();
		switch (command) {
			case 'endtrivia':
				msg.reply('Game ending after next question!');
				endGame();
				break;
			case 'teamlb':
			case 'tlb':
				channel.send({
					embeds: [TeamLeaderboardEmbed(teamInfo, losePoints)]
				});
				break;
			case 'playerlb':
			case 'plb':
				channel.send({
					embeds: [PlayerLeaderboardEmbed(players, losePoints)]
				});
				break;
		}
	}));

	// Check if there is a need to generate files.
	if (readdirSync(setPath).length === 2 * questions.length + 1) {
		// If there is a file for each question and answer and the description, everything should be generated.
		cached = true;
	} else {
		// Otherwise, generates the first 10 questions and description.
		await synthesizeAsync(ttsClient, description, join(setPath, 'description.ogg'));
		await prepareNextQuestions(ttsClient, questions, questionNumber, setPath);
	}

	// Sets last modified of audio directory for cache deletion purposes.
	const gameTime = new Date();
	utimes(setPath, gameTime, gameTime);

	// Reads the description.
	audioPlayer.play(createAudioResource(join(setPath, 'description.ogg'), { inputType: StreamType.OggOpus }));

	while (questions.length && !ended) {
		if (!cached && questionNumber % 10 === 5) {
			// If halfway until next batch, begins preparing next batch.
			currentGeneration = prepareNextQuestions(ttsClient, questions, questionNumber, setPath);
		}

		// Ensures next batch is written before beginning.
		if (questionNumber % 10 === 0) {
			await currentGeneration;
		}

		// Make sure there is nothing playing before beginning the next question.
		await awaitAudioPlayerReady(audioPlayer);

		// Wait to account for latency and distance between questions.
		await wait(3_000);

		// Asks a new question and sends it in the channel.
		const [questionId, nextQuestion] = questions.shift();
		const questionEmbed = VoiceQuestionEmbed(set, questionNumber, nextQuestion);

		const msg = await channel.send({
			embeds: [questionEmbed],
			components: [buzzActionRow]
		});

		let result = null, response = null, answerer = null, answerTeam = null;
		const questionDuration = await speakQuestion(ttsClient, audioPlayer, questionId, questionNumber, questionStarted, setPath);

		try {
			// After the question is sent, look for a player buzz.
			const buzz = await msg.awaitMessageComponent({
				filter: (i) => {
					if (!questionStarted[0]) {
						i.reply({
							content: 'Woah there! Slow your horses, buckaroo. The question hasn\'t even started yet!',
							ephemeral: true
						});
						return false;
					}
					return players.has(i.user.id);
				},
				time: 15_000 + questionDuration,
				componenentType: ComponentType.Button
			});

			answerer = buzz.user;
			answerTeam = players.get(answerer.id).team;
			const numAnswers = nextQuestion.multi;

			questionEmbed
				.setDescription(`${answerer.username} has buzzed in!`)
				.setImage(null);

			msg.edit({
				embeds: [questionEmbed],
				components: []
			});

			const buzzDuration = await speakBuzz(audioPlayer, answerTeam);

			await buzz.reply({
				embeds: [BuzzEmbed(answerer.username, answerTeam, msg.client, numAnswers, numSeconds)]
			});

			try {
				// If a player buzzes in, awaits an answer from that player.
				const answerPromise = channel.awaitMessages({
					filter: (m) => m.author.id === answerer.id && !commands.includes(m.content),
					max: numAnswers,
					time: 1_000 * numSeconds * numAnswers,
					errors: ['time']
				});

				await Promise.all([wait(buzzDuration), answerPromise]);
				response = await answerPromise;

				// Judges the player's answer
				result = judgeAnswer(nextQuestion, response) ? 'correct' : 'incorrect';
			} catch (time) {
				// If a player who buzzes in, runs out of time, calculates new score depending on settings.
				result = 'time';
			}
		} catch (nobuzz) {
			// If no player buzzes in, sends an acknowledgement and move on to the next question.
			msg.edit({
				components: []
			});

			result = 'nobuzz';
		}

		const resultDuration = await speakResult(audioPlayer, result, questionId, setPath);
		await processResult(result, nextQuestion, response, answerTeam, answerer, teamInfo, players, channel, losePoints);

		// Wait for result to finish
		await wait(resultDuration);

		questionNumber++;
		questionStarted[0] = false;
	}

	if (!ended) {
		endGame();
	}

	channel.send({
		content: '## Game Ended! Final Standings:',
		embeds: [TeamLeaderboardEmbed(teamInfo, losePoints), PlayerLeaderboardEmbed(players, losePoints)]
	});

	await wait(5_000);

	function endGame() {
		ended = true;
		commandCollector.stop();
	}
}

// Generates up to the next ten questions of the set.
async function prepareNextQuestions(ttsClient, questions, questionNumber, path) {
	let start, stop;
	if (questionNumber === 1) {
		// If it is the first batch, then use first 10 questions
		start = 0;
		stop = Math.min(questions.length, 10);
	} else {
		// Otherwise, prepare the next 10 questions
		if (questions.length < 6) {
			// If there are no more questions to prepare, just return.
			return;
		}
		start = 6;
		stop = Math.min(questions.length, 16);
	}

	// Generates the next question and answer pairs.
	const promises = [];

	for (let i = start; i < stop; i++) {
		const [questionId, { question, answer }] = questions[i];
		promises.push(synthesizeAsync(ttsClient, question, join(path, `question${questionId}.ogg`)));
		promises.push(synthesizeAsync(ttsClient, answer.join(', '), join(path, `answer${questionId}.ogg`)));
	}

	return Promise.all(promises);
}

// Synthesizes the given text and writes it to the given path.
// Returns Promise that resolves to true if the file was generated; false if it was unnecessary (already exists).
async function synthesizeAsync(ttsClient, text, path) {
	return new Promise((resolve) => {
		open(path, async (err) => {
			if (err && err.code === 'ENOENT') {
				// If the file does not exist, generate the text audio.
				try {
					const [response] = await ttsClient.synthesizeSpeech({
						input: { inputSource: 'text', text: text },
						voice: { languageCode: 'en-US', name: 'en-US-Standard-J', ssmlGender: 'MALE' },
						audioConfig: { effectsProfileId: ['headphone-class-device'], audioEncoding: 'OGG_OPUS', pitch: -3 },
					});
					await writeFile(path, response.audioContent, 'binary');
					resolve(true);
				} catch (err) {
					console.error(err);
				}
			} else {
				resolve(false);
			}
		});
	});
}

// Speaks the quesiton number followed by the question. Returns a promise of the duration of both in milliseconds.
async function speakQuestion(ttsClient, audioPlayer, questionId, questionNumber, questionStarted, path) {
	const questionNumberPath = join(audioFolder, 'questions', `question${questionNumber}.ogg`);
	const questionPath = join(path, `question${questionId}.ogg`);

	await synthesizeAsync(ttsClient, `Question ${questionNumber}`, questionNumberPath);
	audioPlayer.play(createAudioResource(questionNumberPath, { inputType: StreamType.OggOpus }));

	awaitAudioPlayerReady(audioPlayer, async () => {
		await wait(500);
		audioPlayer.play(createAudioResource(questionPath, { inputType: StreamType.OggOpus }));
		questionStarted[0] = true;
	});

	return Math.ceil((await getAudioDurationInSeconds(questionPath)) * 1_000);
}

// Speaks the buzzer sound followed by the team acknowledgement. Returns a promise of the duration of both in milliseconds.
async function speakBuzz(audioPlayer, team) {
	const teamIndex = emojiMap.get(team);
	audioPlayer.pause();
	audioPlayer.play(createAudioResource(buzzersFiles[teamIndex], { inputType: StreamType.OggOpus }));

	awaitAudioPlayerReady(audioPlayer, async () => {
		await wait(200);
		audioPlayer.play(createAudioResource(teamFiles[teamIndex], { inputType: StreamType.OggOpus }));
	});

	return buzzerDurations[teamIndex] + teamDurations[teamIndex];
}

// Speaks the result as well as the answer when necessary. Returns a promise of the duration of both in milliseconds.
async function speakResult(audioPlayer, result, questionId, path) {
	const answerPath = join(path, `answer${questionId}.ogg`);
	const answerDuration = Math.ceil((await getAudioDurationInSeconds(answerPath)) * 1_000);
	let totalDuration = 0;

	switch (result) {
		case 'correct':
			audioPlayer.play(createAudioResource(correctSound, { inputType: StreamType.OggOpus }));
			totalDuration += correctDuration;
			break;
		case 'incorrect':
			audioPlayer.play(createAudioResource(incorrectSound, { inputType: StreamType.OggOpus }));
			awaitAudioPlayerReady(audioPlayer, async () => {
				await wait(200);
				audioPlayer.play(createAudioResource(answerPath, { inputType: StreamType.OggOpus }));
			});
			totalDuration += answerDuration + incorrectDuration + 200;
			break;
		case 'time':
			audioPlayer.play(createAudioResource(timeSound, { inputType: StreamType.OggOpus }));
			awaitAudioPlayerReady(audioPlayer, async () => {
				await wait(200);
				audioPlayer.play(createAudioResource(answerPath, { inputType: StreamType.OggOpus }));
			});
			totalDuration += answerDuration + timeDuration + 200;
			break;
		case 'nobuzz':
			audioPlayer.play(createAudioResource(nobuzzSound, { inputType: StreamType.OggOpus }));
			awaitAudioPlayerReady(audioPlayer, async () => {
				await wait(200);
				audioPlayer.play(createAudioResource(answerPath, { inputType: StreamType.OggOpus }));
			});
			totalDuration += answerDuration + nobuzzDuration + 200;
			break;
	}

	return totalDuration;
}

module.exports = {
	playVoiceGame: playVoiceGame
};