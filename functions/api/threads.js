export async function onRequestGet(context) {
  const { env } = context;
  
  try {
    // 1. Cloudflare KV에서 업무 일지 메타데이터 불러오기
    let discordToken = env.DISCORD_TOKEN;
    let forumChannelId = env.FORUM_CHANNEL_ID;
    
    if (env.KANBAN_KV) {
      if (!discordToken) discordToken = await env.KANBAN_KV.get('DISCORD_TOKEN');
      if (!forumChannelId) forumChannelId = await env.KANBAN_KV.get('FORUM_CHANNEL_ID');
    }

    const metadataString = env.KANBAN_KV ? await env.KANBAN_KV.get('THREAD_METADATA') : null;
    const threadMetadata = metadataString ? JSON.parse(metadataString) : {};
    
    if (!discordToken || !forumChannelId) {
      throw new Error('디스코드 토큰이나 채널 ID가 없습니다. 환경 변수를 확인해주세요.');
    }

    const headers = {
      "Authorization": `Bot ${discordToken}`,
      "Content-Type": "application/json"
    };

    // 2. 디스코드 채널 정보를 먼저 호출하여 guild_id(서버 ID)를 얻습니다.
    const channelRes = await fetch(`https://discord.com/api/v10/channels/${forumChannelId}`, { headers });
    if (!channelRes.ok) {
      const errText = await channelRes.text();
      throw new Error(`채널 조회 실패 (${channelRes.status}). 이유: ${errText}`);
    }
    const channelData = await channelRes.json();
    const guildId = channelData.guild_id;

    // 3. 디스코드 REST API 호출 (서버의 활성 스레드 전체, 채널의 보관된 스레드)
    const [activeRes, archivedRes] = await Promise.all([
      fetch(`https://discord.com/api/v10/guilds/${guildId}/threads/active`, { headers }),
      fetch(`https://discord.com/api/v10/channels/${forumChannelId}/threads/archived/public?limit=50`, { headers })
    ]);

    if (!activeRes.ok || !archivedRes.ok) {
      let errText = '';
      try {
        if (!activeRes.ok) errText = await activeRes.text();
        else errText = await archivedRes.text();
      } catch(e) {}
      throw new Error(`스레드 조회 실패 (활성:${activeRes.status}, 보관:${archivedRes.status}). 이유: ${errText}`);
    }

    const activeData = await activeRes.json();
    const archivedData = await archivedRes.json();

    // 4. 서버 전체 활성 스레드 중, 현재 포럼 채널에 속한 스레드만 필터링
    const activeThreads = (activeData.threads || []).filter(t => t.parent_id === forumChannelId);
    const forumTags = channelData.available_tags || [];
    const allThreads = [...activeThreads, ...(archivedData.threads || [])];

    // 5. 데이터 직렬화 (기존 server.js의 serializeThread 역할)
    const threadList = allThreads.map(thread => {
      const columnId = thread.applied_tags?.[0];
      const tag = forumTags.find(t => t.id === columnId);
      
      let colName = '우선순위 없음';
      let colEmoji = '📌';
      if (tag) {
        colName = tag.name;
        colEmoji = tag.emoji_id ? `https://cdn.discordapp.com/emojis/${tag.emoji_id}.webp?size=32` : (tag.emoji_name || '📌');
      }

      // 스노우플레이크(ID)를 이용해 마지막 메시지 시간 유추
      const lastMessageTime = thread.last_message_id 
        ? Number((BigInt(thread.last_message_id) >> 22n) + 1420070400000n)
        : new Date(thread.thread_metadata?.create_timestamp).getTime();

      const meta = threadMetadata[thread.id] || {
        summary: '미설정', workLog: '미작성', dailyLogs: [], inactiveDays: 3,
        assignees: { main: '미정', sub: '미정' }, members: []
      };
      if (!meta.dailyLogs) meta.dailyLogs = [];

      return {
        id: thread.id,
        name: thread.name,
        appliedTags: thread.applied_tags || [],
        archived: thread.thread_metadata?.archived || false,
        createdAt: thread.thread_metadata?.create_timestamp,
        lastMessageTime: lastMessageTime,
        column: thread.thread_metadata?.archived ? '보관됨 (완료)' : colName,
        columnEmoji: thread.thread_metadata?.archived ? '📦' : colEmoji,
        messageCount: thread.message_count || 0,
        ownerId: thread.owner_id,
        meta: meta
      };
    });

    return new Response(JSON.stringify(threadList), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}