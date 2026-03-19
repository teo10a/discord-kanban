const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits } = require('discord.js');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json()); // 프론트엔드에서 보내는 JSON 데이터를 읽기 위해 추가
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' } // 실제 서비스 시에는 프론트엔드 도메인으로 제한하세요.
});

// 디스코드 클라이언트 설정
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // 메시지 내용을 읽기 위해 추가
    GatewayIntentBits.DirectMessages,
  ]
});

// 전역 환경 변수 (Cloudflare KV에서 불러올 예정)
let DISCORD_TOKEN = '';
let FORUM_CHANNEL_ID = '';

// Cloudflare KV API 접속 정보 (.env에서 읽음)
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_NAMESPACE_ID = process.env.CF_NAMESPACE_ID;
const CF_API_TOKEN = process.env.CF_API_TOKEN;

// 1. Cloudflare KV 읽기 헬퍼 함수
async function getKvValue(key) {
  if (!CF_ACCOUNT_ID || !CF_NAMESPACE_ID || !CF_API_TOKEN) return null;
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_NAMESPACE_ID}/values/${key}`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` } });
  return res.ok ? await res.text() : null;
}

// 2. Cloudflare KV 쓰기 헬퍼 함수
async function putKvValue(key, value) {
  if (!CF_ACCOUNT_ID || !CF_NAMESPACE_ID || !CF_API_TOKEN) return;
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_NAMESPACE_ID}/values/${key}`;
  await fetch(url, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` },
    body: typeof value === 'string' ? value : JSON.stringify(value)
  });
}

// 포럼 태그와 칸반 컬럼 매핑 (태그 ID -> 컬럼명)
const TAG_TO_COLUMN = {
  // 예시: 'tag_id_1': 'To Do', 'tag_id_2': 'In Progress', 'tag_id_3': 'Done'
  // 실제 사용 시 Discord 포럼의 태그 ID로 수정하세요.
};

// 포럼 채널에서 태그 정보 캐시
let forumTags = [];

// 스레드별 메타데이터 (메모리 상태 및 파일 저장)
const METADATA_FILE = path.join(__dirname, 'threadMetadata.json');
let threadMetadata = {};

// 서버 시작 시 파일에서 기존 메타데이터 불러오기
// (동기식 파일 로드는 하단 startServer() 비동기 함수로 이동)

// 메타데이터를 로컬 파일에 저장하는 헬퍼 함수
function saveThreadMetadata() {
  // 로컬 파일과 함께 Cloudflare KV에도 비동기로 동기화
  putKvValue('THREAD_METADATA', threadMetadata).catch(e => console.error('KV 메타데이터 저장 실패:', e));
  try {
    fs.writeFileSync(METADATA_FILE, JSON.stringify(threadMetadata, null, 2), 'utf8');
  } catch (error) {
    console.error('메타데이터 파일 저장 실패:', error);
  }
}

function getThreadMeta(id) {
  if (!threadMetadata[id]) {
    threadMetadata[id] = {
      summary: '미설정',
      workLog: '미작성',
      dailyLogs: [],
      inactiveDays: 3, // 경고 기준 일수
      assignees: { main: '미정', sub: '미정' },
      members: []
    };
    saveThreadMetadata(); // 최초 생성 시 즉시 저장
  }
  // 기존 데이터에 dailyLogs 배열이 없을 경우를 대비한 방어 코드
  if (!threadMetadata[id].dailyLogs) {
    threadMetadata[id].dailyLogs = [];
  }

  return threadMetadata[id];
}

client.once('clientReady', () => {
  console.log(`디스코드 봇 온라인: ${client.user.tag}`);
  
  // 초대 링크 자동 생성 및 출력
  const inviteLink = client.generateInvite({
    permissions: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory,
    ],
    scopes: ['bot'],
  });
  console.log(`봇 초대 링크: ${inviteLink}`);
  
  initializeForumTags();
});

