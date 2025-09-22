import 'dotenv/config';
import {
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
} from 'discord.js';

/** /match result */
const matchCmd = new SlashCommandBuilder()
  .setName('match')
  .setDescription('경기 기록')
  .setDMPermission(false)
  .addSubcommand((s) =>
    s
      .setName('result')
      .setDescription('내전 결과 기록')
      .addStringOption((o) =>
        o
          .setName('winner')
          .setDescription('승팀: A 또는 B')
          .setRequired(true)
          .addChoices({ name: 'A', value: 'A' }, { name: 'B', value: 'B' }),
      )
      .addUserOption((o) => o.setName('a1').setDescription('팀A 플레이어1').setRequired(true))
      .addUserOption((o) => o.setName('a2').setDescription('팀A 플레이어2').setRequired(true))
      .addUserOption((o) => o.setName('a3').setDescription('팀A 플레이어3').setRequired(true))
      .addUserOption((o) => o.setName('a4').setDescription('팀A 플레이어4').setRequired(true))
      .addUserOption((o) => o.setName('a5').setDescription('팀A 플레이어5').setRequired(true))
      .addUserOption((o) => o.setName('b1').setDescription('팀B 플레이어1').setRequired(true))
      .addUserOption((o) => o.setName('b2').setDescription('팀B 플레이어2').setRequired(true))
      .addUserOption((o) => o.setName('b3').setDescription('팀B 플레이어3').setRequired(true))
      .addUserOption((o) => o.setName('b4').setDescription('팀B 플레이어4').setRequired(true))
      .addUserOption((o) => o.setName('b5').setDescription('팀B 플레이어5').setRequired(true))
      .addStringOption((o) => o.setName('score').setDescription('예: 13-10'))
      .addStringOption((o) => o.setName('month').setDescription('예: 2025-09 (소급 기록)')),
  );

/** /profile */
const profileCmd = new SlashCommandBuilder()
  .setName('profile')
  .setDescription('유저 전적')
  .setDMPermission(false)
  .addUserOption((o) => o.setName('user').setDescription('조회할 유저').setRequired(true))
  .addStringOption((o) => o.setName('month').setDescription('YYYY-MM (미입력시 이번 달)'));

/** /leaderboard */
const leaderboardCmd = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('승률/승수 랭킹')
  .setDMPermission(false)
  .addStringOption((o) => o.setName('month').setDescription('YYYY-MM (미입력시 이번 달)'));

/** /backfill — 관리자만 표시/사용 */
const backfillCmd = new SlashCommandBuilder()
  .setName('backfill')
  .setDescription('월별 기준 승/패 백필 (관리자용)')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addUserOption((o) => o.setName('user').setDescription('대상 유저').setRequired(true))
  .addStringOption((o) => o.setName('month').setDescription('YYYY-MM').setRequired(true))
  .addIntegerOption((o) => o.setName('wins').setDescription('승').setRequired(true))
  .addIntegerOption((o) => o.setName('losses').setDescription('패').setRequired(true));

/** /allstats */
const allstatsCmd = new SlashCommandBuilder()
  .setName('allstats')
  .setDescription('모든 플레이어 통계 (판수 오름차순)')
  .setDMPermission(false)
  .addIntegerOption((o) =>
    o.setName('page').setDescription('페이지 번호 (기본 1)').setMinValue(1),
  )
  .addStringOption((o) => o.setName('month').setDescription('YYYY-MM (미입력시 이번 달)'));

/** /setstat — KD/ACS 설정 (관리자) */
const setstatCmd = new SlashCommandBuilder()
  .setName('setstat')
  .setDescription('월별 KD/ACS 설정 (관리자용)')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addUserOption((o) => o.setName('user').setDescription('대상 유저').setRequired(true))
  .addStringOption((o) => o.setName('month').setDescription('YYYY-MM (미입력시 이번 달)'))
  .addNumberOption((o) => o.setName('kd').setDescription('KD (예: 1.23)').setMinValue(0))
  .addIntegerOption((o) => o.setName('acs').setDescription('ACS (예: 245)').setMinValue(0));

/** 👇 map(...) 없이 각 커맨드를 toJSON 해서 배열 생성 */
const commands = [
  matchCmd.toJSON(),
  profileCmd.toJSON(),
  leaderboardCmd.toJSON(),
  backfillCmd.toJSON(),
  allstatsCmd.toJSON(),
  setstatCmd.toJSON(),
];

(async () => {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);
  const route = process.env.GUILD_ID
    ? Routes.applicationGuildCommands(
        process.env.DISCORD_CLIENT_ID!,
        process.env.GUILD_ID!,
      )
    : Routes.applicationCommands(process.env.DISCORD_CLIENT_ID!);

  await rest.put(route, { body: commands });
  console.log(
    `✅ Slash commands registered ${process.env.GUILD_ID ? '(guild)' : '(global)'}!`,
  );
})();
