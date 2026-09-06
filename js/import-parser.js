// ════════════════════════════════════════════════════
//  班表匯入 — 原始檔解析
//
//  把科內既有的 NI Word 與 EVT Excel 轉成班表系統的資料結構。
//  這裡的解析規則以 2026-08 的實際檔案驗證過：除了人工潤飾過的備註文字
//  與來源檔本身缺漏的日期外，各區塊與雲端資料完全吻合。
// ════════════════════════════════════════════════════

const IMPORT_DOWS = ['週一', '週二', '週三', '週四', '週五'];
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

// ── 共用小工具 ──────────────────────────────────────

// 「黃俊肇8/11士揚8/18 士揚」→ { base: '黃俊肇', annot: '8/11士揚8/18 士揚' }
function splitAnnot(raw) {
  const s = (raw || '').trim();
  if (!s) return { base: '', annot: '' };
  const i = [...s].findIndex(c => c >= '0' && c <= '9');
  if (i <= 0) return { base: s, annot: '' };
  return { base: s.slice(0, i).trim(), annot: s.slice(i).trim() };
}

// 號碼欄「00-23 8/07-17棖智」→ { nums: '00-23', annot: '8/07-17棖智' }
// 欄位本身以數字開頭，不能用 splitAnnot
const NUM_RE = /^\s*(\d{1,2}\s*[-–]\s*\d{1,2}(?:\s*,\s*\d{1,2}\s*[-–]\s*\d{1,2})*)\s*(.*)$/;
function splitNumbers(raw) {
  const m = NUM_RE.exec(raw || '');
  return m ? { nums: m[1].trim(), annot: m[2].trim() } : { nums: (raw || '').trim(), annot: '' };
}

// 「AM黃主任 PM魏士揚」→「AM 黃主任 / PM 魏士揚」
// 渲染時需要斜線才會正確分開上下午，不是單純美化
const AMPM_RE = /^\s*AM\s*(.+?)\s*PM\s*(.+?)\s*$/;
function normalizePerson(raw) {
  const m = AMPM_RE.exec(raw || '');
  return m ? `AM ${m[1].trim()} / PM ${m[2].trim()}` : (raw || '').trim();
}

function joinNotes(list) {
  return [...new Set(list.filter(Boolean))].join('; ');
}

// ── .docx ───────────────────────────────────────────

async function readDocx(file) {
  const zip = await JSZip.loadAsync(file);
  const xml = await zip.file('word/document.xml').async('string');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');

  const textOf = el => [...el.getElementsByTagNameNS(W_NS, 't')]
    .map(t => t.textContent || '').join('').trim();

  const tables = [...doc.getElementsByTagNameNS(W_NS, 'tbl')].map(tbl =>
    [...tbl.getElementsByTagNameNS(W_NS, 'tr')].map(tr =>
      [...tr.getElementsByTagNameNS(W_NS, 'tc')].map(textOf)
    )
  );

  const body = doc.getElementsByTagNameNS(W_NS, 'body')[0];
  const paras = [...body.children]
    .filter(el => el.localName === 'p')
    .map(textOf)
    .filter(Boolean);

  return { tables, paras };
}

// ── .xlsx ───────────────────────────────────────────

function colIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref || '');
  if (!m) return 0;
  return [...m[1]].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;
}

