// 스레드 메타데이터(요약, 담당자 등) 수정 API (PATCH)
export async function onRequestPatch(context) {
  const { request, env, params } = context;
  const threadId = params.threadId;

  try {
    const body = await request.json();
    
    // KV 데이터 로드
    const metadataString = await env.KANBAN_KV.get('THREAD_METADATA');
    const threadMetadata = metadataString ? JSON.parse(metadataString) : {};

    if (!threadMetadata[threadId]) {
      threadMetadata[threadId] = { summary: '미설정', workLog: '미작성', dailyLogs: [], inactiveDays: 3, assignees: { main: '미정', sub: '미정' }, members: [] };
    }

    // 전달받은 값이 있으면 각각 업데이트
    if (body.summary !== undefined) threadMetadata[threadId].summary = body.summary;
    if (body.assignees !== undefined) threadMetadata[threadId].assignees = body.assignees;
    if (body.members !== undefined) threadMetadata[threadId].members = body.members;
    if (body.inactiveDays !== undefined) threadMetadata[threadId].inactiveDays = body.inactiveDays;

    await env.KANBAN_KV.put('THREAD_METADATA', JSON.stringify(threadMetadata));
    return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}