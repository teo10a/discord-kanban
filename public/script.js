const socket = io();
let columns = [];
let threads = [];
let viewMode = 'all'; // 'priority', 'category', 'all'
let currentOpenThreadId = null;

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

// 이모지 렌더링 헬퍼 함수 (커스텀 이미지 지원)
function renderEmoji(emoji) {
  if (!emoji) return '';
  if (emoji.startsWith('http')) {
    return `<img src="${emoji}" class="tag-emoji" alt="emoji" loading="lazy" /> `;
  }
  return `${emoji} `;
}

// 텍스트 말줄임 헬퍼 함수
function truncateText(text, maxLength) {
  if (!text) return '';
  return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
}

// 일지 목록 렌더링 헬퍼 함수
function getDailyLogsHtml(logs, threadId) {
  if (!logs || logs.length === 0) {
    return '<div class="daily-log-item"><span class="daily-log-text">아직 작성된 일지가 없습니다.</span></div>';
  }
  return logs.map(l => `
    <div class="daily-log-item">
      <span class="daily-log-date">[${l.date}]</span> 
      <span class="daily-log-text">${l.content}</span>
      <div class="daily-log-actions">
        <span onclick="editDailyLog('${threadId}', ${l.timestamp})" title="수정">✏️</span>
        <span onclick="deleteDailyLog('${threadId}', ${l.timestamp})" title="삭제">❌</span>
      </div>
    </div>
  `).join('');
}

