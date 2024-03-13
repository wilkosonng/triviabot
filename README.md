# 🧠 Triviabot 🧠

A Bot written using Discord.js that allows for uploading and playing of trivia sets.    
Question sets and statistics are stored in a Firebase database.

## Features and Commands

Additional information can be obtained using the `/info` command.

### Question Set Creation and Deletion

- `/adddoc` - Adds a question set from `.docx` file (Microsoft Word, Google Docs, LibreOffice, etc.).
- `/addquizlet` - Adds a question set from a Quizlet URL.
- `/addsheet` - Adds a question set from a public Google Sheets URL.
- `/removeset` - Removes a question set of the given name.

### Question Set Management

- `/listsets` - Lists up to 10 question sets that match the given query.
- `/setinfo` - Provides information and data on the given question set.

### Playing Trivia

- `/startgame` - Starts a text channel-based game.
  - Once a game has started, use `ready`, `buzz`, and `endtrivia` commands to control the game flow. Use `playerlb` and `teamlb` to view the current scores.


## Self-Hosting

In order to host this bot, you will need the following services: 

1. [Node.js](https://nodejs.org/en/download) runtime.
2. [Discord Bot Token](https://discordjs.guide/preparations/setting-up-a-bot-application.html#creating-your-bot) via Discord's developer portal.
3. [Firebase Realtime Database](https://console.firebase.google.com/) account and credentials.
4. The above database should be [configured to handle logins via E-mail and Password](https://firebase.google.com/docs/auth/web/password-auth#before_you_begin). You will need the associated E-mail and Password Authentication for the Realtime Database instance.
5. [Google Service Account and Credentials](https://console.cloud.google.com/). **NOTE** - if you want the bot to be able to play voice games, you may need to link payment information to this account.

### Instructions

1. Clone this repository.
2. Rename the `config-template.json` file to `config.json`. Edit it if necessary.
3. Open up a shell and type `npm i` to install relevant Node.js packages.
4. Create a `.env` file in the directory and fill in the following variables:
   - `TRIVIA_BOT_TOKEN` - Your bot token.
   - `FIREBASE_CREDS` - The string representation of your Firebase credentials.
   - `GOOGLE_CREDS` - The string representation of your Google Service Account credentials.
   - `FIREBASE_EMAIL` - The email associated with your Firebase database access.
   - `FIREBASE_PASSWORD` - The password associated with your Firebase database access.
5. Run `npm run deploy` in your shell window.

### Persistant Process

The Triviabot allows you to keep the application alive indefinitely using PM2. To begin, install PM2 globally with the following command in the shell:   

```npm i pm2 -g```

Afterwards, simply go into your directory and use `pm2 start index.js`.
