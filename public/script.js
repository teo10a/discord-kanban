let columns = [];
let threads = [];
let currentOpenThreadId = null;
let viewMode = 'all'; // 'all', 'priority', 'category', 'assignee'

// 날짜 포맷팅 함수 (디스코드 스타일)
function formatDiscordDate(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  
  const isToday = date.getDate() === now.getDate() && 
                  date.getMonth() === now.getMonth() && 
                  date.getFullYear() === now.getFullYear();
                  
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.getDate() === yesterday.getDate() && 
                      date.getMonth() === yesterday.getMonth() && 
                      date.getFullYear() === yesterday.getFullYear();
                      
  const timeString = date.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  
  if (isToday) return `오늘 ${timeString}`;
  if (isYesterday) return `어제 ${timeString}`;
  
  const dateStr = date.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${dateStr} ${timeString}`;
}

// 태그 종류 자동 분류 함수 (키워드 기반)
function getTagType(tagName) {
  const priorityKeywords = ['긴급', '높음', '보통', '낮음', '우선순위', 'p1', 'p2', 'p3', 'high', 'medium', 'low', 'urgent'];
  const nameLower = tagName.toLowerCase();
  if (priorityKeywords.some(kw => nameLower.includes(kw))) return 'priority';
  if (tagName === '우선순위 없음' || tagName === '보관됨 (완료)') return 'system';
  return 'category'; // 나머지는 전부 분류(기획, 개발, 디자인 등)로 취급
}

// 뷰 모드 변경 처리
function setViewMode(mode) {
  viewMode = mode;
  document.querySelectorAll('.view-btn').forEach(btn => btn.classList.remove('active'));
  // 현재 클릭된 버튼 활성화
  document.querySelector(`.view-btn[onclick="setViewMode('${mode}')"]`).classList.add('active');
  renderBoard();
}

// 이모지 렌더링 헬퍼 함수 (커스텀 이미지 지원)
function renderEmoji(emoji) {
  if (!emoji) return '';
  if (emoji.startsWith('http')) {
    return `<img src="${emoji}" class="tag-emoji" alt="emoji" loading="lazy" /> `;
  }
  return `${emoji} `;
}

// 칸반 컬럼 렌더링
function renderBoard() {
  const board = document.getElementById('kanban-board');
  board.innerHTML = '';
  
  board.className = '';

  // 1. 현재 뷰 모드에 맞는 컬럼(기둥)만 필터링
  let displayColumns = columns;
  const targetType = viewMode === 'priority' ? 'priority' : (viewMode === 'assignee' ? null : 'category');

  if (viewMode === 'all') {
    // 모든 활성 스레드를 담을 단일 거대 기둥 + 보관됨 기둥 생성
    displayColumns = [{ id: 'all_active', name: '모든 진행중인 업무', emoji: '📋' }];
    displayColumns.push({ id: 'archived', name: '보관됨 (완료)', emoji: '📦' });
  } else if (viewMode === 'category') {
    displayColumns = columns.filter(c => getTagType(c.name) === 'category' || getTagType(c.name) === 'system');
  } else if (viewMode === 'priority') {
    displayColumns = columns.filter(c => getTagType(c.name) === 'priority' || getTagType(c.name) === 'system');
  } else if (viewMode === 'assignee') {
    // 메타데이터에서 정담당자(main) 고유 목록 추출
    const uniqueAssignees = [...new Set(threads.map(t => t.meta?.assignees?.main || '미정'))].filter(a => a !== '미정');
    uniqueAssignees.sort();
    uniqueAssignees.push('미정'); // '미정'은 항상 맨 끝에 배치
    
    displayColumns = uniqueAssignees.map(a => ({
      id: 'assignee_' + a,
      name: a,
      emoji: '👤'
    }));
    displayColumns.push({ id: 'archived', name: '보관됨 (완료)', emoji: '📦' });
  }

  // 2. 각 스레드가 현재 뷰 모드에서 어느 컬럼에 속해야 할지 계산
  threads.forEach(t => {
    if (t.archived) {
      t.currentColumn = '보관됨 (완료)';
      t.currentEmoji = '📦';
      return;
    }
    if (viewMode === 'all') {
      t.currentColumn = '모든 진행중인 업무';
      t.currentEmoji = '📋';
    } else if (viewMode === 'assignee') {
      t.currentColumn = t.meta?.assignees?.main || '미정';
      t.currentEmoji = '👤';
    } else {
      // 현재 모드(우선순위 or 분류)에 일치하는 태그 찾기
      const matchedTagId = (t.appliedTags || []).find(tagId => {
        const c = columns.find(col => col.id === tagId);
        return c && getTagType(c.name) === targetType;
      });
      const c = columns.find(col => col.id === matchedTagId);
      t.currentColumn = c ? c.name : '우선순위 없음';
      t.currentEmoji = c ? c.emoji : '📌';
    }
  });

  // 3. 필터링된 컬럼 렌더링
  displayColumns.forEach(col => {
    const colDiv = document.createElement('div');
    colDiv.className = 'kanban-column';
    if (viewMode === 'all' && col.id === 'all_active') {
      colDiv.classList.add('single-column-view');
    }
    colDiv.dataset.tagId = col.id; // 드롭했을 때 어떤 태그인지 알기 위해 ID 저장
    
    const threadsClass = (viewMode === 'all' && col.id === 'all_active') ? 'column-threads grid-3-threads' : 'column-threads';
    colDiv.innerHTML = `<h2 class="column-title">${renderEmoji(col.emoji)}${col.name}</h2><div class="${threadsClass}"></div>`;

    // 드래그 앤 드롭 - Drop Zone(컬럼) 설정
    colDiv.addEventListener('dragover', (e) => {
      if (viewMode === 'assignee' || viewMode === 'all') return; // 모드에 따라 드래그 방지
      e.preventDefault(); // 기본 동작을 막아야 drop 이벤트가 발생함
      e.dataTransfer.dropEffect = 'move';
      colDiv.classList.add('drag-over');
    });
    colDiv.addEventListener('dragleave', (e) => {
      if (viewMode === 'assignee' || viewMode === 'all') return;
      // 자식 요소(다른 카드 등)에 마우스가 올라갔을 때 깜빡이는 현상 방지
      if (!colDiv.contains(e.relatedTarget)) {
        colDiv.classList.remove('drag-over');
      }
    });
    colDiv.addEventListener('drop', (e) => {
      if (viewMode === 'assignee' || viewMode === 'all') return; // 모드에 따라 드롭 무시
      e.preventDefault();
      colDiv.classList.remove('drag-over');
      const threadId = e.dataTransfer.getData('text/plain');
      if (!threadId) return;

      // 웹 화면에서 카드를 새 위치로 즉시 이동시키고 다중 태그 로직 계산
      const threadIndex = threads.findIndex(t => t.id === threadId);
      if (threadIndex !== -1 && threads[threadIndex].currentColumn !== col.name) {
        const t = threads[threadIndex];
        const isArchived = col.id === 'archived';
        t.archived = isArchived;

        // 드래그한 컬럼에 맞게 기존 태그 배열(appliedTags) 수정
        let newTags = [...(t.appliedTags || [])];
        if (!isArchived && col.id !== 'uncategorized') {
          const newTagType = getTagType(col.name);
          // 같은 종류의 태그(우선순위끼리, 분류끼리)만 삭제 후 새로 추가 (나머지 태그는 보존)
          newTags = newTags.filter(tagId => {
            const tagObj = columns.find(c => c.id === tagId);
            return tagObj ? getTagType(tagObj.name) !== newTagType : true;
          });
          newTags.push(col.id);
        } else if (col.id === 'uncategorized') {
          // 현재 뷰 모드의 태그를 완전히 제거함
          const typeToRemove = viewMode === 'all' ? getTagType(t.currentColumn) : targetType;
          newTags = newTags.filter(tagId => {
            const tagObj = columns.find(c => c.id === tagId);
            return tagObj ? getTagType(tagObj.name) !== typeToRemove : true;
          });
        }
        t.appliedTags = newTags;

        renderBoard(); // 바뀐 위치로 즉시 재렌더링
      }
      
      // 드롭 시 백엔드 API를 호출해 디스코드에 태그 변경 요청
      fetch(`/api/threads/${threadId}/tags`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagId: col.id, newTags: threads[threadIndex]?.appliedTags || [], isArchived: col.id === 'archived' })
      }).then(async res => {
        if (!res.ok) {
          const err = await res.json();
          alert('디스코드 서버에 반영 실패: ' + (err.error || '권한이 없거나 서버 오류입니다.'));
          fetchInit(); // 실패 시 원래 상태로 데이터 원상복구
        }
      });
    });

    const threadList = colDiv.querySelector('.column-threads');
    threads.filter(t => t.currentColumn === col.name).forEach(thread => {
      const tDiv = document.createElement('div');
      tDiv.className = 'kanban-thread';

      // 긴급/우선순위가 가장 높은 카드 강조 (어떤 뷰 모드에 있든 상관없이 작동)
      const urgentKeywords = ['긴급', 'urgent', 'p1', '최우선'];
      const isUrgent = (thread.appliedTags || []).some(tagId => {
        const tagObj = columns.find(c => c.id === tagId);
        return tagObj && urgentKeywords.some(kw => tagObj.name.toLowerCase().includes(kw));
      });
      if (isUrgent && !thread.archived) tDiv.classList.add('urgent');

      // 카드에 모든 태그(분류 + 우선순위)를 나열해서 표시
      let tagsHtml = '';
      if (thread.archived) {
        tagsHtml = `<span class="thread-tag">${renderEmoji('📦')}보관됨 (완료)</span>`;
      } else {
        tagsHtml = (thread.appliedTags || [])
          .map(tagId => {
            const tagObj = columns.find(c => c.id === tagId);
            return tagObj ? `<span class="thread-tag">${renderEmoji(tagObj.emoji)}${tagObj.name}</span>` : '';
          }).join('');
        if (!tagsHtml) tagsHtml = `<span class="thread-tag">${renderEmoji('📌')}우선순위 없음</span>`;
      }

      tDiv.innerHTML = `
        <div class="thread-title">${thread.name}</div>
        <div class="thread-tags-container">${tagsHtml}</div>
        <div class="thread-footer">
          <div class="thread-date">${formatDiscordDate(thread.createdAt)}</div>
          <div class="thread-messages-count">💬 ${thread.messageCount+1}</div>
        </div>
      `;
      tDiv.onclick = () => showThreadDetail(thread);

      // 드래그 앤 드롭 - 스레드 카드 잡기 설정
      tDiv.draggable = (viewMode !== 'assignee' && viewMode !== 'all'); // 특정 모드에서 카드 잡기 비활성화
      tDiv.addEventListener('dragstart', (e) => {
        if (viewMode === 'assignee' || viewMode === 'all') return;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', thread.id);
        setTimeout(() => tDiv.classList.add('dragging'), 0); // 브라우저가 화면을 캡처할 시간을 줌
      });
      tDiv.addEventListener('dragend', () => {
        tDiv.classList.remove('dragging');
      });

      threadList.appendChild(tDiv);
    });
    board.appendChild(colDiv);
  });
}

// 스레드 상세 보기
function showThreadDetail(thread) {
  currentOpenThreadId = thread.id;
  const detail = document.getElementById('thread-detail');
  const meta = thread.meta || { summary: '미설정', assignees: { main: '미정', sub: '미정' }, members: [], inactiveDays: 3, dailyLogs: [] };
  const dailyLogsHtml = getDailyLogsHtml(meta.dailyLogs, thread.id);

  detail.innerHTML = `
    <span class="close-btn" onclick="hideThreadDetail()">&times;</span>
    <h3 class="detail-title">${thread.name}</h3>
    <div class="detail-content-layout">
      <div class="detail-left-col">
        <div class="meta-info-box">
          <div><b>📝 요약:</b> ${meta.summary}</div>
          <div>
            <b>👤 담당자:</b>
            <span class="assignee-badge main">${meta.assignees?.main || '미정'} (정)</span>
            <span class="assignee-badge sub">${meta.assignees?.sub || '미정'} (부)</span>
          </div>
          <div><b>👥 팀원:</b> ${meta.members?.length > 0 ? meta.members.join(', ') : '없음'}</div>
          <div><b>⚠️ 경고기준:</b> ${meta.inactiveDays}일 무응답 시 경고</div>
        </div>
        <div class="chat-section">
          <div id="thread-messages">메시지 불러오는 중...</div>
          <div class="message-input-container">
            <input type="text" id="new-message-input" class="message-input" placeholder="메시지 보내기..." onkeydown="if(event.key === 'Enter') sendMessage('${thread.id}')" />
            <button id="send-message-btn" class="message-send-btn" onclick="sendMessage('${thread.id}')">전송</button>
          </div>
        </div>
      </div>
      <div class="detail-right-col">
        <div class="daily-log-section">
          <h4>📋 일자별 업무 일지</h4>
          <div id="daily-log-list-content" class="daily-log-list">
            ${dailyLogsHtml}
          </div>
          <div class="daily-log-input-group">
            <input type="text" id="new-daily-log-input" placeholder="오늘의 업무를 기록하세요..." onkeydown="if(event.key === 'Enter') submitDailyLog('${thread.id}')" />
            <button onclick="submitDailyLog('${thread.id}')">추가</button>
          </div>
        </div>
      </div>
    </div>`;
  detail.style.display = 'block';
  loadMessages(thread.id);
}

// 메시지 불러오기 및 렌더링 (분리)
function loadMessages(threadId) {
  fetch(`/api/threads/${threadId}/messages`).then(r=>r.json()).then(msgs => {
    const msgDiv = document.getElementById('thread-messages');
    if (!msgDiv) return;
    msgDiv.innerHTML = msgs.map(m => {
      const attachmentsHtml = m.attachments && m.attachments.length > 0 
        ? m.attachments.map(url => {
            if (url.match(/\.(jpeg|jpg|gif|png|webp)(\?.*)?$/i)) {
              return `<div class="message-attachment"><img src="${url}" alt="첨부 이미지" loading="lazy" /></div>`;
            }
            return `<div class="message-attachment"><a href="${url}" target="_blank" rel="noopener noreferrer">📎 첨부파일 보기</a></div>`;
          }).join('')
        : '';
      return `
        <div class="message-item">
          <img src="${m.avatar}" class="message-avatar" alt="${m.author}의 프로필" loading="lazy" />
          <div class="message-content-wrapper">
            <div class="message-author">${m.author}</div>
            <div class="message-content">${m.content}</div>
            ${attachmentsHtml}
          </div>
        </div>`;
    }).join('');
    msgDiv.scrollTop = msgDiv.scrollHeight; // 새 메시지가 오면 스크롤을 맨 아래로
  });
}

// 새 메시지 전송 로직
async function sendMessage(threadId) {
  const input = document.getElementById('new-message-input');
  const btn = document.getElementById('send-message-btn');
  const content = input.value.trim();
  if (!content) return;

  input.disabled = true;
  btn.disabled = true;

  try {
    const res = await fetch(`/api/threads/${threadId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    if (res.ok) {
      input.value = '';
      loadMessages(threadId); // 전송 성공 시 메시지 목록 즉시 새로고침
    } else {
      const err = await res.json();
      alert('전송 실패: ' + (err.error || '오류가 발생했습니다.'));
    }
  } catch (error) {
    alert('오류 발생: ' + error.message);
  } finally {
    input.disabled = false;
    btn.disabled = false;
    input.focus();
  }
}

