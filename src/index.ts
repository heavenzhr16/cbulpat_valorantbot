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

// ✅ 멘션 보이되 알림은 막기
const NO_PING = {
  allowedMentions: { parse: [] as ('users' | 'roles' | 'everyone')[], users: [] as string[], roles: [] as string[], repliedUser: false as const },
};

// YYYY-MM
const getMonthString = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

client.once(Events.ClientReady, () =>
  console.log(`✅ Logged in as ${client.user?.tag}`)
);

client.on('interactionCreate', async (i) => {
  if (!i.isChatInputCommand()) return;
  try {
    if (i.commandName === 'match' && i.options.getSubcommand() === 'result') {
      await handleMatchResult(i);
    } else if (i.commandName === 'profile') {
      await handleProfile(i);
    } else if (i.commandName === 'leaderboard') {
      await handleLeaderboard(i);
    } else if (i.commandName === 'undo') {
      await handleUndo(i);
    } else if (i.commandName === 'backfill') {
      await handleBackfill(i);
    } else if (i.commandName === 'allstats') {
      await handleAllStats(i);
    }
  } catch (e) {
    console.error(e);
    // defer 여부에 맞춰 안전하게 응답
    const payload = { content: '⚠️ 에러가 발생했습니다.', ...NO_PING };
    if (i.deferred || i.replied) await i.editReply(payload as any);
    else await i.reply({ ...payload, ephemeral: true });
  }
});

async function upsertPlayer(userId: string, nickname?: string) {
  return prisma.player.upsert({
    where: { userId },
    update: { ...(nickname !== undefined ? { nickname } : {}) },
    create: { userId, ...(nickname !== undefined ? { nickname } : {}) },
  });
}