async function readXlsxGrid(file) {
  const zip = await JSZip.loadAsync(file);
  const parse = s => new DOMParser().parseFromString(s, 'application/xml');

  let shared = [];
  const ssFile = zip.file('xl/sharedStrings.xml');
  if (ssFile) {
    const ss = parse(await ssFile.async('string'));
    shared = [...ss.getElementsByTagName('si')].map(si =>
      [...si.getElementsByTagName('t')].map(t => t.textContent || '').join(''));
  }

  // 取第一張工作表
  const sheetName = Object.keys(zip.files)
    .filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort()[0];
  const sheet = parse(await zip.file(sheetName).async('string'));

  const grid = [];
  for (const row of sheet.getElementsByTagName('row')) {
    const cells = [];
    for (const c of row.getElementsByTagName('c')) {
      const idx = colIndex(c.getAttribute('r'));
      const type = c.getAttribute('t');
      const vEl = c.getElementsByTagName('v')[0];
      let val = '';
      if (type === 's' && vEl) val = shared[parseInt(vEl.textContent, 10)] || '';
      else if (type === 'inlineStr') val = (c.getElementsByTagName('t')[0] || {}).textContent || '';
      else if (vEl) val = vEl.textContent || '';
      cells[idx] = String(val).trim();
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
    grid.push(cells);
  }
  return grid;
}

// ── NI 解析 ─────────────────────────────────────────

function parseNi(tables, paras) {
  const ni = {}, review = [], annots = [];

  // where: { task, loc, when }  —— 儲存格的位置決定了「哪一項工作、哪個院區、哪些日期」
  const cell = (raw, label, where) => {
    const { base, annot } = splitAnnot(raw);
    if (annot) {
      review.push(`${label}：「${raw}」→ 人員 ${base}，註記 ${annot}`);
      if (where) annots.push({ ...where, base, annot, label });
    }
    return { base, annot };
  };

  // 表1 血管攝影
  ni.angio = [];
  for (const r of tables[0] || []) {
    if (!r.length || !IMPORT_DOWS.includes(r[0])) continue;
    const labels = ['台北DSA', '台北TAE', '淡水DSA', '淡水TAE'];
    const spec = [['angio_dsa', 'tp'], ['angio_tae', 'tp'], ['angio_dsa', 'ds'], ['angio_tae', 'ds']];
    const v = [], n = [];
    for (let i = 0; i < 4; i++) {
      const { base, annot } = cell(r[i + 1], `血管攝影 ${r[0]} ${labels[i]}`,
        { task: spec[i][0], loc: spec[i][1], when: { type: 'dow', value: r[0] } });
      v.push(base); n.push(annot);
    }
    ni.angio.push({ dow: r[0], tp_dsa: v[0], tp_tae: v[1], ds_dsa: v[2], ds_tae: v[3], note: joinNotes(n) });
  }

  // 表2 淡水健檢 / 神經 MRI 解釋（每列第 4 欄）
  ni.ds_mri_daily = [];
  for (const r of tables[1] || []) {
    if (!r.length || !IMPORT_DOWS.includes(r[0])) continue;
    const { base, annot } = cell(r[3] || '', `淡水健檢MRI ${r[0]}`,
      { task: 'ds_mri', loc: 'ds', when: { type: 'dow', value: r[0] } });
    ni.ds_mri_daily.push({ dow: r[0], person: base, note: annot });
  }

  // 表3 急診 CT + 門住 CT 號碼
  ni.erct = []; ni.routine_ct = [];
  for (const r of tables[2] || []) {
    if (!r.length || !IMPORT_DOWS.includes(r[0])) continue;
    const tp = cell(r[1], `急診CT ${r[0]} 台北`, { task: 'erct', loc: 'tp', when: { type: 'dow', value: r[0] } });
    const ds = cell(r[2], `急診CT ${r[0]} 淡水`, { task: 'erct', loc: 'ds', when: { type: 'dow', value: r[0] } });
    ni.erct.push({ dow: r[0], tp: tp.base, ds: ds.base, note: joinNotes([tp.annot, ds.annot]) });

    if (r.length >= 6 && r[3]) {
      const a = splitNumbers(r[4]);
      const b = splitNumbers(r[5]);
      [[a, 'tp', '台北'], [b, 'ds', '淡水']].forEach(([x, loc, name]) => {
        if (!x.annot) return;
        review.push(`門住CT ${r[3]} ${name}號碼：「${x.annot}」`);
        annots.push({ task: 'routine_ct', loc, when: { type: 'any' }, base: r[3], annot: x.annot,
                      label: `門住CT ${r[3]} ${name}號碼` });
      });
      ni.routine_ct.push({ person: r[3], tp: a.nums, ds: b.nums, note: joinNotes([a.annot, b.annot]) });
    }
  }

  // 表4 門住急 MRI
  ni.mri = { tp: [], ds: [] };
  for (const r of tables[3] || []) {
    const side = { '台北': 'tp', '淡水': 'ds' }[r[0]];
    if (!side) continue;
    for (let i = 0; i < 5; i++) {
      const { base, annot } = cell(r[i + 1], `門住急MRI ${r[0]} W${i + 1}`,
        { task: 'mri', loc: side, when: { type: 'week', value: i + 1 } });
      ni.mri[side].push({ week: `W${i + 1}`, person: normalizePerson(base), note: annot });
    }
  }

  // 表5 週六班 / 週日 MRI
  // 兩種版面都要支援：
  //   (a) 標題與日期同一列：「周六… | 8/01謝棖智 | 8/08魏士揚 …」
  //   (b) 標題自成一列，日期在後續列：「周六…」換行「7/04 鄭宇凡 | 7/11魏士揚 …」
  ni.saturday = []; ni.mri_sunday = [];
  {
    let target = null;
    const pick = (v) => {
      const t = (v || '').trim();
      const m = /^(\d{1,2})\/(\d{1,2})\s*(.*)$/.exec(t);
      if (!m || !target) return;
      let rest = m[3].trim();
      // 括號內是說明（如「(假日僅MRI)」），不屬於姓名
      let note = '';
      rest = rest.replace(/[（(]([^）)]*)[）)]/g, (_, inner) => { note = inner.trim(); return ' '; }).trim();
      if (!rest) return;
      target.push({ date: `${+m[1]}/${+m[2]}`, person: rest, note });
    };
    for (const r of tables[4] || []) {
      const head = (r[0] || '').trim();
      if (/[周週]六/.test(head)) target = ni.saturday;
      else if (/[周週]日/.test(head)) target = ni.mri_sunday;
      // 標題列本身也可能帶日期；非標題列則整列都是日期
      (/[周週][六日]/.test(head) ? r.slice(1) : r).forEach(pick);
    }
  }

  // 表6 PICC
  const picc = {};
  for (const r of tables[5] || []) {
    const side = { '台北': 'tp', '淡水': 'ds' }[r[0]];
    if (!side) continue;
    for (let i = 0; i < 5; i++) {
      const { base, annot } = cell(r[i + 1], `PICC ${IMPORT_DOWS[i]} ${r[0]}`,
        { task: 'picc', loc: side, when: { type: 'dow', value: IMPORT_DOWS[i] } });
      picc[i] = picc[i] || { dow: IMPORT_DOWS[i], tp: '', ds: '', note: '' };
      picc[i][side] = base;
      if (annot) picc[i].note = joinNotes([picc[i].note, annot]);
    }
  }
  ni.picc = Object.keys(picc).sort((a, b) => a - b).map(k => picc[k]);

  ni.notes = paras.filter(p => !/^\d{4}-\d{2}月$/.test(p)).join('\n');
  return { ni, review, annots };
}

