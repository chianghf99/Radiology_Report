// ════════════════════════════════════════════════════
//  神經放射線班表 — schedule-cloud.js（第 4 / 7 個載入）
//  雲端即時同步、離線快取、資料來源標示
//
//  ⚠️ 這些檔案是同一支程式拆開的，共用全域範圍，載入順序不可調換。
//     順序定義於 tools/schedule.html，新增檔案時也要一併加入 sw.js 的 APP_SHELL。
// ════════════════════════════════════════════════════

// 非同步載入雲端班表資料
// ════════════════════════════════════════════════════
//  雲端即時同步、離線快取與資料來源標示
// ════════════════════════════════════════════════════
// 資料流：程式內建備援 → localStorage 快取 → Firestore 即時訂閱，
// 後者可用時覆蓋前者。畫面上方會標明目前看到的是哪一種，
// 避免在雲端讀取失敗時，安靜地顯示過期班表。
const SCHEDULE_CACHE_KEY = 'scheduleCache:v1';

let dataState = { source: 'local', at: null, error: null };
let cloudUnsubscribe = null;
let pendingSnapshotMonths = null;

function setDataState(source, error) {
  dataState = { source, at: new Date(), error: error || null };
  renderDataSourceBadge();
}

// 舊欄位轉換與缺漏補齊
function normalizeNi(monthKey, ni) {
  if (ni.covers) {
    Object.keys(ni.covers).forEach(dateStr => {
      const dayCovers = ni.covers[dateStr];
      if (!dayCovers || typeof dayCovers !== 'object') return;
      Object.keys(dayCovers).forEach(absentDoc => {
        const coverVal = dayCovers[absentDoc];
        if (coverVal && typeof coverVal === 'object' && 'ct' in coverVal) {
          if (!coverVal.routine_ct) coverVal.routine_ct = coverVal.ct;
          delete coverVal.ct;
        }
      });
    });
  }
  const defaultNi = NI_DATA[monthKey] || {};
  if (!ni.mri_sunday && defaultNi.mri_sunday) ni.mri_sunday = defaultNi.mri_sunday;
  return ni;
}

function applyScheduleDoc(monthKey, data) {
  let changed = false;
  if (data && data.ni) {
    NI_DATA[monthKey] = normalizeNi(monthKey, data.ni);
    changed = true;
  }
  if (data && data.evt) {
    // 雲端 evt 為空但本地有資料時，保留本地的中風取栓班表
    const hasCloudEvt = Object.keys(data.evt).length > 0;
    const hasLocalEvt = ALL_SCHEDULES[monthKey] && Object.keys(ALL_SCHEDULES[monthKey]).length > 0;
    if (hasCloudEvt || !hasLocalEvt) {
      ALL_SCHEDULES[monthKey] = data.evt;
      changed = true;
    }
  }
  return changed;
}

function applyMonths(months) {
  let changed = false;
  Object.keys(months).forEach(mk => {
    if (applyScheduleDoc(mk, months[mk])) changed = true;
  });
  if (changed) refreshMonthKeys();
  return changed;
}

function refreshMonthKeys() {
  const oldMonthKey = MONTH_KEYS[currentIdx];
  MONTH_KEYS = Array.from(new Set([...Object.keys(NI_DATA), ...Object.keys(ALL_SCHEDULES)])).sort();

  // 用當下時間計算，不沿用頁面載入時的 now（跨月時才不會停在舊月份）
  const nowReal = new Date();
  const tk = `${nowReal.getFullYear()}-${String(nowReal.getMonth() + 1).padStart(2, '0')}`;

  // 使用者尚未手動切換月份時，只要當月已經有資料就跳到當月。
  // 載入初期只有內建備援，當月往往還不在其中，得等雲端到齊後才切得過去。
  if (!userPickedMonth && MONTH_KEYS.includes(tk)) {
    currentIdx = MONTH_KEYS.indexOf(tk);
    return;
  }
  if (MONTH_KEYS.includes(oldMonthKey)) {
    currentIdx = MONTH_KEYS.indexOf(oldMonthKey);
  } else {
    currentIdx = MONTH_KEYS.includes(tk) ? MONTH_KEYS.indexOf(tk) : MONTH_KEYS.length - 1;
  }
}

