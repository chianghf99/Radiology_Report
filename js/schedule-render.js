// ════════════════════════════════════════════════════
//  神經放射線班表 — schedule-render.js（第 5 / 7 個載入）
//  時段判斷、今日分配、今日卡片與各班表區塊渲染
//
//  ⚠️ 這些檔案是同一支程式拆開的，共用全域範圍，載入順序不可調換。
//     順序定義於 tools/schedule.html，新增檔案時也要一併加入 sw.js 的 APP_SHELL。
// ════════════════════════════════════════════════════


let autoFilterTime = true;
try {
  autoFilterTime = localStorage.getItem('autoFilterTime') !== 'false';
} catch (e) {}

function toggleAutoFilter(checked) {
  autoFilterTime = checked;
  try {
    localStorage.setItem('autoFilterTime', checked ? 'true' : 'false');
  } catch (e) {}
  render();
}

function getLogicalDate() {
  const now = new Date();
  const hour = now.getHours();
  const min = now.getMinutes();
  const timeInMinutes = hour * 60 + min;
  
  const logicalDate = new Date(now.getTime());
  // 凌晨 00:00 到 08:30 之間，屬於前一天的 On-Call 時段延續，邏輯日期設為昨天
  if (timeInMinutes < 8 * 60 + 30) {
    logicalDate.setDate(logicalDate.getDate() - 1);
  }
  return logicalDate;
}

function getAutoFilterStatus(targetDate) {
  if (!autoFilterTime) return 'show_all';
  
  const now = new Date();
  const logicalDate = getLogicalDate();
  // 時段篩選僅適用於邏輯上的今天
  if (targetDate.toDateString() !== logicalDate.toDateString()) {
    return 'show_all';
  }
  
  const year = targetDate.getFullYear();
  const month = targetDate.getMonth() + 1;
  const day = targetDate.getDate();
  const key = `${year}-${String(month).padStart(2, '0')}`;
  const d = NI_DATA[key];
  const dateStr = `${month}/${day}`;
  const isHoliday = d && d.holidays && d.holidays.includes(dateStr);
  
  const dow = targetDate.getDay(); // 0: Sunday, 6: Saturday
  
  if (dow === 0 || isHoliday) {
    return 'evt_only';
  }
  
  const hour = now.getHours();
  const min = now.getMinutes();
  const timeInMinutes = hour * 60 + min;
  
  const startDaytime = 8 * 60 + 30; // 08:30
  
  if (dow === 6) {
    // 週六
    const endDaytimeSat = 12 * 60; // 12:00
    if (timeInMinutes >= startDaytime && timeInMinutes < endDaytimeSat) {
      return 'daytime_only';
    } else {
      return 'evt_only';
    }
  } else {
    // 週一至週五
    const endDaytimeWeekday = 17 * 60; // 17:00
    if (timeInMinutes >= startDaytime && timeInMinutes < endDaytimeWeekday) {
      return 'daytime_only';
    } else {
      return 'evt_only';
    }
  }
}

const DOW_NAMES_TW = ['日','一','二','三','四','五','六'];
const DOW_LABEL    = { 1:'週一', 2:'週二', 3:'週三', 4:'週四', 5:'週五', 6:'週六' };

// ════════════════════════════════════════════════════
//  換月與換 Tab 邏輯
// ════════════════════════════════════════════════════
function changeMonth(dir) {
  if (isEditMode) {
    if (!confirm("您有未儲存的排班或代班修改，切換月份將會遺失這些修改，確定要切換嗎？")) {
      return;
    }
    cancelEditMode();
  }
  currentIdx = Math.max(0, Math.min(MONTH_KEYS.length - 1, currentIdx + dir));
  userPickedMonth = true;   // 之後雲端資料更新時不要把使用者跳回當月
  activeCoverSection = null;
  isLeavesCoversExpanded = false;
  render();
}

function setTodayTab(tab) {
  todayCardTab = tab;
  if (tab !== 'custom') {
    todayCardCustomDate = null;
  }
  render();
}

function onCustomDateChange(val) {
  if (!val) return;
  todayCardTab = 'custom';
  const [y, m, d] = val.split('-').map(Number);
  todayCardCustomDate = new Date(y, m - 1, d);
  render();
}

function setViewMode(mode) {
  viewMode = mode;
  document.getElementById('mode-today-btn').classList.toggle('active', mode === 'today');
  document.getElementById('mode-month-btn').classList.toggle('active', mode === 'month');

  // 控制月份切換與月度班表容器顯示/隱藏
  document.querySelector('.month-switcher').style.display = mode === 'today' ? 'none' : 'flex';
  document.querySelector('.tabs-container').style.display = mode === 'today' ? 'none' : '';

  const niContent = document.getElementById('ni-content');
  const evtContent = document.getElementById('evt-content');
  if (mode === 'today') {
    niContent.style.display = 'none';
    evtContent.style.display = 'none';
  } else {
    niContent.classList.toggle('active', activeTab === 'ni');
    evtContent.classList.toggle('active', activeTab === 'evt');
    niContent.style.display = activeTab === 'ni' ? 'block' : 'none';
    evtContent.style.display = activeTab === 'evt' ? 'block' : 'none';
    renderTabContent();
  }
}

function switchTab(tab) {
  activeTab = tab;
  document.getElementById('tab-ni-btn').classList.toggle('active', tab === 'ni');
  document.getElementById('tab-evt-btn').classList.toggle('active', tab === 'evt');
  
  const niContent = document.getElementById('ni-content');
  const evtContent = document.getElementById('evt-content');
  if (viewMode === 'today') {
    niContent.style.display = 'none';
    evtContent.style.display = 'none';
  } else {
    niContent.classList.toggle('active', tab === 'ni');
    evtContent.classList.toggle('active', tab === 'evt');
    niContent.style.display = tab === 'ni' ? 'block' : 'none';
    evtContent.style.display = tab === 'evt' ? 'block' : 'none';
    renderTabContent();
  }
}

// ════════════════════════════════════════════════════
//  今日分配邏輯
// ════════════════════════════════════════════════════
function getWeekNum(year, month, day) {
  const firstDow = new Date(year, month - 1, 1).getDay();
  const monOffset = (firstDow + 6) % 7;
  return Math.ceil((day + monOffset) / 7);
}

function getTodayAssignments(key, targetDate = new Date()) {
  const [y, m] = key.split('-').map(Number);
  const day = targetDate.getDate();
  const dowNum = targetDate.getDay();
  const dowLabel = DOW_LABEL[dowNum];
  const dateStr = `${y}/${String(m).padStart(2,'0')}/${String(day).padStart(2,'0')} （週${DOW_NAMES_TW[dowNum]}）`;

  // 取得 EVT On-Call
  const evtSched = ALL_SCHEDULES[key];
  const evtDuty = evtSched ? evtSched[day] : null;
  const evtDoctor = evtDuty ? (typeof evtDuty === 'string' ? evtDuty : evtDuty.tp) : '';

  const baseResult = {
    dateStr,
    year: y,
    month: m,
    day: day,
    targetDate: targetDate,
    key: key
  };

  if (dowNum === 0) {
    const d = NI_DATA[key];
    const sunMri = (d && d.mri_sunday) ? d.mri_sunday.find(r => {
      const [sm, sd] = r.date.split('/').map(Number);
      return sm === m && sd === day;
    }) : null;
    return { ...baseResult, isSunday: true, sunMri, evtDoctor };
  }

  const d = NI_DATA[key];
  if (!d) return null;

  if (dowNum === 6) {
    const sat = d.saturday && d.saturday.find(r => {
      const [sm, sd] = r.date.split('/').map(Number);
      return sm === m && sd === day;
    });
    return { ...baseResult, isSat: true, sat, evtDoctor };
  }

  // 門住急 MRI 班表的 W1 ~ W5 對應週一至週五（dowNum 1 ~ 5）
  const weekLabel = `W${dowNum}`;

  return {
    ...baseResult, isSat: false, weekLabel, evtDoctor,
    angio:       d.angio       && d.angio.find(r => r.dow === dowLabel),
    erct:        d.erct        && d.erct.find(r => r.dow === dowLabel),
    routine_ct:  d.routine_ct,
    mri_tp:      d.mri         && d.mri.tp.find(r => r.week === weekLabel),
    mri_ds:      d.mri         && d.mri.ds.find(r => r.week === weekLabel),
    ds_mri:      d.ds_mri_daily && d.ds_mri_daily.find(r => r.dow === dowLabel),
    picc:        d.picc        && d.picc.find(r => r.dow === dowLabel),
  };
}

