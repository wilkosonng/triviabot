const { threshold, teams, teamEmojis } = require('../../config.json');
const { EmbedBuilder } = require('discord.js');

// Starts the game passed through.

function playGame(game) {
	game.active = true;
}

// Defines a tolerance for how similar a submission must be to an answer to be "correct"

function answerThreshold(str) {
	return 0.95 * Math.pow(Math.E, -(threshold / str.length()));
}

module.exports = {
	playGame: playGame
};