// 포럼 태그 초기화
async function initializeForumTags() {
  try {
    console.log(`채널 데이터 로드 시도 중... (ID: ${FORUM_CHANNEL_ID})`);
    const channel = await client.channels.fetch(FORUM_CHANNEL_ID, { force: true });
    
    console.log(`가져온 채널 정보: 이름="${channel.name}", 타입=${channel.type} (포럼 타입은 15)`);

    if (channel.type === ChannelType.GuildForum) {
      forumTags = channel.availableTags || [];
      console.log('포럼 태그 로드됨:', forumTags.map(tag => ({ id: tag.id, name: tag.name })));
    } else {
      console.warn(`주의: 설정된 ID가 포럼 채널이 아닙니다 (현재 타입: ${channel.type}). 채널 ID를 다시 확인해 주세요.`);
    }
  } catch (error) {
    console.error('포럼 채널 접근 실패: 봇이 서버에 초대되었는지, 채널 보기 권한이 있는지 확인하세요.');
    console.error(`상세 에러: ${error.message}`);
  }
}

// 프론트엔드로 전달할 스레드 데이터 정리 함수
function serializeThread(thread) {
  // 스레드의 첫 번째 태그를 기반으로 컬럼 결정
  const columnId = thread.appliedTags?.[0];
  const tagInfo = getColumnTagInfo(columnId);

  // 마지막 메시지 전송 시간을 스노우플레이크(ID)를 통해 유추
  const lastMessageTime = thread.lastMessageId 
    ? Number((BigInt(thread.lastMessageId) >> 22n) + 1420070400000n)
    : new Date(thread.createdAt).getTime();

  return {
    id: thread.id,
    name: thread.name,
    appliedTags: thread.appliedTags || [],
    archived: thread.archived,
    createdAt: thread.createdAt,
    lastMessageTime: lastMessageTime,
    column: thread.archived ? '보관됨 (완료)' : tagInfo.name,
    columnEmoji: thread.archived ? '📦' : tagInfo.emoji,
    messageCount: thread.messageCount || 0,
    ownerId: thread.ownerId,
    meta: getThreadMeta(thread.id)
  };
}

// 태그 ID로 컬럼 정보 조회
function getColumnTagInfo(tagId) {
  const tag = forumTags.find(t => t.id === tagId);
  if (!tag) return { name: '우선순위 없음', emoji: '📌' };
  return {
    name: tag.name,
    emoji: tag.emoji ? (tag.emoji.id ? `https://cdn.discordapp.com/emojis/${tag.emoji.id}.webp?size=32` : tag.emoji.name) : '📌'
  };
}

