export async function onRequestGet(context) {
  const { env } = context;
  
  try {
    const discordToken = await env.KANBAN_KV.get('DISCORD_TOKEN');
    const forumChannelId = await env.KANBAN_KV.get('FORUM_CHANNEL_ID');

    if (!discordToken || !forumChannelId) {
      throw new Error('KV 저장소에 DISCORD_TOKEN 또는 FORUM_CHANNEL_ID가 설정되지 않았습니다.');
    }

    const response = await fetch(`https://discord.com/api/v10/channels/${forumChannelId}`, {
      headers: { "Authorization": `Bot ${discordToken}` }
    });

    if (!response.ok) throw new Error('채널 정보를 불러오지 못했습니다.');

    const channelData = await response.json();
    const tags = (channelData.available_tags || []).map(tag => ({
      id: tag.id,
      name: tag.name,
      emoji: tag.emoji_id ? `https://cdn.discordapp.com/emojis/${tag.emoji_id}.webp?size=32` : (tag.emoji_name || '📌')
    }));

    tags.push({ id: 'uncategorized', name: '우선순위 없음', emoji: '📌' });
    tags.push({ id: 'archived', name: '보관됨 (완료)', emoji: '📦' });

    return new Response(JSON.stringify(tags), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}