"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const discord_js_1 = require("discord.js");
const commands = [
    new discord_js_1.SlashCommandBuilder()
        .setName('match')
        .setDescription('경기 기록')
        .addSubcommand(s => s.setName('result')
        .setDescription('내전 결과 기록')
        .addStringOption(o => o.setName('winner').setDescription('승팀: A 또는 B').setRequired(true).addChoices({ name: 'A', value: 'A' }, { name: 'B', value: 'B' }))
        .addUserOption(o => o.setName('a1').setDescription('팀A 플레이어1').setRequired(true))
        .addUserOption(o => o.setName('a2').setDescription('팀A 플레이어2').setRequired(true))
        .addUserOption(o => o.setName('a3').setDescription('팀A 플레이어3').setRequired(true))
        .addUserOption(o => o.setName('a4').setDescription('팀A 플레이어4').setRequired(true))
        .addUserOption(o => o.setName('a5').setDescription('팀A 플레이어5').setRequired(true))
        .addUserOption(o => o.setName('b1').setDescription('팀B 플레이어1').setRequired(true))
        .addUserOption(o => o.setName('b2').setDescription('팀B 플레이어2').setRequired(true))
        .addUserOption(o => o.setName('b3').setDescription('팀B 플레이어3').setRequired(true))
        .addUserOption(o => o.setName('b4').setDescription('팀B 플레이어4').setRequired(true))
        .addUserOption(o => o.setName('b5').setDescription('팀B 플레이어5').setRequired(true))
        .addStringOption(o => o.setName('score').setDescription('예: 13-10'))
        // 필요시 과거 월로 소급 기록할 때 사용 (미입력 시 현재 월)
        .addStringOption(o => o.setName('month').setDescription('예: 2025-09'))),
    new discord_js_1.SlashCommandBuilder()
        .setName('profile')
        .setDescription('유저 전적')
        .addUserOption(o => o.setName('user').setDescription('조회할 유저').setRequired(true))
        .addStringOption(o => o.setName('month').setDescription('YYYY-MM (미입력시 이번 달)')),
    new discord_js_1.SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('승률/승수 랭킹')
        .addStringOption(o => o.setName('month').setDescription('YYYY-MM (미입력시 이번 달)')),
    new discord_js_1.SlashCommandBuilder()
        .setName('backfill')
        .setDescription('월별 기준 승/패 백필 (관리자/운영자용)')
        .addUserOption(o => o.setName('user').setDescription('대상 유저').setRequired(true))
        .addStringOption(o => o.setName('month').setDescription('YYYY-MM').setRequired(true))
        .addIntegerOption(o => o.setName('wins').setDescription('승').setRequired(true))
        .addIntegerOption(o => o.setName('losses').setDescription('패').setRequired(true)),
].map(c => c.toJSON());
(async () => {
    const rest = new discord_js_1.REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    const route = process.env.GUILD_ID
        ? discord_js_1.Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.GUILD_ID)
        : discord_js_1.Routes.applicationCommands(process.env.DISCORD_CLIENT_ID);
    await rest.put(route, { body: commands });
    console.log(`✅ Slash commands registered ${process.env.GUILD_ID ? '(guild)' : '(global)'}!`);
})();
//# sourceMappingURL=registerCommands.js.map