// ── 離線快取 ──
function saveScheduleCache(months) {
  try {
    localStorage.setItem(SCHEDULE_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), months }));
  } catch (e) {
    console.warn('[Cache] 班表快取寫入失敗（可能超出容量）:', e);
  }
}

function loadScheduleCache() {
  try {
    const raw = localStorage.getItem(SCHEDULE_CACHE_KEY);
    if (!raw) return false;
    const payload = JSON.parse(raw);
    if (!payload || !payload.months) return false;
    if (!applyMonths(payload.months)) return false;
    dataState = { source: 'cache', at: new Date(payload.savedAt), error: null };
    return true;
  } catch (e) {
    console.warn('[Cache] 班表快取讀取失敗:', e);
    return false;
  }
}

// ── Firestore 即時訂閱 ──
function subscribeCloudSchedules() {
  if (!getDb()) {
    setDataState(dataState.source === 'cache' ? 'cache' : 'local', '雲端資料庫尚未初始化');
    return;
  }
  if (cloudUnsubscribe) return;

  cloudUnsubscribe = db.collection('schedules').onSnapshot(
    (snapshot) => {
      const months = {};
      snapshot.forEach(doc => {
        if (doc.id.startsWith('template')) return;
        months[doc.id] = doc.data();
      });
      if (Object.keys(months).length === 0) return;

      saveScheduleCache(months);

      // 編輯中的未存內容存在 DOM 裡，此時覆蓋會直接清掉，
      // 因此先擱置，待離開編輯模式再套用。
      if (isEditMode || activeEditSection || activeCoverSection) {
        pendingSnapshotMonths = months;
        setDataState('cloud');
        return;
      }

      applyMonths(months);
      setDataState('cloud');
      render();
    },
    (error) => {
      console.error('雲端班表同步失敗，改用快取或內建備援:', error);
      setDataState(dataState.source === 'cache' ? 'cache' : 'local', error.message);
    }
  );
}

// 離開編輯模式後，補套用期間收到的雲端更新
function applyPendingSnapshot() {
  if (!pendingSnapshotMonths) return;
  if (isEditMode || activeEditSection || activeCoverSection) return;
  const months = pendingSnapshotMonths;
  pendingSnapshotMonths = null;
  applyMonths(months);
  render();
}

// ── 資料來源標示 ──
function formatSyncTime(date) {
  if (!date) return '';
  const diffMin = Math.floor((Date.now() - date.getTime()) / 60000);
  if (diffMin < 1) return '剛剛';
  if (diffMin < 60) return `${diffMin} 分鐘前`;
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay ? `${hh}:${mm}` : `${date.getMonth() + 1}/${date.getDate()} ${hh}:${mm}`;
}

function renderDataSourceBadge() {
  const el = document.getElementById('data-source-badge');
  if (!el) return;

  const pendingNote = pendingSnapshotMonths
    ? '<span class="ds-pending">雲端有新版本，結束編輯後套用</span>'
    : '';

  if (dataState.source === 'cloud') {
    el.className = 'data-source-badge ds-ok';
    el.innerHTML = `<span>☁️ 雲端即時同步中</span><span class="ds-time">最後更新 ${formatSyncTime(dataState.at)}</span>${pendingNote}`;
  } else if (dataState.source === 'cache') {
    el.className = 'data-source-badge ds-warn';
    el.innerHTML = `<span>📴 目前無法連線雲端，顯示本機快取</span><span class="ds-time">擷取於 ${formatSyncTime(dataState.at)}</span>`;
  } else {
    el.className = 'data-source-badge ds-error';
    el.innerHTML = `<span>⚠️ 無法取得雲端班表，顯示程式內建的備份資料，內容可能已過期</span>`;
  }
}