function hideThreadDetail() {
  document.getElementById('thread-detail').style.display = 'none';
  currentOpenThreadId = null;
}

// 일지 HTML 생성
function getDailyLogsHtml(logs, threadId) {
  if (!logs || logs.length === 0) return '<div class="no-logs">작성된 업무 일지가 없습니다.</div>';
  return logs.map(log => `
    <div class="daily-log-item">
      <span class="log-date">[${log.date}]</span>
      <span class="log-content">${log.content}</span>
      <div class="log-actions">
        <span class="log-action-btn" onclick="editDailyLog('${threadId}', ${log.timestamp})">✏️</span>
        <span class="log-action-btn" onclick="deleteDailyLog('${threadId}', ${log.timestamp})">❌</span>
      </div>
    </div>
  `).join('');
}

// 일지 작성
async function submitDailyLog(threadId) {
  const input = document.getElementById('new-daily-log-input');
  const content = input.value.trim();
  if (!content) return;
  
  try {
    const res = await fetch(`/api/threads/${threadId}/daily-log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    if (res.ok) {
      input.value = '';
      fetchInit(true); // 조용히 배경에서 새로고침
    } else {
      const err = await res.json();
      alert('일지 추가 실패: ' + err.error);
    }
  } catch (e) {
    alert('오류 발생: ' + e.message);
  }
}

// 일지 수정
async function editDailyLog(threadId, timestamp) {
  const newContent = prompt('수정할 내용을 입력하세요:');
  if (!newContent || !newContent.trim()) return;
  
  try {
    const res = await fetch(`/api/threads/${threadId}/daily-log/${timestamp}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: newContent.trim() })
    });
    if (res.ok) fetchInit(true);
    else alert('일지 수정 실패');
  } catch (e) {
    alert('오류 발생: ' + e.message);
  }
}

