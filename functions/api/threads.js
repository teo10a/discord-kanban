export async function onRequestGet(context) {
  const { env } = context;
  
  try {
    // 1. Cloudflare KV에서 업무 일지 메타데이터 불러오기
    const discordToken = await env.KANBAN_KV.get('DISCORD_TOKEN');
    const forumChannelId = await env.KANBAN_KV.get('FORUM_CHANNEL_ID');
    const metadataString = await env.KANBAN_KV.get('THREAD_METADATA');
    const threadMetadata = metadataString ? JSON.parse(metadataString) : {};
    
    if (!discordToken || !forumChannelId) {
      throw new Error('KV 저장소에 DISCORD_TOKEN 또는 FORUM_CHANNEL_ID가 설정되지 않았습니다.');
    }

    const headers = {
      "Authorization": `Bot ${discordToken}`,
      "Content-Type": "application/json"
    };

    // 2. 디스코드 REST API 동시 호출 (채널 태그, 활성 스레드, 보관된 스레드)
    const [channelRes, activeRes, archivedRes] = await Promise.all([
      fetch(`https://discord.com/api/v10/channels/${forumChannelId}`, { headers }),
      fetch(`https://discord.com/api/v10/channels/${forumChannelId}/threads/active`, { headers }),
      fetch(`https://discord.com/api/v10/channels/${forumChannelId}/threads/archived/public?limit=50`, { headers })
    ]);

    if (!channelRes.ok || !activeRes.ok || !archivedRes.ok) {
      throw new Error('디스코드 API 호출에 실패했습니다. 토큰 및 채널 ID를 확인하세요.');
    }

    const channelData = await channelRes.json();
    const activeData = await activeRes.json();
    const archivedData = await archivedRes.json();

    // 3. 포럼 채널의 태그 정보 캐싱
    const forumTags = channelData.available_tags || [];
    const allThreads = [...(activeData.threads || []), ...(archivedData.threads || [])];

    // 4. 데이터 직렬화 (기존 server.js의 serializeThread 역할)
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