// ── EVT 解析 ────────────────────────────────────────
// 版面為週曆：日期列 → 台北列 → 空列 → 淡水列
function parseEvt(grid, monthKey) {
  const evt = {};
  const daysInMonth = (() => {
    const [y, m] = (monthKey || '').split('-').map(Number);
    return (y && m) ? new Date(y, m, 0).getDate() : 31;
  })();

  for (let i = 0; i < grid.length; i++) {
    const days = (grid[i] || []).slice(0, 7);
    // 日期格可能帶節日註記，例如「16(除夕)」「17(初一)」，取開頭的數字即可
    const dayNum = c => { const m = /^\s*(\d{1,2})/.exec(c || ''); return m ? +m[1] : null; };
    if (!days.some(c => dayNum(c) !== null)) continue;
    const tpRow = grid[i + 1] || [];
    const dsRow = grid[i + 3] || [];

    for (let col = 0; col < 7; col++) {
      const day = dayNum(days[col]);
      if (day === null || day < 1 || day > daysInMonth) continue;

      let tp = (tpRow[col] || '').trim();
      let ds = (dsRow[col] || '').trim();
      if (tp === '台北' || tp === '淡水') tp = '';
      if (ds === '台北' || ds === '淡水') ds = '';
      if (!tp && !ds) continue;

      // 第一週若出現月底日期，代表是上個月的尾巴
      if (i < 4 && day > 20) continue;
      evt[String(day)] = { tp, ds };
    }
  }
  return evt;
}

