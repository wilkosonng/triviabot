const { SlashCommandBuilder } = require('discord.js');
const validator = require('validator');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, set, get, remove } = require('firebase/database');
const { AddSummaryEmbed } = require('../helpers/embeds.js');
const mammoth = require('mammoth');
require('dotenv').config();

const sentenceRegex = /^(\S+ ?)+$/;
const questionRegex = /Q: (?<question>(This is an? (?<ansnum>[2-9]) part question\. )?[^\n]+)\s+A: (?<answer>[^\n]+)/gi;

const firebaseApp = initializeApp(JSON.parse(process.env.FIREBASE_CREDS));
const database = getDatabase(firebaseApp);

module.exports = {
	data: new SlashCommandBuilder()
		.setName('adddoc')
		.setDescription('Adds a question set from a formatted .docx file into the pool.')
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
		.addAttachmentOption(option =>
			option
				.setName('file')
				.setDescription('The .docx file of the question set')
				.setRequired(true)),

	async execute(interaction, currSets) {
		await interaction.deferReply();

		const title = interaction.options.getString('title');
		const description = interaction.options.getString('description');
		const { url, size, contentType } = interaction.options.getAttachment('file');
		const user = interaction.user;

		let questionSet;

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

		// Returns if the file is too large.
		if (size > 1_024_000) {
			return interaction.editReply({
				content: 'File too large! Please keep files at a max of 1MB.',
			});
		}

		// Returns if the type of the file is not a .docx file.
		if (!contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
			return interaction.editReply({
				content: 'Invalid file. Please upload a valid .docx file.',
			});
		}

		const html = await getFile(url);
		const questions = html.matchAll(questionRegex);

		for (const question of questions) {
			console.log(question);
		}

		return interaction.editReply({
			content: 'Check console, loser.'
		});
	}
};

// Gets a .docx file and returns the raw text.
async function getFile(url) {
	const res = await fetch(url);
	const buffer = await res.arrayBuffer();

	return (await mammoth.extractRawText({
		buffer: buffer
	})).value;
}