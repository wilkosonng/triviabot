const { threshold } = require('../../config.json');
const similarity = require('string-similarity');
const { EmbedBuilder, MessageCollector } = require('discord.js');

// Starts the game passed through.

async function playGame(channel, teamInfo, players, losePoints, set, questions, client) {
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
				endGame();
				break;
			}
			case 'teamlb': {
				channel.send({
					embeds: [generatePlayerEmbed(teamInfo)]
				});
				break;
			}
			case 'playerlb': {
				channel.send({
					embeds: [generateTeamEmbed(players)]
				});
				break;
			}
		}
	}));

	while (questions.length && !ended) {
		const nextQuestion = questions.shift();

		await channel.send(
			{
				embeds: [generateQuestionEmbed(set, questionNumber, nextQuestion)]
			})
			.then((msg) => {
				channel.awaitMessages({
					filter: (m) => players.has(m.author.id) && m.content.toLowerCase() === 'buzz',
					max: 1,
					time: 20_000
				})
					.then((async (buzz) => {
						const answerer = buzz.author.id;
						const answerTeam = teamInfo.get(players.get(answerer).team);
						msg.edit({
							embeds: [msg.embeds[0].setDescription('_ _')]
						});

						await channel.send({
							embeds: [generateBuzzEmbed(buzz.author.displayName, answerTeam, client)]
						});

						channel.awaitMessages({
							filter: (m) => m.author.id === buzz.author.id,
							max: 1,
							time: 10_000
						})
							.then((ans) => {
								if (judgeAnswer(question, ans.content)) {
									channel.send({
										embeds: [generateResultEmbed('correct', nextQuestion, losePoints, buzz.author.displayName, ans.content)]
									});
								} else {
									channel.send({
										embeds: [generateResultEmbed('incorrect', nextQuestion, losePoints, buzz.author.displayName, ans.content)]
									});
								}
							})
							.catch(() => {
								channel.send({
									embeds: [generateResultEmbed('time', nextQuestion, losePoints, buzz.author.displayName)]
								});
							});
					}))
					.catch(() => {
						awaitchannel.send({
							embeds: [generateResultEmbed('nobuzz', nextQuestion, losePoints, null)]
						});
					});
			});
	}

	if (!ended) {
		endGame();
	}

	channel.send({
		embeds: [generateTeamEmbed(), generatePlayerEmbed()]
	});

	function endGame() {
		ended = true;
		commandCollector.stop();
	}
}

function generateTeamEmbed() {
	const msg = new EmbedBuilder()
		.setColor(0xD1576D)
		.setTitle('🏆 Team Standings 🏆')
		.setDescription(description);

	return msg;
}

function generatePlayerEmbed() {
	const msg = new EmbedBuilder()
		.setColor(0xD1576D)
		.setTitle('🏆 Player Standings 🏆')
		.setDescription(description);

	return msg;
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

function generataResultEmbed(correct, question, losePoints, answerer, response) {
	let emoji, message, description;
	switch (correct) {
		case 'correct': {
			emoji = '✅';
			message = 'Correct!';
			description = `${answerer} has just scored themselves and their team 1 point!`;
		}
		case 'incorrect': {
			emoji = '❌';
			message = 'Incorrect';
			description = losePoints ? `${answerer} has just lost their team 1 point!` : `Unfortunately, ${answerer} did not answer correctly!`;
		}
		case 'time': {
			emoji = '⏱️';
			message = 'Time\'s Up!';
			description = losePoints ? `${answerer} has just lost their team 1 point!` : `Unfortunately, ${answerer} did not answer correctly!`;
		}
		case 'nobuzz': {
			emoji = '😭';
			message = 'No takers?';
			description = 'Cold feet, eh? No change in the standings.';
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
			value: response
		});
	}

	return msg;
}

function judgeAnswer(question, answer) {
	return string-similary
}

// Defines a tolerance for how similar a submission must be to an answer to be "correct"
function answerThreshold(str) {
	return 0.95 * Math.pow(Math.E, -(threshold / str.length()));
}

module.exports = {
	playGame: playGame
};