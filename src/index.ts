import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Events,
} from 'discord.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const ALLOWED_TEXT_CHANNEL_ID = process.env.ALLOWED_TEXT_CHANNEL_ID ?? '';
const DUPLICATE_WINDOW_MINUTES = parseInt(process.env.DUPLICATE_WINDOW_MINUTES ?? '15', 10);

// 멘션 알림 차단
const NO_PING = {
  allowedMentions: { parse: [] as ('users' | 'roles' | 'everyone')[], users: [] as string[], roles: [] as string[], repliedUser: false as const },
};

// YYYY-MM
const getMonthString = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

// 포맷
const fmtWR = (w: number, l: number) => {
  const t = w + l;
  return t ? `${(Math.round((w / t) * 1000) / 10).toFixed(1)}%` : '0.0%';
};
const fmtKD = (kd?: number | null) => (kd ?? null) === null ? '—' : (kd as number).toFixed(2);
const fmtACS = (acs?: number | null) => (acs ?? null) === null ? '—' : String(acs);

client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user?.tag}`);
  try { await prisma.$connect(); console.log('✅ Prisma connected'); } catch (e) { console.error(e); }
  setInterval(async () => { try { await prisma.$queryRaw`SELECT 1`; } catch (e) { console.error('DB ping error:', e); } }, 5 * 60 * 1000);
});

client.on('interactionCreate', async (i) => {
  if (!i.isChatInputCommand()) return;
  try {
    if (i.commandName === 'match' && i.options.getSubcommand() === 'result')      await handleMatchResult(i);
    else if (i.commandName === 'profile')                                         await handleProfile(i);
    else if (i.commandName === 'leaderboard')                                     await handleLeaderboard(i);
    else if (i.commandName === 'undo')                                            await handleUndo(i);
    else if (i.commandName === 'backfill')                                        await handleBackfill(i);
    else if (i.commandName === 'allstats')                                        await handleAllStats(i);
    else if (i.commandName === 'setstat')                                         await handleSetStat(i); // ⬅ 관리자 KD/ACS
  } catch (e) {
    console.error(e);
    const payload = { content: '⚠️ 에러가 발생했습니다.', ...NO_PING };
    if (i.deferred || i.replied) await i.editReply(payload as any);
    else await i.reply({ ...payload, ephemeral: true });
  }
});

/* ---------- Helpers ---------- */

async function upsertPlayer(userId: string, nickname?: string) {
  return prisma.player.upsert({
    where: { userId },
    update: { ...(nickname !== undefined ? { nickname } : {}) },
    create: { userId, ...(nickname !== undefined ? { nickname } : {}) },
  });
}

// MonthlyStat에 승/패 증감 반영
async function applyStatDelta(playerId: number, month: string, dW: number, dL: number) {
  await prisma.$transaction(async (tx) => {
    const cur = await tx.monthlyStat.findUnique({ where: { playerId_month: { playerId, month } } });
    const nextWins = Math.max(0, (cur?.wins ?? 0) + dW);
    const nextLoss = Math.max(0, (cur?.losses ?? 0) + dL);
    if (cur) {
      await tx.monthlyStat.update({ where: { playerId_month: { playerId, month } }, data: { wins: nextWins, losses: nextLoss } });
    } else {
      await tx.monthlyStat.create({ data: { playerId, month, wins: nextWins, losses: nextLoss } });
    }
  });
}

/* ---------- Handlers ---------- */

async function handleMatchResult(i: ChatInputCommandInteraction) {
  if (ALLOWED_TEXT_CHANNEL_ID && i.channelId !== ALLOWED_TEXT_CHANNEL_ID) {
    await i.reply({ content: '⚠️ 이 명령은 지정된 채널에서만 사용할 수 있습니다.', ephemeral: true, ...NO_PING }); return;
  }

  const winner = i.options.getString('winner', true); // 'A'|'B'
  const score  = i.options.getString('score') ?? undefined;
  const month  = i.options.getString('month') ?? getMonthString();

  const aUsers = ['a1','a2','a3','a4','a5'].map(k => i.options.getUser(k, true));
  const bUsers = ['b1','b2','b3','b4','b5'].map(k => i.options.getUser(k, true));

  const ids = new Set([...aUsers, ...bUsers].map(u => u.id));
  if (ids.size !== 10) { await i.reply({ content: '⚠️ 같은 사람이 중복되었거나 10명이 아닙니다.', ephemeral: true, ...NO_PING }); return; }

  const participantKey = [...aUsers, ...bUsers].map(u => u.id).sort().join(',');
  const since = new Date(Date.now() - DUPLICATE_WINDOW_MINUTES * 60 * 1000);
  const recentMatches = await prisma.match.findMany({ where: { createdAt: { gte: since } }, include: { entries: { include: { Player: true } } } });
  if (recentMatches.some(m => m.entries.map(e => e.Player.userId).sort().join(',') === participantKey)) {
    await i.reply({ content: `⚠️ 같은 10인 구성의 경기가 최근 ${DUPLICATE_WINDOW_MINUTES}분 내에 이미 기록되었습니다.`, ephemeral: true, ...NO_PING }); return;
  }

  await i.deferReply();

  const match = await prisma.match.create({ data: { winner, month, ...(score !== undefined ? { score } : {}) } });

  const saveEntries = async (users: typeof aUsers, team: 'A'|'B') => {
    for (const u of users) {
      const p = await upsertPlayer(u.id, u.username);
      const isWin = winner === team;
      await prisma.entry.create({ data: { matchId: match.id, playerId: p.id, team, isWin } });
      await applyStatDelta(p.id, month, isWin ? 1 : 0, isWin ? 0 : 1);
    }
  };
  await saveEntries(aUsers, 'A');
  await saveEntries(bUsers, 'B');

  const embed = new EmbedBuilder()
    .setTitle('✅ 경기 기록 완료')
    .setDescription(`월: **${month}** / 승팀: **${winner}**${score ? ` / 스코어: **${score}**` : ''}`)
    .addFields(
      { name: '팀 A', value: aUsers.map(u => `<@${u.id}>`).join(' ') },
      { name: '팀 B', value: bUsers.map(u => `<@${u.id}>`).join(' ') },
    )
    .setTimestamp(new Date());

  await i.editReply({ embeds: [embed], ...NO_PING });
}

async function handleProfile(i: ChatInputCommandInteraction) {
  const user  = i.options.getUser('user', true);
  const month = i.options.getString('month') ?? getMonthString();

  const p = await prisma.player.findUnique({ where: { userId: user.id } });
  if (!p) { await i.reply({ content: `📄 <@${user.id}> 전적 없음`, ephemeral: true, ...NO_PING }); return; }

  await i.deferReply();
  const stat = await prisma.monthlyStat.findUnique({ where: { playerId_month: { playerId: p.id, month } } });

  const w = stat?.wins ?? 0;
  const l = stat?.losses ?? 0;

  await i.editReply({
    content: `📊 [${month}] <@${user.id}> — **${w}승 ${l}패** (승률 **${fmtWR(w,l)}**) | KD **${fmtKD(stat?.kd)}** | ACS **${fmtACS(stat?.acs)}**`,
    ...NO_PING,
  });
}

async function handleLeaderboard(i: ChatInputCommandInteraction) {
  await i.deferReply();
  const month = i.options.getString('month') ?? getMonthString();

  const stats = await prisma.monthlyStat.findMany({ where: { month }, include: { Player: true } });
  const rows = stats
    .map(s => {
      const total = s.wins + s.losses;
      const wr = total ? s.wins / total : 0;
      return { userId: s.Player.userId, total, wins: s.wins, wr, kd: s.kd ?? null, acs: s.acs ?? null };
    })
    .filter(r => r.total >= 5)
    .sort((a,b) => b.wr - a.wr || b.wins - a.wins)
    .slice(0, 10);

  if (!rows.length) { await i.editReply({ content: `🏷️ [${month}] 랭킹에 표시할 전적이 부족합니다.`, ...NO_PING }); return; }

  const lines = rows.map((r, idx) => {
    const wrp = (Math.round(r.wr * 1000) / 10).toFixed(1) + '%';
    return `**${idx+1}.** <@${r.userId}> — ${r.wins}승 / ${r.total}전 (승률 ${wrp}) | KD ${fmtKD(r.kd)} | ACS ${fmtACS(r.acs)}`;
  });

  await i.editReply({ content: `🏆 **Leaderboard — ${month}**\n${lines.join('\n')}`, ...NO_PING });
}

async function handleBackfill(i: ChatInputCommandInteraction) {
  const user  = i.options.getUser('user', true);
  const month = i.options.getString('month', true);
  const wins  = i.options.getInteger('wins', true);
  const losses= i.options.getInteger('losses', true);

  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) { await i.reply({ content: '⚠️ month 형식은 YYYY-MM 이어야 합니다.', ephemeral: true, ...NO_PING }); return; }
  if (wins < 0 || losses < 0) { await i.reply({ content: '⚠️ wins/losses는 0 이상이어야 합니다.', ephemeral: true, ...NO_PING }); return; }

  await i.deferReply({ ephemeral: true });

  const p = await upsertPlayer(user.id, user.username);
  const before = await prisma.monthlyBaseline.findUnique({ where: { playerId_month: { playerId: p.id, month } } });
  const prevW = before?.wins ?? 0;
  const prevL = before?.losses ?? 0;
  const dW = wins - prevW;
  const dL = losses - prevL;

  if (before) await prisma.monthlyBaseline.update({ where: { playerId_month: { playerId: p.id, month } }, data: { wins, losses } });
  else        await prisma.monthlyBaseline.create({ data: { playerId: p.id, month, wins, losses } });

  if (dW !== 0 || dL !== 0) await applyStatDelta(p.id, month, dW, dL);

  await i.editReply({ content: `🧾 [${month}] <@${user.id}> 기준치 저장 — **${wins}승 ${losses}패** (변경: ${dW >= 0 ? '+' : ''}${dW}승, ${dL >= 0 ? '+' : ''}${dL}패)`, ...NO_PING });
}

async function handleUndo(i: ChatInputCommandInteraction) {
  await i.deferReply();

  const last = await prisma.match.findFirst({ orderBy: { id: 'desc' }, include: { entries: true } });
  if (!last) { await i.editReply({ content: '되돌릴 경기 없음.', ...NO_PING }); return; }

  for (const e of last.entries) await applyStatDelta(e.playerId, last.month, e.isWin ? -1 : 0, e.isWin ? 0 : -1);

  await prisma.entry.deleteMany({ where: { matchId: last.id } });
  await prisma.match.delete({ where: { id: last.id } });

  await i.editReply({ content: '↩️ 마지막 경기 기록을 삭제했습니다.', ...NO_PING });
}

async function handleAllStats(i: ChatInputCommandInteraction) {
  const PAGE_SIZE = 20;
  const page  = i.options.getInteger('page') ?? 1;
  const month = i.options.getString('month') ?? getMonthString();
  if (page < 1) { await i.reply({ content: '페이지는 1 이상이어야 합니다.', ephemeral: true, ...NO_PING }); return; }

  await i.deferReply();

  const [players, stats] = await Promise.all([
    prisma.player.findMany({ select: { id: true, userId: true } }),
    prisma.monthlyStat.findMany({ where: { month } }),
  ]);
  const byPid = new Map(stats.map(s => [s.playerId, s]));

  const rows = players.map(p => {
    const s = byPid.get(p.id);
    const wins = s?.wins ?? 0;
    const losses = s?.losses ?? 0;
    const total = wins + losses;
    const wr = total ? wins / total : 0;
    return { userId: p.userId, total, wins, losses, wr, kd: s?.kd ?? null, acs: s?.acs ?? null };
  });

  rows.sort((a,b) => a.total - b.total || b.wins - a.wins || b.wr - a.wr);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const curPage = Math.min(page, totalPages);
  const pageRows = rows.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);

  const lines = pageRows.map((r, idx) => {
    const no = idx + 1 + (curPage - 1) * PAGE_SIZE;
    const wrp = (Math.round(r.wr * 1000) / 10).toFixed(1) + '%';
    return `**${no}.** <@${r.userId}> — ${r.wins}승 / ${r.total}전 (승률 ${wrp}) | KD ${fmtKD(r.kd)} | ACS ${fmtACS(r.acs)}`;
  });

  await i.editReply({
    content:
      `📒 **All Stats — ${month}** (판수 오름차순)\n` +
      (lines.length ? lines.join('\n') : '표시할 데이터가 없습니다.') +
      `\n\n페이지 ${curPage}/${totalPages} (총 ${rows.length}명, 페이지당 ${PAGE_SIZE})`,
    ...NO_PING,
  });
}

// 관리자: KD/ACS 설정
async function handleSetStat(i: ChatInputCommandInteraction) {
  if (i.memberPermissions && !i.memberPermissions.has('Administrator')) {
    await i.reply({ content: '⚠️ 관리자만 사용할 수 있습니다.', ephemeral: true, ...NO_PING });
    return;
  }

  const user  = i.options.getUser('user', true);
  const month = i.options.getString('month') ?? getMonthString();
  const kd    = i.options.getNumber('kd');    // 예: 1.23
  const acs   = i.options.getInteger('acs');  // 예: 245

  if (kd == null && acs == null) { await i.reply({ content: '⚠️ kd 또는 acs 중 하나 이상 입력하세요.', ephemeral: true, ...NO_PING }); return; }
  if (kd != null && kd < 0)       { await i.reply({ content: '⚠️ KD는 0 이상이어야 합니다.', ephemeral: true, ...NO_PING }); return; }
  if (acs != null && acs < 0)     { await i.reply({ content: '⚠️ ACS는 0 이상이어야 합니다.', ephemeral: true, ...NO_PING }); return; }

  await i.deferReply({ ephemeral: true });

  const p = await upsertPlayer(user.id, user.username);

  await prisma.monthlyStat.upsert({
    where: { playerId_month: { playerId: p.id, month } },
    update: { ...(kd != null ? { kd } : {}), ...(acs != null ? { acs } : {}) },
    create: { playerId: p.id, month, wins: 0, losses: 0, ...(kd != null ? { kd } : {}), ...(acs != null ? { acs } : {}) },
  });

  await i.editReply({
    content: `🛠️ [${month}] <@${user.id}> KD/ACS 업데이트 완료\n• KD: ${kd != null ? kd.toFixed(2) : '—'}\n• ACS: ${acs != null ? acs : '—'}`,
    ...NO_PING,
  });
}

client.login(process.env.DISCORD_TOKEN);

// Render 헬스체크
import express from 'express';
const port = process.env.PORT || 3000;
const app = express();
app.get('/', (_req, res) => res.send('Bot is running'));
app.listen(port, () => console.log(`🌐 Web server on :${port}`));
