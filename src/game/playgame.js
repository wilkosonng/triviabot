const { threshold } = require('../../config.json');
const { stringSimilarity } = require('string-similarity-js');
const { BuzzEmbed, PlayerLeaderboardEmbed, ResultEmbed, QuestionEmbed, TeamLeaderboardEmbed } = require('../helpers/embeds.js');

// Starts the game passed through.
async function playGame(channel, startChannel, teamInfo, players, losePoints, numSeconds, set, questions) {
	let questionNumber = 1;
	let ended = false;

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

	while (questions.length && !ended) {
		// Asks a new question and sends it in the channel.
		const nextQuestion = questions.shift();
		const questionEmbed = QuestionEmbed(set, questionNumber, nextQuestion);
		const msg = await channel.send({
			embeds: [questionEmbed]
		});

		try {
			// After the question is sent, look for a player buzz.
			const buzz = await channel.awaitMessages({
				filter: (m) => players.has(m.author.id) && m.content.toLowerCase() === 'buzz',
				max: 1,
				time: 20_000,
				errors: ['time']
			});

			const answerer = buzz.first().author;
			const answerTeam = players.get(answerer.id).team;
			const numAnswers = nextQuestion.multi;

			questionEmbed
				.setDescription('Player has buzzed in. Question has been hidden.')
				.setImage(null);

			msg.edit({
				embeds: [questionEmbed]
			});

			await channel.send({
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
					await channel.send({
						embeds: [ResultEmbed('correct', nextQuestion, losePoints, answerer.username, ans)]
					});
				} else {
					if (losePoints) {
						players.get(answerer.id).score--;
						teamInfo.get(answerTeam).score--;
					}
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
				await channel.send({
					embeds: [ResultEmbed('time', nextQuestion, losePoints, answerer.username)]
				});
			}
		} catch (nobuzz) {
			// If no player buzzes in, sends an acknowledgement and move on to the next question.
			await channel.send({
				embeds: [ResultEmbed('nobuzz', nextQuestion, losePoints, null, null)]
			});
		}

		await new Promise(r => setTimeout(r, 5_000));
		questionNumber++;
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

// Judges the answers for correctness using string similarity.
function judgeAnswer(question, response) {
	const answers = [...question.answer];

	if (question.multi > 1) {
		// If the question is a multi-part question, judges all parts.
		let correct = 0;
		for (const res of response.values()) {
			if (answers.some((ans) => {
				if (stringSimilarity(ans, res.content) > answerThreshold(ans)) {
					answers.splice(answers.indexOf(ans), 1);
					return true;
				}
				return false;
			})) {
				correct++;
			}

			if (correct === question.multi) {
				return true;
			}
		}
		return false;
	} else {
		// For single-part questions, simply returns if the response is close enough to one of the answers.
		return answers.some((ans) => {
			return stringSimilarity(ans, response.first().content) > answerThreshold(ans);
		});
	}
}

// Defines a tolerance for how similar a submission must be to an answer to be "correct"
function answerThreshold(str) {
	return 0.95 * Math.pow(Math.E, -(threshold / str.length));
}

module.exports = {
	playGame: playGame
};