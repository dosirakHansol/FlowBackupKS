// Flow 백업 - Content Script (채팅 + 프로젝트, URL 기반 모드 분기)


(function () {
  if (document.getElementById('flow-backup-root')) return;

  let stopFlag = false;
  let currentMode = null; // 'chat' | 'project' | null
  let timerInterval = null;

  // ── URL로 모드 감지 ──
  function detectMode() {
    const url = location.href;
    if (url.includes('subscreen.act') && url.includes('CHAT_COLLECTION')) return 'chatfile';
    if (url.includes('messenger.act')) return 'chat';
    if (url.includes('main.act') && (url.includes('detail') || url.includes('srno'))) return 'project';
    if (url.includes('main.act') && url.includes('fileChange') && !url.includes('#')) return 'file';
    return null;
  }

  // ── 플로팅 패널 생성 ──
  const root = document.createElement('div');
  root.id = 'flow-backup-root';
  root.innerHTML = `
    <div id="fb-panel" style="
      position: fixed; bottom: 24px; right: 24px; z-index: 2147483647;
      background: #1a1a2e; border: 1px solid #2a4a7f; border-radius: 12px;
      padding: 14px 16px; width: 230px;
      font-family: 'Malgun Gothic', sans-serif; font-size: 12px; color: #eee;
      box-shadow: 0 4px 24px rgba(0,0,0,0.5); user-select: none; display:none;
    ">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <span id="fb-title" style="color:#7eb8f7; font-weight:bold; font-size:13px;">💬 Flow 백업</span>
        <span id="fb-toggle" style="cursor:pointer; color:#aaa; font-size:16px; line-height:1;">−</span>
      </div>
      <div id="fb-body">
        <div id="fb-mode-badge" style="margin-bottom:10px; font-size:11px; color:#aaa; text-align:center;"></div>
        <button id="fb-start" style="width:100%; padding:8px; background:#0e4fa8; color:#fff; border:none; border-radius:8px; font-size:12px; cursor:pointer; font-family:inherit; margin-bottom:5px;">▶ 전체 백업 시작</button>
        <button id="fb-stop" style="width:100%; padding:8px; background:#7b1f1f; color:#fff; border:none; border-radius:8px; font-size:12px; cursor:pointer; font-family:inherit; display:none;">■ 중지 후 저장</button>
        <div id="fb-warning" style="display:none; margin-top:8px; padding:6px 8px; background:#3a1a00; border:1px solid #a05000; border-radius:6px; font-size:11px; color:#ffb347; line-height:1.5; text-align:center;">
          ⚠️ 백업 중 창을 이동하거나<br>다른 탭으로 전환하지 마세요
        </div>
        <div id="fb-timer" style="display:none; margin-top:6px; font-size:11px; color:#aaa; text-align:center;">⏱ 경과 시간: <span id="fb-timer-val">0</span>초</div>
        <div style="margin-top:8px; background:#0a1628; border-radius:4px; height:5px; display:none;" id="fb-prog-wrap">
          <div id="fb-prog-bar" style="height:5px; background:#7eb8f7; border-radius:4px; width:0%; transition:width 0.3s;"></div>
        </div>
        <div id="fb-status" style="margin-top:8px; font-size:11px; color:#7eb8f7; text-align:center; min-height:32px; line-height:1.6;"></div>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const panel = document.getElementById('fb-panel');

  document.getElementById('fb-toggle').addEventListener('click', () => {
    const body = document.getElementById('fb-body');
    const toggle = document.getElementById('fb-toggle');
    const collapsed = body.style.display === 'none';
    body.style.display = collapsed ? 'block' : 'none';
    toggle.textContent = collapsed ? '−' : '+';
  });

  let dragging = false, ox = 0, oy = 0;
  panel.addEventListener('mousedown', e => {
    if (['SELECT','INPUT','BUTTON'].includes(e.target.tagName)) return;
    dragging = true;
    ox = e.clientX - panel.getBoundingClientRect().left;
    oy = e.clientY - panel.getBoundingClientRect().top;
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    panel.style.left = (e.clientX - ox) + 'px';
    panel.style.top  = (e.clientY - oy) + 'px';
    panel.style.right = 'auto'; panel.style.bottom = 'auto';
  });
  document.addEventListener('mouseup', () => dragging = false);

  // ── 공통 유틸 ──
  function setStatus(msg, progress = null) {
    document.getElementById('fb-status').textContent = msg;
    if (progress !== null) {
      document.getElementById('fb-prog-wrap').style.display = 'block';
      document.getElementById('fb-prog-bar').style.width = Math.min(100, progress) + '%';
    }
  }

  function resetUI() {
    document.getElementById('fb-start').style.display = 'block';
    document.getElementById('fb-stop').style.display = 'none';
    document.getElementById('fb-warning').style.display = 'none';
    document.getElementById('fb-timer').style.display = 'none';
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  }

  function startTimer() {
    const start = Date.now();
    document.getElementById('fb-warning').style.display = 'block';
    document.getElementById('fb-timer').style.display = 'block';
    timerInterval = setInterval(() => {
      document.getElementById('fb-timer-val').textContent = Math.floor((Date.now() - start) / 1000);
    }, 1000);
  }

  async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function nowStr() {
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
  }

  function exportToCSV(rows, headers, filename) {
    const BOM = '\uFEFF';
    const csv = BOM + [headers.join(','), ...rows.map(r =>
      r.map(v => `"${(v||'').replace(/\r?\n/g,'↵').replace(/"/g,'""')}"`).join(',')
    )].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  function htmlToText(html) {
    if (!html) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    tmp.querySelectorAll('br').forEach(el => el.replaceWith('\n'));
    tmp.querySelectorAll('p,div,li,tr').forEach(el => el.appendChild(document.createTextNode('\n')));
    return tmp.innerText.trim().replace(/\n{3,}/g, '\n\n');
  }

  function exportProjectCSV(posts, baseName) {
    exportToCSV(posts, ['작성자','날짜','제목','내용_html','댓글'], `${baseName}_viewer.csv`);
    const textPosts = posts.map(r => [
      r[0], r[1], r[2],
      htmlToText(r[3]),
      r[4].split(' | ').map(c => {
        const m = c.match(/^\[(.+?)\]\s*([\s\S]*)$/);
        return m ? `[${m[1]}] ${htmlToText(m[2])}` : htmlToText(c);
      }).join(' | ')
    ]);
    exportToCSV(textPosts, ['작성자','날짜','제목','내용','댓글'], `${baseName}_plain.csv`);
  }

  // ════════════════════════════════
  // 채팅 백업
  // ════════════════════════════════
  function findChatContainer() {
    const el = document.querySelector('ul.chat-container');
    if (el) return el;
    return Array.from(document.querySelectorAll('ul,div'))
      .filter(d => d.scrollHeight > d.clientHeight + 100)
      .sort((a, b) => b.scrollHeight - a.scrollHeight)[0] || null;
  }

  function collectChatMessages(container, collectedIds, messages) {
    let currentDate = '';
    Array.from(container.children).forEach(child => {
      if (child.classList && child.classList.contains('chat-date')) {
        const span = child.querySelector('span');
        if (span) currentDate = span.innerText.trim();
        return;
      }
      if (!child.classList || !child.classList.contains('message-item')) return;
      const id = child.id;
      if (!id || collectedIds.has(id)) return;

      const isRight = child.classList.contains('right-section');
      const sender = isRight
        ? '나'
        : (child.getAttribute('rgsr_nm') || child.querySelector('.js-user-title strong, .user-title strong')?.innerText?.trim() || '');

      const timeEl = child.querySelector('.user-time');
      const time = timeEl ? timeEl.innerText.trim() : '';

      const contentsEl = child.querySelector('.js-contents.chat-txt-contents, .chat-txt-contents');
      let body = '';
      if (contentsEl) {
        const clone = contentsEl.cloneNode(true);
        clone.querySelectorAll('i, button').forEach(e => e.remove());
        body = clone.innerText.trim().replace(/\r?\n/g, '↵');
      }
      if (!body) {
        const imgList = child.querySelector('.js-image-list');
        if (imgList && imgList.children.length > 0) body = `(이미지/첨부 ${imgList.children.length}개)`;
      }
      if (!body) return;

      collectedIds.add(id);
      messages.push([sender, currentDate, time, body]);
    });
  }

  async function startChatBackup() {
    const speed = 600;
    stopFlag = false;
    document.getElementById('fb-start').style.display = 'none';
    document.getElementById('fb-stop').style.display = 'block';
    startTimer();
    setStatus('⏳ 채팅 영역 탐색 중...', 0);

    const container = findChatContainer();
    if (!container) { setStatus('❌ 채팅 컨테이너를 찾지 못했습니다.'); resetUI(); return; }

    const roomNameEl = document.querySelector('[class*="room-title"],[class*="chat-title"],.room-name');
    const roomName = (roomNameEl ? roomNameEl.innerText.trim() : 'chat').slice(0,20).replace(/[\\/:*?"<>|]/g,'_');

    const collectedIds = new Set();
    const messages = [];
    const liEl = container.querySelector('li.message-item');
    const scrollStep = (liEl ? liEl.offsetHeight : 80) * 2;

    collectChatMessages(container, collectedIds, messages);
    let noNewCount = 0;

    while (!stopFlag) {
      const prevCount = messages.length;
      const prevScrollHeight = container.scrollHeight;
      const prevScrollTop = container.scrollTop;

      collectChatMessages(container, collectedIds, messages);

      container.scrollTop = Math.max(0, prevScrollTop - scrollStep);
      await sleep(speed);

      const added = container.scrollHeight - prevScrollHeight;
      if (added > 0) {
        container.scrollTop = Math.max(0, container.scrollTop - added);
        await sleep(400);
      }

      collectChatMessages(container, collectedIds, messages);

      const total = container.scrollHeight - container.clientHeight;
      setStatus(`⏳ 수집 중... ${messages.length}개`, Math.min(99, 100 - Math.round((container.scrollTop / total) * 100)));

      if (container.scrollTop <= 0) { await sleep(speed); collectChatMessages(container, collectedIds, messages); break; }
      if (messages.length === prevCount) { if (++noNewCount >= 10) break; } else { noNewCount = 0; }
    }

    if (messages.length === 0) { setStatus('❌ 메시지를 찾지 못했습니다.'); resetUI(); return; }

    exportToCSV(messages, ['발신자','날짜','시간','내용'], `flow_chat_${roomName}_${nowStr()}.csv`);
    setStatus(`✅ 완료! ${messages.length}개 저장됨`, 100);
    resetUI();
  }

  // ════════════════════════════════
  // 프로젝트 백업
  // ════════════════════════════════
  function findProjectContainer() {
    return document.querySelector('.project-detail-inner') || null;
  }

  function collectProjectPosts(container, collectedIds, posts) {
    const cards = container.querySelectorAll('li.pj-post__item');
    cards.forEach(card => {
      const id = card.id || card.getAttribute('data-srno') || card.querySelector('[data-srno]')?.getAttribute('data-srno');
      if (!id) return;

      const isPinned = card.classList.contains('pj-post__item--pinned');
      const title = isPinned
        ? (card.querySelector('h5.post__tit, .js-post-title')?.innerText.trim() || '')
        : (card.querySelector('h4.post-title, .post-title')?.innerText.trim() || '');
      if (!title) return;

      const key = id;
      if (collectedIds.has(key)) return;

      const author = isPinned
        ? (card.querySelector('.post__author')?.innerText.trim() || '')
        : (card.querySelector('strong.author, .author')?.innerText.trim() || '');
      if (!author) return;

      const date = isPinned
        ? (card.querySelector('.post__date')?.innerText.trim() || '')
        : (card.querySelector('.date')?.innerText.trim() || '');

      const bodyEl = card.querySelector('.post-editor-wrap');
      const body = bodyEl ? bodyEl.innerHTML.trim() : '';

      const comments = [];
      card.querySelectorAll('li.remark-item').forEach(r => {
        const cAuthor = r.querySelector('.user-name')?.innerText.trim() || '';
        const cDate   = r.querySelector('.record-date')?.innerText.trim() || '';
        const cTextEl = r.querySelector('.comment-text');
        const cText   = cTextEl ? cTextEl.innerHTML.trim() : '';
        if (cText) comments.push(`[${cAuthor} ${cDate}] ${cText}`);
      });

      collectedIds.add(key);
      posts.push([author, date, title, body, comments.join(' | ')]);
    });
  }

  async function startProjectBackup() {
    const speed = 600;
    stopFlag = false;
    document.getElementById('fb-start').style.display = 'none';
    document.getElementById('fb-stop').style.display = 'block';
    startTimer();
    setStatus('⏳ 프로젝트 탐색 중...', 0);

    const container = findProjectContainer();
    if (!container) { setStatus('❌ 프로젝트 컨테이너를 찾지 못했습니다.'); resetUI(); return; }

    const projectNameEl = document.querySelector('h3.project-title.ellipsis, h3.project-title, .js-post-popup-project-title-area');
    const projectName = (projectNameEl ? projectNameEl.innerText.trim() : 'project').slice(0,20).replace(/[\\/:*?"<>|]/g,'_');

    const collectedIds = new Set();
    const posts = [];

    collectProjectPosts(container, collectedIds, posts);
    let noNewCount = 0;

    while (!stopFlag) {
      const prevCount = posts.length;
      const prevScrollHeight = container.scrollHeight;

      container.scrollTop += container.clientHeight * 0.7;
      await sleep(speed);
      if (container.scrollHeight > prevScrollHeight) await sleep(500);

      collectProjectPosts(container, collectedIds, posts);

      const total = container.scrollHeight - container.clientHeight;
      const progress = total > 0 ? Math.min(99, Math.round((container.scrollTop / total) * 100)) : 99;
      setStatus(`⏳ 수집 중... ${posts.length}건`, progress);

      if (container.scrollTop + container.clientHeight >= container.scrollHeight - 10) {
        await sleep(speed);
        collectProjectPosts(container, collectedIds, posts);
        break;
      }
      if (posts.length === prevCount) { if (++noNewCount >= 10) break; } else { noNewCount = 0; }
    }

    if (posts.length === 0) { setStatus('❌ 게시글을 찾지 못했습니다.'); resetUI(); return; }

    const baseName = `flow_project_${projectName}_${nowStr()}`;
    exportProjectCSV(posts, baseName);
    setStatus(`✅ 완료! ${posts.length}건 저장됨\n뷰어용·일반용 2개 다운로드`, 100);
    resetUI();
  }

  // ── 버튼 이벤트 ──
  document.getElementById('fb-start').addEventListener('click', () => {
    if (currentMode === 'chat') startChatBackup();
    else if (currentMode === 'chatfile') startChatFileDownload();
    else if (currentMode === 'project') startProjectBackup();
    else if (currentMode === 'file') startFileDownload();
  });
  document.getElementById('fb-stop').addEventListener('click', () => { stopFlag = true; });

  // ════════════════════════════════
  // 채팅 파일 다운로드
  // ════════════════════════════════
  async function startChatFileDownload() {
    stopFlag = false;
    document.getElementById('fb-start').style.display = 'none';
    document.getElementById('fb-stop').style.display = 'block';
    startTimer();

    const scrollBox = document.querySelector('#collectionUl');
    if (!scrollBox) {
      setStatus('❌ 파일 목록을 찾지 못했습니다.\n채팅방의 파일 탭을 열어주세요.');
      resetUI();
      return;
    }

    // ── 1단계: 스크롤하며 전체 파일 목록 수집 ──
    setStatus('⏳ 파일 목록 수집 중...', 0);
    scrollBox.scrollTop = 0;
    await sleep(400);

    const collectedSrnos = new Set();
    const allFiles = [];

    const collectItems = () => {
      document.querySelectorAll('.js-collection-item').forEach(item => {
        const srno = item.getAttribute('atch_srno');
        if (!srno || collectedSrnos.has(srno)) return;
        collectedSrnos.add(srno);
        allFiles.push({
          srno,
          randKey: item.getAttribute('rand_key') || '',
          useInttId: item.getAttribute('use_intt_id') || '',
          fileName: item.getAttribute('file_nm') || 'file',
          rgsrNm: item.getAttribute('rgsr_nm') || '',
          rgsnDttm: item.getAttribute('rgsn_dttm') || '',
        });
      });
    };

    collectItems();
    while (!stopFlag) {
      const prevHeight = scrollBox.scrollHeight;
      scrollBox.scrollTop += 800;
      await sleep(600);
      collectItems();
      setStatus(`⏳ 목록 수집 중... ${allFiles.length}개`, 0);
      if (scrollBox.scrollHeight > prevHeight) continue; // 새 콘텐츠 로드됨, 계속
      await sleep(400);
      collectItems();
      if (scrollBox.scrollHeight > prevHeight) continue; // 느린 로딩 재확인
      if (scrollBox.scrollTop + scrollBox.clientHeight >= scrollBox.scrollHeight - 10) break;
    }

    if (stopFlag) { setStatus('⏹ 중지됨'); resetUI(); return; }
    if (allFiles.length === 0) { setStatus('❌ 파일을 찾지 못했습니다.'); resetUI(); return; }

    // ── 2단계: MAIN world에서 save 버튼 인터셉트로 URL 템플릿 확보 ──
    setStatus('⏳ 다운로드 준비 중...');
    scrollBox.scrollTop = 0;
    await sleep(400);

    const templateRes = await sendToBackground({ type: 'GET_CHAT_URL_TEMPLATE' });
    const urlTemplate = templateRes?.result;

    if (!urlTemplate) { setStatus('❌ 다운로드 URL을 가져오지 못했습니다.'); resetUI(); return; }

    const templateUrl = new URL(urlTemplate);
    const roomNameEl = document.querySelector('.js-chat-room.on .project-ttl');
    const roomName = (roomNameEl ? roomNameEl.innerText.trim() : 'chat').slice(0, 20).replace(/[/\\:*?"<>|]/g, '_');
    const folderName = `${roomName}_${nowStr()}`;

    // 전체 파일에 ATCH_URL 조립
    const downloadFiles = allFiles.map(f => {
      const url = new URL(templateUrl.href);
      url.searchParams.set('RAND_KEY', f.randKey);
      url.searchParams.set('ATCH_SRNO', f.srno);
      url.searchParams.set('USE_INTT_ID', f.useInttId);
      return {
        ATCH_URL: url.toString(),
        ORCP_FILE_NM: f.fileName,
        RGSR_NM: roomName,
        RGSN_DTTM: f.rgsnDttm,
        FILE_SIZE: '0',
      };
    });

    resetUI();
    setStatus(`📋 ${downloadFiles.length}개 수집 완료`);

    // ── 3단계: 확인 알럿 ──
    const confirmed = confirm(
      `📁 채팅 파일 일괄 다운로드\n\n` +
      `총 ${downloadFiles.length}개 파일\n\n` +
      `저장 폴더: ${folderName}/\n` +
      `파일명 형식: 채팅방이름_날짜_원본파일명\n\n` +
      `⚠️ 다운로드가 완료될 때까지 창을 닫지 마세요.\n\n` +
      `진행하시겠습니까?`
    );
    if (!confirmed) { setStatus(`✋ 취소됨 (${downloadFiles.length}개 수집)`); return; }

    // ── 4단계: chrome.downloads로 일괄 다운로드 ──
    startTimer();
    document.getElementById('fb-start').style.display = 'none';
    document.getElementById('fb-stop').style.display = 'block';
    setStatus('⏳ 다운로드 시작...', 0);

    await sendToBackground({ type: 'DOWNLOAD_FILES_DIRECT', files: downloadFiles, folderName });
    setStatus(`⏳ 다운로드 중... 0/${downloadFiles.length}개`, 0);
  }

  // ════════════════════════════════
  // 파일 일괄 다운로드
  // ════════════════════════════════

  // background를 통해 MAIN world에서 실행
  function sendToBackground(msg) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage(msg, res => {
        if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
        else resolve(res || { ok: false });
      });
    });
  }

  async function startFileDownload() {
    const check = await sendToBackground({ type: 'CHECK_API' });
    if (!check?.ok || !check?.result) {
      setStatus('❌ 플로우 파일 API를 찾을 수 없습니다.'); return;
    }

    stopFlag = false;
    document.getElementById('fb-start').style.display = 'none';
    document.getElementById('fb-stop').style.display = 'block';
    startTimer();
    setStatus('⏳ 파일 목록 수집 중...', 0);

    // 스크롤 없이 API 직접 호출로 전체 파일 수집
    const res = await sendToBackground({ type: 'FETCH_ALL_FILES_VIA_API' });

    if (stopFlag) { setStatus('⏹ 중지됨'); resetUI(); return; }

    const allFiles = res?.result || [];
    if (allFiles.length === 0) { setStatus('❌ 파일을 찾지 못했습니다.'); resetUI(); return; }

    const totalSize = allFiles.reduce((sum, f) => sum + parseInt(f.FILE_SIZE || 0), 0);
    const totalSizeMB = (totalSize / 1024 / 1024).toFixed(1);

    resetUI();
    setStatus(`📋 ${allFiles.length}개 수집 완료`);

    const projectName = (allFiles[0]?.TTL || 'flow').replace(/[/\\:*?"<>|]/g, '_').slice(0, 30);
    const folderName = `${projectName}_${nowStr()}`;

    const confirmed = confirm(
      `📁 파일 일괄 다운로드\n\n` +
      `총 ${allFiles.length}개 파일 (약 ${totalSizeMB} MB)\n\n` +
      `저장 폴더: ${folderName}/\n` +
      `파일명 형식: 작성자_날짜_원본파일명\n\n` +
      `⚠️ 다운로드가 완료될 때까지 창을 닫지 마세요.\n\n` +
      `진행하시겠습니까?`
    );

    if (!confirmed) { setStatus(`✋ 취소됨 (${allFiles.length}개 수집)`); return; }

    startTimer();
    document.getElementById('fb-start').style.display = 'none';
    document.getElementById('fb-stop').style.display = 'block';
    setStatus('⏳ 다운로드 시작...', 0);

    await sendToBackground({ type: 'DOWNLOAD_FILES_DIRECT', files: allFiles, folderName });
    setStatus(`⏳ 다운로드 시작... 0/${allFiles.length}개`, 0);
  }

  // ── URL 변화 감지 및 패널 표시/갱신 ──
  function updatePanel() {
    const mode = detectMode();
    if (mode === currentMode) return;
    currentMode = mode;

    if (!mode) {
      panel.style.display = 'none';
      return;
    }

    panel.style.display = 'block';
    if (mode === 'chat') {
      document.getElementById('fb-title').textContent = '💬 채팅 백업';
      document.getElementById('fb-mode-badge').textContent = '📍 채팅 모드';
      document.getElementById('fb-start').textContent = '▶ 전체 백업 시작';
      setStatus('채팅방을 열고 시작하세요.');
    } else if (mode === 'project') {
      document.getElementById('fb-title').textContent = '📋 프로젝트 백업';
      document.getElementById('fb-mode-badge').textContent = '📍 프로젝트 모드';
      document.getElementById('fb-start').textContent = '▶ 전체 백업 시작';
      setStatus('프로젝트 페이지에서 시작하세요.');
    } else if (mode === 'chatfile') {
      document.getElementById('fb-title').textContent = '📎 채팅 파일 다운로드';
      document.getElementById('fb-mode-badge').textContent = '📍 채팅 파일 모드';
      document.getElementById('fb-start').textContent = '▶ 전체 다운로드';
      setStatus('파일 탭의 항목을 순서대로 저장합니다.');
    } else if (mode === 'file') {
      document.getElementById('fb-title').textContent = '📥 파일 다운로드';
      document.getElementById('fb-mode-badge').textContent = '📍 파일 모드';
      document.getElementById('fb-start').textContent = '▶ 전체 다운로드';
      setStatus('파일 탭에서 전체 다운로드합니다.');
    }
    resetUI();
    document.getElementById('fb-prog-wrap').style.display = 'none';
  }

  // 다운로드 진행상황 수신
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'DOWNLOAD_PROGRESS') {
      const pct = Math.round((msg.current / msg.total) * 100);
      setStatus(`⏳ 다운로드 중... ${msg.current}/${msg.total}개`, pct);
    } else if (msg.type === 'DOWNLOAD_DONE') {
      setStatus(`✅ 완료! ${msg.total}개 저장됨`, 100);
      resetUI();
    }
  });

  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      currentMode = null;
      setTimeout(updatePanel, 800);
    }
  }).observe(document.body, { childList: true, subtree: true });

  updatePanel();
})();
