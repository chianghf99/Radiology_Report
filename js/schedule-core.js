// ════════════════════════════════════════════════════
//  神經放射線班表 — schedule-core.js（第 2 / 7 個載入）
//  人員配色、姓名註記解析、工作項目 (taskKey) 設定、全域狀態、Firebase 初始化
//
//  ⚠️ 這些檔案是同一支程式拆開的，共用全域範圍，載入順序不可調換。
//     順序定義於 tools/schedule.html，新增檔案時也要一併加入 sw.js 的 APP_SHELL。
// ════════════════════════════════════════════════════

// ════════════════════════════════════════════════════
//  人員與配色設定
// ════════════════════════════════════════════════════
const CORE_DOCTORS = ['姜信帆', '黃俊肇', '謝棖智', '魏士揚', '鄭宇凡'];

const PEOPLE = [
  { key: 'jiang',    name: '姜信帆', cls: 'chip-jiang',    color: '#059669' },
  { key: 'huang_jz', name: '黃俊肇', cls: 'chip-huang-jz', color: '#d97706' },
  { key: 'zhou',     name: '周兆亮', cls: 'chip-zhou',     color: '#7c3aed' },
  { key: 'huang_yp', name: '黃勇評', cls: 'chip-huang-yp', color: '#c2410c' },
  { key: 'xie',      name: '謝棖智', cls: 'chip-xie',      color: '#be185d' },
  { key: 'wei',      name: '魏士揚', cls: 'chip-wei',      color: '#0e7490' },
  { key: 'zheng',    name: '鄭宇凡', cls: 'chip-zheng',    color: '#6d28d9' },
  { key: 'liu',      name: '劉家義', cls: 'chip-liu',      color: '#0284c7' },
  { key: 'huang_cy', name: '黃崇堯', cls: 'chip-huang-cy', color: '#78350f' },
];

const PERSON_CLASS = {
  '姜信帆': 'p-jiang',
  '黃俊肇': 'p-huang-jz',
  '周兆亮': 'p-zhou',
  '黃勇評': 'p-huang-yp',
  '謝棖智': 'p-xie',
  '魏士揚': 'p-wei',
  '鄭宇凡': 'p-zheng',
  '劉家義': 'p-liu',
  '黃崇堯': 'p-huang-cy',
};

const personByName = {};
PEOPLE.forEach(p => { personByName[p.name] = p; });

function personCls(name) {
  return PERSON_CLASS[name] || 'p-other';
}

// ────────────────────────────────────────────────
//  姓名欄內嵌換班註記的解析
//  班表有時會把換班直接寫進姓名欄，例如「黃俊肇8/11士揚8/18 士揚」。
//  這種字串含有「/」，若交給下方的 學/Cover 或 AM/PM 分隔邏輯會被切成亂碼
//  （例如顯示成「黃俊肇8學/11士揚8Cover」），因此在此先攔截下來，
//  將姓名與註記分開呈現，不改動原始資料。
// ────────────────────────────────────────────────

// 醫師簡稱（取全名後兩字）→ 全名，用於替註記內的簡稱上色
const SHORT_NAME_TO_FULL = {};
PEOPLE.forEach(p => {
  const short = p.name.slice(-2);
  if (!SHORT_NAME_TO_FULL[short]) SHORT_NAME_TO_FULL[short] = p.name;
});

// 依字串長度排序，確保全名優先於簡稱被比對到
const ANNOT_NAME_RE = new RegExp(
  Object.keys(SHORT_NAME_TO_FULL)
    .concat(PEOPLE.map(p => p.name))
    .sort((a, b) => b.length - a.length)
    .join('|'),
  'g'
);

// 將「黃俊肇8/11士揚」拆成 { base: '黃俊肇', annot: '8/11士揚' }；無內嵌註記則回傳 null
function splitInlineAnnotation(raw) {
  const s = String(raw).trim();
  const idx = s.search(/\d/);
  if (idx <= 0) return null;
  const base = s.slice(0, idx).trim();
  const annot = s.slice(idx).trim();
  if (!base || !annot) return null;
  return { base, annot };
}

// 把註記內容渲染成小徽章，並替其中的醫師名字上色
function inlineAnnotHtml(annot) {
  const colored = annot.replace(ANNOT_NAME_RE, m => {
    const full = SHORT_NAME_TO_FULL[m] || m;
    return `<span class="person ${personCls(full)}">${m}</span>`;
  });
  return `<span class="inline-annot" title="此欄位直接寫在姓名中的換班註記">${colored}</span>`;
}

