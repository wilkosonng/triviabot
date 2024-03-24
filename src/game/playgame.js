const { judgeAnswer, processResult, wait } = require('../helpers/helpers');
const { BuzzEmbed, PlayerLeaderboardEmbed, ResultEmbed, QuestionEmbed, TeamLeaderboardEmbed } = require('../helpers/embeds.js');

const commands = ['endtrivia', 'teamlb', 'tlb', 'playerlb', 'plb'];

// Starts the game passed through.
async function playGame(channel, startChannel, teamInfo, players, losePoints, numSeconds, set, questions) {
	let questionNumber = 1;
	let ended = false;

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

	while (questions.length && !ended) {
		// Asks a new question and sends it in the channel.
		const nextQuestion = questions.shift();
		const questionEmbed = QuestionEmbed(set, questionNumber, nextQuestion);
		const msg = await channel.send({
			embeds: [questionEmbed]
		});

		let result = null, response = null, answerer = null, answerTeam = null;

		try {
			// After the question is sent, look for a player buzz.
			const buzz = await channel.awaitMessages({
				filter: (m) => players.has(m.author.id) && m.content.toLowerCase() === 'buzz',
				max: 1,
				time: 20_000,
				errors: ['time']
			});

			answerer = buzz.first().author;
			answerTeam = players.get(answerer.id).team;
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
				response = await channel.awaitMessages({
					filter: (m) => m.author.id === answerer.id && !commands.includes(m.content),
					max: numAnswers,
					time: 1_000 * numSeconds * numAnswers,
					errors: ['time']
				});

				// Judges the player's answer
				result = judgeAnswer(nextQuestion, response) ? 'correct' : 'incorrect';
			} catch (time) {
				// If a player who buzzes in, runs out of time, calculates new score depending on settings.
				result = 'timeout';
			}
		} catch (nobuzz) {
			// If no player buzzes in, sends an acknowledgement and move on to the next question.
			result = 'nobuzz';
		}

		await processResult(result, nextQuestion, response, answerTeam, answerer, teamInfo, players, channel, losePoints);
		await wait(4_000);
		questionNumber++;
	}

	if (!ended) {
		endGame();
	}

	channel.send({
		content: '## Game Ended! Final Standings:',
		embeds: [TeamLeaderboardEmbed(teamInfo, losePoints), PlayerLeaderboardEmbed(players, losePoints)]
	});

	function endGame() {
		ended = true;
		commandCollector.stop();
	}
}

module.exports = {
	playGame: playGame
};