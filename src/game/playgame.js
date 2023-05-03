// Starts the game passed through.

function startGame(game) {
	game.active = true;
}

// Defines a tolerance for how similar a submission must be to an answer to be "correct"

function answerThreshold(str) {
	return 0.95 * Math.pow(Math.E, -(threshold / str.length()));
}

// Defines a shuffle algorithm to randomize questions.

function randomize(questions) {
	for (let i = questions.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[questions[i], questions[j]] = [questions[j], questions[i]];
	}
}

module.exports = startGame;