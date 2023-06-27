const { threshold } = require('../../config.json');
const { stringSimilarity } = require('string-similarity-js');
const { EmbedBuilder } = require('discord.js');

// Starts the game passed through.
async function playGame(channel, teamInfo, players, losePoints, set, questions) {
	let questionNumber = 1;
	let ended = false;

	const commandCollector = channel.createMessageCollector({
		filter: (msg) => {
			const content = msg.content.toLowerCase();
			return content === 'endtrivia' || content === 'teamlb' || content === 'playerlb';
		}
	});

	commandCollector.on('collect', (msg => {
		const command = msg.content.toLowerCase();
		switch (command) {
			case 'endtrivia': {
				msg.reply('Game ending after next question!');
				endGame();
				break;
			}
			case 'teamlb': {
				channel.send({
					embeds: [generateTeamEmbed(teamInfo)]
				});
				break;
			}
			case 'playerlb': {
				channel.send({
					embeds: [generatePlayerEmbed(players)]
				});
				break;
			}
		}
	}));

	while (questions.length && !ended) {
		const nextQuestion = questions.shift();
		const questionEmbed = generateQuestionEmbed(set, questionNumber, nextQuestion);
		const msg = await channel.send({
			embeds: [questionEmbed]
		});

		try {
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
				embeds: [generateBuzzEmbed(answerer.username, answerTeam, msg.client, numAnswers)]
			});

			try {
				const ans = await channel.awaitMessages({
					filter: (m) => m.author.id === answerer.id && !['endtrivia', 'playerlb', 'teamlb'].includes(m.content),
					max: numAnswers,
					time: 10_000 * numAnswers,
					errors: ['time']
				});

				if (judgeAnswer(nextQuestion, ans)) {
					players.get(answerer.id).score++;
					teamInfo.get(answerTeam).score++;
					await channel.send({
						embeds: [generateResultEmbed('correct', nextQuestion, losePoints, answerer.username, ans)]
					});
				} else {
					if (losePoints) {
						players.get(answerer.id).score--;
						teamInfo.get(answerTeam).score--;
					}
					await channel.send({
						embeds: [generateResultEmbed('incorrect', nextQuestion, losePoints, answerer.username, ans)]
					});
				}
			} catch (time) {
				if (losePoints) {
					players.get(answerer.id).score--;
					teamInfo.get(answerTeam).score--;
				}
				await channel.send({
					embeds: [generateResultEmbed('time', nextQuestion, losePoints, answerer.username)]
				});
			}
		} catch (nobuzz) {
			await channel.send({
				embeds: [generateResultEmbed('nobuzz', nextQuestion, losePoints, null, null)]
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
		embeds: [generateTeamEmbed(teamInfo), generatePlayerEmbed(players)]
	});

	function endGame() {
		ended = true;
		commandCollector.stop();
	}
}

/* %%%%%%%%%%%%%%%%
 * EMBED GENERATORS
 * %%%%%%%%%%%%%%%%
 * TODO: Maybe move all embeds across the bot to a single embed file.
*/
function generateTeamEmbed(teamInfo) {
	const msg = new EmbedBuilder()
		.setColor(0xD1576D)
		.setTitle('🏆 Team Standings 🏆');

	let description = '';
	const sorted = new Map([...(teamInfo.entries())].sort((a, b) => b[1].score - a[1].score));
	for (const [_, info] of sorted) {
		description += `\`${info.score} points\` - ${info.name}\n`;
	}

	return msg.setDescription(description);
}

function generatePlayerEmbed(players) {
	const msg = new EmbedBuilder()
		.setColor(0xD1576D)
		.setTitle('🏆 Player Standings 🏆');

	let description = '';
	const sorted = new Map([...(players.entries())].sort((a, b) => b[1].score - a[1].score));
	for (const [_, info] of sorted) {
		description += `\`${info.score} points\` - ${info.name}\n`;
	}
	return msg.setDescription(description);
}

function generateQuestionEmbed(set, num, question) {
	const msg = new EmbedBuilder()
		.setColor(0xD1576D)
		.setTitle(`❔ ${set} ※ Question ${num} ❔`)
		.setDescription(`${question.multi > 1 ? 'This is a ' + question.multi + ' part question. ' : ''}${question?.question ?? '_ _'}`);

	if (question.img) {
		msg.setImage(question.img);
	}

	return msg;
}

function generateBuzzEmbed(playerName, team, client, numAnswers) {
	const emoji = client.emojis.cache.get(team);
	const msg = new EmbedBuilder()
		.setColor(0xD1576D)
		.setTitle(`${emoji} ${playerName} has buzzed in! ${emoji}`)
		.setDescription(`You have ${10 * numAnswers} seconds to answer!`);

	return msg;
}

function generateResultEmbed(correct, question, losePoints, answerer, response) {
	let emoji, message, description;
	switch (correct) {
		case 'correct': {
			emoji = '✅';
			message = 'Correct!';
			description = `${answerer} has just scored themselves and their team 1 point!`;
			break;
		}
		case 'incorrect': {
			emoji = '❌';
			message = 'Incorrect';
			description = losePoints ? `${answerer} has just lost their team 1 point!` : `Unfortunately, ${answerer} did not answer correctly!`;
			break;
		}
		case 'time': {
			emoji = '⏱️';
			message = 'Time\'s Up!';
			description = losePoints ? `${answerer} has just lost their team 1 point!` : `Unfortunately, ${answerer} did not answer correctly!`;
			break;
		}
		case 'nobuzz': {
			emoji = '😭';
			message = 'No takers?';
			description = 'Cold feet, eh? No change in the standings.';
			break;
		}
	}
	const msg = new EmbedBuilder()
		.setColor(0xD1576D)
		.setTitle(`${emoji} ${message} ${emoji}`)
		.setDescription(description)
		.setFields(
			{
				name: 'Question',
				value: question.question
			},
			{
				name: 'Answer',
				value: question.answer.join(', ')
			});

	if (response != null) {
		msg.addFields({
			name: 'Player Response',
			value: [...response.values()].join(', ')
		});
	}

	return msg;
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