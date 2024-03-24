const { threshold } = require('../../config.json');
const { ResultEmbed } = require('./embeds');
const { stringSimilarity } = require('string-similarity-js');
const { AudioPlayer, AudioPlayerStatus } = require('@discordjs/voice');
const { get, ref, set, remove } = require('firebase/database');
const { User, Message, TextChannel } = require('discord.js');
const { readdirSync } = require('fs');
const { rm, stat } = require('fs/promises');
const { join } = require('path');

const cacheFolder = join(__dirname, '../..', 'cache');
const cacheTime = 604_800_000;

/**
 * Defines a tolerance for how similar a submission must be to an answer to be "correct"
 * @param {string} str The string to base the threshold on
 *
 * @returns {number} A threshold from 0 to 1 that dicates how close a string must be to be correct.
 */
function answerThreshold(str) {
	return 0.95 * Math.pow(Math.E, -(threshold / str.length));
}

/**
 * Waits for the audio player to reach the idle state, then executes the callback.
 * @param {AudioPlayer} audioPlayer
 * @param {function} callback The callback once the audio player has become idle.
 *
 * @returns {Promise<null>} A promise once the audio player becomes idle.
 */
async function awaitAudioPlayerReady(audioPlayer, callback = () => ({})) {
	return new Promise(async (resolve) => {
		if (audioPlayer?.state?.status === AudioPlayerStatus.Idle) {
			callback();
			resolve(null);
		} else {
			audioPlayer.once(AudioPlayerStatus.Idle, async () => {
				callback();
				resolve(null);
			});
		}
	});
}

async function clearCache() {
	// Gets all cache directories.
	const directories = readdirSync(cacheFolder, { withFileTypes: true })
		.filter(dirent => dirent.isDirectory())
		.map(dirent => dirent.name);

	directories.forEach((cachedSet) => {
		const questionPath = join(cacheFolder, cachedSet);
		stat(questionPath)
			.then(stats => {
				if (Date.now() - stats.mtimeMs >= cacheTime) {
					// If the set hasn't been accessed within the cache time, remove the directory
					rm(questionPath, { recursive: true, force: true })
						.catch(err => {
							console.log(`Error clearing cache of ${cachedSet}`);
							console.error(err);
						});
				}
			})
			.catch((err) => {
				// Something weird happened
				console.error(err);
			});
	});
}

/**
 * Removes the question set data from the Firebase database
 * @param {Database} database Database to delete the question set from
 * @param {string} title Title of the question set
 *
 * @returns {boolean} Whether or not the deletion was a success
*/
function deleteSet(database, title) {
	// TODO: Update to also remove cache if it exists
	try {
		(async () => {
			// Attempts to remove the question set metadata from the database.
			await remove(ref(database, `questionSets/${title}`));

			// Attempts to remove the question set from the database.
			await remove(ref(database, `questionLists/${title}`));
		})();
	} catch (error) {
		console.error(error);
		return false;
	}

	return true;
}

/**
 * Judges a response for correctness based on string similarity
 * @param {Object} question The original question to be judged.
 * @param {Array} response The list of player responses.
 *
 * @returns {boolean} Whether or not the response is considered correct.
 */
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

/**
 * Processes the result of a question, mutating the players and teamInfo maps and sending the correct result embed.
 * @param {String} result The type or result ot process
 * @param {Object} question The question being asked
 * @param {Array} response The list of player responses
 * @param {string} answerTeam The team of the answerer
 * @param {User} answerer The user who answered the question
 * @param {Map<String, Object>} teamInfo A map of the team information
 * @param {Map<String, Object>} players A map of the player information
 * @param {TextChannel} channel The channel to send the embed to
 * @param {boolean} losePoints Whether or not incorrect questions lose points in the current game
 *
 * @returns {Promise<Message>} Returns a promise of the message of the result embed.
 */
async function processResult(result, question, response = null, answerTeam = null, answerer = null, teamInfo, players, channel, losePoints) {
	if (answerer) {
		teamInfo.get(answerTeam)[result]++;
		players.get(answerer.id)[result]++;
	}

	return channel.send({
		embeds: [ResultEmbed(result, question, losePoints, answerer?.username, response)]
	});
}

