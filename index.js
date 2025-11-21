require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Partials } = require('discord.js');

// 設定の読み込み
const TOKEN = process.env.DISCORD_TOKEN;
const JUDGE_ROLE_NAME = process.env.JUDGE_ROLE_NAME || 'judge';
const TARGET_EMOJI = process.env.TARGET_EMOJI || '✅';
const POINTS_FILE = path.join(__dirname, 'points.json');

// クライアントの初期化
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

const SETTINGS_FILE = path.join(__dirname, 'settings.json');

// 設定データの読み込み
function loadSettings() {
    try {
        if (!fs.existsSync(SETTINGS_FILE)) {
            fs.writeFileSync(SETTINGS_FILE, JSON.stringify({}));
        }
        const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('設定データの読み込みに失敗しました:', err);
        return {};
    }
}

// 設定データの保存
function saveSettings(data) {
    try {
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('設定データの保存に失敗しました:', err);
    }
}

// ポイントデータの読み込み
function loadPoints() {
    try {
        if (!fs.existsSync(POINTS_FILE)) {
            fs.writeFileSync(POINTS_FILE, JSON.stringify({}));
        }
        const data = fs.readFileSync(POINTS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('ポイントデータの読み込みに失敗しました:', err);
        return {};
    }
}

// ポイントデータの保存
function savePoints(data) {
    try {
        fs.writeFileSync(POINTS_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('ポイントデータの保存に失敗しました:', err);
    }
}

// 起動時のイベント
client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
    console.log(`監視対象の絵文字: ${TARGET_EMOJI}`);
    console.log(`判定ロール名: ${JUDGE_ROLE_NAME}`);
});

// メッセージ受信時のイベント
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    const guildId = message.guild.id;

    // !set_channel コマンド (通知先チャンネルの設定)
    if (message.content === '!set_channel') {
        // 管理者権限チェック (またはjudgeロール)
        const member = await message.guild.members.fetch(message.author.id);
        // 管理者権限を持っているか、judgeロールを持っているか
        const isAdmin = member.permissions.has('Administrator');
        const isJudge = member.roles.cache.some(role => role.name === JUDGE_ROLE_NAME);

        if (!isAdmin && !isJudge) {
            await message.reply('このコマンドを実行する権限がありません。');
            return;
        }

        const settings = loadSettings();
        settings[guildId] = {
            notificationChannelId: message.channel.id
        };
        saveSettings(settings);

        try {
            await message.reply(`このチャンネル (${message.channel.name}) を通知先に設定しました！`);
        } catch (err) {
            console.error('返信に失敗しました。通常メッセージとして送信を試みます:', err);
            try {
                await message.channel.send(`このチャンネル (${message.channel.name}) を通知先に設定しました！`);
            } catch (sendErr) {
                console.error('メッセージの送信にも失敗しました:', sendErr);
            }
        }
        return;
    }

    // !points コマンド
    if (message.content === '!points') {
        const pointsData = loadPoints();
        // サーバーごとのデータを取得
        const guildPoints = pointsData[guildId] || {};
        const userPoints = guildPoints[message.author.id] || 0;
        await message.reply(`現在のポイントは **${userPoints}** ポイントです！`);
        return;
    }

    // !subtra コマンド (例: !subtra @User 5)
    if (message.content.startsWith('!subtra')) {
        await handlePointCommand(message, 'sub');
    }

    // !add コマンド (例: !add @User 5)
    if (message.content.startsWith('!add')) {
        await handlePointCommand(message, 'add');
    }
});