// ── 語意比對 ────────────────────────────────────────
// 連字號樣式、多餘空白、列的順序都不算差異
function normText(v) {
  return String(v == null ? '' : v).replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
}

function rowsByKey(rows, keyName) {
  const out = {};
  (rows || []).forEach(r => {
    const copy = {};
    Object.keys(r).filter(k => k !== keyName).sort().forEach(k => { copy[k] = normText(r[k]); });
    out[r[keyName]] = copy;
  });
  return out;
}

function diffSection(label, parsed, cloud, keyName) {
  const a = rowsByKey(parsed, keyName);
  const b = rowsByKey(cloud, keyName);
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  const rows = [];
  keys.forEach(k => {
    const x = a[k], y = b[k];
    if (!y) { rows.push({ key: k, kind: 'added', detail: '新增' }); return; }
    if (!x) return;
    const changed = Object.keys(x).filter(f => x[f] !== (y[f] || ''));
    if (changed.length) {
      rows.push({
        key: k, kind: 'changed',
        detail: changed.map(f => `${f}：<span class="old">${y[f] || '(空)'}</span> → <span class="new">${x[f] || '(空)'}</span>`).join('　')
      });
    }
  });
  return { label, rows };
}

function buildDiff(parsed, cloudNi, parsedEvt, cloudEvt, monthKey) {
  const blocks = [
    diffSection('血管攝影', parsed.angio, cloudNi.angio, 'dow'),
    diffSection('急診 CT', parsed.erct, cloudNi.erct, 'dow'),
    diffSection('門住 CT 號碼', parsed.routine_ct, cloudNi.routine_ct, 'person'),
    diffSection('門住急 MRI（台北）', parsed.mri.tp, (cloudNi.mri || {}).tp, 'week'),
    diffSection('門住急 MRI（淡水）', parsed.mri.ds, (cloudNi.mri || {}).ds, 'week'),
    diffSection('淡水健檢 MRI', parsed.ds_mri_daily, cloudNi.ds_mri_daily, 'dow'),
    diffSection('週六班', parsed.saturday, cloudNi.saturday, 'date'),
    diffSection('週日 MRI', parsed.mri_sunday, cloudNi.mri_sunday, 'date'),
    diffSection('PICC', parsed.picc, cloudNi.picc, 'dow')
  ];

  // 備註
  if (normText(parsed.notes) !== normText(cloudNi.notes || '')) {
    blocks.push({ label: '本月備註', rows: [{ key: '', kind: 'changed',
      detail: `<span class="old">${cloudNi.notes || '(空)'}</span> → <span class="new">${parsed.notes}</span>` }] });
  }

  // EVT：只比對台北（依專案規則，淡水不呈現）
  const [y, m] = monthKey.split('-').map(Number);
  const dim = new Date(y, m, 0).getDate();
  const evtRows = [], missing = [];
  for (let d = 1; d <= dim; d++) {
    const k = String(d);
    const pv = normText((parsedEvt[k] || {}).tp);
    const cv = normText((cloudEvt[k] || {}).tp);
    if (!pv) { missing.push(d); continue; }
    if (pv !== cv) {
      evtRows.push({ key: `${m}/${d}`, kind: cv ? 'changed' : 'added',
        detail: cv ? `<span class="old">${cv}</span> → <span class="new">${pv}</span>` : `<span class="new">${pv}</span>` });
    }
  }
  blocks.push({ label: '中風取栓（台北）', rows: evtRows });
  return { blocks, missingEvtDays: missing };
}