function getDoctorTasksForToday(a) {
  if (!a) return {};
  
  const doctorTasks = {};
  CORE_DOCTORS.forEach(docName => {
    doctorTasks[docName] = { tasks: [], isOnLeave: false };
  });

  function checkLeave(name) {
    if (!name) return false;
    const key = a.key;
    const d = NI_DATA[key];
    if (d && d.leaves && d.leaves[name]) {
      const dateStr = `${a.month}/${a.day}`;
      return d.leaves[name].includes(dateStr);
    }
    return false;
  }

  const key = a.key;
  const d = NI_DATA[key];
  const dateStr = `${a.month}/${a.day}`;
  const dayCovers = (d && d.covers && d.covers[dateStr]) ? d.covers[dateStr] : null;

  function addTask(name, task) {
    if (!name) return;
    name = name.trim();
    if (!name || name === '—') return;
    
    const ampmMatch = name.match(/^(AM|PM)\s+(.+)$/);
    let displayName = name;
    let suffix = '';
    if (ampmMatch) {
      displayName = ampmMatch[2].trim();
      suffix = ` (${ampmMatch[1]})`;
    }
    
    if (!CORE_DOCTORS.includes(displayName)) return;

    if (!doctorTasks[displayName]) {
      doctorTasks[displayName] = { tasks: [], isOnLeave: false };
    }

    // Determine the task key for this task
    let taskKey = null;
    if (task.includes('DSA')) {
      taskKey = 'angio_dsa';
    } else if (task.includes('TAE')) {
      taskKey = 'angio_tae';
    } else if (task.includes('血管攝影')) {
      taskKey = 'angio';
    } else if (task.includes('急 CT')) {
      taskKey = 'erct';
    } else if (task.includes('門住 CT')) {
      taskKey = 'routine_ct';
    } else if (task.includes('MRI') && !task.includes('解釋')) {
      taskKey = 'mri';
    } else if (task.includes('MRI') && task.includes('解釋')) {
      taskKey = 'ds_mri';
    } else if (task.includes('PICC')) {
      taskKey = 'picc';
    }

    let coverName = null;
    let isSplitCt = false;
    let tpCover = null;
    let dsCover = null;

    if (dayCovers && dayCovers[displayName]) {
      const cover = dayCovers[displayName];
      if (typeof cover === 'string') {
        coverName = cover;
      } else if (typeof cover === 'object' && pickTaskCover(cover, taskKey)) {
        const taskCover = pickTaskCover(cover, taskKey);
        if (typeof taskCover === 'string') {
          coverName = taskCover;
        } else if (typeof taskCover === 'object') {
          if (taskKey === 'routine_ct' && task.includes('北:') && task.includes('淡:')) {
            isSplitCt = true;
            tpCover = taskCover.tp;
            dsCover = taskCover.ds;
          } else {
            if (task.includes('台北') || task.includes('北:')) {
              coverName = taskCover.tp;
            } else if (task.includes('淡水') || task.includes('淡:')) {
              coverName = taskCover.ds;
            }
          }
        }
      }
    }

    if (isSplitCt) {
      const ctMatch = task.match(/門住 CT \(北:(.+?)\/淡:(.+?)\)/);
      if (ctMatch) {
        const tpVal = ctMatch[1];
        const dsVal = ctMatch[2];
        if (tpCover) {
          if (!doctorTasks[tpCover]) doctorTasks[tpCover] = { tasks: [], isOnLeave: false };
          doctorTasks[tpCover].tasks.push(`門住 CT 台北 (${tpVal}) (代${displayName})${suffix}`);
        } else {
          doctorTasks[displayName].tasks.push(`門住 CT 台北 (${tpVal})${suffix}`);
        }
        if (dsCover) {
          if (!doctorTasks[dsCover]) doctorTasks[dsCover] = { tasks: [], isOnLeave: false };
          doctorTasks[dsCover].tasks.push(`門住 CT 淡水 (${dsVal}) (代${displayName})${suffix}`);
        } else {
          doctorTasks[displayName].tasks.push(`門住 CT 淡水 (${dsVal})${suffix}`);
        }
      }
    } else if (coverName) {
      if (!doctorTasks[coverName]) {
        doctorTasks[coverName] = { tasks: [], isOnLeave: false };
      }
      doctorTasks[coverName].tasks.push(`${task} (代${displayName})${suffix}`);
    } else {
      doctorTasks[displayName].tasks.push(task + suffix);
    }
  }

  function processField(raw, taskName) {
    if (!raw) return;
    if (raw.includes('AM') || raw.includes('PM')) {
      raw.split('/').forEach(seg => {
        seg = seg.trim();
        const m = seg.match(/^(AM|PM)\s+(.+)$/);
        if (m) {
          addTask(m[2].trim(), `${taskName} (${m[1]})`);
        } else {
          addTask(seg, taskName);
        }
      });
      return;
    }
    if (raw.includes('/')) {
      const parts = raw.split('/');
      addTask(parts[0].trim(), `${taskName} (學習)`);
      addTask(parts[1].trim(), `${taskName} (Cover)`);
      return;
    }
    addTask(raw, taskName);
  }

  if (a.isSunday) {
    if (a.sunMri) processField(a.sunMri.person, '週日 MRI 加班');
    if (a.evtDoctor) processField(a.evtDoctor, '中風取栓 On-Call');
  } else if (a.isSat) {
    if (a.sat) processField(a.sat.person, '週六班');
    if (a.evtDoctor) processField(a.evtDoctor, '中風取栓 On-Call');
  } else {
    if (a.angio) {
      processField(a.angio.tp_dsa, '台北 DSA');
      processField(a.angio.tp_tae, '台北 TAE');
      processField(a.angio.ds_dsa, '淡水 DSA');
      processField(a.angio.ds_tae, '淡水 TAE');
    }
    if (a.erct) {
      processField(a.erct.tp, '台北急 CT');
      processField(a.erct.ds, '淡水急 CT');
    }
    if (a.mri_tp) {
      processField(a.mri_tp.person, '台北 MRI');
    }
    if (a.mri_ds) {
      processField(a.mri_ds.person, '淡水 MRI');
    }
    if (a.ds_mri) {
      processField(a.ds_mri.person, '淡水神經 MRI 解釋');
    }
    if (a.picc) {
      processField(a.picc.tp, '台北 PICC');
      processField(a.picc.ds, '淡水 PICC');
    }
    if (a.evtDoctor) {
      processField(a.evtDoctor, '中風取栓 On-Call');
    }
    if (a.routine_ct && a.routine_ct.length) {
      a.routine_ct.forEach(r => {
        processField(r.person, `門住 CT (北:${r.tp}/淡:${r.ds})`);
      });
    }
  }

  // Mark leaves
  Object.keys(doctorTasks).forEach(name => {
    doctorTasks[name].isOnLeave = checkLeave(name);
  });

  // Filter out doctors who have no tasks and are not on leave
  const result = {};
  Object.keys(doctorTasks).forEach(name => {
    const info = doctorTasks[name];
    if (info.tasks.length > 0 || info.isOnLeave) {
      result[name] = info;
    }
  });

  return result;
}

