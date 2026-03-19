// 스레드 태그(우선순위) 변경 및 보관 처리 API (PATCH)
export async function onRequestPatch(context) {
  const { request, env, params } = context;
  const threadId = params.threadId;

  try {
    const { tagId, newTags, isArchived } = await request.json();

    let discordToken = env.DISCORD_TOKEN;
    if (env.KANBAN_KV && !discordToken) {
      discordToken = await env.KANBAN_KV.get('DISCORD_TOKEN');
    }

    const payload = {};
    if (isArchived !== undefined) {
      payload.archived = isArchived;
    }
    // 새 태그 배열이 전달되었을 때만 디스코드에 반영
    if (newTags && Array.isArray(newTags)) {
      payload.applied_tags = newTags;
    }

    const res = await fetch(`https://discord.com/api/v10/channels/${threadId}`, {
      method: 'PATCH',
      headers: {
        "Authorization": `Bot ${discordToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`디스코드 API 거절 (${res.status}): ${errText}`);
    }

    return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}