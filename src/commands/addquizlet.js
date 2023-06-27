const { SlashCommandBuilder, EmbedBuilder, bold, underscore } = require('discord.js');
const validator = require('validator');
const puppeteer = require('puppeteer-extra');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, set, get, remove } = require('firebase/database');
require('dotenv').config();

const quizletRegex = /quizlet\.com\/(?<id>\d+)\/(?<name>[a-z0-9-]+flash-cards)/;
const sentenceRegex = /^(\S+ ?)+$/;

const firebaseApp = initializeApp(JSON.parse(process.env.FIREBASE_CREDS));
const database = getDatabase(firebaseApp);

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

	async execute(interaction) {
		await interaction.deferReply();

		const title = interaction.options.getString('title');
		const description = interaction.options.getString('description');
		const url = interaction.options.getString('url');
		const flip = interaction.options.getBoolean('flip') ?? false;
		const user = interaction.user;

		let questionSet;
		let titleExists = false;

		// Returns if the title is invalid.

		if (!sentenceRegex.test(title) || title.length > 60) {
			return interaction.editReply({
				content: 'Invalid title. Please keep titles at most 60 characters with alphanumeric with punctuation and normal spacing!',
			});
		}

		// Returns if the description is invalid.

		if (!sentenceRegex.test(description) || description.length > 300) {
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

		// Checks if title is already taken.

		try {
			await get(ref(database, `questionSets/${title}/owner`)).then((snapshot) => {
				if (snapshot.exists()) {
					titleExists = true;
				}
			});
		} catch (error) {
			return interaction.editReply({
				content: 'Database reference error.',
			});
		}

		if (titleExists) {
			return interaction.editReply({
				content: 'Title already exists. Please choose a different title!',
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

		let success = false;

		await set(ref(database, `questionSets/${title}`), {
			description: description,
			owner: user.id,
			timestamp: (Date.now() / 1000) | 0,
		})
			.then(() => {
				success = true;
			})
			.catch((error) => {
				console.log(error);
			});

		if (success) {
			await set(ref(database, `questionLists/${title}`), {
				questions: questionSet,
			})
				.catch(async (error) => {
					console.error(error);

					// Cleans up if the operation was a half success.
					await remove(ref(database, `questionSets/${title}`));

					return interaction.editReply({
						content: 'Upload unsuccessful! :(',
					});
				});
		}

		// Constructs an embed summary.
		try {
			const summary = new EmbedBuilder()
				.setColor(0xD1576D)
				.setTitle(title)
				.setDescription(description)
				.setAuthor({
					name: interaction.member.displayName,
					iconURL: interaction.member.displayAvatarURL(),
				})
				.setFields(
					{ name: bold(underscore('Questions Added')), value: questionSet.length.toString() },
					{ name: bold(underscore('First Question')), value: questionSet[0].question },
					{ name: bold(underscore('Last Question')), value: questionSet[questionSet.length - 1].question },
				)
				.setTimestamp();

			interaction.channel.send({
				embeds: [summary],
			});

			return interaction.editReply({
				content: 'Successfully added question set!',
			});
		} catch (error) {
			console.log(error);
		}

	}
};

// Uses Puppeteer to navigate to the quizlet site and returns the question info.
async function scrapeSet(url, flip) {
	const browser = await puppeteer.launch({
		headless: 'new'
	});
	const page = await browser.newPage();
	await page.goto(url);

	await page.waitForSelector('.SetPage-terms', {
		visible: true
	});

	// Makes sure we get every term.
	if (await page.$('button[aria-label="See more"]') != null) {
		await page.click('button[aria-label="See more"]');
	}

	const data = await page.evaluate((flipQuestions) => {
		const questions = Array.from(document.querySelectorAll('.SetPageTerm-wordText > .TermText'));
		const answers = Array.from(document.querySelectorAll('.SetPageTerm-definitionText > .TermText'));

		if (questions.length > 1000 || answers.length !== questions.length) {
			return null;
		}

		return questions.map((e, i) => ({
			question: flipQuestions ? answers[i].innerHTML : e.innerHTML,
			answer: flipQuestions ? [e.innerHTML] : [answers[i].innerHTML],
			multi: 1,
			img: null
		}));
	}, flip);

	return data;
}