// ════════════════════════════════════════════════════
//  姓名渲染與小備註 helper
// ════════════════════════════════════════════════════
function renderPerson(raw, showTraineeTag = true, targetDate = null, taskKey = null, location = null, dow = null) {
  if (!raw) return '—';

  function formatName(name) {
    const cls = personCls(name);
    const baseHtml = `<span class="person ${cls}">${name}</span>`;
    
    let isCovered = false;
    let coverSuffix = '';
    let hasActiveCover = false;
    let dateStr = '';
    
    if (targetDate) {
      const parsedDate = typeof targetDate === 'string' ? new Date(MONTH_KEYS[currentIdx].split('-')[0], MONTH_KEYS[currentIdx].split('-')[1] - 1, targetDate.split('/')[1]) : targetDate;
      const year = parsedDate.getFullYear();
      const month = parsedDate.getMonth() + 1;
      const day = parsedDate.getDate();
      const monthKey = `${year}-${String(month).padStart(2, '0')}`;
      const d = NI_DATA[monthKey];
      
      dateStr = `${month}/${day}`;
      
      if (d && d.covers && d.covers[dateStr] && d.covers[dateStr][name]) {
        const cover = d.covers[dateStr][name];
        let coverName = '';
        if (typeof cover === 'string') {
          coverName = cover;
          hasActiveCover = true;
        } else if (typeof cover === 'object') {
          const taskCover = pickTaskCover(cover, taskKey);
          if (taskCover) {
            if (typeof taskCover === 'string') {
              coverName = taskCover;
              hasActiveCover = true;
            } else if (typeof taskCover === 'object') {
              if (location === 'tp' && taskCover.tp) {
                coverName = taskCover.tp;
                hasActiveCover = true;
              } else if (location === 'ds' && taskCover.ds) {
                coverName = taskCover.ds;
                hasActiveCover = true;
              } else if (!location && taskCover.tp && taskCover.ds) {
                const tpCls = personCls(taskCover.tp);
                const dsCls = personCls(taskCover.ds);
                coverSuffix = `<span class="cover-arrow">→</span><span class="cover-loc">(北)</span><span class="person ${tpCls}">${taskCover.tp}</span><span class="cover-loc is-second">(淡)</span><span class="person ${dsCls}">${taskCover.ds}</span>`;
                hasActiveCover = true;
              }
            }
          }
        }
        if (coverName) {
          const coverCls = personCls(coverName);
          coverSuffix = `<span class="cover-arrow">→</span><span class="person ${coverCls}">${coverName}</span>`;
        }
      }

      if (d && d.leaves && d.leaves[name] && d.leaves[name].includes(dateStr)) {
        isCovered = true;
      }
    }
    
    let finalHtml = baseHtml;
    if (isCovered) {
      finalHtml = `<span class="person ${cls} is-replaced">${name}</span><span class="leave-tag">(休)</span>${coverSuffix}`;
    } else if (hasActiveCover) {
      finalHtml = `<span class="person ${cls} is-replaced">${name}</span>${coverSuffix}`;
    }
    
    // 如果處於該區塊的請假代班編輯模式，且 name 是有效醫師，渲染 🔄 按鈕
    // 區塊鍵仍是 'angio'，但欄位的 taskKey 是 angio_dsa / angio_tae，故用備援鏈比對
    if (activeCoverSection && (taskKeyChain(taskKey).includes(activeCoverSection) || (activeCoverSection === 'sunday' && taskKey === 'sunday'))) {
      const cleanName = name.replace(/AM|PM/g, '').trim();
      const isValidDoc = PEOPLE.some(p => p.name === cleanName);
      if (isValidDoc) {
        const tDateVal = targetDate ? (typeof targetDate === 'string' ? targetDate : `${targetDate.getMonth()+1}/${targetDate.getDate()}`) : '';
        const escapedName = cleanName.replace(/'/g, "\\'");
        const escapedTask = taskKey ? taskKey.replace(/'/g, "\\'") : '';
        const escapedLoc = location ? location.replace(/'/g, "\\'") : '';
        const escapedDow = dow ? dow.replace(/'/g, "\\'") : '';
        
        finalHtml += `<span class="set-cover-btn" onclick="openCellCoverModal('${escapedTask}', '${escapedLoc}', '${escapedName}', '${tDateVal}', '${escapedDow}')" style="cursor:pointer; margin-left:4px; font-size:0.75rem; background:#eff6ff; border:1px solid #bfdbfe; padding:1px 4px; border-radius:3px; display:inline-block;" title="設定代班">🔄</span>`;
      }
    }
    
    return finalHtml;
  }

  // 姓名欄內嵌換班註記（如「黃俊肇8/11士揚」）：先攔截，避免被下方的 / 分隔邏輯切壞
  const inline = splitInlineAnnotation(raw);
  if (inline) {
    return formatName(inline.base) + inlineAnnotHtml(inline.annot);
  }

  if (raw.includes('AM') || raw.includes('PM')) {
    return raw
      .split('/')
      .map(seg => {
        seg = seg.trim();
        const m = seg.match(/^(AM|PM)\s+(.+)$/);
        if (m) {
          const name = m[2].trim();
          return `<span class="ampm-label">${m[1]}</span> ${formatName(name)}`;
        }
        return formatName(seg);
      })
      .join('<span class="name-sep">/</span>');
  }

  const parts = raw.split('/');
  if (parts.length >= 2) {
    const p1 = parts[0].trim();
    const p2 = parts[1].trim();
    if (showTraineeTag) {
      return formatName(p1)
           + `<span class="trainee-tag tag-learn">學</span>`
           + `<span class="name-sep">/</span>`
           + formatName(p2)
           + `<span class="trainee-tag tag-cover">Cover</span>`;
    } else {
      return `<span class="ampm-label">AM</span> ` + formatName(p1)
           + `<span class="name-sep">/</span>`
           + `<span class="ampm-label">PM</span> ` + formatName(p2);
    }
  }

  return formatName(raw);
}

function noteHtml(note) {
  if (!note) return '';
  return `<div class="note-tooltip-trigger" style="display: inline-flex; width: 18px; height: 18px; font-size: 0.72rem; margin-left: 4px; vertical-align: middle;">💬<span class="note-tooltip-text">${note}</span></div>`;
}

// ════════════════════════════════════════════════════
//  今日卡片渲染
// ════════════════════════════════════════════════════
function renderTodayCard(key) {
  const targetDate = getLogicalDate();
  let titleText = '今日分配';
  if (todayCardTab === 'tomorrow') {
    targetDate.setDate(targetDate.getDate() + 1);
    titleText = '明日預覽';
  } else if (todayCardTab === 'custom' && todayCardCustomDate) {
    targetDate.setTime(todayCardCustomDate.getTime());
    titleText = '指定分配';
  }

  const targetKey = `${targetDate.getFullYear()}-${String(targetDate.getMonth()+1).padStart(2,'0')}`;
  const a = getTodayAssignments(targetKey, targetDate);

  // 日期標籤不依賴 a，這樣即使該月份尚未建班表也能正常顯示標題與日期切換鈕
  const dateLabel = `${targetDate.getFullYear()}/${String(targetDate.getMonth()+1).padStart(2,'0')}/${String(targetDate.getDate()).padStart(2,'0')} （週${DOW_NAMES_TW[targetDate.getDay()]}）`;

  const d = NI_DATA[targetKey];
  const dateStr = a ? `${a.month}/${a.day}` : `${targetDate.getMonth()+1}/${targetDate.getDate()}`;

  const card = document.createElement('div');
  card.className = 'today-card';

  const isTodayActive = todayCardTab === 'today';
  const isTomorrowActive = todayCardTab === 'tomorrow';
  const isCustomActive = todayCardTab === 'custom';

  const bgToday = isTodayActive ? '#ffffff' : 'transparent';
  const colorToday = isTodayActive ? 'var(--primary-color)' : '#64748b';
  const shadowToday = isTodayActive ? '0 1px 2px rgba(0,0,0,0.05)' : 'none';
  
  const bgTomorrow = isTomorrowActive ? '#ffffff' : 'transparent';
  const colorTomorrow = isTomorrowActive ? 'var(--primary-color)' : '#64748b';
  const shadowTomorrow = isTomorrowActive ? '0 1px 2px rgba(0,0,0,0.05)' : 'none';

  const bgCustom = isCustomActive ? '#ffffff' : 'transparent';
  const colorCustom = isCustomActive ? 'var(--primary-color)' : '#64748b';
  const shadowCustom = isCustomActive ? '0 1px 2px rgba(0,0,0,0.05)' : 'none';
  
  let customBtnLabel = '指定日期';
  if (isCustomActive && todayCardCustomDate) {
    customBtnLabel = `📅 ${todayCardCustomDate.getMonth() + 1}/${todayCardCustomDate.getDate()}`;
  } else {
    customBtnLabel = '📅 指定日期';
  }

  const status = getAutoFilterStatus(targetDate);
  let statusBadge = '';
  if (status === 'evt_only') {
    statusBadge = `<span style="font-size:0.7rem; background:#fee2e2; color:#ef4444; padding:2px 8px; border-radius:12px; font-weight:600; display:inline-flex; align-items:center; gap:4px; margin-left: 6px; vertical-align: middle;">🌙 On-Call 時段</span>`;
  } else if (status === 'daytime_only') {
    statusBadge = `<span style="font-size:0.7rem; background:#fef3c7; color:#d97706; padding:2px 8px; border-radius:12px; font-weight:600; display:inline-flex; align-items:center; gap:4px; margin-left: 6px; vertical-align: middle;">☀️ 白天值班時段</span>`;
  } else {
    statusBadge = `<span style="font-size:0.7rem; background:#e2e8f0; color:#475569; padding:2px 8px; border-radius:12px; font-weight:600; display:inline-flex; align-items:center; gap:4px; margin-left: 6px; vertical-align: middle;">🕒 自動篩選：關</span>`;
  }

  let headerHtml = `
    <div class="today-card-header" style="display:flex; justify-content:space-between; align-items:center; width:100%; flex-wrap:wrap; gap:10px; margin-bottom:14px;">
      <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
        <h2>📅 ${titleText}</h2>
        <span class="today-date-badge">${dateLabel}</span>${statusBadge}
      </div>
      <div style="display:flex; gap:2px; background:#f1f5f9; padding:2px; border-radius:6px; border:1px solid #e2e8f0; align-items:center; height: 28px;">
        <button onclick="setTodayTab('today')" style="padding:3px 10px; font-size:0.75rem; border-radius:4px; border:none; font-weight:600; cursor:pointer; transition:all 0.15s; background:${bgToday}; color:${colorToday}; box-shadow:${shadowToday}; height:100%;">今日</button>
        <button onclick="setTodayTab('tomorrow')" style="padding:3px 10px; font-size:0.75rem; border-radius:4px; border:none; font-weight:600; cursor:pointer; transition:all 0.15s; background:${bgTomorrow}; color:${colorTomorrow}; box-shadow:${shadowTomorrow}; height:100%;">明日</button>
        <div style="position:relative; display:flex; align-items:center; height:100%;">
          <button onclick="const p = document.getElementById('todayCardDatePicker'); if (p && typeof p.showPicker === 'function') { p.showPicker(); } else if (p) { p.click(); }" style="padding:3px 10px; font-size:0.75rem; border-radius:4px; border:none; font-weight:600; cursor:pointer; transition:all 0.15s; background:${bgCustom}; color:${colorCustom}; box-shadow:${shadowCustom}; height:100%; white-space:nowrap; z-index: 1;">${customBtnLabel}</button>
          <input type="date" id="todayCardDatePicker" onchange="onCustomDateChange(this.value)" style="position:absolute; top:0; left:0; width:100%; height:100%; opacity:0; pointer-events:none; z-index: -1; margin: 0; padding: 0; border: none;">
        </div>
      </div>
    </div>`;

  let toggleHtml = `
    <div style="display:flex; align-items:center; justify-content:flex-end; width:100%; margin-top:-8px; margin-bottom:10px; font-size:0.75rem; color:#64748b; gap:6px;">
      <label style="display:inline-flex; align-items:center; cursor:pointer; gap:6px; user-select:none;">
        <input type="checkbox" id="autoFilterToggle" ${autoFilterTime ? 'checked' : ''} onchange="toggleAutoFilter(this.checked)" style="cursor:pointer; width:14px; height:14px; margin:0; vertical-align:middle;">
        <span style="vertical-align:middle;">🕒 依目前時間自動切換時段班表</span>
      </label>
    </div>`;

  // 該月份尚未建立班表：顯示提示，而不是整張卡片消失
  // （「今日精簡」模式下月份切換列是隱藏的，若這裡回傳 null 會變成整頁空白）
  if (!a) {
    card.innerHTML = headerHtml + `
      <div class="today-empty-notice">
        <div class="today-empty-title">⚠️ 尚未建立 ${targetKey} 的班表資料</div>
        <div class="today-empty-desc">
          請由右上角「⚙️ 管理設定 → ➕ 建立新月份班表」新增，或用上方的「今日 / 明日 / 指定日期」切換到其他日期。
        </div>
      </div>`;
    return card;
  }

  card.innerHTML = headerHtml + toggleHtml;

  const year = targetDate.getFullYear();
  const month = targetDate.getMonth() + 1;
  const day = targetDate.getDate();
  const dateStrShort = `${month}/${day}`;
  const isHoliday = d && d.holidays && d.holidays.includes(dateStrShort);

  // ── Sunday / Holiday ──
  if (a.isSunday || isHoliday) {
    let sunHtml = '';
    if (a.isSunday && status !== 'evt_only') {
      sunHtml += `<div style="display:flex; gap:12px; flex-wrap:wrap; margin-top:5px; padding:10px 0; justify-content:center;">`;
      if (a.sunMri) {
        const formattedPerson = renderPerson(a.sunMri.person, true, targetDate);
        sunHtml += `
          <div class="today-sat-card" style="min-width:200px;">
            <div class="today-sat-label">週日 MRI 加班</div>
            <div class="today-sat-person">${formattedPerson}</div>
          </div>`;
      } else {
        sunHtml += `
          <div class="today-sat-card" style="min-width:200px;">
            <div class="today-sat-label">週日 MRI 加班</div>
            <div style="color:var(--text-sub);font-size:0.88rem;text-align:center;padding:10px 0;">無加班資料</div>
          </div>`;
      }
      sunHtml += `</div>`;
    } else {
      sunHtml += `<div style="padding:10px 0; text-align:center; color:var(--text-sub); font-size:0.88rem; font-weight:600;">☕ 週日常規日班休假 / 醫院休假日</div>`;
    }

    if (a.evtDoctor && status !== 'daytime_only') {
      const formattedEvt = renderPerson(a.evtDoctor, true, targetDate);
      sunHtml += `
        <div style="display:flex; justify-content:center; margin-top:10px;">
          <div class="today-sat-card" style="min-width:200px;">
            <div class="today-sat-label">中風取栓 On-Call (24H)</div>
            <div class="today-sat-person">${formattedEvt}</div>
          </div>
        </div>`;
    }
    card.innerHTML += sunHtml;
    return card;
  }

  // ── Non-office hours (evt_only) ──
  if (status === 'evt_only') {
    let noticeHtml = `
      <div style="padding:12px; border-radius:8px; background:#f8fafc; border:1px solid #e2e8f0; text-align:center; color:#64748b; font-size:0.82rem; font-weight:500; margin-bottom:14px; display:flex; align-items:center; justify-content:center; gap:6px;">
        <span>🌙 目前為非上班時間，僅顯示中風取栓 On-Call 人員</span>
      </div>`;
    if (a.evtDoctor) {
      const formattedEvt = renderPerson(a.evtDoctor, true, targetDate);
      noticeHtml += `
        <div style="display:flex; justify-content:center; margin-top:10px; margin-bottom: 10px;">
          <div class="today-sat-card" style="min-width:200px;">
            <div class="today-sat-label">中風取栓 On-Call (24H)</div>
            <div class="today-sat-person">${formattedEvt}</div>
          </div>
        </div>`;
    } else {
      noticeHtml += `<div style="text-align:center; color:var(--text-sub); font-size:0.88rem; padding:15px 0;">今日無 On-Call 人員資料</div>`;
    }
    card.innerHTML += noticeHtml;
    return card;
  }

  // ── Saturday ──
  if (a.isSat) {
    let satHtml = `<div style="display:flex; gap:12px; flex-wrap:wrap; margin-top:5px; padding:10px 0;">`;
    if (a.sat) {
      const formattedPerson = renderPerson(a.sat.person, true, targetDate);
      satHtml += `
        <div class="today-sat-card">
          <div class="today-sat-label">週六班（北淡 MRI + 急 CT）</div>
          <div class="today-sat-person">${formattedPerson}</div>
        </div>`;
    } else {
      satHtml += `<div class="today-sat-card"><div class="today-sat-label">週六班</div><div style="color:var(--text-sub);font-size:0.88rem">無資料</div></div>`;
    }
    
    if (a.evtDoctor && status !== 'daytime_only') {
      const formattedEvt = renderPerson(a.evtDoctor, true, targetDate);
      satHtml += `
        <div class="today-sat-card">
          <div class="today-sat-label">中風取栓 On-Call (24H)</div>
          <div class="today-sat-person">${formattedEvt}</div>
        </div>`;
    }
    satHtml += `</div>`;
    card.innerHTML += satHtml;
    return card;
  }

  // ── Today's Doctor Tasks Overview ──
  const doctorTasks = getDoctorTasksForToday(a);
  let overviewHtml = '';
  const docNames = Object.keys(doctorTasks);

  // Filter active doctors based on the selected time-mode
  const activeDocs = docNames.filter(name => {
    const info = doctorTasks[name];
    let filtered = info.tasks;
    if (status === 'evt_only') {
      filtered = info.tasks.filter(t => t.includes('中風取栓') || t.includes('On-Call'));
    } else if (status === 'daytime_only') {
      filtered = info.tasks.filter(t => !(t.includes('中風取栓') || t.includes('On-Call')));
    }
    return filtered.length > 0;
  });

  if (activeDocs.length > 0) {
    overviewHtml += `<div style="margin-bottom: 20px;">
      <div style="font-size: 0.82rem; font-weight: 800; color: var(--primary-color); margin-bottom: 10px;">👤 今日醫師任務總覽 (Task Overview)</div>
      <div class="today-doctors-grid">`;
    activeDocs.forEach(name => {
      const info = doctorTasks[name];
      const pc = personCls(name);
      
      let cardStyle = '';
      let badgeHtml = '';
      
      if (info.isOnLeave) {
        cardStyle = ' style="opacity: 0.6; border-color: #fca5a5; background: #fff5f5;"';
        // 有代班的工作已在 getDoctorTasksForToday 轉給代班醫師，
        // 因此還留在休假醫師清單裡的，就是沒人代的工作。
        // （原本只看「當天有沒有任何一筆代班」，只要有一筆就不提醒，
        //   因此「有 DSA 沒 TAE」這種部分遺漏會被漏掉。）
        const isMissingCover = info.tasks.length > 0;
        badgeHtml = isMissingCover
          ? ' <span style="font-size: 0.65rem; background: #dc2626; color: white; padding: 1px 5px; border-radius: 4px; margin-left: 5px; font-weight: 800; vertical-align: middle;">⚠️ 漏代班</span>'
          : ' <span style="font-size: 0.65rem; background: #ef4444; color: white; padding: 1px 5px; border-radius: 4px; margin-left: 5px; font-weight: 800; vertical-align: middle;">✈️ 休假</span>';
      }
      
      overviewHtml += `
        <div class="today-doctor-card"${cardStyle}>
          <div class="today-doctor-name">
            <span class="person ${pc}">${name}</span>${badgeHtml}
          </div>
          <div class="today-doctor-task-list">`;
      
      // Filter tasks to show
      let filteredTasks = info.tasks;
      if (status === 'evt_only') {
        filteredTasks = info.tasks.filter(t => t.includes('中風取栓') || t.includes('On-Call'));
      } else if (status === 'daytime_only') {
        filteredTasks = info.tasks.filter(t => !(t.includes('中風取栓') || t.includes('On-Call')));
      }

      if (info.isOnLeave) {
        if (filteredTasks.length > 0) {
          filteredTasks.forEach(task => {
            const warningSuffix = ' <span style="color:#dc2626; font-weight:800; font-size:0.65rem;">(無代班)</span>';
            overviewHtml += `<div class="today-doctor-task-item" style="text-decoration: line-through; opacity: 0.7; border-left-color: #ef4444;">${task}${warningSuffix}</div>`;
          });
        } else {
          overviewHtml += `<div style="font-size: 0.72rem; color: #94a3b8; font-style: italic; padding: 2px 6px;">今日無常規任務</div>`;
        }
      } else {
        if (filteredTasks.length > 0) {
          filteredTasks.forEach(task => {
            overviewHtml += `<div class="today-doctor-task-item">${task}</div>`;
          });
        } else {
          overviewHtml += `<div style="font-size: 0.72rem; color: #94a3b8; font-style: italic; padding: 2px 6px;">今日無常規任務</div>`;
        }
      }
      
      overviewHtml += `</div>
        </div>`;
    });
    overviewHtml += `</div></div>`;
  }
  card.innerHTML += overviewHtml;

  // ── Weekday grid ──
  const rows = [];

  if (a.angio) {
    rows.push({ label: '血管攝影室 DSA', tp: renderPerson(a.angio.tp_dsa, true, targetDate, 'angio_dsa', 'tp'), ds: renderPerson(a.angio.ds_dsa, true, targetDate, 'angio_dsa', 'ds'), note: a.angio.note });
    rows.push({ label: '血管攝影室 TAE', tp: renderPerson(a.angio.tp_tae, true, targetDate, 'angio_tae', 'tp'), ds: renderPerson(a.angio.ds_tae, true, targetDate, 'angio_tae', 'ds') });
  }
  if (a.erct) {
    rows.push({ label: '急診 CT', tp: renderPerson(a.erct.tp, true, targetDate, 'erct', 'tp'), ds: renderPerson(a.erct.ds, true, targetDate, 'erct', 'ds'), note: a.erct.note });
  }
  if (a.mri_tp || a.mri_ds) {
    rows.push({
      label: `門住急 MRI`,
      tp: a.mri_tp ? renderPerson(a.mri_tp.person, false, targetDate, 'mri', 'tp') : '—',
      ds: a.mri_ds ? renderPerson(a.mri_ds.person, false, targetDate, 'mri', 'ds') : '—',
    });
  }
  if (a.ds_mri) {
    rows.push({ label: '淡水神經 MRI 解釋', tp: '—', ds: renderPerson(a.ds_mri.person, true, targetDate, 'ds_mri', 'ds'), note: a.ds_mri.note });
  }
  if (a.picc) {
    rows.push({ label: 'PICC', tp: renderPerson(a.picc.tp, true, targetDate, 'picc', 'tp'), ds: renderPerson(a.picc.ds, true, targetDate, 'picc', 'ds'), note: a.picc.note });
  }
  if (a.evtDoctor && status !== 'daytime_only') {
    rows.push({ label: '中風取栓 On-Call', tp: renderPerson(a.evtDoctor, true, targetDate, 'evt', 'tp'), ds: '—' });
  }

  let gridHtml = `<div class="today-grid">`;
  gridHtml += `<div class="today-grid-row today-grid-col-header">
    <div></div>
    <div><span class="loc loc-tp">台北</span></div>
    <div><span class="loc loc-ds">淡水</span></div>
  </div>`;
  rows.forEach(r => {
    gridHtml += `<div class="today-grid-row">
      <div>${r.label}</div>
      <div>${r.tp}</div>
      <div>${r.ds}</div>
    </div>`;
  });
  gridHtml += `</div>`;

  // CT number pills
  if (a.routine_ct && a.routine_ct.length) {
    gridHtml += `<div style="margin-top:10px;">
      <div style="font-size:0.72rem;font-weight:700;color:var(--text-sub);margin-bottom:5px;">門住 CT 號碼分配</div>
      <div class="today-ct-pills">`;
    a.routine_ct.forEach(r => {
      const formattedPerson = renderPerson(r.person, true, targetDate, 'routine_ct', 'all', null);
      gridHtml += `<span class="today-ct-pill">${formattedPerson} 台北 ${r.tp} / 淡水 ${r.ds}</span>`;
    });
    gridHtml += `</div></div>`;
  }

  card.innerHTML += gridHtml;
  return card;
}

// ════════════════════════════════════════════════════
//  日班工作分配 Tab 渲染
// ════════════════════════════════════════════════════
// ────────────────────────────────────────────────
//  整月代班缺口稽核
// ────────────────────────────────────────────────
// 有代班的工作會在 getDoctorTasksForToday 中轉給代班醫師，所以「還留在
// 休假醫師清單裡的工作」就是沒人代的。這裡沿用同一套判斷逐日掃描整個月，
// 避免管理者得一天一天點過去才發現漏設。
function findMonthCoverGaps(key) {
  const d = NI_DATA[key];
  if (!d || !d.leaves || Object.keys(d.leaves).length === 0) return [];

  const [y, m] = key.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const gaps = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const a = getTodayAssignments(key, new Date(y, m - 1, day));
    if (!a) continue;
    const doctorTasks = getDoctorTasksForToday(a);
    Object.keys(doctorTasks).forEach(name => {
      const info = doctorTasks[name];
      if (info.isOnLeave && info.tasks.length > 0) {
        gaps.push({ date: `${m}/${day}`, name, tasks: info.tasks.slice() });
      }
    });
  }
  return gaps;
}

// ── 缺口的「忽略」狀態 ──
// 有些缺口是正常的（備註限定的代班日期範圍之外、學／Cover 欄位等），
// 每次開啟都跳紅色提醒反而變成雜訊，因此可逐筆忽略。
// 已登入時寫入雲端，讓這份判斷對所有人一致；未登入則僅存在本機瀏覽器。
let showIgnoredGaps = false;

function gapKey(g) {
  // 工作內容變動時 key 會跟著變，缺口會重新浮現，避免舊的忽略掩蓋新問題
  return `${g.date}|${g.name}|${g.tasks.join('、')}`;
}

function ignoredGapsStorageKey(monthKey) {
  return `scheduleIgnoredGaps:${monthKey}`;
}

function getLocalIgnoredGaps(monthKey) {
  try {
    const raw = localStorage.getItem(ignoredGapsStorageKey(monthKey));
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function getIgnoredGaps(monthKey) {
  const cloud = (NI_DATA[monthKey] && NI_DATA[monthKey].ignoredGaps) || [];
  return new Set([...cloud, ...getLocalIgnoredGaps(monthKey)]);
}

window.toggleGapIgnored = function(encodedKey, ignore) {
  const key = decodeURIComponent(encodedKey);
  const monthKey = MONTH_KEYS[currentIdx];

  // 本機一律記錄，未登入也能用
  const local = getLocalIgnoredGaps(monthKey).filter(k => k !== key);
  if (ignore) local.push(key);
  try {
    localStorage.setItem(ignoredGapsStorageKey(monthKey), JSON.stringify(local));
  } catch (e) {}

  // 已登入則一併寫回雲端
  if (currentUser && getDb()) {
    if (!NI_DATA[monthKey]) NI_DATA[monthKey] = {};
    const cloudList = (NI_DATA[monthKey].ignoredGaps || []).filter(k => k !== key);
    if (ignore) cloudList.push(key);
    NI_DATA[monthKey].ignoredGaps = cloudList;
    db.collection("schedules").doc(monthKey).update({ "ni.ignoredGaps": cloudList })
      .catch(err => console.warn("[IgnoredGaps] 雲端同步失敗，已保留本機設定:", err));
  }
  render();
};

window.toggleShowIgnoredGaps = function() {
  showIgnoredGaps = !showIgnoredGaps;
  render();
};

function renderCoverGapBanner(key) {
  const allGaps = findMonthCoverGaps(key);
  if (allGaps.length === 0) return null;

  const ignored = getIgnoredGaps(key);
  const active = allGaps.filter(g => !ignored.has(gapKey(g)));
  const hidden = allGaps.filter(g => ignored.has(gapKey(g)));

  const banner = document.createElement('div');

  // 全部都忽略掉時只留一行極簡提示，不再用紅色橫幅打擾
  if (active.length === 0 && !showIgnoredGaps) {
    banner.className = 'cover-gap-muted full-width';
    banner.innerHTML = `✔️ 本月代班無缺口（已忽略 ${hidden.length} 筆）
      <button type="button" class="cover-gap-link" onclick="toggleShowIgnoredGaps()">檢視</button>`;
    return banner;
  }

  const row = (g, isIgnored) => `
    <div class="cover-gap-item${isIgnored ? ' ignored' : ''}">
      <strong>${g.date}</strong>
      <span class="person ${personCls(g.name)}">${g.name}</span>
      <span class="cover-gap-tasks">${g.tasks.join('、')}</span>
      <button type="button" class="cover-gap-ignore"
        onclick="toggleGapIgnored('${encodeURIComponent(gapKey(g))}', ${!isIgnored})">${isIgnored ? '↩︎ 取消忽略' : '✕ 忽略'}</button>
    </div>`;

  banner.className = 'cover-gap-banner full-width';
  if (active.length === 0) banner.classList.add('resolved');

  const toggleBtn = hidden.length > 0
    ? `<button type="button" class="cover-gap-link" onclick="toggleShowIgnoredGaps()">${showIgnoredGaps ? `收合已忽略的 ${hidden.length} 筆` : `顯示已忽略的 ${hidden.length} 筆`}</button>`
    : '';

  const scopeHint = currentUser
    ? '忽略設定會同步至雲端，所有人看到的結果一致。'
    : '未登入，忽略設定僅保存在這台裝置的瀏覽器。';

  banner.innerHTML = `
    <div class="cover-gap-title">${active.length > 0
      ? `⚠️ 本月有 ${active.length} 筆請假工作尚未指派代班`
      : '✔️ 本月代班無缺口'}</div>
    ${active.length ? `<div class="cover-gap-list">${active.map(g => row(g, false)).join('')}</div>` : ''}
    ${showIgnoredGaps && hidden.length
      ? `<div class="cover-gap-list cover-gap-hidden-list">${hidden.map(g => row(g, true)).join('')}</div>`
      : ''}
    <div class="cover-gap-foot">
      <span class="cover-gap-hint">若該項工作本來就由原醫師自理（例如備註限定的代班日期範圍之外），可按「忽略」隱藏。${scopeHint}</span>
      ${toggleBtn}
    </div>`;
  return banner;
}

function renderNiTab(d) {
  const root = document.getElementById('ni-sections');
  root.innerHTML = '';

  const gapBanner = renderCoverGapBanner(MONTH_KEYS[currentIdx]);
  if (gapBanner) root.appendChild(gapBanner);

  root.appendChild(renderAngio(d.angio));
  root.appendChild(renderErCt(d.erct));
  root.appendChild(renderRoutineCt(d.routine_ct));
  root.appendChild(renderMri(d.mri));
  root.appendChild(renderDsMriDaily(d.ds_mri_daily));
  root.appendChild(renderSaturday(d.saturday));
  root.appendChild(renderSundayMri(d.mri_sunday));
  if (d.picc) root.appendChild(renderPicc(d.picc));
  root.appendChild(renderNotes(d.notes || ''));
  root.appendChild(renderLeavesAndCoversEditorSection(d));
}

let activeCoverSection = null;
let isLeavesCoversExpanded = false;

function makeSection(icon, title, cls='', sectionKey=null) {
  const div = document.createElement('div');
  div.className = 'section-card' + (cls ? ' ' + cls : '');
  const h = document.createElement('div');
  h.className = 'section-title';
  
  if (sectionKey && currentUser) {
    h.className = 'section-title section-header';
    let btnHtml = '';
    const supportCoverSections = ['angio', 'erct', 'mri', 'ds_mri', 'picc', 'routine_ct'];
    
    if (activeEditSection === null && activeCoverSection === null) {
      const editBtn = `<button class="section-edit-btn" onclick="startSectionEdit('${sectionKey}')">✏️ 編輯</button>`;
      const coverBtn = supportCoverSections.includes(sectionKey)
        ? `<button class="section-edit-btn" onclick="enterSectionCover('${sectionKey}')" style="background:#f0fdf4; border-color:#bbf7d0; color:#16a34a;">🔄 設定代班</button>`
        : '';
      btnHtml = `<div style="display:flex; gap:6px;">${editBtn}${coverBtn}</div>`;
    } else if (activeEditSection === sectionKey) {
      btnHtml = `
        <div style="display:flex; gap:6px;">
          <button class="section-edit-save-btn" onclick="saveSectionEdit('${sectionKey}')">💾 儲存</button>
          <button class="section-edit-cancel-btn" onclick="cancelSectionEdit()">❌ 取消</button>
        </div>`;
    } else if (activeCoverSection === sectionKey) {
      btnHtml = `<button class="section-edit-cancel-btn" style="background:#ef4444; color:white; border:none;" onclick="exitSectionCover()">❌ 取消</button>`;
    }
    h.innerHTML = `<span>${icon} ${title}</span>${btnHtml}`;
  } else {
    h.textContent = `${icon} ${title}`;
  }
  
  div.appendChild(h);
  return div;
}

function makeEditSelect(id, currentValue) {
  let opts = CORE_DOCTORS.map(name => `<option value="${name}" ${name === currentValue ? 'selected' : ''}>${name}</option>`).join('');
  if (currentValue && !CORE_DOCTORS.includes(currentValue)) {
    opts += `<option value="${currentValue}" selected>${currentValue}</option>`;
  }
  return `<select id="${id}" style="width:100%; font-size:0.8rem; padding:2px;"><option value="">-</option>${opts}</select>`;
}

function makeEditInput(id, currentValue) {
  return `<input type="text" id="${id}" value="${currentValue || ''}" style="width:100%; font-size:0.8rem; padding:2px; box-sizing:border-box;">`;
}

window.onCoverModeChange = function(selectEl) {
  const row = selectEl.closest('tr');
  const mode = selectEl.value;
  const singleContainer = row.querySelector('.cover-single-container');
  const advancedContainer = row.querySelector('.cover-advanced-container');
  if (mode === 'single') {
    if (singleContainer) singleContainer.style.display = 'block';
    if (advancedContainer) advancedContainer.style.display = 'none';
  } else {
    if (singleContainer) singleContainer.style.display = 'none';
    if (advancedContainer) advancedContainer.style.display = 'flex';
  }
};

window.addVisualCoverRow = function(date = '', absent = '', taskKey = 'all', mode = 'single', tpVal = '', dsVal = '') {
  const tbody = document.getElementById('visual-covers-tbody');
  if (!tbody) return;
  
  let absentOpts = CORE_DOCTORS.map(docName => `<option value="${docName}" ${docName === absent ? 'selected' : ''}>${docName}</option>`).join('');
  if (absent && !CORE_DOCTORS.includes(absent)) {
    absentOpts += `<option value="${absent}" selected>${absent}</option>`;
  }

  let singleOpts = CORE_DOCTORS.map(docName => `<option value="${docName}" ${docName === tpVal && mode === 'single' ? 'selected' : ''}>${docName}</option>`).join('');
  if (tpVal && mode === 'single' && !CORE_DOCTORS.includes(tpVal)) {
    singleOpts += `<option value="${tpVal}" selected>${tpVal}</option>`;
  }

  let tpOpts = CORE_DOCTORS.map(docName => `<option value="${docName}" ${docName === tpVal && mode === 'advanced' ? 'selected' : ''}>${docName}</option>`).join('');
  if (tpVal && mode === 'advanced' && !CORE_DOCTORS.includes(tpVal)) {
    tpOpts += `<option value="${tpVal}" selected>${tpVal}</option>`;
  }

  let dsOpts = CORE_DOCTORS.map(docName => `<option value="${docName}" ${docName === dsVal && mode === 'advanced' ? 'selected' : ''}>${docName}</option>`).join('');
  if (dsVal && mode === 'advanced' && !CORE_DOCTORS.includes(dsVal)) {
    dsOpts += `<option value="${dsVal}" selected>${dsVal}</option>`;
  }

  const tr = document.createElement('tr');
  const dateInput = `<input type="text" class="cover-date-input" value="${date}" placeholder="如: 7/17" style="width:90%; padding:4px 8px; border:1px solid #cbd5e1; border-radius:4px; font-size:0.8rem; box-sizing:border-box;">`;
  const absentSelect = `
    <select class="cover-absent-select" style="width:95%; padding:4px; border:1px solid #cbd5e1; border-radius:4px; font-size:0.8rem;">
      <option value="">-</option>
      ${absentOpts}
    </select>`;
    
  const taskOptionsHtml = Object.keys(TASK_NAMES)
    .map(k => `<option value="${k}" ${k === taskKey ? 'selected' : ''}>${TASK_NAMES[k]}</option>`).join('');
  
  const taskSelect = `
    <select class="cover-task-select" style="width:95%; padding:4px; border:1px solid #cbd5e1; border-radius:4px; font-size:0.8rem;">
      ${taskOptionsHtml}
    </select>`;
    
  const modeSelect = `
    <select class="cover-mode-select" onchange="onCoverModeChange(this)" style="width:95%; padding:4px; border:1px solid #cbd5e1; border-radius:4px; font-size:0.8rem;">
      <option value="single" ${mode === 'single' ? 'selected' : ''}>單人代班</option>
      <option value="advanced" ${mode === 'advanced' ? 'selected' : ''}>指定分院區</option>
    </select>`;
  const singleSelect = `
    <div class="cover-single-container" style="display:${mode === 'single' ? 'block' : 'none'};">
      <select class="cover-single-select" style="width:95%; padding:4px; border:1px solid #cbd5e1; border-radius:4px; font-size:0.8rem;">
        <option value="">-</option>
        ${singleOpts}
      </select>
    </div>`;
  const advancedSelect = `
    <div class="cover-advanced-container" style="display:${mode === 'advanced' ? 'flex' : 'none'}; gap:4px; align-items:center; flex-wrap:wrap;">
      <span style="font-size:0.7rem; color:#64748b;">北:</span>
      <select class="cover-tp-select" style="padding:2px 4px; border:1px solid #cbd5e1; border-radius:4px; font-size:0.75rem; min-width:60px;">
        <option value="">-</option>
        ${tpOpts}
      </select>
      <span style="font-size:0.7rem; color:#64748b; margin-left:4px;">淡:</span>
      <select class="cover-ds-select" style="padding:2px 4px; border:1px solid #cbd5e1; border-radius:4px; font-size:0.75rem; min-width:60px;">
        <option value="">-</option>
        ${dsOpts}
      </select>
    </div>`;
  const deleteBtn = `<button type="button" class="covers-delete-btn" onclick="this.closest('tr').remove()">🗑️ 刪除</button>`;
  
  tr.innerHTML = `
    <td>${dateInput}</td>
    <td>${absentSelect}</td>
    <td>${taskSelect}</td>
    <td>${modeSelect}</td>
    <td>${singleSelect}${advancedSelect}</td>
    <td style="text-align:center;">${deleteBtn}</td>`;
  tbody.appendChild(tr);
};

function renderLeavesAndCoversEditorSection(d) {
  const editing = isSectionEditing('leaves_covers');
  const taskNames = TASK_NAMES;
  
  // 1. 唯讀預覽模式
  if (!editing) {
    const sec = makeSection('⚙️', '請假與代班明細總覽', 'full-width', 'leaves_covers');
    
    // 建立展開/收合按鈕
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'toggle-collapse-btn';
    toggleBtn.style.cssText = `
      width: 100%;
      padding: 10px;
      margin-top: 8px;
      font-size: 0.85rem;
      font-weight: 700;
      border: 1px dashed #cbd5e1;
      border-radius: 8px;
      background: #f8fafc;
      color: #475569;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: all 0.2s;
    `;
    toggleBtn.onmouseover = () => {
      toggleBtn.style.background = '#f1f5f9';
      toggleBtn.style.borderColor = '#94a3b8';
    };
    toggleBtn.onmouseout = () => {
      toggleBtn.style.background = '#f8fafc';
      toggleBtn.style.borderColor = '#cbd5e1';
    };
    toggleBtn.innerHTML = isLeavesCoversExpanded ? '📁 收合請假與代班明細' : '📂 展開請假與代班明細';
    toggleBtn.onclick = () => {
      isLeavesCoversExpanded = !isLeavesCoversExpanded;
      render();
    };
    sec.appendChild(toggleBtn);

    const container = document.createElement('div');
    container.style.marginTop = '12px';
    container.style.padding = '16px';
    container.style.background = '#f8fafc';
    container.style.border = '1px solid #e2e8f0';
    container.style.borderRadius = '8px';
    container.style.fontSize = '0.85rem';
    container.style.display = isLeavesCoversExpanded ? 'block' : 'none';
    
    let activeLeavesHtml = '';
    let leaveCount = 0;
    if (d.leaves) {
      Object.keys(d.leaves).forEach(name => {
        const dates = d.leaves[name];
        if (dates && Array.isArray(dates) && dates.length > 0) {
          activeLeavesHtml += `<div style="padding:5px 10px; background:white; border:1px solid #e2e8f0; border-radius:6px; font-weight:600;"><span class="person ${personCls(name)}">${name}</span>：${dates.join(', ')}</div>`;
          leaveCount++;
        }
      });
    }
    if (leaveCount === 0) {
      activeLeavesHtml = `<div style="color:#94a3b8; font-style:italic;">本月無請假紀錄</div>`;
    }
    
    let activeCoversHtml = '';
    let coverCount = 0;
    if (d.covers) {
      Object.keys(d.covers).sort().forEach(dateStr => {
        const dayCovers = d.covers[dateStr];
        if (dayCovers && typeof dayCovers === 'object') {
          Object.keys(dayCovers).forEach(absentDoc => {
            const coverVal = dayCovers[absentDoc];
            let coverText = '';
            
            if (typeof coverVal === 'string') {
              coverText = `<span class="person ${personCls(coverVal)}">${coverVal}</span>`;
            } else if (typeof coverVal === 'object' && coverVal !== null) {
              const knownTasks = KNOWN_TASK_KEYS;
              const hasTaskKeys = Object.keys(coverVal).some(k => knownTasks.includes(k) || k === 'all');
              
              if (hasTaskKeys) {
                const taskParts = [];
                Object.keys(coverVal).forEach(tKey => {
                  const tVal = coverVal[tKey];
                  const tName = taskNames[tKey] || tKey;
                  let tText = '';
                  if (typeof tVal === 'string') {
                    tText = `<span class="person ${personCls(tVal)}">${tVal}</span>`;
                  } else if (typeof tVal === 'object' && tVal !== null) {
                    const subParts = [];
                    if (tVal.tp) subParts.push(`<span class="loc loc-tp">台北</span><span class="person ${personCls(tVal.tp)}">${tVal.tp}</span>`);
                    if (tVal.ds) subParts.push(`<span class="loc loc-ds">淡水</span><span class="person ${personCls(tVal.ds)}">${tVal.ds}</span>`);
                    tText = subParts.join('、');
                  }
                  taskParts.push(`<span style="background:#f1f5f9; padding:2px 6px; border-radius:4px; border:1px solid #cbd5e1; font-size:0.75rem; margin-right:4px; display:inline-block; margin-top:2px;">${tName}: ${tText}</span>`);
                });
                coverText = taskParts.join(' ');
              } else {
                const parts = [];
                if (coverVal.tp) parts.push(`<span class="loc loc-tp">台北</span><span class="person ${personCls(coverVal.tp)}">${coverVal.tp}</span>`);
                if (coverVal.ds) parts.push(`<span class="loc loc-ds">淡水</span><span class="person ${personCls(coverVal.ds)}">${coverVal.ds}</span>`);
                coverText = parts.join('、');
              }
            }
            
            activeCoversHtml += `<div style="padding:8px 12px; background:white; border:1px solid #e2e8f0; border-radius:6px; display:inline-flex; align-items:center; gap:6px; flex-wrap:wrap; width:100%; box-sizing:border-box;">
              <strong style="color:var(--primary-color); min-width:35px;">${dateStr}</strong>
              <span class="person ${personCls(absentDoc)}" style="text-decoration:line-through; opacity:0.6;">${absentDoc}</span>
              <span style="color:#94a3b8;">→</span>
              <div style="display:inline-flex; flex-wrap:wrap; gap:4px; align-items:center;">${coverText}</div>
            </div>`;
            coverCount++;
          });
        }
      });
    }
    if (coverCount === 0) {
      activeCoversHtml = `<div style="color:#94a3b8; font-style:italic;">本月無代班紀錄</div>`;
    }
    
    container.innerHTML = `
      <div style="margin-bottom:15px;">
        <div style="font-weight:700; color:#475569; margin-bottom:8px; font-size:0.82rem; display:flex; align-items:center; gap:4px;">✈️ 醫師請假日程：</div>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">${activeLeavesHtml}</div>
      </div>
      <div>
        <div style="font-weight:700; color:#475569; margin-bottom:8px; font-size:0.82rem; display:flex; align-items:center; gap:4px;">🔄 醫師代班明細：</div>
        <div style="display:flex; flex-direction:column; gap:6px;">${activeCoversHtml}</div>
      </div>`;
    sec.appendChild(container);
    return sec;
  }
  
  // 2. 編輯模式下的視覺化表格
  const sec = makeSection('⚙️', '請假與代班設定 (Leaves & Covers)', 'full-width', 'leaves_covers');
  const container = document.createElement('div');
  container.style.marginTop = '12px';
  container.style.padding = '16px';
  container.style.background = '#f1f5f9';
  container.style.border = '1px solid #cbd5e1';
  container.style.borderRadius = '8px';
  container.style.fontSize = '0.88rem';
  
  let leavesHtml = `<div style="margin-bottom: 20px;">
    <div style="font-weight:700; color:#475569; margin-bottom:8px;">醫師請假日期設定 (請輸入半形逗號分隔日期，如 7/17, 7/18)：</div>
    <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px;">`;
  
  PEOPLE.forEach(p => {
    const currentLeaves = d.leaves && d.leaves[p.name] ? d.leaves[p.name].join(', ') : '';
    leavesHtml += `<div style="display:flex; align-items:center; gap:8px; background:white; padding:6px 10px; border-radius:6px; border:1px solid #e2e8f0;">
      <span style="font-weight:700; min-width:60px;">${p.name}：</span>
      <input type="text" id="ni-leaves-${p.name}" value="${currentLeaves}" placeholder="如: 7/17, 7/18" style="flex:1; padding:4px 8px; border:1px solid #cbd5e1; border-radius:4px; font-size:0.8rem;">
    </div>`;
  });
  leavesHtml += `</div></div>`;
  
  const coversTableHtml = `<div>
    <div style="font-weight:700; color:#475569; margin-bottom:4px;">代班規則設定：</div>
    <div style="font-size:0.75rem; color:#64748b; margin-bottom:8px;">請填寫日期與請假人，並設定代班工作與代班醫師。代班模式支援「單人代班」或指定「台北/淡水」分院區。</div>
    <table class="covers-edit-table">
      <thead>
        <tr>
          <th style="width: 15%;">請假日期 (M/D)</th>
          <th style="width: 20%;">請假醫師</th>
          <th style="width: 20%;">代班工作</th>
          <th style="width: 15%;">代班模式</th>
          <th style="width: 25%;">代班設定</th>
          <th style="width: 5%; text-align:center;">操作</th>
        </tr>
      </thead>
      <tbody id="visual-covers-tbody">
      </tbody>
    </table>
    <button type="button" class="covers-edit-btn-add" onclick="addVisualCoverRow()">➕ 新增代班設定</button>
  </div>`;
  
  container.innerHTML = leavesHtml + coversTableHtml;
  sec.appendChild(container);
  
  // 載入當前代班資料。
  // 這裡是延後填入的（區塊要先掛進文件才抓得到 tbody），在填完之前
  // 表格是空的；getCoversFromVisualTable() 必須能分辨「還沒填」與「真的沒有代班」，
  // 否則這段空窗期若有人讀取，會把整個月的代班誤判成空的而清掉。
  setTimeout(() => {
    const tbody = document.getElementById('visual-covers-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (d.covers) {
      Object.keys(d.covers).forEach(dateStr => {
        const dayCovers = d.covers[dateStr];
        if (dayCovers && typeof dayCovers === 'object') {
          Object.keys(dayCovers).forEach(absentDoc => {
            const val = dayCovers[absentDoc];
            if (typeof val === 'string') {
              window.addVisualCoverRow(dateStr, absentDoc, 'all', 'single', val, '');
            } else if (typeof val === 'object' && val !== null) {
              const knownTasks = KNOWN_TASK_KEYS;
              const hasTaskKeys = Object.keys(val).some(k => knownTasks.includes(k) || k === 'all');
              
              if (hasTaskKeys) {
                Object.keys(val).forEach(tKey => {
                  const tVal = val[tKey];
                  if (typeof tVal === 'string') {
                    window.addVisualCoverRow(dateStr, absentDoc, tKey, 'single', tVal, '');
                  } else if (typeof tVal === 'object' && tVal !== null) {
                    window.addVisualCoverRow(dateStr, absentDoc, tKey, 'advanced', tVal.tp || '', tVal.ds || '');
                  }
                });
              } else {
                window.addVisualCoverRow(dateStr, absentDoc, 'all', 'advanced', val.tp || '', val.ds || '');
              }
            }
          });
        }
      });
    }
    // 標記已填入，這之後讀到的空表格才代表「本月確實沒有代班」
    tbody.dataset.populated = '1';
  }, 20);

  return sec;
}

function renderAngio(data) {
  const editing = isSectionEditing('angio');
  const sec = makeSection('🏥', '血管攝影室（神經介入）', 'full-width', 'angio');
  const t = document.createElement('table');
  t.className = 'ni-table';
  t.style.marginTop = '0';
  const noteColHeader = editing ? '<th style="width: 180px;">備注</th>' : '<th style="width: 55px;">💬</th>';
  t.innerHTML = `
    <thead><tr>
      <th style="width: 10%;">星期</th>
      <th style="width: 22.5%;"><span class="loc loc-tp">台北</span> DSA / IA</th>
      <th style="width: 22.5%;"><span class="loc loc-tp">台北</span> TAE</th>
      <th style="width: 22.5%;"><span class="loc loc-ds">淡水</span> DSA / IA</th>
      <th style="width: 22.5%;"><span class="loc loc-ds">淡水</span> TAE</th>
      ${noteColHeader}
    </tr></thead>
    <tbody></tbody>`;
  const tbody = t.querySelector('tbody');
  data.forEach((row, idx) => {
    const tr = document.createElement('tr');
    if (editing) {
      tr.innerHTML = `
        <td class="dow">${row.dow}</td>
        <td>${makeEditSelect(`ni-angio-${idx}-tp_dsa`, row.tp_dsa)}</td>
        <td>${makeEditInput(`ni-angio-${idx}-tp_tae`, row.tp_tae)}</td>
        <td>${makeEditSelect(`ni-angio-${idx}-ds_dsa`, row.ds_dsa)}</td>
        <td>${makeEditInput(`ni-angio-${idx}-ds_tae`, row.ds_tae)}</td>
        <td>${makeEditInput(`ni-angio-${idx}-note`, row.note)}</td>`;
    } else {
      tr.innerHTML = `
        <td class="dow">${row.dow}</td>
        <td>${renderPerson(row.tp_dsa, true, null, 'angio_dsa', 'tp', row.dow)}</td>
        <td>${renderPerson(row.tp_tae, true, null, 'angio_tae', 'tp', row.dow)}</td>
        <td>${renderPerson(row.ds_dsa, true, null, 'angio_dsa', 'ds', row.dow)}</td>
        <td>${renderPerson(row.ds_tae, true, null, 'angio_tae', 'ds', row.dow)}</td>
        <td class="ni-note-cell">${row.note ? `<div class="note-tooltip-trigger tooltip-right">💬<span class="note-tooltip-text">${row.note}</span></div>` : '—'}</td>`;
    }
    tbody.appendChild(tr);
  });
  
  const wrap = document.createElement('div');
  wrap.style.overflowX = 'auto';
  wrap.style.webkitOverflowScrolling = 'touch';
  wrap.style.marginTop = '12px';
  wrap.appendChild(t);
  sec.appendChild(wrap);
  return sec;
}

function renderErCt(data) {
  const editing = isSectionEditing('erct');
  const sec = makeSection('🚨', '急診 CT（Neuro ER CT）', '', 'erct');
  const t = document.createElement('table');
  t.className = 'ni-table';
  t.style.marginTop = '0';
  const noteColHeader = editing ? '<th style="width: 180px;">備注</th>' : '<th style="width: 55px;">💬</th>';
  t.innerHTML = `
    <thead><tr>
      <th style="width: 15%;">星期</th>
      <th style="width: 42.5%;"><span class="loc loc-tp">台北</span></th>
      <th style="width: 42.5%;"><span class="loc loc-ds">淡水</span></th>
      ${noteColHeader}
    </tr></thead><tbody></tbody>`;
  const tbody = t.querySelector('tbody');
  data.forEach((row, idx) => {
    const tr = document.createElement('tr');
    if (editing) {
      tr.innerHTML = `
        <td class="dow">${row.dow}</td>
        <td>${makeEditSelect(`ni-erct-${idx}-tp`, row.tp)}</td>
        <td>${makeEditSelect(`ni-erct-${idx}-ds`, row.ds)}</td>
        <td>${makeEditInput(`ni-erct-${idx}-note`, row.note)}</td>`;
    } else {
      tr.innerHTML = `
        <td class="dow">${row.dow}</td>
        <td>${renderPerson(row.tp, true, null, 'erct', 'tp', row.dow)}</td>
        <td>${renderPerson(row.ds, true, null, 'erct', 'ds', row.dow)}</td>
        <td class="ni-note-cell">${row.note ? `<div class="note-tooltip-trigger tooltip-right">💬<span class="note-tooltip-text">${row.note}</span></div>` : '—'}</td>`;
    }
    tbody.appendChild(tr);
  });

  const wrap = document.createElement('div');
  wrap.style.overflowX = 'auto';
  wrap.style.webkitOverflowScrolling = 'touch';
  wrap.style.marginTop = '12px';
  wrap.appendChild(t);
  sec.appendChild(wrap);
  return sec;
}

function renderRoutineCt(data) {
  const editing = isSectionEditing('routine_ct');
  const sec = makeSection('📋', '門住 CT 號碼分配', '', 'routine_ct');
  const t = document.createElement('table');
  t.className = 'ni-table';
  t.style.marginTop = '0';
  const noteColHeader = editing ? '<th style="width: 180px;">備注</th>' : '<th style="width: 55px;">💬</th>';
  t.innerHTML = `
    <thead><tr>
      <th style="width: 25%;">醫師</th>
      <th style="width: 37.5%;"><span class="loc loc-tp">台北</span> 號碼</th>
      <th style="width: 37.5%;"><span class="loc loc-ds">淡水</span> 號碼</th>
      ${noteColHeader}
    </tr></thead><tbody></tbody>`;
  const tbody = t.querySelector('tbody');
  data.forEach((row, idx) => {
    const tr = document.createElement('tr');
    if (editing) {
      tr.innerHTML = `
        <td>${renderPerson(row.person)}</td>
        <td>${makeEditInput(`ni-ct-${idx}-tp`, row.tp)}</td>
        <td>${makeEditInput(`ni-ct-${idx}-ds`, row.ds)}</td>
        <td>${makeEditInput(`ni-ct-${idx}-note`, row.note)}</td>`;
    } else {
      tr.innerHTML = `
        <td>${renderPerson(row.person, true, null, 'routine_ct', 'all', null)}</td>
        <td style="text-align:center;font-weight:600;">${row.tp}</td>
        <td style="text-align:center;font-weight:600;">${row.ds}</td>
        <td class="ni-note-cell">${row.note ? `<div class="note-tooltip-trigger tooltip-right">💬<span class="note-tooltip-text">${row.note}</span></div>` : '—'}</td>`;
    }
    tbody.appendChild(tr);
  });

  const wrap = document.createElement('div');
  wrap.style.overflowX = 'auto';
  wrap.style.webkitOverflowScrolling = 'touch';
  wrap.style.marginTop = '12px';
  wrap.appendChild(t);
  sec.appendChild(wrap);
  return sec;
}

function renderMri(data) {
  const editing = isSectionEditing('mri');
  const sec = makeSection('🧲', '門住急 MRI', 'full-width', 'mri');
  const t = document.createElement('table');
  t.className = 'ni-table';
  t.style.marginTop = '0';

  const weekToDow = {
    'W1': '週一',
    'W2': '週二',
    'W3': '週三',
    'W4': '週四',
    'W5': '週五'
  };

  const weekLabels = data.tp.map(r => r.week);
  t.innerHTML = `
    <thead><tr>
      <th style="width: 10%;">院區</th>
      ${weekLabels.map(w => `<th style="width: 18%;"><span class="week-badge">${weekToDow[w] || w}</span></th>`).join('')}
    </tr></thead><tbody></tbody>`;
  const tbody = t.querySelector('tbody');

  ['tp', 'ds'].forEach(side => {
    const tr = document.createElement('tr');
    const label = side === 'tp'
      ? `<span class="loc loc-tp">台北</span>`
      : `<span class="loc loc-ds">淡水</span>`;
    let cells = `<td class="dow">${label}</td>`;
    data[side].forEach((r, idx) => {
      if (editing) {
        cells += `<td>
          ${makeEditInput(`ni-mri-${side}-${idx}-person`, r.person)}
          <div style="margin-top:4px;">${makeEditInput(`ni-mri-${side}-${idx}-note`, r.note)}</div>
        </td>`;
      } else {
        cells += `<td>${renderPerson(r.person, false, null, 'mri', side, ['週一', '週二', '週三', '週四', '週五'][idx])}${r.note ? noteHtml(r.note) : ''}</td>`;
      }
    });
    tr.innerHTML = cells;
    tbody.appendChild(tr);
  });

  const wrap = document.createElement('div');
  wrap.style.overflowX = 'auto';
  wrap.style.webkitOverflowScrolling = 'touch';
  wrap.style.marginTop = '12px';
  wrap.appendChild(t);
  sec.appendChild(wrap);
  return sec;
}

function renderDsMriDaily(data) {
  const editing = isSectionEditing('ds_mri');
  const sec = makeSection('🏥', '淡水健檢 / 神經 MRI 解釋', '', 'ds_mri');
  const t = document.createElement('table');
  t.className = 'ni-table';
  t.style.marginTop = '0';
  const noteColHeader = editing ? '<th style="width: 180px;">備注</th>' : '<th style="width: 55px;">💬</th>';
  t.innerHTML = `
    <thead><tr>
      <th style="width: 20%;">星期</th>
      <th style="width: 65%;"><span class="loc loc-ds">淡水</span> 負責人</th>
      ${noteColHeader}
    </tr></thead><tbody></tbody>`;
  const tbody = t.querySelector('tbody');
  data.forEach((row, idx) => {
    const tr = document.createElement('tr');
    if (editing) {
      tr.innerHTML = `
        <td class="dow">${row.dow}</td>
        <td>${makeEditSelect(`ni-dsmri-${idx}-person`, row.person)}</td>
        <td>${makeEditInput(`ni-dsmri-${idx}-note`, row.note)}</td>`;
    } else {
      tr.innerHTML = `
        <td class="dow">${row.dow}</td>
        <td>${renderPerson(row.person, true, null, 'ds_mri', 'ds', row.dow)}</td>
        <td class="ni-note-cell">${row.note ? `<div class="note-tooltip-trigger tooltip-right">💬<span class="note-tooltip-text">${row.note}</span></div>` : '—'}</td>`;
    }
    tbody.appendChild(tr);
  });

  const wrap = document.createElement('div');
  wrap.style.overflowX = 'auto';
  wrap.style.webkitOverflowScrolling = 'touch';
  wrap.style.marginTop = '12px';
  wrap.appendChild(t);
  sec.appendChild(wrap);
  return sec;
}

function renderSaturday(data) {
  const editing = isSectionEditing('saturday');
  const sec = makeSection('📅', '週六班（北淡 MRI + 急 CT）', '', 'saturday');
  const list = document.createElement('div');
  list.className = 'sat-list';
  data.forEach((row, idx) => {
    const card = document.createElement('div');
    card.className = 'sat-card';
    if (editing) {
      card.innerHTML = `
        <div class="sat-date">${row.date}</div>
        <div style="margin-top:4px; width:100%;">${makeEditSelect(`ni-sat-${idx}-person`, row.person)}</div>
        <div style="margin-top:4px; width:100%;">${makeEditInput(`ni-sat-${idx}-note`, row.note)}</div>`;
    } else {
      card.innerHTML = `
        <div class="sat-date">${row.date}</div>
        <div class="sat-person">${renderPerson(row.person, true, null, 'saturday', 'all', '週六')}</div>
        ${row.note ? `<div class="sat-note">※ ${row.note}</div>` : ''}`;
    }
    list.appendChild(card);
  });
  sec.appendChild(list);
  return sec;
}

function renderSundayMri(data) {
  const editing = isSectionEditing('sunday');
  let activeData = data;
  if (!activeData || activeData.length === 0) {
    const key = MONTH_KEYS[currentIdx];
    if (key && /^\d{4}-\d{2}$/.test(key)) {
      const [yearStr, monthStr] = key.split('-');
      const year = parseInt(yearStr);
      const month = parseInt(monthStr);
      const sundays = [];
      const daysInMonth = new Date(year, month, 0).getDate();
      for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month - 1, day);
        if (date.getDay() === 0) {
          sundays.push(`${month}/${day}`);
        }
      }
      activeData = sundays.map(dateStr => ({ date: dateStr, person: '', note: '' }));
      if (NI_DATA[key] && !NI_DATA[key].mri_sunday) {
        NI_DATA[key].mri_sunday = activeData;
      }
    }
  }
  if (!activeData) activeData = [];

  const sec = makeSection('📅', '週日 MRI 加班', '', 'sunday');
  const list = document.createElement('div');
  list.className = 'sat-list';
  activeData.forEach((row, idx) => {
    const card = document.createElement('div');
    card.className = 'sat-card';
    if (editing) {
      card.innerHTML = `
        <div class="sat-date">${row.date}</div>
        <div style="margin-top:4px; width:100%;">${makeEditSelect(`ni-sun-${idx}-person`, row.person)}</div>
        <div style="margin-top:4px; width:100%;">${makeEditInput(`ni-sun-${idx}-note`, row.note)}</div>`;
    } else {
      card.innerHTML = `
        <div class="sat-date">${row.date}</div>
        <div class="sat-person">${renderPerson(row.person, true, null, 'sunday', 'all', '週日')}</div>
        ${row.note ? `<div class="sat-note">※ ${row.note}</div>` : ''}`;
    }
    list.appendChild(card);
  });
  sec.appendChild(list);
  return sec;
}

function renderPicc(data) {
  const editing = isSectionEditing('picc');
  const sec = makeSection('💉', 'PICC', '', 'picc');
  const t = document.createElement('table');
  t.className = 'ni-table';
  t.style.marginTop = '0';
  const noteColHeader = editing ? '<th style="width: 180px;">備注</th>' : '<th style="width: 55px;">💬</th>';
  t.innerHTML = `
    <thead><tr>
      <th style="width: 15%;">星期</th>
      <th style="width: 42.5%;"><span class="loc loc-tp">台北</span></th>
      <th style="width: 42.5%;"><span class="loc loc-ds">淡水</span></th>
      ${noteColHeader}
    </tr></thead><tbody></tbody>`;
  const tbody = t.querySelector('tbody');
  const key = MONTH_KEYS[currentIdx];
  data.forEach((row, idx) => {
    const tr = document.createElement('tr');
    const dowDates = getDatesForDayOfWeek(key, row.dow);
    const repDate = dowDates.length > 0 ? dowDates[0] : null;
    if (editing) {
      tr.innerHTML = `
        <td class="dow">${row.dow}</td>
        <td>${makeEditSelect(`ni-picc-${idx}-tp`, row.tp)}</td>
        <td>${makeEditSelect(`ni-picc-${idx}-ds`, row.ds)}</td>
        <td>${makeEditInput(`ni-picc-${idx}-note`, row.note)}</td>`;
    } else {
      tr.innerHTML = `
        <td class="dow">${row.dow}</td>
        <td>${renderPerson(row.tp, true, null, 'picc', 'tp', row.dow)}</td>
        <td>${renderPerson(row.ds, true, null, 'picc', 'ds', row.dow)}</td>
        <td class="ni-note-cell">${row.note ? `<div class="note-tooltip-trigger tooltip-right">💬<span class="note-tooltip-text">${row.note}</span></div>` : '—'}</td>`;
    }
    tbody.appendChild(tr);
  });

  const wrap = document.createElement('div');
  wrap.style.overflowX = 'auto';
  wrap.style.webkitOverflowScrolling = 'touch';
  wrap.style.marginTop = '12px';
  wrap.appendChild(t);
  sec.appendChild(wrap);
  return sec;
}

function renderNotes(notes) {
  const sec = makeSection('📝', '本月備註');
  sec.className = 'section-card full-width';
  
  const container = document.createElement('div');
  container.style.marginTop = '12px';
  container.style.padding = '16px';
  container.style.background = '#fff8e1';
  container.style.border = '1px solid #ffe082';
  container.style.borderRadius = '8px';
  container.style.fontSize = '0.88rem';
  
  const formattedNotes = notes ? notes.replace(/\n/g, '<br>') : '<span style="color:#94a3b8; font-style:italic;">本月無備註</span>';
  
  if (!currentUser) {
    container.innerHTML = `<div style="white-space:pre-line; line-height:1.6; color:#5d4037;">${formattedNotes}</div>`;
  } else {
    container.innerHTML = `
      <div id="notesDisplayMode">
        <div style="white-space:pre-line; line-height:1.6; color:#5d4037; margin-bottom:12px;">${formattedNotes}</div>
        <div style="display:flex; justify-content:flex-end;">
          <button onclick="showNotesEditMode()" style="padding:4px 12px; font-size:0.75rem; border-radius:4px; border:none; background:var(--primary-color); color:white; font-weight:600; cursor:pointer;">編輯備註</button>
        </div>
      </div>
      
      <div id="notesEditMode" style="display:none; flex-direction:column; gap:10px;">
        <div style="font-weight:700; color:#475569;">編輯本月備註：</div>
        <textarea id="notesInput" style="padding:8px 12px; border-radius:6px; border:1px solid #cbd5e1; width:100%; min-height:100px; font-size:0.88rem; box-sizing:border-box; font-family:inherit; resize:vertical;">${notes || ''}</textarea>
        <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:4px;">
          <button onclick="hideNotesEditMode()" style="padding:4px 12px; font-size:0.75rem; border-radius:4px; border:1px solid #cbd5e1; background:white; color:#475569; font-weight:600; cursor:pointer;">取消</button>
          <button id="saveNotesBtn" onclick="saveNotes()" style="padding:4px 12px; font-size:0.75rem; border-radius:4px; border:none; background:var(--primary-color); color:white; font-weight:600; cursor:pointer;">儲存</button>
        </div>
      </div>
    `;
  }
  
  sec.appendChild(container);
  return sec;
}


