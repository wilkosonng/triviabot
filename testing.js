const similarity = require('string-similarity');
const validator = require('validator');
const url = 'https://docs.google.com/spreadsheets/d/1dOJ3IVf0A_7vcAQxrXYIjPJlOSsjst84hjYeAserZAE/edit#gid=0';

const sheetsRegex = /docs\.google\.com\/spreadsheets\/d\/(?<id>[A-Za-z0-9-_]+)\//;

const ans = 'automated teller machine';
const res = 'automate teller machine';

console.log([similarity.compareTwoStrings(res, ans), answerThreshold(ans)]);

function answerThreshold(str) {
	return 0.95 * Math.pow(Math.E, -(1.2 / str.length));
}