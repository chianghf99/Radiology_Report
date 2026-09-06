// ════════════════════════════════════════════════════
//  班表匯入 — 介面與雲端寫入
//
//  設計原則：匯入只覆蓋「班表本體」（各區塊的人員與號碼）。
//  請假 leaves、代班 covers、已忽略的缺口 ignoredGaps 都是人工判斷的成果，
//  來源檔案裡沒有這些資訊，因此一律保留雲端既有內容。
// ════════════════════════════════════════════════════

const firebaseConfig = {
  apiKey: "AIzaSyBFKkYhLe_s4R10wuP80T1OHkGLFLn2epE",
  authDomain: "radiology-hub-80908.firebaseapp.com",
  projectId: "radiology-hub-80908",
  storageBucket: "radiology-hub-80908.firebasestorage.app",
  messagingSenderId: "508499242885",
  appId: "1:508499242885:web:885a5f469fe30bf32f9eec"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

let pending = null;   // { monthKey, ni, evt, cloudDoc, review }

const $ = id => document.getElementById(id);

function setStatus(el, msg, kind) {
  el.className = 'status show ' + (kind || '');
  el.innerHTML = msg;
}

// ── 解析與預覽 ──────────────────────────────────────

$('parseBtn').addEventListener('click', async () => {
  const box = $('parseStatus');
  const monthKey = $('monthKey').value.trim();
  const niFile = $('niFile').files[0];
  const evtFile = $('evtFile').files[0];

  if (!/^\d{4}-\d{2}$/.test(monthKey)) return setStatus(box, '月份格式錯誤，請用 YYYY-MM，例如 2026-09', 'err');
  if (!niFile && !evtFile) return setStatus(box, '請至少選擇一個檔案', 'err');

  setStatus(box, '解析中…', '');
  try {
    let ni = null, review = [], evt = null;

    let coverSug = [], coverWarn = [], leaveInfo = { leaves: {}, found: [], warnings: [] };
    if (niFile) {
      const { tables, paras } = await readDocx(niFile);
      if (tables.length < 6) throw new Error(`NI 文件的表格數量不符（讀到 ${tables.length} 個，預期 6 個）。請確認選到的是 NI 日班工作分配檔。`);
      const r = parseNi(tables, paras);
      ni = r.ni; review = r.review;
      const c = buildCoverSuggestions(r.annots, monthKey);
      coverSug = c.suggestions; coverWarn = c.warnings;
      leaveInfo = parseLeavesFromNotes(ni.notes, monthKey);
    }
    if (evtFile) {
      const grid = await readXlsxGrid(evtFile);
      evt = parseEvt(grid, monthKey);
      if (!Object.keys(evt).length) throw new Error('EVT 檔案沒有解析到任何值班資料，請確認選到的是中風取栓班表。');
    }

    // 取雲端現況作為比對基準
    const snap = await db.collection('schedules').doc(monthKey).get();
    const cloudDoc = snap.exists ? snap.data() : null;
    const cloudNi = (cloudDoc && cloudDoc.ni) || {};
    const cloudEvt = (cloudDoc && cloudDoc.evt) || {};

    const isNew = !cloudDoc;
    const diff = ni || evt
      ? buildDiff(ni || cloudNi, cloudNi, evt || cloudEvt, cloudEvt, monthKey)
      : { blocks: [], missingEvtDays: [] };

    // 來源檔沒有、但雲端有的區塊：匯入時會保留，這裡要讓使用者知道
    const SECTION_LABEL = { angio: '血管攝影', erct: '急診 CT', routine_ct: '門住 CT 號碼',
      ds_mri_daily: '淡水健檢 MRI', saturday: '週六班', mri_sunday: '週日 MRI', picc: 'PICC' };
    const keptSections = !ni ? [] : Object.keys(SECTION_LABEL).filter(f =>
      (!ni[f] || !ni[f].length) && (cloudNi[f] || []).length);

    renderPreview(diff, isNew, monthKey, !!ni, !!evt,
      keptSections.map(f => `${SECTION_LABEL[f]}（${cloudNi[f].length} 筆）`));
    renderCovers(coverSug, coverWarn, leaveInfo, cloudNi);
    renderReview(review);

    pending = { monthKey, ni, evt, cloudDoc, review, coverSug, leaveInfo };
    $('importCard').style.display = '';

    const changed = diff.blocks.reduce((n, b) => n + b.rows.length, 0);
    setStatus(box,
      isNew
        ? `✅ 解析完成。雲端尚無 ${monthKey}，將<strong>建立新月份</strong>。`
        : `✅ 解析完成。與雲端現況共有 <strong>${changed}</strong> 處差異，請於下方確認。`,
      changed || isNew ? 'ok' : 'warn');
    if (!changed && !isNew) setStatus(box, '✅ 解析完成，內容與雲端現況一致，沒有需要更新的地方。', 'ok');

  } catch (err) {
    console.error(err);
    setStatus(box, '❌ 解析失敗：' + err.message, 'err');
    $('previewCard').style.display = 'none';
    $('importCard').style.display = 'none';
    pending = null;
  }
});

function renderPreview(diff, isNew, monthKey, hasNi, hasEvt, keptSections) {
  const out = $('diffOutput');
  let html = '';

  html += `<div class="keep-note">
    ${isNew ? `雲端尚無 <strong>${monthKey}</strong>，這次會建立新的月份。` :
              `只會更新班表本體。<strong>既有的請假、代班與已忽略的缺口都會原樣保留</strong>，不受這次匯入影響。`}
    ${hasNi ? '' : '<br>（未選 NI 檔案，班表本體維持雲端原樣）'}
    ${hasEvt ? '' : '<br>（未選 EVT 檔案，中風取栓班表維持雲端原樣）'}
  </div>`;

  if ((keptSections || []).length) {
    html += `<div class="status show warn" style="margin-top:12px;">
      ⚠️ 來源檔沒有這些區塊：<strong>${keptSections.join('、')}</strong>。
      匯入後會保留雲端原有的內容，不會被清空。
    </div>`;
  }

  if (diff.missingEvtDays.length) {
    html += `<div class="status show warn" style="margin-top:12px;">
      ⚠️ 來源 EVT 檔案沒有這幾天的值班：<strong>${diff.missingEvtDays.join('、')}</strong> 日。
      這些日子在雲端的原有內容會保留不動，請確認是否需要另外補上。
    </div>`;
  }

  const blocks = diff.blocks.filter(b => b.rows.length);
  if (!blocks.length) {
    html += `<div class="diff-row same" style="margin-top:12px;">各區塊與雲端現況一致，沒有差異。</div>`;
  } else {
    blocks.forEach(b => {
      html += `<div class="diff-block"><div class="diff-title">${b.label}（${b.rows.length}）</div>`;
      b.rows.forEach(r => {
        html += `<div class="diff-row ${r.kind}"><strong>${r.key}</strong>　${r.detail}</div>`;
      });
      html += `</div>`;
    });
  }

  out.innerHTML = html;
  $('previewCard').style.display = '';
}

const TASK_LABEL = {
  angio_dsa: '血管攝影 DSA', angio_tae: '血管攝影 TAE', erct: '急診 CT',
  routine_ct: '門住 CT 號碼', mri: '門住急 MRI', ds_mri: '淡水健檢 MRI', picc: 'PICC'
};
const LOC_LABEL = { tp: '台北', ds: '淡水' };

function renderCovers(sug, warns, leaveInfo, cloudNi) {
  const card = $('coverCard'), list = $('coverList');
  if (!sug.length && !warns.length && !leaveInfo.found.length
      && !((leaveInfo.warnings || []).length)) { card.style.display = 'none'; return; }

  const existing = (cloudNi && cloudNi.covers) || {};
  list.innerHTML = sug.map((s, i) => {
    const has = existing[s.date] && existing[s.date][s.absent];
    return `<label class="diff-row ${has ? 'same' : 'added'}" style="display:flex; gap:8px; align-items:flex-start; cursor:pointer;">
      <input type="checkbox" class="cover-cb" data-i="${i}" checked style="margin-top:3px;">
      <span><strong>${s.date}</strong>　${s.absent} → <span class="new">${s.cover}</span>
      　<span style="color:#64748b;">${TASK_LABEL[s.task] || s.task}${s.loc ? '（' + LOC_LABEL[s.loc] + '）' : ''}</span>
      <span style="color:#94a3b8; font-size:.72rem;"> ← ${s.label}</span></span>
    </label>`;
  }).join('') || '<div class="diff-row same">沒有偵測到需要設定的代班</div>';

  $('leaveArea').innerHTML = leaveInfo.found.length
    ? `<div class="keep-note"><strong>偵測到的請假</strong>（取自備註最下方的說明）<br>
       ${leaveInfo.found.join('<br>')}<br>
       <label style="display:inline-flex; align-items:center; gap:6px; margin-top:8px; cursor:pointer;">
         <input type="checkbox" id="applyLeaves" checked> 一併寫入請假設定
       </label></div>`
    : '';

  const allWarns = [...(warns || []), ...((leaveInfo && leaveInfo.warnings) || [])];
  $('coverWarnings').innerHTML = allWarns.length
    ? `<div class="status show warn" style="margin-top:12px;">⚠️ 需要注意：<br>${allWarns.join('<br>')}</div>`
    : '';

  card.style.display = '';
  updateCoverCount();
}

function updateCoverCount() {
  const all = document.querySelectorAll('.cover-cb');
  const on = document.querySelectorAll('.cover-cb:checked');
  $('coverCount').textContent = `已選 ${on.length} / ${all.length} 筆`;
}

document.addEventListener('change', e => { if (e.target.classList.contains('cover-cb')) updateCoverCount(); });
$('checkAllBtn').addEventListener('click', () => {
  document.querySelectorAll('.cover-cb').forEach(c => { c.checked = true; }); updateCoverCount();
});
$('uncheckAllBtn').addEventListener('click', () => {
  document.querySelectorAll('.cover-cb').forEach(c => { c.checked = false; }); updateCoverCount();
});

function renderReview(review) {
  const card = $('reviewCard'), list = $('reviewList');
  if (!review.length) { card.style.display = 'none'; return; }
  list.innerHTML = review.map(r => `<li>${r}</li>`).join('');
  card.style.display = '';
}

// ── 登入 ────────────────────────────────────────────

auth.onAuthStateChanged(user => {
  $('authArea').style.display = user ? 'none' : '';
  $('importArea').style.display = user ? '' : 'none';
  if (user) $('userName').textContent = user.displayName || user.email;
});

$('loginBtn').addEventListener('click', () => {
  auth.signInWithPopup(new firebase.auth.GoogleAuthProvider())
    .catch(e => setStatus($('importStatus'), '❌ 登入失敗：' + e.message, 'err'));
});
$('logoutBtn').addEventListener('click', () => auth.signOut());

// ── 寫入雲端 ────────────────────────────────────────

$('importBtn').addEventListener('click', async () => {
  const box = $('importStatus');
  if (!pending) return setStatus(box, '請先解析檔案', 'err');

  const { monthKey, ni, evt, cloudDoc } = pending;
  if (!confirm(`確定將 ${monthKey} 的班表寫入雲端嗎？\n\n班表本體會被覆蓋；請假、代班與已忽略的缺口會保留。`)) return;

  setStatus(box, '寫入中…', '');
  try {
    const cloudNi = (cloudDoc && cloudDoc.ni) || {};

    // 班表本體用新解析的內容；人工判斷的結果一律沿用雲端既有值
    const merged = ni ? { ...ni } : { ...cloudNi };

    // 來源檔不一定包含每個區塊（例如 7 月的 Word 就沒有「週日 MRI」那一段）。
    // 解析為空、但雲端原本有資料時，保留雲端的 —— 空的解析結果不可以清空既有班表。
    ['angio', 'erct', 'routine_ct', 'ds_mri_daily', 'saturday', 'mri_sunday', 'picc'].forEach(f => {
      const parsed = merged[f];
      const existing = cloudNi[f];
      if ((!parsed || !parsed.length) && existing && existing.length) merged[f] = existing;
    });
    if (merged.mri && cloudNi.mri) {
      ['tp', 'ds'].forEach(side => {
        if ((!merged.mri[side] || !merged.mri[side].length) && (cloudNi.mri[side] || []).length) {
          merged.mri[side] = cloudNi.mri[side];
        }
      });
    }
    if (!merged.notes && cloudNi.notes) merged.notes = cloudNi.notes;

    merged.leaves = cloudNi.leaves || {};
    merged.covers = cloudNi.covers || {};
    merged.holidays = cloudNi.holidays || [];

    // 勾選的代班建議：疊加在雲端既有代班之上（既有設定不會被移除）
    const picked = [...document.querySelectorAll('.cover-cb:checked')]
      .map(cb => pending.coverSug[+cb.dataset.i]).filter(Boolean);
    if (picked.length) {
      const add = suggestionsToCovers(picked);
      Object.keys(add).forEach(date => {
        merged.covers[date] = merged.covers[date] || {};
        Object.keys(add[date]).forEach(doc => {
          merged.covers[date][doc] = { ...(merged.covers[date][doc] || {}), ...add[date][doc] };
        });
      });
    }

    // 請假：沿用備註推導的結果（使用者可取消）
    const applyLeaves = document.getElementById('applyLeaves');
    if (applyLeaves && applyLeaves.checked && Object.keys(pending.leaveInfo.leaves).length) {
      merged.leaves = { ...merged.leaves, ...pending.leaveInfo.leaves };
    }
    if (cloudNi.ignoredGaps) merged.ignoredGaps = cloudNi.ignoredGaps;
    if (!ni && cloudNi.notes !== undefined) merged.notes = cloudNi.notes;

    // EVT：以解析結果為主，來源缺漏的日子保留雲端原值
    const mergedEvt = { ...((cloudDoc && cloudDoc.evt) || {}) };
    if (evt) Object.keys(evt).forEach(d => { mergedEvt[d] = evt[d]; });

    await db.collection('schedules').doc(monthKey).set({ ni: merged, evt: mergedEvt });

    setStatus(box,
      `🎉 <strong>${monthKey}</strong> 已成功寫入雲端。<br>` +
      `班表頁面會即時更新，不需要重新整理。` +
      `<br>已寫入 ${picked.length} 筆代班設定。請到班表確認上方的「代班缺口」提醒是否還有遺漏。`,
      'ok');
  } catch (err) {
    console.error(err);
    setStatus(box, '❌ 寫入失敗：' + err.message +
      '<br>（若顯示權限不足，表示這個帳號不在管理者名單中）', 'err');
  }
});
