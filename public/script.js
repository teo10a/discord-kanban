const socket = io();
let columns = [];
let threads = [];

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

// 칸반 컬럼 렌더링
function renderBoard() {
  const board = document.getElementById('kanban-board');
  board.innerHTML = '';
  columns.forEach(col => {
    const colDiv = document.createElement('div');
    colDiv.className = 'kanban-column';
    colDiv.dataset.tagId = col.id; // 드롭했을 때 어떤 태그인지 알기 위해 ID 저장
    colDiv.innerHTML = `<h2 class="column-title">${renderEmoji(col.emoji)}${col.name}</h2><div class="column-threads"></div>`;

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

      // 웹 화면에서 먼저 카드를 새 위치로 이동시킴 (빠른 반응성)
      const threadIndex = threads.findIndex(t => t.id === threadId);
      if (threadIndex !== -1 && threads[threadIndex].column !== col.name) {
        threads[threadIndex].column = col.name;
        threads[threadIndex].columnEmoji = col.emoji;
        renderBoard(); // 바뀐 위치로 즉시 재렌더링
      }
      
      // 드롭 시 백엔드 API를 호출해 디스코드에 태그 변경 요청
      fetch(`/api/threads/${threadId}/tags`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagId: col.id })
      }).then(async res => {
        if (!res.ok) {
          const err = await res.json();
          alert('디스코드 서버에 반영 실패: ' + (err.error || '권한이 없거나 서버 오류입니다.'));
          fetchInit(); // 실패 시 원래 상태로 데이터 원상복구
        }
      });
    });

    const threadList = colDiv.querySelector('.column-threads');
    threads.filter(t => t.column === col.name).forEach(thread => {
      const tDiv = document.createElement('div');
      tDiv.className = 'kanban-thread';
      tDiv.innerHTML = `
        <div class="thread-title">${thread.name}</div>
        <div class="thread-tag">${renderEmoji(thread.columnEmoji)}${thread.column}</div>
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
  const detail = document.getElementById('thread-detail');
  detail.innerHTML = `<span class="close-btn" onclick="hideThreadDetail()">&times;</span>
    <h3 class="detail-title">${thread.name}</h3>
    <p><b>생성일:</b> ${formatDiscordDate(thread.createdAt)}</p>
    <p><b>상태:</b> ${renderEmoji(thread.columnEmoji)}${thread.column}</p>
    <div id="thread-messages">메시지 불러오는 중...</div>
    <div class="message-input-container">
      <input type="text" id="new-message-input" class="message-input" placeholder="메시지 보내기..." onkeydown="if(event.key === 'Enter') sendMessage('${thread.id}')" />
      <button id="send-message-btn" class="message-send-btn" onclick="sendMessage('${thread.id}')">전송</button>
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
}

// 데이터 초기화
async function fetchInit() {
  try {
    const [tagRes, threadRes] = await Promise.all([
      fetch('/api/tags'),
      fetch('/api/threads')
    ]);
    
    if (!tagRes.ok || !threadRes.ok) {
      throw new Error(`API 호출 실패 (태그: ${tagRes.status}, 스레드: ${threadRes.status}) - Cloudflare 함수 오류입니다.`);
    }

    columns = await tagRes.json();
    threads = await threadRes.json();
    renderBoard();
  } catch (error) {
    console.error('데이터 로딩 오류:', error);
    alert('데이터를 불러오지 못했습니다. (서버/설정 오류)\n\n상세: ' + error.message);
  }
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
});
socket.on('threadDelete', id => {
  threads = threads.filter(t => t.id !== id);
  renderBoard();
});

// 태그(우선순위 등) 변경 시 자동으로 전체 새로고침
socket.on('tagsUpdate', () => {
  fetchInit();
});

window.onload = () => {
  fetchInit();
  
  // 새로고침 버튼 추가
  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'refresh-btn';
  refreshBtn.innerHTML = '🔄 새로고침';
  refreshBtn.onclick = fetchInit;
  document.body.appendChild(refreshBtn);
};
window.hideThreadDetail = hideThreadDetail;