// ポイント操作コマンドの共通処理
async function handlePointCommand(message, type) {
    const guildId = message.guild.id;

    // 実行者のロールチェック
    const member = await message.guild.members.fetch(message.author.id);
    const hasRole = member.roles.cache.some(role => role.name === JUDGE_ROLE_NAME);
    if (!hasRole) {
        await message.reply('このコマンドを実行する権限がありません。');
        return;
    }

    const args = message.content.split(/\s+/);
    // args[0]: !sub or !add, args[1]: @User, args[2]: amount

    const targetUser = message.mentions.users.first();
    const amount = parseInt(args[2]);

    if (!targetUser || isNaN(amount)) {
        const commandName = type === 'sub' ? '!subtra' : '!add';
        await message.reply(`使用法: \`${commandName} @User <ポイント数>\``);
        return;
    }

    console.log(`Command received: ${type}, User: ${targetUser.tag}, Amount: ${amount}`);

    const pointsData = loadPoints();
    // サーバーごとのデータを初期化
    if (!pointsData[guildId]) {
        pointsData[guildId] = {};
    }

    const targetId = targetUser.id;
    if (!pointsData[guildId][targetId]) {
        pointsData[guildId][targetId] = 0;
    }

    if (type === 'sub') {
        pointsData[guildId][targetId] -= amount;
    } else {
        pointsData[guildId][targetId] += amount;
    }

    savePoints(pointsData);
    console.log(`Points updated. New balance: ${pointsData[guildId][targetId]}`);

    // 通知処理
    const actionText = type === 'sub' ? '減算' : '加算';
    const notificationMessage = `${targetUser} さんのポイントを ${amount} ${actionText}しました。(現在のポイント: ${pointsData[guildId][targetId]})`;

    // コマンドを実行したチャンネルに返信
    try {
        await message.reply(notificationMessage);
    } catch (err) {
        console.error('返信に失敗しました。通常メッセージとして送信を試みます:', err);
        try {
            await message.channel.send(notificationMessage);
        } catch (sendErr) {
            console.error('メッセージの送信にも失敗しました:', sendErr);
        }
    }

    // 通知先チャンネルにも送信 (設定ファイルから取得)
    try {
        const settings = loadSettings();
        const guildSettings = settings[guildId];

        if (guildSettings && guildSettings.notificationChannelId && guildSettings.notificationChannelId !== message.channel.id) {
            const channel = await client.channels.fetch(guildSettings.notificationChannelId);
            if (channel) {
                await channel.send(notificationMessage);
            }
        }
    } catch (err) {
        console.error('通知先チャンネルへの送信に失敗しました:', err);
    }
}

// リアクション追加時のイベント
client.on('messageReactionAdd', async (reaction, user) => {
    // Partialの場合はfetchして完全なデータを取得
    if (reaction.partial) {
        try {
            await reaction.fetch();
        } catch (error) {
            console.error('Something went wrong when fetching the message:', error);
            return;
        }
    }

    // Botのリアクションは無視
    if (user.bot) return;

    // 指定の絵文字かチェック
    if (reaction.emoji.name !== TARGET_EMOJI) return;

    // リアクションが行われたギルド（サーバー）の情報を取得
    const guild = reaction.message.guild;
    if (!guild) return;
    const guildId = guild.id;

    // リアクションしたメンバーを取得
    let member;
    try {
        member = await guild.members.fetch(user.id);
    } catch (err) {
        console.error('メンバー情報の取得に失敗しました:', err);
        return;
    }

    // ロールチェック (judgeロールを持っているか)
    const hasRole = member.roles.cache.some(role => role.name === JUDGE_ROLE_NAME);
    if (!hasRole) {
        console.log(`${user.tag} は ${JUDGE_ROLE_NAME} ロールを持っていません。`);
        return;
    }

    // 投稿者がBotでないかチェック
    const messageAuthor = reaction.message.author;
    if (messageAuthor.bot) return;

    // 自分自身の投稿へのリアクションでポイント稼ぎを防ぐ場合（今回は許可するか不明だが、一般的には防ぐ）
    // if (messageAuthor.id === user.id) return; 

    // ポイント加算処理
    const pointsData = loadPoints();
    const authorId = messageAuthor.id;

    // サーバーごとのデータを初期化
    if (!pointsData[guildId]) {
        pointsData[guildId] = {};
    }

    if (!pointsData[guildId][authorId]) {
        pointsData[guildId][authorId] = 0;
    }
    pointsData[guildId][authorId] += 1;

    savePoints(pointsData);

    console.log(`${user.tag} が ${messageAuthor.tag} にポイントを付与しました。現在のポイント: ${pointsData[guildId][authorId]}`);

    // チャンネルに通知
    try {
        const settings = loadSettings();
        const guildSettings = settings[guildId];
        const notificationMessage = `${messageAuthor} さんに 1ポイント付与されました！ (現在のポイント: ${pointsData[guildId][authorId]})`;

        if (guildSettings && guildSettings.notificationChannelId) {
            const channel = await client.channels.fetch(guildSettings.notificationChannelId);
            if (channel) {
                await channel.send(notificationMessage);
            } else {
                // 設定されたチャンネルが見つからない場合は元のチャンネルに
                await reaction.message.channel.send(notificationMessage);
            }
        } else {
            // 設定がない場合は元のチャンネルに送信
            await reaction.message.channel.send(notificationMessage);
        }
    } catch (err) {
        console.error('メッセージの送信に失敗しました:', err);
    }
});

// ログイン
client.login(TOKEN);