// 칸반 컬럼 렌더링
function renderBoard() {
  const board = document.getElementById('kanban-board');
  board.innerHTML = '';

  // 태그들을 우선순위용과 분류용으로 자동 분리
  const priorityKeywords = ['우선', '높음', '보통', '낮음', '긴급', '중요', '우선순위'];
  let priorityCols = columns.filter(c => priorityKeywords.some(k => c.name.includes(k)) && c.id !== 'uncategorized' && c.id !== 'archived');
  let categoryCols = columns.filter(c => !priorityCols.includes(c) && c.id !== 'uncategorized' && c.id !== 'archived');
  
  let uncategorizedCol = columns.find(c => c.id === 'uncategorized');
  if (uncategorizedCol) {
    uncategorizedCol = { ...uncategorizedCol, name: viewMode === 'category' ? '미분류' : '우선순위 없음' };
  }
  const archivedCol = columns.find(c => c.id === 'archived');

  // 현재 보기 모드에 따라 렌더링할 컬럼 결정
  const activeCols = viewMode === 'priority' ? priorityCols : (viewMode === 'category' ? categoryCols : []);
  let viewColumns = [...activeCols];

  // '전체 보기' 모드일 경우 가상의 '전체' 컬럼 추가
  if (viewMode === 'all') {
    viewColumns.push({ id: 'all', name: '전체 스레드', emoji: '📋' });
  }
  // 분류가 없는 항목을 표시 (우선순위/분류 보기 모두)
  if ((viewMode === 'priority' || viewMode === 'category') && uncategorizedCol) {
    viewColumns.push(uncategorizedCol);
  }
  // '보관됨 (완료)' 컬럼은 항상 표시
  if (archivedCol) {
    viewColumns.push(archivedCol);
  }

  viewColumns.forEach(col => {
    const colDiv = document.createElement('div');
    colDiv.className = `kanban-column ${viewMode === 'all' && col.id === 'all' ? 'full-width-column' : ''}`;
    colDiv.dataset.tagId = col.id; // 드롭했을 때 어떤 태그인지 알기 위해 ID 저장

    const threadsInColumn = threads.filter(t => {
      if (t.archived) return col.id === 'archived';
      if (col.id === 'archived') return false;
      
      // 전체 보기 모드일 때 모든 활성 스레드 표시
      if (col.id === 'all') return !t.archived;

      // 스레드가 가진 태그 중 현재 뷰 모드에 해당하는 태그를 찾음
      const matchedColId = t.appliedTags.find(tagId => activeCols.some(ac => ac.id === tagId));
      return matchedColId ? matchedColId === col.id : col.id === 'uncategorized';
    });
    const threadCount = threadsInColumn.length;
    colDiv.innerHTML = `<h2 class="column-title">${renderEmoji(col.emoji)}${col.name} <span class="column-thread-count">${threadCount}</span></h2><div class="column-threads"></div>`;

    // 드래그 앤 드롭 - Drop Zone(컬럼) 설정
    colDiv.addEventListener('dragover', (e) => {
      e.preventDefault(); // 기본 동작을 막아야 drop 이벤트가 발생함
      e.dataTransfer.dropEffect = 'move';
      colDiv.classList.add('drag-over');
    });
    colDiv.addEventListener('dragleave', (e) => {
      // 자식 요소(다른 카드 등)에 마우스가 올라갔을 때 깜빡이는 현상 방지
      if (!colDiv.contains(e.relatedTarget)) {
        colDiv.classList.remove('drag-over');
      }
    });
    colDiv.addEventListener('drop', (e) => {
      e.preventDefault();
      colDiv.classList.remove('drag-over');
      const threadId = e.dataTransfer.getData('text/plain');
      if (!threadId) return;

      const threadIndex = threads.findIndex(t => t.id === threadId);
      if (threadIndex === -1) return;
      const thread = threads[threadIndex];

      let isArchived = thread.archived;
      let newTags = [...thread.appliedTags];

      if (col.id === 'archived') {
        isArchived = true;
      } else {
        isArchived = false;
        // 현재 뷰 모드(우선순위 or 분류)에 해당하는 기존 태그만 제거
        const activeColIds = activeCols.map(c => c.id);
        newTags = newTags.filter(id => !activeColIds.includes(id));
        // 새 컬럼 태그 추가
        if (col.id !== 'uncategorized') newTags.unshift(col.id);
      }

      // 화면 즉시 반영 (낙관적 UI)
      thread.archived = isArchived;
      thread.appliedTags = newTags;
      renderBoard();

      // 드롭 시 백엔드 API를 호출해 디스코드에 태그 변경 요청
      fetch(`/api/threads/${threadId}/tags`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newTags, isArchived })
      }).then(async res => {
        if (!res.ok) {
          const err = await res.json();
          alert('디스코드 서버에 반영 실패: ' + (err.error || '권한이 없거나 서버 오류입니다.'));
          fetchInit(); // 실패 시 원래 상태로 데이터 원상복구
        }
      });
    });

    const threadList = colDiv.querySelector('.column-threads');
    threadsInColumn.forEach(thread => {
      // 미활동 일수 계산 및 경고 배지 생성
      const lastMsgTime = thread.lastMessageTime || new Date(thread.createdAt).getTime();
      const idleDays = (Date.now() - lastMsgTime) / (1000 * 60 * 60 * 24);

      // 백엔드 업데이트 누락 등으로 meta가 없는 경우 기본값 제공 (에러 방지)
      const meta = thread.meta || {
        summary: '미설정', workLog: '미작성', dailyLogs: [], inactiveDays: 3,
        assignees: { main: '미정', sub: '미정' }, members: []
      };

      const latestLog = meta.dailyLogs && meta.dailyLogs.length > 0 
        ? meta.dailyLogs[meta.dailyLogs.length - 1].content 
        : meta.workLog;

      const isIdle = !thread.archived && idleDays >= meta.inactiveDays;
      const idleWarningHtml = isIdle ? `<div class="idle-warning">⚠️ ${Math.floor(idleDays)}일째 메시지 없음 (기준: ${meta.inactiveDays}일)</div>` : '';

      // 현재 뷰에 맞는 대표 태그 계산
      const colsToSearch = viewMode === 'all' ? columns : activeCols;
      const currentTagId = thread.appliedTags.find(tagId => colsToSearch.some(ac => ac.id === tagId));
      const currentTagCol = colsToSearch.find(c => c.id === currentTagId) || uncategorizedCol;

      const tDiv = document.createElement('div');
      tDiv.className = 'kanban-thread';
      tDiv.innerHTML = `
        <div class="thread-title" title="${thread.name}">${truncateText(thread.name, 45)}</div>
        <div class="thread-tag">${renderEmoji(thread.archived ? '📦' : currentTagCol.emoji)}${thread.archived ? '보관됨 (완료)' : currentTagCol.name}</div>
        ${idleWarningHtml}
        <div class="thread-meta">
          <div class="meta-item" title="${meta.summary}"><span class="meta-icon">📝</span> <b>요약:</b> ${truncateText(meta.summary, 22)}</div>
          <div class="meta-item" title="${latestLog}"><span class="meta-icon">📋</span> <b>업무:</b> ${truncateText(latestLog, 22)}</div>
          <div class="meta-item" title="정: ${meta.assignees.main}, 부: ${meta.assignees.sub}"><span class="meta-icon">👤</span> <b>담당:</b> ${truncateText(meta.assignees.main, 8)}(정) / ${truncateText(meta.assignees.sub, 8)}(부)</div>
          <div class="meta-item" title="${meta.members.length > 0 ? meta.members.join(', ') : '없음'}"><span class="meta-icon">👥</span> <b>팀원:</b> ${truncateText(meta.members.length > 0 ? meta.members.join(', ') : '없음', 20)}</div>
        </div>
        <div class="thread-footer">
          <div class="thread-date">${formatDiscordDate(thread.createdAt)}</div>
          <div class="thread-messages-count">💬 ${thread.messageCount+1}</div>
        </div>
      `;
      tDiv.onclick = () => showThreadDetail(thread);

      // 드래그 앤 드롭 - 스레드 카드 잡기 설정
      tDiv.draggable = true;
      tDiv.addEventListener('dragstart', (e) => {
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
  document.getElementById('modal-overlay').style.display = 'block';

  const meta = thread.meta || {
    summary: '미설정', workLog: '미작성', dailyLogs: [], inactiveDays: 3,
    assignees: { main: '미정', sub: '미정' }, members: []
  };

  const dailyLogs = meta.dailyLogs || [];
  const dailyLogsHtml = getDailyLogsHtml(dailyLogs, thread.id);

  const detail = document.getElementById('thread-detail');
  detail.innerHTML = `<span class="close-btn" onclick="hideThreadDetail()">&times;</span>
    <h3 class="detail-title">${thread.name}</h3>
    <p><b>생성일:</b> ${formatDiscordDate(thread.createdAt)}</p>
    <p><b>상태:</b> ${renderEmoji(thread.columnEmoji)}${thread.column}</p>
    <div class="detail-meta">
      <div><b>📝 요약:</b> ${meta.summary}</div>
      <div><b>👤 담당자:</b> 정(${meta.assignees.main}) / 부(${meta.assignees.sub})</div>
      <div><b>👥 팀원:</b> ${meta.members.length > 0 ? meta.members.join(', ') : '없음'}</div>
      <div><b>⚠️ 경고기준:</b> ${meta.inactiveDays}일 무응답 시 경고</div>
    </div>
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
    <div id="thread-messages">메시지 불러오는 중...</div>
    <div class="message-input-container">
      <input type="text" id="new-message-input" class="message-input" placeholder="메시지 보내기..." onkeydown="if(event.key === 'Enter') sendMessage('${thread.id}')" />
      <button id="send-message-btn" class="message-send-btn" onclick="sendMessage('${thread.id}')">전송</button>
    </div>`;
  detail.style.display = 'block';

  const logList = document.getElementById('daily-log-list-content');
  if (logList) logList.scrollTop = logList.scrollHeight;

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
      const isJson = res.headers.get("content-type")?.includes("application/json");
      if (isJson) {
        const err = await res.json();
        alert('전송 실패: ' + (err.error || '오류가 발생했습니다.'));
      } else {
        alert(`전송 실패 (${res.status}): 백엔드 서버(server.js)가 최신 상태인지 확인해주세요.`);
      }
    }
  } catch (error) {
    alert('오류 발생: ' + error.message);
  } finally {
    input.disabled = false;
    btn.disabled = false;
    input.focus();
  }
}

async function submitDailyLog(threadId) {
  const input = document.getElementById('new-daily-log-input');
  const content = input.value.trim();
  if (!content) return;

  input.disabled = true;

  try {
    const res = await fetch(`/api/threads/${threadId}/daily-log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    if (res.ok) {
      input.value = '';
    } else {
      const isJson = res.headers.get("content-type")?.includes("application/json");
      if (isJson) {
        const err = await res.json();
        alert('일지 등록 실패: ' + (err.error || '오류가 발생했습니다.'));
      } else {
        alert(`일지 등록 실패 (${res.status}): 터미널에서 백엔드 서버(server.js)를 껐다가 다시 켜주세요.`);
      }
    }
  } catch (error) {
    alert('오류 발생: ' + error.message);
  } finally {
    input.disabled = false;
    input.focus();
  }
}

async function editDailyLog(threadId, timestamp) {
  const thread = threads.find(t => t.id === threadId);
  if (!thread) return;
  const log = (thread.meta.dailyLogs || []).find(l => l.timestamp === timestamp);
  if (!log) return;
  
  const newContent = prompt('업무 일지를 수정하세요:', log.content);
  if (newContent === null || newContent.trim() === log.content) return;
  if (!newContent.trim()) {
     alert('내용을 입력해주세요.');
     return;
  }

  try {
    const res = await fetch(`/api/threads/${threadId}/daily-log/${timestamp}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: newContent })
    });
    if (!res.ok) {
      const isJson = res.headers.get("content-type")?.includes("application/json");
      if (isJson) {
        const err = await res.json();
        alert('수정 실패: ' + (err.error || '오류가 발생했습니다.'));
      } else {
        alert(`수정 실패 (${res.status}): 터미널에서 백엔드 서버(server.js)를 재시작해주세요.`);
      }
    }
  } catch(e) {
    alert('오류 발생: ' + e.message);
  }
}