// ════════════════════════════════════════════════════
//  由內嵌註記推導代班與請假
//
//  關鍵在於：儲存格的位置已經決定了「哪一項工作、哪個院區、適用哪些日期」，
//  註記文字只需要提供「哪一天、換給誰」。因此代班是可以推導出來的，
//  不必逐筆人工判斷 —— 但仍然要讓使用者在預覽時逐筆確認。
// ════════════════════════════════════════════════════

const IMPORT_PEOPLE = ['姜信帆', '黃俊肇', '周兆亮', '黃勇評', '謝棖智',
                       '魏士揚', '鄭宇凡', '劉家義', '黃崇堯'];

// 簡稱（全名後兩字）→ 全名
const SHORT_TO_FULL = IMPORT_PEOPLE.reduce((m, n) => {
  const s = n.slice(-2);
  if (!(s in m)) m[s] = n;
  return m;
}, {});

function resolvePerson(name) {
  const n = (name || '').trim();
  if (!n) return null;
  if (IMPORT_PEOPLE.includes(n)) return n;
  if (SHORT_TO_FULL[n]) return SHORT_TO_FULL[n];
  return null;                       // 認不得就回 null，交由呼叫端提出警告
}

const DOW_TO_NUM = { '週一': 1, '週二': 2, '週三': 3, '週四': 4, '週五': 5 };

// 把註記拆成 [{ days:[..], person }]。
// 支援：8/11士揚 ／ 8/11, 8/18士揚 ／ 8/11,18士揚 ／ 8/07-17棖智 ／ 8/10信帆 8/17棖智
function parseAnnotation(annot, monthNum) {
  const tokens = String(annot || '').match(/\d{1,2}\/\d{1,2}(?:\s*[-–]\s*\d{1,2})?|\d{1,2}|[一-鿿]+/g) || [];
  const out = [];
  let pending = [], lastMonth = monthNum;

  for (const tk of tokens) {
    const range = /^(\d{1,2})\/(\d{1,2})\s*[-–]\s*(\d{1,2})$/.exec(tk);
    const single = /^(\d{1,2})\/(\d{1,2})$/.exec(tk);
    if (range) {
      lastMonth = +range[1];
      for (let d = +range[2]; d <= +range[3]; d++) pending.push(`${lastMonth}/${d}`);
    } else if (single) {
      lastMonth = +single[1];
      pending.push(`${lastMonth}/${+single[2]}`);
    } else if (/^\d{1,2}$/.test(tk)) {
      pending.push(`${lastMonth}/${+tk}`);          // 只寫日、沿用前一個月份
    } else {
      const person = resolvePerson(tk);
      if (pending.length) {
        out.push({ days: pending, person, raw: tk });
        pending = [];
      }
    }
  }
  if (pending.length) out.push({ days: pending, person: null, raw: '' });
  return out;
}

// 該儲存格在本月適用哪些日期
function datesForCell(when, year, month) {
  const dim = new Date(year, month, 0).getDate();
  const all = [];
  for (let d = 1; d <= dim; d++) all.push(d);
  if (when.type === 'any') return all;
  const target = when.type === 'week' ? when.value : DOW_TO_NUM[when.value];
  if (!target) return all;
  return all.filter(d => new Date(year, month - 1, d).getDay() === target);
}

function buildCoverSuggestions(annots, monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  const suggestions = [], warnings = [];

  (annots || []).forEach(a => {
    const basePerson = resolvePerson(a.base);
    if (!basePerson) {
      warnings.push(`${a.label}：原班人員「${a.base}」不在醫師名單中，已略過`);
      return;
    }
    const validDates = new Set(datesForCell(a.when, year, month).map(d => `${month}/${d}`));

    parseAnnotation(a.annot, month).forEach(seg => {
      if (!seg.person) {
        warnings.push(`${a.label}：註記「${a.annot}」中的「${seg.raw}」不是認得的醫師姓名`);
        return;
      }
      seg.days.forEach(day => {
        if (!validDates.has(day)) {
          const scope = a.when.type === 'week' ? IMPORT_DOWS[a.when.value - 1]
                      : (a.when.type === 'dow' ? a.when.value : '每日');
          warnings.push(`${a.label}：${day} 不是${scope}，與這一格適用的日期不符，已略過`);
          return;
        }
        suggestions.push({
          date: day, absent: basePerson, task: a.task, loc: a.loc,
          cover: seg.person, label: a.label
        });
      });
    });
  });

  suggestions.sort((x, y) => {
    const [ax, bx] = x.date.split('/').map(Number), [ay, by] = y.date.split('/').map(Number);
    return ax - ay || bx - by || x.task.localeCompare(y.task);
  });
  return { suggestions, warnings };
}

