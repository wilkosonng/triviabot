const { SlashCommandBuilder } = require('discord.js');
const validator = require('validator');
const puppeteer = require('puppeteer-extra');
const { AddSummaryEmbed } = require('../helpers/embeds');
const { removeWhiteSpace, replaceLineBreaks, uploadSet, deleteSet } = require('../helpers/helpers');
require('dotenv').config();

const quizletRegex = /quizlet\.com\/(?<id>\d+)\/(?<name>[a-z0-9-]+flash-cards)/;

const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const AdblockerPlugin = require('puppeteer-extra-plugin-adblocker');
puppeteer.use(AdblockerPlugin({ blockTrackers: true }));

module.exports = {
	data: new SlashCommandBuilder()
		.setName('addquizlet')
		.setDescription('Adds a question set from a Quizlet set into the pool.')
		.addStringOption(option =>
			option
				.setName('title')
				.setDescription('The title of your question set')
				.setRequired(true))
		.addStringOption(option =>
			option
				.setName('description')
				.setDescription('Explanation (including special instructions) of the question set')
				.setRequired(true))
		.addStringOption(option =>
			option
				.setName('url')
				.setDescription('Quizlet set URL of the question set')
				.setRequired(true))
		.addBooleanOption(option =>
			option
				.setName('flip')
				.setDescription('Flip the questions and answers? (default: false)')
				.setRequired(false)),

	async execute(interaction, database, currSets) {
		await interaction.deferReply();

		const title = removeWhiteSpace(interaction.options.getString('title'));
		const description = removeWhiteSpace(interaction.options.getString('description'));
		const url = interaction.options.getString('url');
		const flip = interaction.options.getBoolean('flip') ?? false;
		const user = interaction.user;

		let questionSet;

		// Returns if the title is invalid.
		if (title.length > 60) {
			return interaction.editReply({
				content: 'Invalid title. Please keep titles at most 60 characters with alphanumeric with punctuation and normal spacing!',
			});
		}

		// Checks if title is already taken.
		if (currSets.includes(title)) {
			return interaction.editReply({
				content: 'Title already exists. Please choose a different title!',
			});
		}

		// Returns if the description is invalid.
		if (description.length > 300) {
			return interaction.editReply({
				content: 'Invalid description. Please make sure you are using normal spacing and the description is at most 300 characters!}',
			});
		}

		// Returns if the URL is invalid.
		if (!validator.isURL(url)) {
			return interaction.editReply({
				content: 'Invalid URL. Please check to make sure you submitted a valid URL!',
			});
		}

		const match = url.match(quizletRegex);

		// Asserts the URL is properly-formatted such that the ID and name are extractable.
		if (match?.groups?.id == null || match.groups.name == null) {
			return interaction.editReply({
				content: 'Unable to find the set ID and title from the URL. Please make sure your URL is valid!',
			});
		}

		try {
			questionSet = await scrapeSet(`https://quizlet.com/${match.groups.id}/${match.groups.name}/`, flip);
		} catch (err) {
			console.error(err);
			return interaction.editReply({
				content: 'Failed to retrieve data from Quizlet'
			});
		}

		if (questionSet == null) {
			return interaction.editReply({
				content: 'Error with resolving Quizlet set. Make sure the question set is under 1000 questions and the ID is valid.'
			});
		}

		// Attempts to add the trivia to the database.
		if (!(uploadSet(database, questionSet, title, description, user.id))) {
			// Cleans up if the operation was unsuccessful
			deleteSet(database, title);
			return interaction.editReply({
				content: 'Failure to upload question set.'
			});
		}

		// Constructs an embed summary.
		const summary = AddSummaryEmbed(title, description, interaction.member, questionSet);

		interaction.channel.send({
			embeds: [summary],
		});

		return interaction.editReply({
			content: 'Successfully added question set!',
		});
	}
};

// Uses Puppeteer to navigate to the quizlet site and returns the question info.
async function scrapeSet(url, flip) {
	const browser = await puppeteer.launch({
		headless: 'new'
	});
	const page = await browser.newPage();
	await page.goto(url);

	await page.waitForSelector('.SetPageTerms-termsList', {
		visible: true
	});

	// Makes sure we get every term.
	while ((await page.$('button[aria-label="See more"]')) != null) {
		await page.click('button[aria-label="See more"]');
		await new Promise(r => setTimeout(r, 100));
	}

	await page.addScriptTag({ content: `${removeWhiteSpace} ${replaceLineBreaks}` });

	// eslint-disable-next-line no-shadow
	const data = await page.evaluate((flipped) => {
		const questions = Array.from(document.querySelectorAll('.s1q0b356 > .TermText'));
		const answers = Array.from(document.querySelectorAll('.hcszxtp > .TermText'));

		if (questions.length > 1000 || answers.length !== questions.length) {
			return null;
		}

		return questions.map((e, i) => {
			const question = replaceLineBreaks(removeWhiteSpace(e.innerHTML));
			const answer = replaceLineBreaks(removeWhiteSpace(answers[i].innerHTML));

			return {
				question: flipped ? answer : question,
				answer: flipped ? [question] : [answer],
				multi: 1,
				img: null
			};
		});
	}, flip);

	return data;
}