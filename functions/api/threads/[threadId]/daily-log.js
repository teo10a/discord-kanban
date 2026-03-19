// 스레드 일자별 업무 일지 작성 API (POST)
export async function onRequestPost(context) {
  const { request, env, params } = context;
  const threadId = params.threadId;

  try {
    const { content } = await request.json();
    if (!content || !content.trim()) {
      return new Response(JSON.stringify({ error: '일지 내용이 비어있습니다.' }), { status: 400 });
    }

    // KV 데이터 로드
    const metadataString = await env.KANBAN_KV.get('THREAD_METADATA');
    const threadMetadata = metadataString ? JSON.parse(metadataString) : {};

    // 스레드 메타데이터가 없으면 초기화
    if (!threadMetadata[threadId]) {
      threadMetadata[threadId] = { summary: '미설정', workLog: '미작성', dailyLogs: [], inactiveDays: 3, assignees: { main: '미정', sub: '미정' }, members: [] };
    }
    if (!threadMetadata[threadId].dailyLogs) threadMetadata[threadId].dailyLogs = [];

    // 날짜 포맷 (한국 시간 기준)
    const today = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit' });
    threadMetadata[threadId].dailyLogs.push({ date: today, content: content.trim(), timestamp: Date.now() });

    // 변경된 메타데이터 KV에 다시 저장
    await env.KANBAN_KV.put('THREAD_METADATA', JSON.stringify(threadMetadata));

    return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}