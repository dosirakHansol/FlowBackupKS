// Flow 백업 - Background Service Worker

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // ── 채팅 파일: MAIN world에서 save 버튼 클릭 인터셉트로 URL 템플릿 확보 ──
  if (msg.type === 'GET_CHAT_URL_TEMPLATE') {
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      world: 'MAIN',
      func: async () => {
        return new Promise((resolve) => {
          const origClick = HTMLAnchorElement.prototype.click;
          HTMLAnchorElement.prototype.click = function() {
            if (this.href && this.href.includes('FLOW_DOWNLOAD_R001')) {
              HTMLAnchorElement.prototype.click = origClick;
              resolve(this.href);
              return; // 실제 다운로드 차단
            }
            return origClick.call(this);
          };

          const firstItem = document.querySelector('.js-collection-item');
          if (!firstItem) { HTMLAnchorElement.prototype.click = origClick; resolve(null); return; }
          const moreBtn = firstItem.querySelector('.js-collection-more-button');
          if (!moreBtn) { HTMLAnchorElement.prototype.click = origClick; resolve(null); return; }

          moreBtn.click();
          setTimeout(() => {
            const saveBtn = firstItem.querySelector('.js-save-file');
            if (saveBtn) {
              saveBtn.click();
            } else {
              HTMLAnchorElement.prototype.click = origClick;
              resolve(null);
            }
            setTimeout(() => { document.body.click(); }, 300);
          }, 300);

          setTimeout(() => { HTMLAnchorElement.prototype.click = origClick; resolve(null); }, 5000);
        });
      },
    })
    .then(r => sendResponse({ ok: true, result: r?.[0]?.result }))
    .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  // API 직접 호출로 전체 파일 목록 수집 (스크롤 불필요)
  if (msg.type === 'FETCH_ALL_FILES_VIA_API') {
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      world: 'MAIN',
      func: async () => {
        return new Promise((resolve) => {
          const origOpen = XMLHttpRequest.prototype.open;
          const origSend = XMLHttpRequest.prototype.send;
          let captureResolve = null;
          const capturePromise = new Promise(r => { captureResolve = r; });

          XMLHttpRequest.prototype.open = function(m, url) {
            this._captureUrl = url;
            return origOpen.apply(this, arguments);
          };
          XMLHttpRequest.prototype.send = function(body) {
            if (this._captureUrl && this._captureUrl.includes('ACT_FILE_LIST')) {
              XMLHttpRequest.prototype.open = origOpen;
              XMLHttpRequest.prototype.send = origSend;
              captureResolve(body);
            }
            return origSend.apply(this, arguments);
          };

          // 목록 새로고침으로 page=1 XHR 유발
          if (typeof AllFile !== 'undefined' && AllFile.searchFileList) AllFile.searchFileList();
          setTimeout(() => captureResolve(null), 10000);

          capturePromise.then(async (body) => {
            if (!body) { resolve([]); return; }
            try {
              const jsonStr = decodeURIComponent(decodeURIComponent(body.replace('_JSON_=', '')));
              const params = JSON.parse(jsonStr);
              const allFiles = [];
              let page = 1;
              let hasMore = true;
              while (hasMore && page <= 200) {
                params.PG_NO = page;
                const newBody = '_JSON_=' + encodeURIComponent(encodeURIComponent(JSON.stringify(params)));
                const res = await fetch(`/ACT_FILE_LIST.jct?mode=DOWN_ONE_DEPTH&page=${page}`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
                  body: newBody,
                  credentials: 'include'
                });
                const data = await res.json();
                const recs = data.ATCH_REC || [];
                allFiles.push(...recs);
                hasMore = data.NEXT_YN === 'Y' && recs.length > 0;
                page++;
              }
              resolve(allFiles);
            } catch(e) { resolve([]); }
          });
        });
      },
    })
    .then(r => sendResponse({ ok: true, result: r?.[0]?.result }))
    .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  // ATCH_URL로 직접 다운로드
  if (msg.type === 'DOWNLOAD_FILES_DIRECT') {
    const { files, folderName } = msg;
    const tabId = sender.tab.id;
    sendResponse({ ok: true });
    (async () => {
      const total = files.length;
      for (let i = 0; i < total; i++) {
        const file = files[i];
        const url = file.ATCH_URL;
        if (!url) continue;
        const author = (file.RGSR_NM || '').replace(/[/\\:*?"<>|]/g, '_').trim();
        const date   = (file.RGSN_DTTM || '').replace(/[^\d]/g, '').slice(0, 8);
        const name   = file.ORCP_FILE_NM || 'file';
        const filename = `${folderName}/${[author, date, name].filter(Boolean).join('_')}`;
        await new Promise(resolve => {
          chrome.downloads.download({ url, filename, conflictAction: 'uniquify' }, resolve);
        });
        chrome.tabs.sendMessage(tabId, {
          type: 'DOWNLOAD_PROGRESS', current: i + 1, total
        }).catch(() => {});
        await new Promise(r => setTimeout(r, 200));
      }
      chrome.tabs.sendMessage(tabId, { type: 'DOWNLOAD_DONE', total }).catch(() => {});
    })();
    return true;
  }

  if (msg.type === 'CHECK_API') {
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      world: 'MAIN',
      func: () => typeof AllFile !== 'undefined' && typeof FileUtil !== 'undefined',
    })
    .then(r => sendResponse({ ok: true, result: r?.[0]?.result }))
    .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === 'GET_ALL_FILES') {
    // 스크롤 후 전체 li 목록 수집 (ATCH_SRNO만)
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      world: 'MAIN',
      func: () => {
        const lis = [...document.querySelectorAll('li.js-file-list')]
          .filter(l => {
            const srno = l.getAttribute('atch_srno');
            return srno && !srno.includes('{') && l.getAttribute('down_yn') === 'Y';
          });
        return lis.map(l => ({
          ATCH_SRNO: l.getAttribute('atch_srno'),
          ORCP_FILE_NM: l.getAttribute('orcp_file_nm'),
          FILE_SIZE: l.getAttribute('file_size'),
        }));
      },
    })
    .then(r => sendResponse({ ok: true, result: r?.[0]?.result }))
    .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === 'SELECT_ALL_AND_DOWNLOAD') {
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      world: 'MAIN',
      func: async (atchSrnos) => {
        let selectedCount = 0;
        atchSrnos.forEach(srno => {
          const li = [...document.querySelectorAll('li.js-file-list')]
            .find(l => l.getAttribute('atch_srno') === srno);
          if (li) {
            const checked = AllFile.getCheckedFileJson?.() || [];
            if (!checked.find(f => f.ATCH_SRNO === srno)) {
              li.click();
              selectedCount++;
            }
          }
        });

        await new Promise(r => setTimeout(r, 800));
        const files = AllFile.getCheckedDownloadFileJson?.() || [];
        return { ok: true, selectedCount, totalChecked: files.length, files };
      },
      args: [msg.atchSrnos],
    })
    .then(r => {
      const result = r?.[0]?.result;
      sendResponse({ ok: true, result });

      if (!result?.files?.length) return;

      // 응답 후 백그라운드에서 다운로드 처리
      (async () => {
        const now = new Date();
        const folderTime = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
        for (const file of result.files) {
          if (!file.IMG_PATH) continue;
          const project  = (file.PROJECT_TITLE || 'flow').replace(/[/\\:*?"<>|]/g, '_').trim();
          const author   = (file.RGSR_NM       || '').replace(/[/\\:*?"<>|]/g, '_').trim();
          const date     = (file.RGSN_DTTM     || '').replace(/[^\d]/g, '').slice(0, 8);
          const name     = file.ORCP_FILE_NM   || 'file';
          const filename = `${project}_${folderTime}/${[author, date, name].filter(Boolean).join('_')}`;

          await new Promise(resolve => {
            chrome.downloads.download({ url: file.IMG_PATH, filename, conflictAction: 'uniquify' }, resolve);
          });
          await new Promise(r => setTimeout(r, 300));
        }
      })();
    })
    .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

});
