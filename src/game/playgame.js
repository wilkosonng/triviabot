const { threshold, teams, teamEmojis } = require('../../config.json');
const similarity = require('string-similarity');
const { EmbedBuilder, Events } = require('discord.js');

let gameCollector;

// Starts the game passed through.

async function playGame(channel, teamInfo, players, losePoints, set, questions, client) {
	const commandCollector = channel.createMessageCollector({
		filter: (msg) => {
			const content = msg.content.toLowerCase();
			return content === 'endtrivia' || content === 'leaderboards';
		}
	});
}

// Defines a tolerance for how similar a submission must be to an answer to be "correct"

function answerThreshold(str) {
	return 0.95 * Math.pow(Math.E, -(threshold / str.length()));
}

module.exports = {
	playGame: playGame
};