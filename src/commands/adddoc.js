const { SlashCommandBuilder } = require('discord.js');
const { AddSummaryEmbed } = require('../helpers/embeds.js');
const { removeWhiteSpace, uploadSet, deleteSet } = require('../helpers/helpers.js');
const mammoth = require('mammoth');
require('dotenv').config();

const questionRegex = /^(!!img\[(?<img>https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&\/=]*)\.(png|jpg|jpeg|gif|webp))\])?Q: (?<question>(This is an? (?<ansnum>[2-9]) part question\. )?[^\n]+)$\s{1, 1000}^A: (?<answers>[^\n]+)$/gim;

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

	async execute(interaction, database, currSets) {
		await interaction.deferReply();

		const title = removeWhiteSpace(interaction.options.getString('title'));
		const description = removeWhiteSpace(interaction.options.getString('description'));
		const { url, size, contentType } = interaction.options.getAttachment('file');
		const user = interaction.user;
		const questionSet = [];

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

		// Returns if the file is too large.
		if (size > 1_024_000) {
			return interaction.editReply({
				content: 'File too large! Please keep files at a max of 1 MB.',
			});
		}

		// Returns if the type of the file is not a .docx file.
		if (contentType !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
			return interaction.editReply({
				content: 'Invalid file. Please upload a valid .docx file.',
			});
		}

		const docText = await getFile(url);
		const matches = docText.matchAll(questionRegex);

		for (const match of matches) {
			const { question, answers } = match.groups;
			if (question && answers) {
				questionSet.push({
					question: removeWhiteSpace(question),
					answer: answers.split('|').map(answer => removeWhiteSpace(answer)),
					multi: match.groups.ansnum ? parseInt(match.groups.ansnum) : 1,
					img: match.groups.img ?? null
				});
			} else {
				return interaction.editReply({
					content: 'Something has gone terribly wrong with parsing the document!'
				});
			}
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

// Gets a .docx file and returns the raw text.
async function getFile(url) {
	const res = await fetch(url);
	const buffer = await res.arrayBuffer();

	return (await mammoth.extractRawText({
		buffer: buffer
	})).value;
}