function initSchedulePage() {
  // 初始化全域氣泡 Tooltip 容器
  const gt = document.createElement('div');
  gt.id = 'global-tooltip';
  gt.className = 'global-note-tooltip';
  document.body.appendChild(gt);

  // 全域 Hover 監聽器 (自適應防遮擋與邊界修正)
  document.addEventListener('mouseover', function(e) {
    const trigger = e.target.closest('.note-tooltip-trigger');
    if (!trigger) return;
    
    const textEl = trigger.querySelector('.note-tooltip-text');
    if (!textEl) return;
    
    const noteText = textEl.textContent ? textEl.textContent.trim() : '';
    if (!noteText) return;
    
    const tooltip = document.getElementById('global-tooltip');
    if (!tooltip) return;
    
    tooltip.innerHTML = noteText;
    tooltip.style.display = 'block';
    
    const rect = trigger.getBoundingClientRect();
    
    const tooltipHeight = tooltip.offsetHeight;
    const tooltipWidth = tooltip.offsetWidth;
    
    // 自適應防遮擋：若上方高度不足以容納 tooltip 加上安全邊距 15px，則向下彈出
    let showBelow = false;
    if (rect.top < tooltipHeight + 15) {
      showBelow = true;
    }
    
    // position:fixed → 直接用 viewport 座標，不加 scroll offset
    let leftPos = rect.left + rect.width / 2 - tooltipWidth / 2;
    const maxLeft = document.documentElement.clientWidth - tooltipWidth - 10;
    if (leftPos < 10) {
      leftPos = 10;
    } else if (leftPos > maxLeft) {
      leftPos = maxLeft;
    }
    
    // 表格最右邊的備註欄氣泡 (帶有 tooltip-right class)，改用靠右對齊 (防止超出右邊界被裁剪)
    if (trigger.classList.contains('tooltip-right')) {
      leftPos = rect.right - tooltipWidth;
      if (leftPos < 10) leftPos = 10;
    }
    
    let topPos = 0;
    if (showBelow) {
      topPos = rect.bottom + 8;
      tooltip.className = 'global-note-tooltip arrow-top';
    } else {
      topPos = rect.top - tooltipHeight - 8;
      tooltip.className = 'global-note-tooltip arrow-bottom';
    }
    
    tooltip.style.left = leftPos + 'px';
    tooltip.style.top = topPos + 'px';
    
    // 動態修正箭頭位置，精準指向 trigger 中心
    const triggerCenterRelative = rect.left + rect.width / 2 - leftPos;
    const arrowStyle = document.getElementById('global-tooltip-arrow-style') || document.createElement('style');
    arrowStyle.id = 'global-tooltip-arrow-style';
    arrowStyle.innerHTML = `
      .global-note-tooltip::after {
        left: ${triggerCenterRelative}px !important;
      }
    `;
    if (!arrowStyle.parentNode) {
      document.head.appendChild(arrowStyle);
    }
    
    tooltip.style.opacity = '1';
  });

  document.addEventListener('mouseout', function(e) {
    const trigger = e.target.closest('.note-tooltip-trigger');
    if (!trigger) return;
    
    const tooltip = document.getElementById('global-tooltip');
    if (tooltip) {
      tooltip.style.opacity = '0';
      tooltip.style.display = 'none';
    }
  });

  // 先用本機快取立即上畫面（離線也看得到），再訂閱雲端即時更新
  if (loadScheduleCache()) render();
  renderDataSourceBadge();
  subscribeCloudSchedules();
}
// 註：initSchedulePage() 的啟動時機移至最後載入的 schedule-main.js，
// 確保後續檔案的全域變數都初始化完畢後才執行。
