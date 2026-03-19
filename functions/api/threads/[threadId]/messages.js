// 1. 특정 스레드의 최근 메시지 5개 조회 (GET)
export async function onRequestGet(context) {
  const { env, params } = context;
  const threadId = params.threadId;

  try {
    const discordToken = await env.KANBAN_KV.get('DISCORD_TOKEN');
    const res = await fetch(`https://discord.com/api/v10/channels/${threadId}/messages?limit=5`, {
      headers: { "Authorization": `Bot ${discordToken}` }
    });

    if (!res.ok) throw new Error('메시지를 불러오지 못했습니다.');
    const messages = await res.json();

    const messageList = messages.reverse().map(msg => {
      // 디스코드 기본 아바타와 커스텀 아바타 처리
      const avatarUrl = msg.author.avatar
        ? `https://cdn.discordapp.com/avatars/${msg.author.id}/${msg.author.avatar}.webp?size=64`
        : `https://cdn.discordapp.com/embed/avatars/${parseInt(msg.author.discriminator || 0) % 5}.png`;

      return {
        id: msg.id,
        author: msg.author.username,
        avatar: avatarUrl,
        content: msg.content,
        createdAt: msg.timestamp,
        attachments: (msg.attachments || []).map(att => att.url)
      };
    });

    return new Response(JSON.stringify(messageList), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}

// 2. 스레드에 새 메시지 작성 (POST)
export async function onRequestPost(context) {
  const { request, env, params } = context;
  const threadId = params.threadId;

  try {
    const { content } = await request.json();
    if (!content || !content.trim()) return new Response(JSON.stringify({ error: '메시지 내용이 없습니다.' }), { status: 400 });

    const discordToken = await env.KANBAN_KV.get('DISCORD_TOKEN');
    const res = await fetch(`https://discord.com/api/v10/channels/${threadId}/messages`, {
      method: 'POST',
      headers: {
        "Authorization": `Bot ${discordToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ content: content.trim() })
    });

    if (!res.ok) throw new Error('메시지 전송에 실패했습니다.');
    return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}