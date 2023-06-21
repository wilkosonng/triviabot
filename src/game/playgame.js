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
			questionEmbed.setDescription('Player has buzzed in. Question has been hidden.');

			msg.edit({
				embeds: [questionEmbed]
			});

			await channel.send({
				embeds: [generateBuzzEmbed(answerer.username, answerTeam, msg.client)]
			});

			try {
				const ans = await channel.awaitMessages({
					filter: (m) => m.author.id === answerer.id,
					max: Math.max(1, nextQuestion.multi),
					time: 10_000,
					errors: ['time']
				});

				if (judgeAnswer(nextQuestion, ans)) {
					players.get(answerer.id).score++;
					teamInfo.get(answerTeam).score++;
					await channel.send({
						embeds: [generateResultEmbed('correct', nextQuestion, losePoints, answerer.username, ans.content)]
					});
				} else {
					players.get(answerer.id).score--;
					teamInfo.get(answerTeam).score--;
					await channel.send({
						embeds: [generateResultEmbed('incorrect', nextQuestion, losePoints, answerer.username, ans.content)]
					});
				}
			} catch (err) {
				console.error(err);
				players.get(answerer.id).score--;
				teamInfo.get(answerTeam).score--;
				await channel.send({
					embeds: [generateResultEmbed('time', nextQuestion, losePoints, buzz.author.displayName)]
				});
			}
		} catch (err) {
			console.error(err);
			await channel.send({
				embeds: [generateResultEmbed('nobuzz', nextQuestion, losePoints, null)]
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

function generateTeamEmbed(teamInfo) {
	const msg = new EmbedBuilder()
		.setColor(0xD1576D)
		.setTitle('🏆 Team Standings 🏆');
	let description = '';

	const sorted = new Map([...(teamInfo.entries())].sort((a, b) => b[1].score - a[1].score));
	for (const [_, info] of sorted) {
		description += `\`${info.score} points\` - ${info.name}`;
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
		description += `\`${info.score} points\` - ${info.name}`;
	}
	return msg.setDescription(description);
}

function generateQuestionEmbed(set, num, question) {
	const msg = new EmbedBuilder()
		.setColor(0xD1576D)
		.setTitle(`❔ ${set} ※ Question ${num} ❔`)
		.setDescription(question?.question ?? '_ _');

	return msg;
}

function generateBuzzEmbed(playerName, team, client) {
	const emoji = client.emojis.cache.get(team);
	const msg = new EmbedBuilder()
		.setColor(0xD1576D)
		.setTitle(`${emoji} ${playerName} has buzzed in! ${emoji}`)
		.setDescription('You have 10 seconds to answer!');

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
		.addFields(
			{
				name: 'Question',
				value: question.question
			},
			{
				name: 'Answer',
				value: question.answer.join(', ')
			});

	if (response) {
		msg.addFields({
			name: 'Player Response',
			value: [...response.values()].join(', ')
		});
	}

	return msg;
}

function judgeAnswer(question, response) {
	if (question.multi > 1) {
		let correct = 0;
		for (const res of response.values()) {
			if (question.answer.some((ans) => {
				return stringSimilarity(ans, res.content) > answerThreshold(ans);
			})) {
				correct++;
			}

			if (correct === question.multi) {
				return true;
			}
		}
		return false;
	} else {
		return question.answer.some((ans) => {
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