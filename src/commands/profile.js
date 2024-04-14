const { AttachmentBuilder, SlashCommandBuilder, time } = require('discord.js');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const { join } = require('path');
const { rm, writeFile } = require('fs/promises');
const { binarySearch } = require('../helpers/helpers');
const { ProfileEmbed } = require('../helpers/embeds');

const publicFolder = join(__dirname, '../..', 'public');
const canvas = new ChartJSNodeCanvas({
	width: 1200,
	height: 900,
	chartCallback: (ChartJS) => {
		ChartJS.defaults.color = '#ffffff';
		ChartJS.defaults.responsive = true;
		ChartJS.defaults.maintainAspectRatio = false;
	}
});

module.exports = {
	data: new SlashCommandBuilder()
		.setName('profile')
		.setDescription('Pull up the game stats of you or another player')
		.addUserOption(option =>
			option
				.setName('user')
				.setDescription('Whose profile to display? Uses command executor profile by default')
				.setRequired(false))
		.addBooleanOption(option =>
			option
				.setName('ranked')
				.setDescription('Display ranked or unranked statistics? Ranked by default.')
				.setRequired(false)),

	async execute(interaction, stats) {
		const user = interaction.options.getUser('user') ?? interaction.user;
		const ranked = interaction.options.getBoolean('ranked') ?? true;
		const statsArray = Object.entries(stats['alltime']);

		const index = binarySearch(statsArray, user.id, (id, e) => id.localeCompare(e[0]));

		if (index === -1) {
			return interaction.reply(`Looks like ${user.username} hasn't yet played a game!`);
		}

		const userStats = statsArray[index][1];
		let score, correct, incorrect, timeout, gamesPlayed, gamesWon;

		if (ranked) {
			score = userStats['rankedScore'];
			correct = userStats['rankedCorrect'];
			incorrect = userStats['rankedIncorrect'];
			timeout = userStats['rankedTimeout'];
			gamesPlayed = userStats['rankedPlayed'];
			gamesWon = userStats['rankedWon'];
		} else {
			score = userStats['unrankedScore'];
			correct = userStats['unrankedCorrect'];
			incorrect = userStats['unrankedIncorrect'];
			timeout = userStats['unrankedTimeout'];
			gamesPlayed = userStats['unrankedPlayed'];
			gamesWon = userStats['unrankedWon'];
		}

		const lastPlayedSet = userStats['lastPlayedSet'];
		const accuracy = `${Math.round(correct * 10000 / (correct + incorrect + timeout)) / 100}%`;
		const winRate = `${Math.round(gamesWon * 10000 / gamesPlayed) / 100}%`;

		const graph = await generateImage({ correct, incorrect, timeout }, `${user.id}_pie.png`, user.username);
		await interaction.reply({
			embeds: [ProfileEmbed(user, { score, correct, incorrect, timeout, accuracy, gamesPlayed, gamesWon, winRate, lastPlayedSet }, ranked)],
			files: [graph]
		});

		rm(join(publicFolder, `${user.id}_pie.png`));
	}
};

async function generateImage({ correct, incorrect, timeout }, filename, username) {
	return new Promise(async (resolve) => {
		const url = join(publicFolder, filename);
		const buffer = await canvas.renderToBuffer({
			type: 'pie',
			data: {
				labels: ['Correct', 'Incorrect', 'Timeout'],
				datasets: [{
					data: [correct, incorrect, timeout],
					backgroundColor: [
						'#bfe5b8ff',
						'#fed3caff',
						'#d2ddf7ff'
					],
					borderColor: [
						'#12440aff',
						'#742b1eff',
						'#163784ff'
					],
					borderWidth: 3
				}]
			},
			options: {
				plugins: {
					title: {
						display: true,
						font: {
							size: 48
						},
						padding: 50,
						text: `${username}'s Buzzer Performance`
					},
					legend: {
						position: 'right',
						labels: {
							font: {
								size: 36
							},
							padding: 20
						}
					}
				}
			}
		});

		await writeFile(url, buffer);
		resolve(new AttachmentBuilder(url));
	});
}