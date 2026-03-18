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

// 환경 변수 설정
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const FORUM_CHANNEL_ID = process.env.FORUM_CHANNEL_ID?.trim() || '연동할_포럼_채널_ID';

if (!DISCORD_TOKEN || DISCORD_TOKEN === '당신의_디스코드_봇_토큰' || !DISCORD_TOKEN.includes('.')) {
  console.error('오류: .env 파일에 유효한 DISCORD_TOKEN이 설정되지 않았습니다.');
  if (DISCORD_TOKEN && !DISCORD_TOKEN.includes('.')) {
    console.error('힌트: 현재 입력된 토큰은 ID 형태인 것 같습니다. Bot 메뉴에서 "Reset Token"을 눌러 가져온 긴 토큰을 사용하세요.');
  }
  process.exit(1);
}

// 포럼 태그와 칸반 컬럼 매핑 (태그 ID -> 컬럼명)
const TAG_TO_COLUMN = {
  // 예시: 'tag_id_1': 'To Do', 'tag_id_2': 'In Progress', 'tag_id_3': 'Done'
  // 실제 사용 시 Discord 포럼의 태그 ID로 수정하세요.
};

// 포럼 채널에서 태그 정보 캐시
let forumTags = [];

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

  return {
    id: thread.id,
    name: thread.name,
    appliedTags: thread.appliedTags || [],
    archived: thread.archived,
    createdAt: thread.createdAt,
    column: tagInfo.name,
    columnEmoji: tagInfo.emoji,
    messageCount: thread.messageCount || 0,
    ownerId: thread.ownerId
  };
}

// 태그 ID로 컬럼 정보 조회
function getColumnTagInfo(tagId) {
  if (!tagId) return { name: '우선순위 없음', emoji: '📌' };
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
    const { threads } = await channel.threads.fetchActive();
    
    const threadList = threads.map(serializeThread);
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

    res.json(tags);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. 특정 스레드의 메시지 조회 API
app.get('/api/threads/:threadId/messages', async (req, res) => {
  try {
    const thread = await client.channels.fetch(req.params.threadId);
    const messages = await thread.messages.fetch({ limit: 10 });
    
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
    const { tagId } = req.body;

    const thread = await client.channels.fetch(threadId);
    if (!thread || !thread.isThread()) {
      return res.status(404).json({ error: '스레드를 찾을 수 없습니다.' });
    }

    // 기존 태그에서 포럼의 컬럼용 태그들만 모두 제외 (커스텀 태그는 유지하기 위함)
    const forumTagIds = forumTags.map(t => t.id);
    let newTags = (thread.appliedTags || []).filter(id => !forumTagIds.includes(id));

    // 새 태그가 '우선순위 없음'이 아니라면 배열 맨 앞에 추가
    if (tagId && tagId !== 'uncategorized') {
      newTags.unshift(tagId);
    }

    await thread.setAppliedTags(newTags); // 디스코드에 변경된 태그 적용
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

client.login(DISCORD_TOKEN);
server.listen(3001, () => console.log('백엔드 서버가 3001번 포트에서 실행 중입니다.'));