/**
 * Randomizes a given array in-place.
 * @param {Array} arr Array to be randomized
*/
function randomize(arr) {
	for (let i = arr.length - 1; i > 0; --i) {
		const j = Math.random() * (i + 1) | 0;
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
}

/**
 * Removes all that pesky extraneous white space for consistent styling
 * @param {string} string String to be formatted
 *
 * @returns {string} Original string with extraneous white space removed
*/
function removeWhiteSpace(string) {
	return string.trim().replaceAll(/\s+/g, ' ');
}

/**
 * Resets a given leaderboard
 * @param {Database} database Database to reset
 * @param {string} leaderboard Which leaderboard to reset
 *
 * @returns {boolean} Whether or not the reset was a success
*/
function resetLeaderboard(database, leaderboard) {
	try {
		(async () => {
			// Attempts to reset the given leaderboard
			await set(ref(database, `leaderboards/${leaderboard}`), '');
		})();
	} catch (error) {
		console.error(error);
		return false;
	}

	return true;
}

/**
 * Replaces HTML <br> tags with new line characters.
 * @param {string} string String to be formatted
 *
 * @returns {string} Original string with line brea
*/
function replaceLineBreaks(string) {
	return string.trim().replaceAll(/\<br\>/g, '\n');
}

/**
 * Adds the question set data to the Firebase database
 * @param {Database} database Database to upload the question set to
 * @param {Array} questionSet Question set to upload to the database
 * @param {string} title Title of the question set
 * @param {string} description Description provided for the question set
 * @param {number} owner User ID of the owner of the question set
 *
 * @returns {boolean} Whether or not the upload was a success
*/
function uploadSet(database, questionSet, title, description, owner) {
	try {
		(async () => {
			// Attempts to add the question set metadata to the database.
			await set(ref(database, `questionSets/${title}`), {
				description: description,
				owner: owner,
				timestamp: (Date.now() / 1000) | 0,
			});

			// Attempts to add the question set to the database.
			await set(ref(database, `questionLists/${title}`), {
				questions: questionSet,
			});
		})();
	} catch (error) {
		console.error(error);
		return false;
	}

	return true;
}

/**
 * Updates a given leaderboard with the result of a game.
 * @param {Database} database Database to update
 * @param {Map} result The final results of the game to add to the result
 *
 * @returns {boolean} Whether or not the update was a success
*/
function updateStats(database, result, ranked, losePoints) {
	const leaderboards = ['alltime', 'weekly', 'monthly'];

	try {
		return (async () => {
			// Attempts to update all leaderboards.
			return await get(ref(database, 'stats'))
				.then((snapshot) => {
					if (snapshot.exists()) {
						const currBoard = snapshot.val();
						for (const board of leaderboards) {
							const selectedBoard = currBoard[board] === '' ? new Map() : new Map(Object.entries(currBoard[board]));

							for (const [player, info] of result) {
								const playerObject = selectedBoard.has(player) ? selectedBoard.get(player) : {
									rankedScore: 0,
									rankedCorrect: 0,
									rankedIncorrect: 0,
									rankedTimeout: 0,
									rankedPlayed: 0,
									unrankedScore: 0,
									unrankedCorrect: 0,
									unrankedIncorrect: 0,
									unrankedTimeout: 0,
									unrankedPlayed: 0
								};

								playerObject[ranked ? 'rankedScore' : 'unrankedScore'] += losePoints ? info.correct - info.incorrect - info.timeout : info.correct;
								playerObject[ranked ? 'rankedCorrect' : 'unrankedCorrect'] += info.correct;
								playerObject[ranked ? 'rankedIncorrect' : 'unrankedIncorrect'] += info.incorrect;
								playerObject[ranked ? 'rankedTimeout' : 'unrankedTimeout'] += info.timeout;
								playerObject[ranked ? 'rankedPlayed' : 'unrankedPlayed']++;
								selectedBoard.set(player, playerObject);
							}

							const newBoard = [...selectedBoard.entries()].sort((a, b) => a[0].localeCompare(b[0]));

							currBoard[board] = Object.fromEntries(newBoard);
						}

						// Attempts to push update.
						try {
							(async () => {
								await set(ref(database, 'stats'), currBoard);
							})();
						} catch (error) {
							console.error(error);
							return false;
						}

						return true;
					}
				});
		})();
	} catch (error) {
		console.error(error);
		return false;
	}
}

/**
 * Waits for a certain number of milliseconds
 * @param {number} time The amount of time, in milliseconds, to wait for
 *
 * @returns {Promise} A promise that resolves to null
 */
async function wait(time) {
	return new Promise(r => setTimeout(r, time));
}

module.exports = {
	awaitAudioPlayerReady, clearCache, deleteSet, judgeAnswer, processResult, randomize,
	removeWhiteSpace, replaceLineBreaks, resetLeaderboard, updateStats, uploadSet, wait
};