// 일지 삭제
async function deleteDailyLog(threadId, timestamp) {
  if (!confirm('정말로 이 일지를 삭제하시겠습니까?')) return;
  try {
    const res = await fetch(`/api/threads/${threadId}/daily-log/${timestamp}`, {
      method: 'DELETE'
    });
    if (res.ok) fetchInit(true);
    else alert('일지 삭제 실패');
  } catch (e) {
    alert('오류 발생: ' + e.message);
  }
}

// 데이터 초기화
async function fetchInit(isSilent = false) {
  const icon = document.getElementById('refresh-icon');
  if (icon && !isSilent) icon.classList.add('spinning');

  try {
    const [tagRes, threadRes] = await Promise.all([
      fetch('/api/tags'),
      fetch('/api/threads')
    ]);
    
    if (!tagRes.ok || !threadRes.ok) {
      let errMsg = `API 호출 실패 (상태 코드: ${tagRes.status})`;
      try {
        const errData = await threadRes.clone().json();
        if (errData.error) errMsg += `\n사유: ${errData.error}`;
      } catch(e) {}
      try {
        const tagErrData = await tagRes.clone().json();
        if (tagErrData.error) errMsg += `\n사유(태그): ${tagErrData.error}`;
      } catch(e) {}
      throw new Error(errMsg);
    }

    columns = await tagRes.json();
    threads = await threadRes.json();
    renderBoard();

    // 팝업이 열려있다면 내용만 부드럽게 갱신 (입력중인 텍스트 보호)
    if (currentOpenThreadId) {
      const currentThread = threads.find(t => t.id === currentOpenThreadId);
      if (currentThread) {
        const listContainer = document.getElementById('daily-log-list-content');
        if (listContainer && currentThread.meta && currentThread.meta.dailyLogs) {
          listContainer.innerHTML = getDailyLogsHtml(currentThread.meta.dailyLogs, currentThread.id);
        }
      }
    }
  } catch (error) {
    console.error('데이터 로딩 오류:', error);
    if (!isSilent) alert('데이터를 불러오지 못했습니다. (서버/설정 오류)\n\n상세: ' + error.message);
  } finally {
    if (icon && !isSilent) icon.classList.remove('spinning');
  }
}

// 서버리스 환경용 백그라운드 데이터 동기화 (5초마다 조용히 새로고침)
setInterval(() => {
  fetchInit(true);
  if (currentOpenThreadId) loadMessages(currentOpenThreadId); // 모달이 열려있으면 채팅도 갱신
}, 5000);

window.onload = () => {
  fetchInit();
  
  // 새로고침 버튼 추가
  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'refresh-btn';
  refreshBtn.innerHTML = '<span id="refresh-icon">🔄</span> 새로고침';
  refreshBtn.onclick = () => fetchInit(false);
  document.body.appendChild(refreshBtn);
};
window.hideThreadDetail = hideThreadDetail;
window.setViewMode = setViewMode;