// ════════════════════════════════════════════════════
//  工作項目 (taskKey) 設定
// ════════════════════════════════════════════════════
// 血管攝影的 DSA 與 TAE 是兩個獨立項目，代班可各自指派，
// 因此 taskKey 分為 angio_dsa / angio_tae。
// 舊資料只有單一 angio 鍵（DSA 與 TAE 共用一個代班），查詢時需向下相容。
const TASK_NAMES = {
  'all':        '全部工作',
  'mri':        '🧲 門住急 MRI',
  'angio_dsa':  '🏥 血管攝影 DSA',
  'angio_tae':  '🏥 血管攝影 TAE',
  'angio':      '🏥 血管攝影（DSA+TAE，舊格式）',
  'erct':       '🚨 急診 CT',
  'routine_ct': '📋 門住 CT 號碼',
  'ds_mri':     '🏥 淡水健檢 MRI',
  'picc':       '💉 PICC',
  'saturday':   '📅 週六班',
  'sunday':     '📅 週日 MRI'
};

const KNOWN_TASK_KEYS = Object.keys(TASK_NAMES).filter(k => k !== 'all');

// taskKey → 查詢順序（先找專屬鍵，找不到再退回舊的共用鍵）
const TASK_KEY_FALLBACK = {
  'angio_dsa': ['angio_dsa', 'angio'],
  'angio_tae': ['angio_tae', 'angio'],
  // 門住 CT 早期存成 ct，載入時雖會轉為 routine_ct，仍保留備援以防漏網
  'routine_ct': ['routine_ct', 'ct']
};

function taskKeyChain(taskKey) {
  if (!taskKey) return [];
  return TASK_KEY_FALLBACK[taskKey] || [taskKey];
}

// 由代班物件取出指定工作的代班設定，自動套用向下相容的備援鍵
function pickTaskCover(coverObj, taskKey) {
  if (!coverObj || typeof coverObj !== 'object') return undefined;
  for (const k of taskKeyChain(taskKey)) {
    const v = coverObj[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

// ════════════════════════════════════════════════════
//  全域狀態
// ════════════════════════════════════════════════════
let MONTH_KEYS = Array.from(new Set([...Object.keys(NI_DATA), ...Object.keys(ALL_SCHEDULES)])).sort();
const now = new Date();
const todayKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
let currentIdx = MONTH_KEYS.includes(todayKey)
  ? MONTH_KEYS.indexOf(todayKey)
  : MONTH_KEYS.length - 1;

// 使用者是否曾手動切換月份。
// 頁面剛載入時只有內建備援資料，若當月尚未包含在內就會退到最後一個月；
// 等雲端資料到齊後必須重新判斷，否則會一直停在舊月份。
// 但使用者若已自行切換過，就尊重他的選擇不要跳走。
let userPickedMonth = false;

let todayCardTab = 'today';
let todayCardCustomDate = null;
let activeTab = 'ni'; // 'ni' or 'evt'
const hiddenPeople = new Set();
let viewMode = window.innerWidth <= 768 ? 'today' : 'month';

// ════════════════════════════════════════════════════
//  Firebase 雲端資料庫初始化 (第一階段唯讀)
// ════════════════════════════════════════════════════
const firebaseConfig = {
    apiKey: "AIzaSyBFKkYhLe_s4R10wuP80T1OHkGLFLn2epE",
    authDomain: "radiology-hub-80908.firebaseapp.com",
    projectId: "radiology-hub-80908",
    storageBucket: "radiology-hub-80908.firebasestorage.app",
    messagingSenderId: "508499242885",
    appId: "1:508499242885:web:885a5f469fe30bf32f9eec",
    measurementId: "G-14TEJRN2LT"
};

let db = null;

function getDb() {
  if (db) return db;
  if (typeof firebase !== 'undefined' && firebaseConfig.apiKey !== "YOUR_API_KEY") {
    try {
      if (firebase.apps.length === 0) {
        firebase.initializeApp(firebaseConfig);
      }
      db = firebase.firestore();
      if (!provider) {
        provider = new firebase.auth.GoogleAuthProvider();
        firebase.auth().onAuthStateChanged((user) => {
          currentUser = user;
          // 這個回呼可能在後續程式檔尚未載入完成時就觸發，
          // 因此呼叫前先確認函式已存在（拆檔後才有的時序問題）
          if (typeof updateAdminControlBar === 'function') updateAdminControlBar();
          if (typeof render === 'function') render();
        });
      }
      return db;
    } catch (e) {
      console.error("Firebase Lazy Init Error:", e);
    }
  }
  return null;
}
let currentUser = window.currentUser || null;
let provider = null;

let isEditMode = false;
let activeEditSection = null;

function isSectionEditing(key) {
  if (activeEditSection === null) return false;
  return activeEditSection === 'all' || activeEditSection === key;
}

// 註：Firebase 的主動初始化改於最後載入的 schedule-main.js 執行。
// 放在這裡的話，onAuthStateChanged 可能在後續程式檔載入完成前就觸發，
// 導致回呼裡的 render() 尚未定義。

function updateAdminControlBar() {
  updateModalAuthStatus();
}