async function handleMatchResult(i: ChatInputCommandInteraction) {
  // 1) 채널 제한은 바로 에페메랄 응답
  if (ALLOWED_TEXT_CHANNEL_ID && i.channelId !== ALLOWED_TEXT_CHANNEL_ID) {
    await i.reply({ content: '⚠️ 이 명령은 지정된 채널에서만 사용할 수 있습니다.', ephemeral: true, ...NO_PING });
    return;
  }

  const winner = i.options.getString('winner', true);
  const score  = i.options.getString('score') ?? undefined;
  const monthOpt = i.options.getString('month') ?? undefined;
  const month = monthOpt ?? getMonthString(); // 기본 현재 월

  const aUsers = ['a1','a2','a3','a4','a5'].map(k => i.options.getUser(k, true));
  const bUsers = ['b1','b2','b3','b4','b5'].map(k => i.options.getUser(k, true));

  // 2) 인원/중복 검증도 에페메랄로 즉시 처리
  const ids = new Set([...aUsers, ...bUsers].map(u => u.id));
  if (ids.size !== 10) {
    await i.reply({ content: '⚠️ 같은 사람이 중복되었거나 10명이 아닙니다.', ephemeral: true, ...NO_PING });
    return;
  }

  const participants = [...aUsers, ...bUsers];
  const participantKey = participants.map(u => u.id).sort().join(',');
  const since = new Date(Date.now() - DUPLICATE_WINDOW_MINUTES * 60 * 1000);

  const recentMatches = await prisma.match.findMany({
    where: { createdAt: { gte: since } },
    include: { entries: { include: { Player: true } } }
  });
  const isDuplicate = recentMatches.some(
    (m) => m.entries.map((e) => e.Player.userId).sort().join(',') === participantKey
  );
  if (isDuplicate) {
    await i.reply({ content: `⚠️ 같은 10인 구성의 경기가 최근 ${DUPLICATE_WINDOW_MINUTES}분 내에 이미 기록되었습니다.`, ephemeral: true, ...NO_PING });
    return;
  }

  // 3) 시간이 걸릴 수 있는 DB 작업 전, 디퍼
  await i.deferReply();

  // 4) 저장
  const match = await prisma.match.create({
    data: {
      winner,
      month,
      ...(score !== undefined ? { score } : {}),
    }
  });

  const saveEntries = async (users: typeof aUsers, team: 'A'|'B') => {
    for (const u of users) {
      const p = await upsertPlayer(u.id, u.username);
      await prisma.entry.create({
        data: { matchId: match.id, playerId: p.id, team, isWin: winner === team }
      });
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
  const user = i.options.getUser('user', true);
  const month = i.options.getString('month') ?? getMonthString();

  const p = await prisma.player.findUnique({ where: { userId: user.id } });
  if (!p) { await i.reply({ content: `📄 <@${user.id}> 전적 없음`, ephemeral: true, ...NO_PING }); return; }

  await i.deferReply();

  // 월별 엔트리
  const entries = await prisma.entry.findMany({
    where: { playerId: p.id, Match: { month } },
    include: { Match: true }
  });
  const winsFromMatches = entries.filter((e) => e.isWin).length;
  const lossesFromMatches = entries.length - winsFromMatches;

  // 월별 기준치(백필)
  const base = await prisma.monthlyBaseline.findUnique({
    where: { playerId_month: { playerId: p.id, month } }
  });

  const wins   = (base?.wins ?? 0) + winsFromMatches;
  const losses = (base?.losses ?? 0) + lossesFromMatches;
  const wr = (wins + losses) > 0 ? Math.round((wins / (wins + losses)) * 1000) / 10 : 0;

  await i.editReply({ content: `📊 [${month}] <@${user.id}> — **${wins}승 ${losses}패** (승률 **${wr}%**)`, ...NO_PING });
}

async function handleLeaderboard(i: ChatInputCommandInteraction) {
  await i.deferReply();
  const month = i.options.getString('month') ?? getMonthString();

  // 해당 월의 엔트리 전부 로딩 후 JS에서 집계 (소규모 서버 기준 충분)
  const entries = await prisma.entry.findMany({
    where: { Match: { month } },
    include: { Player: true, Match: true }
  });

  // 월별 기준치 전부
  const baselines = await prisma.monthlyBaseline.findMany({ where: { month } });

  const byUserId = new Map<string, { total: number; wins: number }>();
  for (const e of entries) {
    const uid = e.Player.userId;
    const cur = byUserId.get(uid) ?? { total: 0, wins: 0 };
    cur.total += 1;
    if (e.isWin) cur.wins += 1;
    byUserId.set(uid, cur);
  }
  for (const b of baselines) {
    const p = await prisma.player.findUnique({ where: { id: b.playerId } });
    if (!p) continue;
    const uid = p.userId;
    const cur = byUserId.get(uid) ?? { total: 0, wins: 0 };
    cur.total += (b.wins + b.losses);
    cur.wins  += b.wins;
    byUserId.set(uid, cur);
  }

  const rows = [...byUserId.entries()]
    .map(([userId, v]) => ({ userId, total: v.total, wins: v.wins, wr: v.total ? v.wins / v.total : 0 }))
    .filter(r => r.total >= 5)
    .sort((a,b) => b.wr - a.wr || b.wins - a.wins)
    .slice(0, 10);

  if (rows.length === 0) {
    await i.editReply({ content: `🏷️ [${month}] 랭킹에 표시할 전적이 부족합니다.`, ...NO_PING });
    return;
  }

  const lines = rows.map((r, idx) =>
    `**${idx+1}.** <@${r.userId}> — ${r.wins}승 / ${r.total}전 (승률 ${Math.round(r.wr*1000)/10}%)`
  );
  await i.editReply({ content: `🏆 **Leaderboard — ${month}**\n${lines.join('\n')}`, ...NO_PING });
}

async function handleBackfill(i: ChatInputCommandInteraction) {
  // 필요 시 권한 체크(역할 제한) 추가 가능
  const user = i.options.getUser('user', true);
  const month = i.options.getString('month', true);
  const wins = i.options.getInteger('wins', true);
  const losses = i.options.getInteger('losses', true);

  // 유효성
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    await i.reply({ content: '⚠️ month 형식은 YYYY-MM 이어야 합니다. 예: 2025-09', ephemeral: true, ...NO_PING });
    return;
  }
  if (wins < 0 || losses < 0) {
    await i.reply({ content: '⚠️ wins/losses는 0 이상이어야 합니다.', ephemeral: true, ...NO_PING });
    return;
  }

  await i.deferReply();

  const p = await upsertPlayer(user.id, user.username);
  await prisma.monthlyBaseline.upsert({
    where: { playerId_month: { playerId: p.id, month } },
    update: { wins, losses },
    create: { playerId: p.id, month, wins, losses }
  });

  await i.editReply({ content: `🧾 [${month}] <@${user.id}> 기준치 저장 — **${wins}승 ${losses}패**`, ...NO_PING });
}

async function handleUndo(i: ChatInputCommandInteraction) {
  await i.deferReply();

  const last = await prisma.match.findFirst({ orderBy: { id: 'desc' } });
  if (!last) { await i.editReply({ content: '되돌릴 경기 없음.', ...NO_PING }); return; }
  await prisma.entry.deleteMany({ where: { matchId: last.id } });
  await prisma.match.delete({ where: { id: last.id } });
  await i.editReply({ content: '↩️ 마지막 경기 기록을 삭제했습니다.', ...NO_PING });
}

async function handleAllStats(i: ChatInputCommandInteraction) {
  const PAGE_SIZE = 20;
  const page = i.options.getInteger('page') ?? 1;
  const month = i.options.getString('month') ?? getMonthString();
  if (page < 1) {
    await i.reply({ content: '페이지는 1 이상이어야 합니다.', ephemeral: true, ...NO_PING });
    return;
  }

  await i.deferReply();

  // 1) 이번 달 엔트리 전부
  const entries = await prisma.entry.findMany({
    where: { Match: { month } },
    include: { Player: true },
  });

  // 2) 이번 달 백필(기준치)
  const baselines = await prisma.monthlyBaseline.findMany({ where: { month } });

  // 3) playerId -> userId 매핑
  const players = await prisma.player.findMany({ select: { id: true, userId: true } });
  const idToUserId = new Map(players.map(p => [p.id, p.userId]));

  // 4) 합산
  const byUserId = new Map<string, { total: number; wins: number }>();

  for (const e of entries) {
    const uid = e.Player.userId;
    const cur = byUserId.get(uid) ?? { total: 0, wins: 0 };
    cur.total += 1;
    if (e.isWin) cur.wins += 1;
    byUserId.set(uid, cur);
  }

  for (const b of baselines) {
    const uid = idToUserId.get(b.playerId);
    if (!uid) continue;
    const cur = byUserId.get(uid) ?? { total: 0, wins: 0 };
    cur.total += b.wins + b.losses;
    cur.wins  += b.wins;
    byUserId.set(uid, cur);
  }

  // 기록 없는 사람도 0으로 포함 (원하면 제거 가능)
  for (const p of players) if (!byUserId.has(p.userId)) byUserId.set(p.userId, { total: 0, wins: 0 });

  type Row = { userId: string; total: number; wins: number; losses: number; wr: number };
  const rows: Row[] = [...byUserId.entries()].map(([userId, v]) => {
    const total = v.total;
    const wins = v.wins;
    const losses = total - wins;
    const wr = total ? wins / total : 0;
    return { userId, total, wins, losses, wr };
  });

  // 정렬: 판수 오름차순 → (동률이면 승수 내림차순 → 승률 내림차순)
  rows.sort((a, b) => a.total - b.total || b.wins - a.wins || b.wr - a.wr);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const curPage = Math.min(page, totalPages);
  const pageRows = rows.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);

  const lines = pageRows.map((r, idx) => {
    const no = idx + 1 + (curPage - 1) * PAGE_SIZE;
    const wrp = (Math.round(r.wr * 1000) / 10).toFixed(1) + '%';
    return `**${no}.** <@${r.userId}> — ${r.wins}승 / ${r.total}전 (승률 ${wrp})`;
  });

  await i.editReply({
    content:
      `📒 **All Stats — ${month}** (판수 오름차순)\n` +
      (lines.length ? lines.join('\n') : '표시할 데이터가 없습니다.') +
      `\n\n페이지 ${curPage}/${totalPages} (총 ${rows.length}명, 페이지당 ${PAGE_SIZE})`,
    ...NO_PING,
  });
}

client.login(process.env.DISCORD_TOKEN);

// --- Render Web Service healthcheck ---
import express from 'express';
const port = process.env.PORT || 3000;
const app = express();
app.get('/', (_req: express.Request, res: express.Response) => res.send('Bot is running'));
app.listen(port, () => console.log(`🌐 Web server on :${port}`));
