// 1. 업무일지 수정 API (PATCH)
export async function onRequestPatch(context) {
  const { request, env, params } = context;
  const { threadId, timestamp } = params;

  try {
    const { content } = await request.json();
    if (!content || !content.trim()) return new Response(JSON.stringify({ error: '내용이 비어있습니다.' }), { status: 400 });

    const metadataString = await env.KANBAN_KV.get('THREAD_METADATA');
    const threadMetadata = metadataString ? JSON.parse(metadataString) : {};

    if (!threadMetadata[threadId] || !threadMetadata[threadId].dailyLogs) {
      return new Response(JSON.stringify({ error: '스레드 정보를 찾을 수 없습니다.' }), { status: 404 });
    }

    const log = threadMetadata[threadId].dailyLogs.find(l => l.timestamp === parseInt(timestamp, 10));
    if (!log) {
      return new Response(JSON.stringify({ error: '해당 일지를 찾을 수 없습니다.' }), { status: 404 });
    }

    log.content = content.trim();
    await env.KANBAN_KV.put('THREAD_METADATA', JSON.stringify(threadMetadata));

    return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}

// 2. 업무일지 삭제 API (DELETE)
export async function onRequestDelete(context) {
  const { env, params } = context;
  const { threadId, timestamp } = params;

  try {
    const metadataString = await env.KANBAN_KV.get('THREAD_METADATA');
    const threadMetadata = metadataString ? JSON.parse(metadataString) : {};

    if (threadMetadata[threadId] && threadMetadata[threadId].dailyLogs) {
      threadMetadata[threadId].dailyLogs = threadMetadata[threadId].dailyLogs.filter(
        l => l.timestamp !== parseInt(timestamp, 10)
      );
      await env.KANBAN_KV.put('THREAD_METADATA', JSON.stringify(threadMetadata));
    }

    return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}