// 1. 초기 데이터 제공 API (현재 포럼의 활성 스레드 목록)
app.get('/api/threads', async (req, res) => {
  try {
    const channel = await client.channels.fetch(FORUM_CHANNEL_ID);
    const { threads: activeThreads } = await channel.threads.fetchActive();
    
    // 최근 보관된(완료된) 스레드 최대 20개 가져오기
    const { threads: archivedThreads } = await channel.threads.fetchArchived({ limit: 50});
    
    const threadList = [
      ...activeThreads.map(serializeThread),
      ...archivedThreads.map(serializeThread)
    ];
    res.json(threadList);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. 포럼 태그 조회 API
app.get('/api/tags', (req, res) => {
  try {
    const tags = forumTags.map(tag => ({
      id: tag.id,
      name: tag.name,
      emoji: tag.emoji ? (tag.emoji.id ? `https://cdn.discordapp.com/emojis/${tag.emoji.id}.webp?size=32` : tag.emoji.name) : '📌'
    }));

    // 지정된 태그(우선순위)가 없는 스레드를 위한 기본 컬럼 추가
    tags.push({
      id: 'uncategorized',
      name: '우선순위 없음',
      emoji: '📌'
    });

    // 보관(완료)된 스레드를 위한 가상 컬럼 추가
    tags.push({
      id: 'archived',
      name: '보관됨 (완료)',
      emoji: '📦'
    });

    res.json(tags);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. 특정 스레드의 메시지 조회 API
app.get('/api/threads/:threadId/messages', async (req, res) => {
  try {
    const thread = await client.channels.fetch(req.params.threadId);
    const messages = await thread.messages.fetch({ limit: 5 });
    
    const messageList = messages
      .reverse()
      .map(msg => ({
        id: msg.id,
        author: msg.author.username,
        avatar: msg.author.displayAvatarURL({ size: 64 }),
        content: msg.content,
        createdAt: msg.createdAt,
        attachments: msg.attachments.map(att => att.url)
      }));
    
    res.json(messageList);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. 스레드 태그(우선순위) 변경 API (드래그 앤 드롭용)
app.patch('/api/threads/:threadId/tags', async (req, res) => {
  try {
    const { threadId } = req.params;
    const { newTags, isArchived } = req.body;

    const thread = await client.channels.fetch(threadId);
    if (!thread || !thread.isThread()) {
      return res.status(404).json({ error: '스레드를 찾을 수 없습니다.' });
    }

    // 1) 보관/활성화 상태 변경
    if (isArchived === true) {
      if (!thread.archived) await thread.setArchived(true);
      return res.json({ success: true });
    } else if (isArchived === false) {
      if (thread.archived) await thread.setArchived(false);
    }

    // 2) 다중 태그 덮어쓰기 (분류와 우선순위를 모두 유지하기 위해 프론트에서 계산한 배열 사용)
    if (newTags && Array.isArray(newTags)) {
      await thread.setAppliedTags(newTags); // 디스코드에 변경된 태그 적용
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 5. 스레드에 새 메시지(댓글) 작성 API
app.post('/api/threads/:threadId/messages', async (req, res) => {
  try {
    const { threadId } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: '메시지 내용이 비어있습니다.' });
    }

    const thread = await client.channels.fetch(threadId);
    if (!thread || !thread.isThread()) {
      return res.status(404).json({ error: '스레드를 찾을 수 없습니다.' });
    }

    await thread.send(content); // 디스코드 스레드에 봇이 메시지 전송
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 6. 스레드 일자별 업무 일지 작성 API
app.post('/api/threads/:threadId/daily-log', async (req, res) => {
  try {
    const { threadId } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: '일지 내용이 비어있습니다.' });
    }

    const thread = await client.channels.fetch(threadId);
    if (!thread || !thread.isThread()) return res.status(404).json({ error: '스레드를 찾을 수 없습니다.' });

    const meta = getThreadMeta(threadId);
    const today = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit' });
    meta.dailyLogs.push({ date: today, content: content.trim(), timestamp: Date.now() });
    
    saveThreadMetadata();
    io.emit('threadUpdate', serializeThread(thread));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 7. 스레드 일자별 업무 일지 수정 API
app.patch('/api/threads/:threadId/daily-log/:timestamp', async (req, res) => {
  try {
    const { threadId, timestamp } = req.params;
    const { content } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: '내용이 비어있습니다.' });

    const thread = await client.channels.fetch(threadId);
    if (!thread || !thread.isThread()) return res.status(404).json({ error: '스레드를 찾을 수 없습니다.' });

    const meta = getThreadMeta(threadId);
    const log = meta.dailyLogs.find(l => l.timestamp === parseInt(timestamp, 10));
    if (log) {
      log.content = content.trim();
      saveThreadMetadata();
      io.emit('threadUpdate', serializeThread(thread));
      res.json({ success: true });
    } else {
      res.status(404).json({ error: '일지를 찾을 수 없습니다.' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 8. 스레드 일자별 업무 일지 삭제 API
app.delete('/api/threads/:threadId/daily-log/:timestamp', async (req, res) => {
  try {
    const { threadId, timestamp } = req.params;
    const thread = await client.channels.fetch(threadId);
    if (!thread || !thread.isThread()) return res.status(404).json({ error: '스레드를 찾을 수 없습니다.' });

    const meta = getThreadMeta(threadId);
    meta.dailyLogs = meta.dailyLogs.filter(l => l.timestamp !== parseInt(timestamp, 10));
    saveThreadMetadata();
    io.emit('threadUpdate', serializeThread(thread));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. 스레드 생성 실시간 감지
client.on('threadCreate', (thread) => {
  if (thread.parentId === FORUM_CHANNEL_ID) {
    io.emit('threadCreate', serializeThread(thread));
  }
});

// 3. 스레드 업데이트 실시간 감지 (예: 제목 수정, 태그 추가/삭제)
client.on('threadUpdate', (oldThread, newThread) => {
  if (newThread.parentId === FORUM_CHANNEL_ID) {
    io.emit('threadUpdate', serializeThread(newThread));
  }
});

// 4. 스레드 삭제 실시간 감지
client.on('threadDelete', (thread) => {
  if (thread.parentId === FORUM_CHANNEL_ID) {
    io.emit('threadDelete', thread.id);
  }
});

// 5. 채널 정보 변경 실시간 감지 (태그 추가/수정 등)
client.on('channelUpdate', async (oldChannel, newChannel) => {
  // 포럼 채널 자체의 설정(태그 등)이 변경되었을 때
  if (newChannel.id === FORUM_CHANNEL_ID) {
    await initializeForumTags(); // 캐시된 태그 정보 업데이트
    io.emit('tagsUpdate');       // 모든 웹 화면에 새로고침 요청
  }
});

// 6. 봇 명령어 감지 (스레드 설정)
client.on('messageCreate', (message) => {
  if (message.author.bot) return;
  
  // 포럼 채널 내부의 특정 스레드에서 보낸 메시지만 처리
  if (!message.channel.isThread() || message.channel.parentId !== FORUM_CHANNEL_ID) return;

  const args = message.content.trim().split(/\s+/);
  const cmd = args[0];
  if (!cmd.startsWith('!')) return;

  const meta = getThreadMeta(message.channel.id);
  let updated = false;

  if (cmd === '!요약') {
    meta.summary = args.slice(1).join(' ') || '미설정';
    updated = true;
  } else if (cmd === '!업무일지') {
    meta.workLog = args.slice(1).join(' ') || '미작성';
    const content = args.slice(1).join(' ') || '미작성';
    const today = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit' });
    meta.dailyLogs.push({ date: today, content, timestamp: Date.now() });
    updated = true;
  } else if (cmd === '!경고기준') {
    const d = parseInt(args[1], 10);
    if (!isNaN(d)) { meta.inactiveDays = d; updated = true; }
  } else if (cmd === '!담당자') {
    meta.assignees.main = args[1] || '미정';
    meta.assignees.sub = args[2] || '미정';
    updated = true;
  } else if (cmd === '!팀원') {
    meta.members = args.slice(1);
    updated = true;
  }

  if (updated) {
    saveThreadMetadata(); // 업데이트가 발생했을 때 파일에 덮어쓰기 저장
    message.reply('✅ 스레드 설정이 업데이트 되었습니다.\n웹 칸반 보드 카드에 실시간으로 반영됩니다.');
    io.emit('threadUpdate', serializeThread(message.channel));
  }
});

// 서버 초기화 및 실행 (Cloudflare KV 비동기 로드)
async function startServer() {
  console.log('Cloudflare KV에서 데이터를 불러오는 중...');
  
  // 1. KV에서 환경변수 로드 (KV에 없으면 기존 .env 값을 폴백으로 사용)
  DISCORD_TOKEN = (await getKvValue('DISCORD_TOKEN')) || process.env.DISCORD_TOKEN;
  FORUM_CHANNEL_ID = (await getKvValue('FORUM_CHANNEL_ID'))?.trim() || process.env.FORUM_CHANNEL_ID?.trim() || '연동할_포럼_채널_ID';

  if (!DISCORD_TOKEN || !DISCORD_TOKEN.includes('.')) {
    console.error('오류: 유효한 DISCORD_TOKEN이 설정되지 않았습니다. Cloudflare KV 또는 .env를 확인하세요.');
    process.exit(1);
  }

  // 2. KV에서 메타데이터(업무일지 등) 로드
  const kvMetadata = await getKvValue('THREAD_METADATA');
  if (kvMetadata) {
    try {
      threadMetadata = JSON.parse(kvMetadata);
      console.log('✅ Cloudflare KV에서 업무일지 메타데이터를 성공적으로 불러왔습니다.');
    } catch (e) {
      console.error('KV 메타데이터 파싱 실패:', e);
    }
  } else if (fs.existsSync(METADATA_FILE)) {
    try {
      const data = fs.readFileSync(METADATA_FILE, 'utf8');
      threadMetadata = JSON.parse(data);
    } catch (error) {
      console.error('로컬 메타데이터 로드 실패:', error);
    }
  }

  client.login(DISCORD_TOKEN);
  server.listen(3001, () => console.log('백엔드 서버가 3001번 포트에서 실행 중입니다.'));
}

startServer();
