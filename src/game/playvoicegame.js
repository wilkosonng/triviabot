const { buzzers, teams, teamEmojis } = require('../../config.json');
const { open, readdirSync } = require('fs');
const { writeFile } = require('fs/promises');
const { join } = require('path');
const { awaitAudioPlayerReady, judgeAnswer } = require('../helpers/helpers');
const { BuzzEmbed, PlayerLeaderboardEmbed, ResultEmbed, VoiceQuestionEmbed, TeamLeaderboardEmbed } = require('../helpers/embeds');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { AudioPlayerStatus, StreamType, createAudioResource } = require('@discordjs/voice');

const audioFolder = join(__dirname, '../..', 'public', 'audio');

// Sets up action row for buzzing in.
const buzzActionRow = new ActionRowBuilder()
	.addComponents(
		new ButtonBuilder()
			.setCustomId('buzz')
			.setLabel('Buzz in')
			.setStyle(ButtonStyle.Primary)
			.setEmoji(teamEmojis[0]));

const buzzersFiles = buzzers.map((e) => join(audioFolder, e));
const teamFiles = teams.map((e) => join(audioFolder, `${e.toLowerCase()}team.ogg`));
const emojiMap = new Map(teamEmojis.map((e, i) => [e, i]));

const incorrectSound = join(audioFolder, 'incorrect.ogg');
const correctSound = join(audioFolder, 'correct.ogg');
const timeSound = join(audioFolder, 'time.ogg');
const nobuzzSound = join(audioFolder, 'nobuzz.ogg');

