/* LifeLog — data model, scoring and local persistence */
(function () {
  'use strict';

  const STORAGE_KEY = 'lifelog.v1';
  const BACKUP_KEY = 'lifelog.backups.v1';
  const VERSION = 1;
  const TIMEZONE = 'Asia/Shanghai';

  const CN_WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
  const WEEKDAY_SHORT = { 0: '日', 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六' };

  // 数据保护：读取异常时保留原始副本，并拒绝写入，避免覆盖既有数据
  const DataGuard = (function () {
    const blocked = {};
    let bannerShown = false;

    function rescue(key, raw) {
      try {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        localStorage.setItem('__rescue.' + key + '.' + stamp, raw);
      } catch (err) { /* 存储已满时忽略，仍不覆盖原数据 */ }
    }

    function paintBanner() {
      if (document.getElementById('__data_guard_banner')) return;
      const el = document.createElement('div');
      el.id = '__data_guard_banner';
      el.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:2147483647;background:#8f1d1d;' +
        'color:#fff;font:13px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;' +
        'padding:10px 14px;box-shadow:0 2px 10px rgba(0,0,0,.35)';
      el.textContent = '数据读取异常：原始数据已另存副本，本次不会写入。请到「数据备份中心」恢复后再使用。';
      document.body.appendChild(el);
    }

    function showBanner() {
      if (bannerShown) return;
      bannerShown = true;
      if (document.body) paintBanner();
      else document.addEventListener('DOMContentLoaded', paintBanner);
    }

    function markBroken(key, raw) {
      rescue(key, raw);
      blocked[key] = true;
      showBanner();
    }

    function read(key) {
      let raw = null;
      try { raw = localStorage.getItem(key); } catch (err) { return { ok: true, raw: null, value: null }; }
      if (raw === null) return { ok: true, raw: null, value: null };
      try {
        return { ok: true, raw: raw, value: JSON.parse(raw) };
      } catch (err) {
        markBroken(key, raw);
        return { ok: false, raw: raw, value: null };
      }
    }

    return {
      read: read,
      markBroken: markBroken,
      canWrite: function (key) { return !blocked[key]; }
    };
  })();

  const COMPLETION_OPTIONS = [
    { value: 0, label: '未完成', short: '未完成' },
    { value: 0.5, label: '完成 50%', short: '50%' },
    { value: 0.75, label: '完成 75%', short: '75%' },
    { value: 1, label: '完成 100%', short: '100%' },
    { value: 1.2, label: '超额完成', short: '超额' }
  ];

  const RESCHEDULE_REASONS = [
    { id: 'business', label: '出差', hint: '行程冲突' },
    { id: 'sick', label: '生病', hint: '身体不适' },
    { id: 'mood', label: '情绪', hint: '状态低落' },
    { id: 'work', label: '工作忙', hint: '临时加班' },
    { id: 'family', label: '家庭事务', hint: '需要陪伴家人' },
    { id: 'weather', label: '天气原因', hint: '不适合户外' },
    { id: 'other', label: '其他', hint: '临时变化' }
  ];

  const PROGRAM_COLORS = ['#5B7FA3', '#9A6B4F', '#6F8F6A', '#B45F4D', '#8273A5', '#A8833D', '#4F7C78', '#8F5F72'];
  const LEVEL_TITLES = ['起步者', '行动派', '习惯养成者', '自律行者', '节奏大师', '长期主义者', 'LifeLog 主理人'];
  const QUOTES = [
    { text: '先完成，再完美。', from: '行动准则' },
    { text: '不必每天都很好，但要每天都出现。', from: '长期主义' },
    { text: '把注意力放回今天，未来会自己长出来。', from: '今日提醒' },
    { text: '真正的进步，常常发生在无人鼓掌的时候。', from: '写给坚持' },
    { text: '计划是给未来的自己留一盏灯。', from: 'LifeLog' },
    { text: '慢一点没关系，别停下来就好。', from: '节奏感' },
    { text: '一次只做一件事，做完一件就少一件。', from: '专注' },
    { text: '你不需要更多意志力，你需要更少的阻力。', from: '习惯设计' },
    { text: '记录不是为了审判自己，而是为了看清自己。', from: '复盘' },
    { text: '持续，比强度更有力量。', from: '训练日志' },
    { text: '今天留下的痕迹，会成为明天继续的理由。', from: 'LifeLog' },
    { text: '状态不好时，完成最小的一件事也算赢。', from: '低谷期' },
    { text: '别等有心情才开始，开始了心情自然会来。', from: '行动派' },
    { text: '所有看似惊人的成果，都有一段安静重复的日子。', from: '时间' }
  ];

  function pad(n) { return String(n).padStart(2, '0'); }

  function todayStr() {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(new Date());
      const get = (type) => parts.find((p) => p.type === type).value;
      return `${get('year')}-${get('month')}-${get('day')}`;
    } catch (err) {
      const d = new Date();
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
  }

  function beijingHour() {
    try {
      return Number(new Intl.DateTimeFormat('en-GB', {
        timeZone: TIMEZONE, hour: '2-digit', hour12: false
      }).format(new Date()));
    } catch (err) {
      return new Date().getHours();
    }
  }

  function parseDate(str) {
    if (!str) return null;
    const [y, m, d] = String(str).split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d, 12, 0, 0, 0);
  }

  function formatDate(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function addDays(str, amount) {
    const d = parseDate(str);
    if (!d) return str;
    d.setDate(d.getDate() + amount);
    return formatDate(d);
  }

  function weekday(str) {
    const d = parseDate(str);
    return d ? d.getDay() : 0;
  }

  function startOfWeek(str) {
    const offset = (weekday(str) + 6) % 7;
    return addDays(str, -offset);
  }

  function endOfWeek(str) {
    return addDays(startOfWeek(str), 6);
  }

  function datesBetween(start, end) {
    const list = [];
    if (!start || !end || start > end) return list;
    let cursor = start;
    let guard = 0;
    while (cursor <= end && guard < 1500) {
      list.push(cursor);
      cursor = addDays(cursor, 1);
      guard += 1;
    }
    return list;
  }

  function uid(prefix) {
    return `${prefix || 'id'}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

  function roundScore(score) {
    return Math.round(score * 100) / 100;
  }

  function monthKey(str) { return String(str).slice(0, 7); }

  function monthLabel(month) {
    const [y, m] = month.split('-').map(Number);
    return `${y}年${m}月`;
  }

  function monthGrid(month) {
    const [y, m] = month.split('-').map(Number);
    const first = `${y}-${pad(m)}-01`;
    const offset = (weekday(first) + 6) % 7;
    const start = addDays(first, -offset);
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }

  function daysInYear(year) {
    return datesBetween(`${year}-01-01`, `${year}-12-31`);
  }

  function fullDateLabel(str) {
    const d = parseDate(str);
    if (!d) return str;
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 · ${CN_WEEKDAY[d.getDay()]}`;
  }

  function monthDayLabel(str) {
    const d = parseDate(str);
    if (!d) return str;
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }

  function quoteForDate(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i += 1) hash = (hash * 31 + str.charCodeAt(i)) % 100000;
    return QUOTES[hash % QUOTES.length];
  }

  function phaseForDate(program, date) {
    if (!program || !program.phases) return null;
    return program.phases.find((p) => p.start <= date && date <= p.end) || null;
  }

  function programById(state, id) {
    return state.programs.find((p) => p.id === id) || null;
  }

  function entriesForDate(state, date) {
    return state.entries
      .filter((e) => e.date === date)
      .sort((a, b) => {
        const ai = state.programs.findIndex((p) => p.id === a.programId);
        const bi = state.programs.findIndex((p) => p.id === b.programId);
        return ai - bi;
      });
  }

  function entriesForProgramDate(state, programId, date) {
    return state.entries.filter((e) => e.programId === programId && e.date === date);
  }

  function deliverableCompletion(d) {
    return typeof d.completion === 'number' ? d.completion : 0;
  }

  function entryScore(entry) {
    const list = (entry.deliverables || []);
    if (!list.length) return 0;
    return list.reduce((sum, d) => sum + deliverableCompletion(d), 0) / list.length;
  }

  function entryRecordedCount(entry) {
    return (entry.deliverables || []).filter((d) => typeof d.completion === 'number').length;
  }

  function programDayScore(state, programId, date) {
    const entries = entriesForProgramDate(state, programId, date);
    const deliverables = entries.flatMap((e) => e.deliverables || []);
    if (!deliverables.length) return null;
    return deliverables.reduce((sum, d) => sum + deliverableCompletion(d), 0) / deliverables.length;
  }

  function dayProgramScores(state, date) {
    const entries = entriesForDate(state, date);
    const ids = Array.from(new Set(entries.map((e) => e.programId)));
    return ids.map((programId) => {
      const program = programById(state, programId);
      return {
        programId,
        program,
        score: programDayScore(state, programId, date),
        entries: entries.filter((e) => e.programId === programId)
      };
    }).filter((item) => item.program);
  }

  function dayScore(state, date) {
    const scores = dayProgramScores(state, date).map((item) => item.score).filter((s) => s !== null);
    if (!scores.length) return null;
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  }

  function dayAggregate(state, date) {
    const entries = entriesForDate(state, date);
    const deliverables = entries.flatMap((e) => e.deliverables || []);
    const recorded = deliverables.filter((d) => typeof d.completion === 'number');
    const completed = deliverables.filter((d) => deliverableCompletion(d) >= 1);
    const est = deliverables.reduce((sum, d) => sum + (Number(d.estimatedUnits) || 0), 0);
    const actual = deliverables.reduce((sum, d) => sum + (Number(d.actualUnits) || 0), 0);
    return {
      hasPlan: entries.length > 0,
      entries,
      deliverables,
      recorded: recorded.length,
      completed: completed.length,
      estimatedUnits: est,
      actualUnits: actual,
      score: dayScore(state, date)
    };
  }

  function colorInfo(score, hasPlan) {
    if (!hasPlan || score === null || typeof score === 'undefined') {
      return { key: 'none', color: '#DDD6CB', soft: '#F2EDE5', label: '无计划' };
    }
    if (score > 1.0001) return { key: 'over', color: '#6B4628', soft: '#EADFD4', label: '超额完成' };
    if (score >= 0.9999) return { key: 'perfect', color: '#BE4A3D', soft: '#F5DFDA', label: '刚好达标' };
    if (score > 0.5) return { key: 'good', color: '#6B8C63', soft: '#E3EBDD', label: '表现良好' };
    if (score > 0) return { key: 'warn', color: '#D2A03E', soft: '#F6EACC', label: '刚刚起步' };
    return { key: 'zero', color: '#B4ADA1', soft: '#ECE8E1', label: '尚未完成' };
  }

  function phaseScheduledDates(program, phase, endDate) {
    if (!phase) return [];
    const end = endDate < phase.end ? endDate : phase.end;
    if (phase.start > end) return [];
    const days = phase.weekdays && phase.weekdays.length ? phase.weekdays : [3, 6, 0];
    return datesBetween(phase.start, end).filter((d) => days.includes(weekday(d)));
  }

  function phaseProgress(state, program, phase, today) {
    const cutoff = today || todayStr();
    if (!phase) {
      return { percent: 0, planned: 0, done: 0, avg: 0 };
    }
    const scheduled = phase.start <= cutoff
      ? phaseScheduledDates(program, phase, cutoff)
      : [];
    const entryDates = Array.from(new Set(
      state.entries
        .filter((e) => e.programId === program.id && e.phaseId === phase.id && e.date <= cutoff)
        .map((e) => e.date)
    )).filter((d) => phase.start <= d);
    const allDates = Array.from(new Set([...scheduled, ...entryDates])).sort();
    let earned = 0;
    let done = 0;
    allDates.forEach((date) => {
      const score = programDayScore(state, program.id, date);
      if (score === null) {
        earned += 0;
      } else {
        earned += Math.min(score, 1);
        if (score >= 0.9999) done += 1;
      }
    });
    return {
      percent: allDates.length ? Math.round((earned / allDates.length) * 100) : 0,
      planned: allDates.length,
      done,
      avg: allDates.length ? earned / allDates.length : 0
    };
  }

  function programTotals(state, program, today) {
    const phases = program.phases || [];
    let planned = 0;
    let done = 0;
    let percentSum = 0;
    phases.forEach((phase) => {
      const progress = phaseProgress(state, program, phase, today);
      planned += progress.planned;
      done += progress.done;
      percentSum += progress.percent;
    });
    return {
      planned,
      done,
      percent: phases.length ? Math.round(percentSum / phases.length) : 0
    };
  }

  function yearAggregate(state, year, today) {
    const cutoff = today || todayStr();
    const allDates = new Set();
    let points = 0;
    let programDays = 0;
    state.entries.forEach((e) => {
      const date = e.date;
      if (String(date).slice(0, 4) === String(year) && date <= cutoff) allDates.add(date);
    });
    allDates.forEach((date) => {
      dayProgramScores(state, date).forEach((item) => {
        points += Math.min(item.score, 1);
        programDays += 1;
      });
    });
    const xp = computeXP(state);
    return {
      days: allDates.size,
      programDays,
      execution: programDays ? points / programDays : 0,
      xp
    };
  }

  function computeStreak(state, today) {
    const cutoff = today || todayStr();
    let cursor = cutoff;
    let count = 0;
    const todayScore = dayScore(state, cutoff);
    if (todayScore === null || todayScore < 0.5) {
      cursor = addDays(cutoff, -1);
    }
    let guard = 0;
    while (guard < 730) {
      const score = dayScore(state, cursor);
      if (score !== null && score >= 0.5) {
        count += 1;
        cursor = addDays(cursor, -1);
      } else {
        break;
      }
      guard += 1;
    }
    return count;
  }

  function computeXP(state) {
    const dates = Array.from(new Set(state.entries.map((e) => e.date))).sort();
    let xp = 0;
    dates.forEach((date) => {
      const programs = dayProgramScores(state, date);
      if (!programs.length) return;
      let dayXp = 0;
      programs.forEach((item) => {
        dayXp += Math.round((item.score || 0) * 100);
      });
      if (programs.length >= 2 && dayScore(state, date) >= 0.9999) dayXp += 20;
      xp += dayXp;
    });
    return xp;
  }

  function levelInfo(xp) {
    let level = Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1;
    level = clamp(level, 1, LEVEL_TITLES.length);
    const base = Math.pow(level - 1, 2) * 100;
    const next = level >= LEVEL_TITLES.length ? base : Math.pow(level, 2) * 100;
    const progress = level >= LEVEL_TITLES.length
      ? 1
      : clamp((xp - base) / Math.max(1, next - base), 0, 1);
    return {
      level,
      title: LEVEL_TITLES[level - 1],
      xp,
      base,
      next,
      progress,
      toNext: Math.max(0, next - xp)
    };
  }

  function computeBadges(state) {
    const dates = Array.from(new Set(state.entries.map((e) => e.date))).sort();
    const ratedEntries = state.entries.filter((e) => entryRecordedCount(e) > 0);
    const ratedDeliverables = state.entries.flatMap((e) => e.deliverables || [])
      .filter((d) => typeof d.completion === 'number');
    const completedDeliverables = ratedDeliverables.filter((d) => d.completion >= 1);
    const overDays = dates.filter((d) => (dayScore(state, d) || 0) > 1);
    const perfectDays = dates.filter((d) => (dayScore(state, d) || 0) >= 0.9999);
    const streak = computeStreak(state);
    const tripleDays = dates.filter((d) => dayProgramScores(state, d).length >= 3);
    const totalMinutes = state.entries.flatMap((e) => e.deliverables || [])
      .reduce((sum, d) => sum + (Number(d.actualUnits) || 0) * 30, 0);
    return [
      { id: 'first', icon: 'spark', name: '第一步', desc: '记录第一个交付物', unlocked: ratedDeliverables.length >= 1 },
      { id: 'perfect', icon: 'target', name: '稳稳达标', desc: '有一天评分达到 1.0', unlocked: perfectDays.length >= 1 },
      { id: 'over', icon: 'rocket', name: '超额选手', desc: '有一天评分超过 1.0', unlocked: overDays.length >= 1 },
      { id: 'streak3', icon: 'flame', name: '三日不断', desc: '连续 3 天评分达标', unlocked: streak >= 3 },
      { id: 'streak7', icon: 'flame', name: '一周有恒', desc: '连续 7 天评分达标', unlocked: streak >= 7 },
      { id: 'triple', icon: 'layers', name: '三线并进', desc: '同一天推进三个项目', unlocked: tripleDays.length >= 1 },
      { id: 'deliver30', icon: 'check', name: '三十次交付', desc: '完成 30 个交付物', unlocked: completedDeliverables.length >= 30 },
      { id: 'hours20', icon: 'clock', name: '投入二十小时', desc: '累计实际投入 20 小时', unlocked: totalMinutes >= 1200 }
    ];
  }

  function defaultPrograms(year) {
    return [
      {
        id: 'tech',
        name: '技术知识学习',
        subtitle: '持续构建技术深度',
        color: '#5B7FA3',
        phases: [
          { id: 'tech_p1', name: '第一阶段 · 筑基', start: `${year}-01-01`, end: `${year}-03-31`, weekdays: [3, 6, 0] },
          { id: 'tech_p2', name: '第二阶段 · 专题', start: `${year}-04-01`, end: `${year}-06-30`, weekdays: [3, 6, 0] },
          { id: 'tech_p3', name: '第三阶段 · 实战', start: `${year}-07-01`, end: `${year}-09-30`, weekdays: [3, 6, 0] },
          { id: 'tech_p4', name: '第四阶段 · 体系', start: `${year}-10-01`, end: `${year}-12-31`, weekdays: [3, 6, 0] }
        ]
      },
      {
        id: 'economist',
        name: '《经济学人》学习',
        subtitle: '读懂世界，也读懂表达',
        color: '#9A6B4F',
        phases: [
          { id: 'econ_p1', name: '第一阶段 · 建立语感', start: `${year}-01-01`, end: `${year}-03-31`, weekdays: [1, 0] },
          { id: 'econ_p2', name: '第二阶段 · 精读积累', start: `${year}-04-01`, end: `${year}-06-30`, weekdays: [1, 0] },
          { id: 'econ_p3', name: '第三阶段 · 主题阅读', start: `${year}-07-01`, end: `${year}-09-30`, weekdays: [1, 0] },
          { id: 'econ_p4', name: '第四阶段 · 观点输出', start: `${year}-10-01`, end: `${year}-12-31`, weekdays: [1, 0] }
        ]
      },
      {
        id: 'fitness',
        name: '体能训练',
        subtitle: '跑步 · 核心 · 自由搏击',
        color: '#6F8F6A',
        phases: [
          { id: 'fit_p1', name: '第一阶段 · 基础适应', start: `${year}-08-24`, end: `${year}-09-27`, weekdays: [2, 6, 0] },
          { id: 'fit_p2', name: '第二阶段 · 耐力强化', start: `${year}-09-28`, end: `${year}-11-08`, weekdays: [2, 6, 0] },
          { id: 'fit_p3', name: '第三阶段 · 赛前冲刺', start: `${year}-11-09`, end: `${year}-12-20`, weekdays: [2, 6, 0] }
        ]
      }
    ];
  }

  function buildEntry(state, programId, date, content, deliverables, extras) {
    const program = programById(state, programId);
    const phase = phaseForDate(program, date);
    return Object.assign({
      id: uid('entry'),
      programId,
      phaseId: phase ? phase.id : (program && program.phases[0] ? program.phases[0].id : ''),
      date,
      content,
      deliverables: deliverables.map((d) => ({
        id: uid('dl'),
        title: d.title,
        estimatedUnits: Number(d.estimatedUnits) || 0,
        actualUnits: Number(d.actualUnits) || 0,
        completion: typeof d.completion === 'number' ? d.completion : null
      })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }, extras || {});
  }

  function createSeedState(withDemo) {
    const today = todayStr();
    const monday = startOfWeek(today);
    const prev = addDays(monday, -7);
    const state = {
      version: VERSION,
      profile: { name: '', createdAt: new Date().toISOString() },
      settings: { timezone: TIMEZONE, weekStartsOn: 1, showQuotes: true },
      programs: defaultPrograms(Number(today.slice(0, 4))),
      entries: [],
      adjustments: [],
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        onboarded: false,
        demo: true,
        demoEntryIds: []
      }
    };

    if (withDemo === false) {
      state.meta.demo = false;
      return state;
    }

    const add = (programId, dateOffset, content, deliverables, extras) => {
      const entry = buildEntry(state, programId, addDays(prev, dateOffset), content, deliverables, extras);
      state.entries.push(entry);
      state.meta.demoEntryIds.push(entry.id);
      return entry;
    };
    const m = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 };
    add('economist', m[1], '精读 · 央行的两难', [
      { title: '精读全文，标注作者的核心论点', estimatedUnits: 2, actualUnits: 2, completion: 1 },
      { title: '整理 8 个值得复用的表达', estimatedUnits: 1, actualUnits: 1, completion: 1 }
    ]);
    add('fitness', m[2], '自由搏击 · 防守反击', [
      { title: '热身 + 步法练习', estimatedUnits: 1, actualUnits: 1, completion: 1 },
      { title: '防守反击组合 5 组', estimatedUnits: 2, actualUnits: 2, completion: 0.75 }
    ]);
    add('tech', m[3], '算法专题 · 图与搜索', [
      { title: '阅读 BFS / DFS 章节', estimatedUnits: 2, actualUnits: 2, completion: 1 },
      { title: '完成 3 道相关练习', estimatedUnits: 1, actualUnits: 1, completion: 0.5 }
    ]);
    add('fitness', m[5], '长距离慢跑 12km', [
      { title: 'E 配速完成 12km', estimatedUnits: 3, actualUnits: 3, completion: 1.2 },
      { title: '拉伸、补水与记录体感', estimatedUnits: 1, actualUnits: 1, completion: 1 }
    ]);
    add('tech', m[5], '项目复盘 · 缓存优化', [
      { title: '整理本次优化的背景与数据', estimatedUnits: 1, actualUnits: 1, completion: 1 },
      { title: '输出一页复盘笔记', estimatedUnits: 1, actualUnits: 1, completion: 1 }
    ]);
    add('economist', m[6], '泛读 · 一周观点回顾', [
      { title: '泛读本周 3 篇文章', estimatedUnits: 2, actualUnits: 2, completion: 0.75 },
      { title: '口头复述主要观点', estimatedUnits: 1, actualUnits: 1, completion: 1 }
    ]);
    add('fitness', m[6], '核心力量 + 恢复跑', [
      { title: '核心训练 20 分钟', estimatedUnits: 1, actualUnits: 1, completion: 1 },
      { title: '轻松跑 5km', estimatedUnits: 1, actualUnits: 1, completion: 0.5 }
    ]);

    // 本周计划（今天开始执行）
    const current = [
      ['economist', 0, '精读 · 全球通胀与利率走向', [
        { title: '精读全文，理清论证链条', estimatedUnits: 2 },
        { title: '整理 8 个表达与句式', estimatedUnits: 1 }
      ]],
      ['fitness', 1, '自由搏击 · 步法与组合拳', [
        { title: '热身 + 步法练习', estimatedUnits: 1 },
        { title: '组合拳 5 组', estimatedUnits: 2 }
      ]],
      ['tech', 2, '算法专题 · 动态规划入门', [
        { title: '阅读章节并手写状态转移', estimatedUnits: 2 },
        { title: '完成 3 道练习题', estimatedUnits: 1 }
      ]],
      ['tech', 5, '项目实战 · 把知识变成作品', [
        { title: '编码实现一个小功能', estimatedUnits: 3 },
        { title: '写一页实现复盘', estimatedUnits: 1 }
      ]],
      ['fitness', 5, '长距离慢跑 10km', [
        { title: 'E 配速完成 10km', estimatedUnits: 3 },
        { title: '拉伸与补水', estimatedUnits: 1 }
      ]],
      ['economist', 6, '泛读 · 一周观点整理', [
        { title: '泛读 2 篇文章', estimatedUnits: 2 },
        { title: '输出一段英文摘要', estimatedUnits: 1 }
      ]],
      ['tech', 6, '知识卡片 · 周复盘', [
        { title: '整理本周知识卡片', estimatedUnits: 1 }
      ]],
      ['fitness', 6, '核心力量 · 稳定与恢复', [
        { title: '核心训练 20 分钟', estimatedUnits: 1 },
        { title: '轻松跑 5km', estimatedUnits: 1 }
      ]]
    ];
    current.forEach(([programId, offset, content, deliverables]) => {
      const entry = buildEntry(state, programId, addDays(monday, offset), content, deliverables);
      state.entries.push(entry);
      state.meta.demoEntryIds.push(entry.id);
    });

    return state;
  }

  function normalizeState(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (!Array.isArray(raw.programs) || !Array.isArray(raw.entries)) return null;
    const state = {
      version: VERSION,
      profile: Object.assign({ name: '' }, raw.profile || {}),
      settings: Object.assign({ timezone: TIMEZONE, weekStartsOn: 1, showQuotes: true }, raw.settings || {}),
      programs: raw.programs,
      entries: raw.entries,
      adjustments: Array.isArray(raw.adjustments) ? raw.adjustments : [],
      meta: Object.assign({
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        onboarded: true,
        demo: false,
        demoEntryIds: []
      }, raw.meta || {})
    };
    state.programs.forEach((p) => {
      p.phases = Array.isArray(p.phases) ? p.phases : [];
      p.phases.forEach((phase) => {
        phase.weekdays = Array.isArray(phase.weekdays) && phase.weekdays.length ? phase.weekdays : [3, 6, 0];
      });
    });
    state.entries.forEach((entry) => {
      entry.deliverables = Array.isArray(entry.deliverables) ? entry.deliverables : [];
      entry.deliverables.forEach((d) => {
        d.estimatedUnits = Number(d.estimatedUnits) || 0;
        d.actualUnits = Number(d.actualUnits) || 0;
        d.completion = typeof d.completion === 'number' ? d.completion : null;
      });
    });
    return state;
  }

  function loadState() {
    const read = DataGuard.read(STORAGE_KEY);
    if (!read.ok) return createSeedState(false);
    if (read.value === null) {
      const seeded = createSeedState();
      saveState(seeded);
      return seeded;
    }
    const normalized = normalizeState(read.value);
    if (!normalized) {
      // 结构异常：保留原始数据，不做任何覆盖
      DataGuard.markBroken(STORAGE_KEY, read.raw);
      return createSeedState(false);
    }
    return normalized;
  }

  function saveState(state) {
    if (!DataGuard.canWrite(STORAGE_KEY)) return false;
    try {
      state.meta = state.meta || {};
      state.meta.updatedAt = new Date().toISOString();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (err) {
      console.warn('LifeLog: failed to save local data', err);
      return false;
    }
  }

  function makeBackup(state, label) {
    if (!DataGuard.canWrite(STORAGE_KEY)) return null;
    try {
      const raw = localStorage.getItem(BACKUP_KEY);
      const backups = raw ? JSON.parse(raw) : [];
      const snapshot = {
        id: uid('backup'),
        at: new Date().toISOString(),
        label: label || '手动备份',
        state: JSON.parse(JSON.stringify(state))
      };
      backups.unshift(snapshot);
      localStorage.setItem(BACKUP_KEY, JSON.stringify(backups.slice(0, 7)));
      return snapshot;
    } catch (err) {
      console.warn('LifeLog: failed to create backup', err);
      return null;
    }
  }

  function listBackups() {
    try {
      const raw = localStorage.getItem(BACKUP_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (err) {
      return [];
    }
  }

  function ensureAutoBackup(state) {
    try {
      const list = listBackups();
      const today = todayStr();
      const latestAuto = list.find((b) => b.label === '自动备份');
      const latestDate = latestAuto ? new Date(latestAuto.at).toISOString().slice(0, 10) : '';
      if (latestDate !== today) makeBackup(state, '自动备份');
    } catch (err) {
      // ignore backup quota errors
    }
  }

  function storageBytes() {
    try {
      const main = localStorage.getItem(STORAGE_KEY) || '';
      const backup = localStorage.getItem(BACKUP_KEY) || '';
      return (main.length + backup.length) * 2;
    } catch (err) {
      return 0;
    }
  }

  function clearDemoEntries(state) {
    const ids = new Set(state.meta.demoEntryIds || []);
    state.entries = state.entries.filter((e) => !ids.has(e.id));
    state.meta.demo = false;
    state.meta.demoEntryIds = [];
  }

  window.LifeLogCore = {
    STORAGE_KEY,
    BACKUP_KEY,
    VERSION,
    TIMEZONE,
    CN_WEEKDAY,
    WEEK_ORDER,
    WEEKDAY_SHORT,
    COMPLETION_OPTIONS,
    RESCHEDULE_REASONS,
    PROGRAM_COLORS,
    QUOTES,
    todayStr,
    beijingHour,
    pad,
    parseDate,
    formatDate,
    addDays,
    weekday,
    startOfWeek,
    endOfWeek,
    datesBetween,
    uid,
    roundScore,
    monthKey,
    monthLabel,
    monthGrid,
    daysInYear,
    fullDateLabel,
    monthDayLabel,
    quoteForDate,
    phaseForDate,
    programById,
    entriesForDate,
    entriesForProgramDate,
    entryScore,
    entryRecordedCount,
    programDayScore,
    dayProgramScores,
    dayScore,
    dayAggregate,
    colorInfo,
    phaseScheduledDates,
    phaseProgress,
    programTotals,
    yearAggregate,
    computeStreak,
    computeXP,
    levelInfo,
    computeBadges,
    defaultPrograms,
    buildEntry,
    createSeedState,
    normalizeState,
    loadState,
    saveState,
    makeBackup,
    listBackups,
    ensureAutoBackup,
    storageBytes,
    clearDemoEntries
  };
})();