async function deleteDailyLog(threadId, timestamp) {
  if (!confirm('이 일지를 삭제하시겠습니까?')) return;
  try {
    const res = await fetch(`/api/threads/${threadId}/daily-log/${timestamp}`, {
      method: 'DELETE'
    });
    if (!res.ok) alert('삭제 실패');
  } catch(e) {
    alert('오류 발생: ' + e.message);
  }
}

function hideThreadDetail() {
  currentOpenThreadId = null;
  document.getElementById('modal-overlay').style.display = 'none';
  document.getElementById('thread-detail').style.display = 'none';
}

// 데이터 초기화
async function fetchInit() {
  const [tagRes, threadRes] = await Promise.all([
    fetch('/api/tags'),
    fetch('/api/threads')
  ]);
  columns = await tagRes.json();
  threads = await threadRes.json();
  
  renderBoard();
}

// 실시간 이벤트
socket.on('threadCreate', t => {
  threads.push(t);
  renderBoard();
});
socket.on('threadUpdate', t => {
  const idx = threads.findIndex(th => th.id === t.id);
  if (idx !== -1) threads[idx] = t;
  renderBoard();

  // 팝업이 열려있다면 일지 목록 리렌더링 (깜빡임 없이)
  if (currentOpenThreadId === t.id) {
    const listContainer = document.getElementById('daily-log-list-content');
    if (listContainer && t.meta && t.meta.dailyLogs) {
      listContainer.innerHTML = getDailyLogsHtml(t.meta.dailyLogs, t.id);
      listContainer.scrollTop = listContainer.scrollHeight;
    }
  }
});
socket.on('threadDelete', id => {
  threads = threads.filter(t => t.id !== id);
  renderBoard();
});

// 태그(우선순위 등) 변경 시 자동으로 전체 새로고침
socket.on('tagsUpdate', () => {
  fetchInit();
});

window.setViewMode = function(mode) {
  viewMode = mode;
  document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('btn-view-' + mode).classList.add('active');
  renderBoard();
};

window.onload = () => {
  // 상단 UI(보기 토글) 주입
  const topUIHtml = `
    <div class="view-controls">
      <button id="btn-view-all" class="view-btn active" onclick="setViewMode('all')">📋 전체 보기</button>
      <button id="btn-view-priority" class="view-btn" onclick="setViewMode('priority')">📌 우선순위별 보기</button>
      <button id="btn-view-category" class="view-btn" onclick="setViewMode('category')">📂 분류별 보기</button>
    </div>`;
  document.getElementById('kanban-board').insertAdjacentHTML('beforebegin', topUIHtml);

  fetchInit();
  
  // 새로고침 버튼 추가
  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'refresh-btn';
  refreshBtn.innerHTML = '🔄 새로고침';
  refreshBtn.onclick = fetchInit;
  document.body.appendChild(refreshBtn);
};
window.hideThreadDetail = hideThreadDetail;