// Starts the game passed through.
async function playVoiceGame(channel, startChannel, teamInfo, players, losePoints, numSeconds, set, questions, description, connection, audioPlayer, ttsClient, setPath) {
	const questionStarted = [false];
	let questionNumber = 1;
	let ended = false;
	let cached = false;
	let currentGeneration;

	// Sets up and executes in-game commands.
	const commandCollector = startChannel.createMessageCollector({
		filter: (msg) => {
			const content = msg.content.toLowerCase();
			return content === 'endtrivia' || content === 'teamlb' || content === 'playerlb';
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
				channel.send({
					embeds: [TeamLeaderboardEmbed(teamInfo)]
				});
				break;
			case 'playerlb':
				channel.send({
					embeds: [PlayerLeaderboardEmbed(players)]
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

		// Asks a new question and sends it in the channel.
		const [questionId, nextQuestion] = questions.shift();
		const questionEmbed = VoiceQuestionEmbed(set, questionNumber, nextQuestion);

		const msg = await channel.send({
			embeds: [questionEmbed],
			components: [buzzActionRow]
		});

		speakQuestion(ttsClient, audioPlayer, questionId, questionNumber, questionStarted, setPath);

		try {
			// After the question is sent, look for a player buzz.
			const buzz = await msg.awaitMessageComponent({
				filter: (i) => players.has(i.user.id) && questionStarted[0],
				time: 20_000,
				componenentType: ComponentType.Button
			});

			const answerer = buzz.user;
			const answerTeam = players.get(answerer.id).team;
			const numAnswers = nextQuestion.multi;

			questionEmbed
				.setDescription(`${answerer.username} has buzzed in!`)
				.setImage(null);

			msg.edit({
				embeds: [questionEmbed],
				components: []
			});

			speakBuzz(audioPlayer, answerTeam);

			await buzz.reply({
				embeds: [BuzzEmbed(answerer.username, answerTeam, msg.client, numAnswers, numSeconds)]
			});

			try {
				// If a player buzzes in, awaits an answer from that player.
				const ans = await channel.awaitMessages({
					filter: (m) => m.author.id === answerer.id && !['endtrivia', 'playerlb', 'teamlb'].includes(m.content),
					max: numAnswers,
					time: 1_000 * numSeconds * numAnswers,
					errors: ['time']
				});

				// Judges the player's answer and updates the new score.
				if (judgeAnswer(nextQuestion, ans)) {
					players.get(answerer.id).score++;
					teamInfo.get(answerTeam).score++;

					speakResult(audioPlayer, 'correct', questionId, setPath);

					await channel.send({
						embeds: [ResultEmbed('correct', nextQuestion, losePoints, answerer.username, ans)]
					});
				} else {
					if (losePoints) {
						players.get(answerer.id).score--;
						teamInfo.get(answerTeam).score--;
					}

					speakResult(audioPlayer, 'incorrect', questionId, setPath);

					await channel.send({
						embeds: [ResultEmbed('incorrect', nextQuestion, losePoints, answerer.username, ans)]
					});
				}
			} catch (time) {
				// If a player who buzzes in, runs out of time, calculates new score depending on settings.
				if (losePoints) {
					players.get(answerer.id).score--;
					teamInfo.get(answerTeam).score--;
				}

				speakResult(audioPlayer, 'time', questionId, setPath);

				await channel.send({
					embeds: [ResultEmbed('time', nextQuestion, losePoints, answerer.username)]
				});
			}
		} catch (nobuzz) {
			// If no player buzzes in, sends an acknowledgement and move on to the next question.
			msg.edit({
				components: []
			});

			speakResult(audioPlayer, 'nobuzz', questionId, setPath);

			await channel.send({
				embeds: [ResultEmbed('nobuzz', nextQuestion, losePoints, null, null)]
			});
		}

		await new Promise(r => setTimeout(r, 3_000));
		questionNumber++;
		questionStarted[0] = false;
	}

	if (!ended) {
		endGame();
	}

	channel.send({
		content: '## Game Ended! Final Standings:',
		embeds: [TeamLeaderboardEmbed(teamInfo), PlayerLeaderboardEmbed(players)]
	});


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
		stop = Math.min(questions.length, 9) + 1;
	} else {
		// Otherwise, prepare the next 10 questions
		if (questions.length < 6) {
			// If there are no more questions to prepare, just return.
			return;
		}
		start = 6;
		stop = Math.min(questions.length, 15) + 1;
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

async function speakQuestion(ttsClient, audioPlayer, questionId, questionNumber, questionStarted, path) {
	const questionNumberPath = join(audioFolder, 'questions', `question${questionNumber}.ogg`);
	const questionPath = join(path, `question${questionId}.ogg`);

	await synthesizeAsync(ttsClient, `Question ${questionNumber}`, questionNumberPath);
	audioPlayer.play(createAudioResource(questionNumberPath), { inputType: StreamType.OggOpus });

	awaitAudioPlayerReady(audioPlayer, async () => {
		await new Promise(r => setTimeout(r, 500));
		audioPlayer.play(createAudioResource(questionPath, { inputType: StreamType.OggOpus }));
		questionStarted[0] = true;
	});
}

function speakBuzz(audioPlayer, team) {
	audioPlayer.pause();
	audioPlayer.play(createAudioResource(buzzersFiles[emojiMap.get(team)], { inputType: StreamType.OggOpus }));

	awaitAudioPlayerReady(audioPlayer, async () => {
		await new Promise(r => setTimeout(r, 200));
		audioPlayer.play(createAudioResource(teamFiles[emojiMap.get(team)], { inputType: StreamType.OggOpus }));
	});
}

function speakResult(audioPlayer, result, questionId, path) {
	const answerPath = join(path, `answer${questionId}.ogg`);

	switch (result) {
		case 'correct':
			audioPlayer.play(createAudioResource(correctSound, { inputType: StreamType.OggOpus }));
			break;
		case 'incorrect':
			audioPlayer.play(createAudioResource(incorrectSound, { inputType: StreamType.OggOpus }));
			awaitAudioPlayerReady(audioPlayer, async () => {
				await new Promise(r => setTimeout(r, 200));
				audioPlayer.play(createAudioResource(answerPath, { inputType: StreamType.OggOpus }));
			});
			break;
		case 'time':
			audioPlayer.play(createAudioResource(timeSound, { inputType: StreamType.OggOpus }));
			awaitAudioPlayerReady(audioPlayer, async () => {
				await new Promise(r => setTimeout(r, 200));
				audioPlayer.play(createAudioResource(answerPath, { inputType: StreamType.OggOpus }));
			});
			break;
		case 'nobuzz':
			audioPlayer.play(createAudioResource(nobuzzSound, { inputType: StreamType.OggOpus }));
			awaitAudioPlayerReady(audioPlayer, async () => {
				await new Promise(r => setTimeout(r, 200));
				audioPlayer.play(createAudioResource(answerPath, { inputType: StreamType.OggOpus }));
			});
			break;
	}
}

module.exports = {
	playVoiceGame: playVoiceGame
};