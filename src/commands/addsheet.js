const { SlashCommandBuilder, EmbedBuilder, bold, underscore } = require('discord.js');
const validator = require('validator');
const sheets = require('google-spreadsheet');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, set, get, remove } = require('firebase/database');
require('dotenv').config();

const sheetsRegex = /docs\.google\.com\/spreadsheets\/d\/(?<id>[\w-]+)\//;
const sentenceRegex = /^(\S+ ?)+$/;
const questionRegex = /^(!!(?<ansnum>[2-9]))?(!!img\[(?<img>\S+\.(png|jpg|jpeg|gif|webp))\])?(?<question>(\S+ ?)+)$/;

const firebaseApp = initializeApp(JSON.parse(process.env.FIREBASE_CREDS));
const database = getDatabase(firebaseApp);

module.exports = {
	data: new SlashCommandBuilder()
		.setName('addsheet')
		.setDescription('Adds a question set from a Google Sheet into the pool.')
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
				.setDescription('Google Sheets URL of the question set')
				.setRequired(true)),

	async execute(interaction) {
		await interaction.deferReply();

		const title = interaction.options.getString('title');
		const description = interaction.options.getString('description');
		const url = interaction.options.getString('url');
		const user = interaction.user;
		const questionSet = [];

		let titleExists = false;

		// Returns if the title is invalid.

		if (!sentenceRegex.test(title)) {
			return interaction.editReply({
				content: 'Invalid title. Please keep titles alphanumeric with punctuation and normal spacing!',
			});
		}

		// Returns if the description is invalid.

		if (!sentenceRegex.test(description)) {
			return interaction.editReply({
				content: 'Invalid description. Please make sure you are using normal spacing!}',
			});
		}

		// Returns if the URL is invalid.

		if (!validator.isURL(url)) {
			return interaction.editReply({
				content: 'Invalid URL. Please check to make sure you submitted a valid URL!',
			});
		}

		const match = url.match(sheetsRegex);

		// Asserts the URL is properly-formatted such that the spreadsheet ID is extractable.

		if (match?.groups?.id == null) {
			return interaction.editReply({
				content: 'Cannot find Spreadsheet ID from URL. Make sure your URL is a valid Google Sheets URL!',
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

		// Attempts to access the spreadsheet.

		const doc = new sheets.GoogleSpreadsheet(match.groups.id);
		try {
			await doc.useServiceAccountAuth(JSON.parse(process.env.GOOGLE_CREDS));
		} catch (error) {
			console.log(error);
			return interaction.editReply({
				content: 'Could not access spreadsheet (authentication issue).',
			});
		}

		// Attempts to load the info from the spreadsheet.

		try {
			await doc.loadInfo();
		} catch (error) {
			console.log(error);
			return interaction.editReply({
				content: 'Failure to load spreadsheet. Check if your Spreadsheet ID in your Google Sheets URL is valid and that the sheet is public or shared with the bot.',
			});
		}

		const sheet = doc.sheetsByIndex[0];

		// Attempts to load and process the spreadsheet rows.

		try {
			const rows = await sheet.getRows();

			if (rows.length < 1) {
				return interaction.editReply({
					content: 'No questions found!',
				});
			}

			if (rows.length >= 1000) {
				return interaction.editReply({
					content: 'Too many questions and answers. Please keep maximum rows to 1000. Split up the question set if necessary.',
				});
			}

			for (const row of rows) {
				const raw = row._rawData;
				const question = raw[0];
				const questionMatch = question.match(questionRegex);

				if (raw.length > 100) {
					return interaction.editReply({
						content: 'Too many questions and answers. Please keep maximum columns to 100.',
					});
				}

				// Asserts the question is properly-formatted.

				if (questionMatch.groups.question == null) {
					return interaction.editReply({
						content: `Failed to add question at row ${row.rowIndex}: invalid question.`,
					});
				}

				// Asserts an answer exists.

				if (raw.length < 2) {
					return interaction.editReply({
						content: `Failed to add question ${question}: no answer pair found.`,
					});
				}

				// If an answer exists, add the question and answer pair to the question set.

				questionSet.push({
					question: questionMatch.groups.question,
					answer: raw.slice(1),
					multi: parseInt(questionMatch.groups.ansnum) ?? 1,
					img: questionMatch.groups.img ?? null
				});
			}
		} catch (error) {
			console.log(error);
			return interaction.editReply({
				content: 'Failure to extract data. Make sure your spreadsheet is formatted correctly.',
			});
		}

		// Attempts to add the trivia to the database.

		let success = false;

		await set(ref(database, `questionSets/${title}`), {
			description: description,
			owner: user.id,
			timestamp: Date.now(),
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
				.addFields(
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