// 把選定的建議組成 covers 結構
function suggestionsToCovers(list) {
  const covers = {};
  list.forEach(s => {
    covers[s.date] = covers[s.date] || {};
    covers[s.date][s.absent] = covers[s.date][s.absent] || {};
    const slot = covers[s.date][s.absent];
    if (s.loc) {
      if (typeof slot[s.task] !== 'object' || slot[s.task] === null) slot[s.task] = {};
      slot[s.task][s.loc] = s.cover;
    } else {
      slot[s.task] = s.cover;
    }
  });

  // 台北與淡水是同一人時收斂成字串，與手動輸入「單人代班」的格式一致
  // （兩種寫法效果相同，統一格式可避免日後重新匯入時出現無意義的差異）
  Object.values(covers).forEach(day => Object.values(day).forEach(byDoc => {
    Object.keys(byDoc).forEach(task => {
      const v = byDoc[task];
      if (v && typeof v === 'object' && v.tp && v.ds && v.tp === v.ds) byDoc[task] = v.tp;
    });
  }));
  return covers;
}

// 由備註最下方的說明推導請假。
// 需要涵蓋的寫法：
//   休假：俊肇(8/07-8/18)                        單一區間
//   休假：俊肇(9/05-9/09, 9/25-10/05)            多個區間、且可能跨月
//   休假：姜信帆、魏士揚（6/4–6/8）               多人共用同一區間
function parseLeavesFromNotes(notes, monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  const leaves = {}, found = [], warnings = [];
  const line = String(notes || '').split('\n').find(l => l.includes('休假')) || '';
  if (!line) return { leaves, found, warnings };
  const body = line.slice(line.indexOf('休假'));

  // 姓名（可用「、」並列）＋ 括號內的區間清單
  const re = /([一-鿿]{2,3}(?:\s*[、,]\s*[一-鿿]{2,3})*)\s*[（(]([^）)]*)[）)]/g;
  let m;
  while ((m = re.exec(body))) {
    const people = m[1].split(/[、,]/).map(x => resolvePerson(x.trim())).filter(Boolean);
    if (!people.length) continue;

    const days = [], outside = [];
    m[2].split(/[,，]/).forEach(part => {
      const r = /(\d{1,2})\/(\d{1,2})\s*[-–~]\s*(?:(\d{1,2})\/)?(\d{1,2})/.exec(part);
      if (!r) return;
      const start = new Date(year, +r[1] - 1, +r[2]);
      const end = new Date(year, (+(r[3] || r[1])) - 1, +r[4]);
      if (isNaN(start) || isNaN(end) || end < start) return;
      for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const label = `${d.getMonth() + 1}/${d.getDate()}`;
        // 區間可能跨到下個月（如 9/25-10/05），只保留屬於本月的部分
        if (d.getMonth() + 1 === month) days.push(label);
        else outside.push(label);
      }
    });

    if (!days.length) continue;
    people.forEach(p => {
      leaves[p] = days;
      found.push(`${p}：${days[0]}–${days[days.length - 1]}（${days.length} 天）`);
    });
    if (outside.length) {
      warnings.push(`${people.join('、')} 的休假有 ${outside.length} 天落在本月之外`
        + `（${outside[0]}–${outside[outside.length - 1]}），需於該月份另行設定`);
    }
  }
  return { leaves, found, warnings };
}
