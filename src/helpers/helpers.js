const { ref, set, remove } = require('firebase/database');
const spaceRegex = /\s+/g;

/**
 * Removes the question set data from the Firebase database
 * @param {Database} database Database to delete the question set from
 * @param {string} title Title of the question set
 *
 * @returns {boolean} Whether or not the deletion was a success
*/
function deleteSet(database, title) {
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
 * Removes all that pesky extraneous white space for consistent styling
 * @param {string} string String to be formatted
 *
 * @returns {string} Original space with extraneous white space removed
*/
function removeWhiteSpace(string) {
	return string.trim().replaceAll(spaceRegex, ' ');
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

module.exports = {
	deleteSet, removeWhiteSpace, uploadSet
};