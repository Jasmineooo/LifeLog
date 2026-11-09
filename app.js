/* LifeLog — application shell and interactions */
(function () {
  'use strict';

  const C = window.LifeLogCore;
  const TODAY = C.todayStr();

  let state = C.loadState();
  const ui = {
    tab: 'today',
    selectedDate: TODAY,
    calMonth: TODAY.slice(0, 7),
    statsYear: Number(TODAY.slice(0, 4)),
    statsProgram: 'all',
    modal: null
  };

  const main = document.getElementById('app-main');
  const modalRoot = document.getElementById('modal-root');
  const toastRoot = document.getElementById('toast-root');

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function attr(value) { return esc(value); }

  function icon(name, cls) {
    return `<svg class="icon ${cls || ''}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  }

  function timeLabel(units) {
    const value = Number(units) || 0;
    if (value === 0) return '0h';
    const hours = value / 2;
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
  }

  function durationLabel(units) {
    const value = Number(units) || 0;
    if (value === 0) return '0 分钟';
    const mins = value * 30;
    if (mins < 60) return `${mins} 分钟`;
    return `${Number.isInteger(mins / 60) ? mins / 60 : (mins / 60).toFixed(1)} 小时`;
  }

  function scoreText(score) {
    if (score === null || typeof score === 'undefined') return '—';
    return Number(score).toFixed(2);
  }

  function fmtShort(date) {
    const d = C.parseDate(date);
    if (!d) return date;
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  function fmtRange(start, end) {
    const a = C.parseDate(start);
    const b = C.parseDate(end);
    if (!a || !b) return '';
    return `${C.pad(a.getMonth() + 1)}.${C.pad(a.getDate())} – ${C.pad(b.getMonth() + 1)}.${C.pad(b.getDate())}`;
  }

  function monthDateLabel(date) {
    const d = C.parseDate(date);
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  }

  function greeting() {
    const hour = C.beijingHour();
    if (hour < 5) return '夜深了';
    if (hour < 11) return '早上好';
    if (hour < 14) return '中午好';
    if (hour < 18) return '下午好';
    return '晚上好';
  }

  function programInitial(name) {
    const clean = String(name || 'L').replace(/[《》\s]/g, '');
    return clean.slice(0, 1) || 'L';
  }

  function programShort(name) {
    const clean = String(name || '').replace(/[《》]/g, '').replace(/学习/g, '').replace(/计划/g, '');
    return clean.slice(0, 4) || '项目';
  }

  function scoreStyle(score, hasPlan) {
    return C.colorInfo(score, hasPlan);
  }

  function formatUpdated(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '—';
      return d.toLocaleString('zh-CN', {
        timeZone: C.TIMEZONE, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
      });
    } catch (err) {
      return '—';
    }
  }

  function formatBackupTime(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleString('zh-CN', {
        timeZone: C.TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false
      });
    } catch (err) {
      return iso;
    }
  }

  function showToast(message, type) {
    const kind = type || 'ok';
    const toast = document.createElement('div');
    toast.className = 'toast';
    const iconName = kind === 'alert' ? 'alert' : kind === 'info' ? 'spark' : 'check';
    toast.innerHTML = `${icon(iconName)}<span>${esc(message)}</span>`;
    toastRoot.appendChild(toast);
    while (toastRoot.children.length > 2) toastRoot.removeChild(toastRoot.firstChild);
    setTimeout(() => {
      toast.classList.add('out');
      setTimeout(() => toast.remove(), 220);
    }, 2600);
  }

  function persist() {
    const ok = C.saveState(state);
    if (!ok) showToast('本地存储空间不足，建议先导出备份。', 'alert');
    return ok;
  }

  function saveAndRender() {
    persist();
    render();
  }

  function levelChipHTML() {
    const info = C.levelInfo(C.computeXP(state));
    return `<button class="level-chip" data-action="go-tab" data-tab="stats" aria-label="查看统计与等级">
      <span class="lv">L${info.level}</span>
      <span class="meta"><b>${esc(info.title)}</b><span>${info.xp} 能量</span></span>
    </button>`;
  }

  function render() {
    document.querySelectorAll('.desktop-nav button, .bottom-nav button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === ui.tab);
    });
    document.getElementById('level-chip').innerHTML = levelChipHTML();
    if (ui.tab === 'today') main.innerHTML = renderToday();
    else if (ui.tab === 'calendar') main.innerHTML = renderCalendar();
    else if (ui.tab === 'stats') main.innerHTML = renderStats();
    else main.innerHTML = renderSettings();
    document.title = `LifeLog · ${ui.tab === 'today' ? '今日' : ui.tab === 'calendar' ? '日历' : ui.tab === 'stats' ? '统计' : '设置'}`;
  }

  /* ---------------- Today ---------------- */

  function renderToday() {
    const date = ui.selectedDate;
    const aggregate = C.dayAggregate(state, date);
    const dateObj = C.parseDate(date);
    const info = scoreStyle(aggregate.score, aggregate.hasPlan);
    const angle = aggregate.hasPlan ? Math.min((aggregate.score || 0) / 1.2, 1) * 360 : 0;
    const isToday = date === TODAY;
    const isFuture = date > TODAY;
    const quote = state.settings.showQuotes === false
      ? { text: '今天也要向前一步。', from: 'LifeLog' }
      : C.quoteForDate(date);
    const greetingText = `${greeting()}${state.profile.name ? `，${state.profile.name}` : ''}`;
    const xp = C.computeXP(state);
    const level = C.levelInfo(xp);
    const streak = C.computeStreak(state);
    const badges = C.computeBadges(state);
    const unlockedBadges = badges.filter((b) => b.unlocked);
    const entries = aggregate.entries;

    const note = !isToday
      ? `<div class="date-note">${icon(isFuture ? 'calendar' : 'edit')}
          <span>${isFuture ? '你在查看未来的日程，计划正在这里等你。' : '补记过去的完成情况，也是一种诚实。'}</span>
          <button class="text-btn" data-action="goto-today">回到今天</button>
        </div>`
      : '';

    const planCards = entries.length
      ? `<div class="plan-list">${entries.map((entry) => renderPlanCard(entry)).join('')}</div>`
      : `<div class="empty-state">
          <div class="empty-art">${icon(isFuture ? 'calendar' : 'sun')}</div>
          <h3>${isFuture ? '这一天还是留白' : '今天还没有安排'}</h3>
          <p>${isFuture ? '把想做的事放进日历，未来的你会感谢现在的你。' : '留白也是一种选择，但别让明天替今天还债。先放进一件小事，行动会接住你。'}</p>
          <div class="empty-actions">
            <button class="btn btn-primary" data-action="open-plan" data-date="${date}">${icon('plus')} 排计划</button>
            <button class="btn btn-soft" data-action="go-tab" data-tab="calendar">${icon('calendar')} 看看日历</button>
          </div>
        </div>`;

    return `<section class="page">
      <div class="daybar">
        <button class="icon-btn" data-action="day-prev" aria-label="前一天">${icon('chevron-left')}</button>
        <div class="daybar-main">
          <span class="eyebrow">北京时间 · ${C.CN_WEEKDAY[dateObj.getDay()]} · ${isToday ? '今天' : isFuture ? '未来' : '补记'}</span>
          <h1><span class="year">${dateObj.getFullYear()}</span>${dateObj.getMonth() + 1}月${dateObj.getDate()}日</h1>
        </div>
        <div class="daybar-actions">
          <button class="today-pill ${isToday ? 'is-today' : ''}" data-action="goto-today">${isToday ? icon('check') : ''}${isToday ? '今天' : '回到今天'}</button>
          <button class="icon-btn" data-action="day-next" aria-label="后一天">${icon('chevron-right')}</button>
        </div>
      </div>
      ${note}
      <div class="today-top">
        <article class="hero-card">
          <div class="hero-copy">
            <div class="hero-kicker"><span class="dot"></span>${esc(greetingText)} · 今日节奏</div>
            <h2 class="hero-quote">${esc(quote.text)}</h2>
            <p class="hero-sub">${esc(quote.from)} · ${entries.length ? `已安排 ${entries.length} 项，${aggregate.recorded}/${aggregate.deliverables.length} 个交付物留下记录` : '给今天一个具体的开始，不用宏大，只要清晰。'}</p>
            <div class="hero-meta">
              <span class="hero-chip">${icon('calendar')} ${C.CN_WEEKDAY[dateObj.getDay()]}</span>
              <span class="hero-chip">${icon('timer')} 预计 <strong>${timeLabel(aggregate.estimatedUnits)}</strong></span>
              <span class="hero-chip">${icon('flame')} 连续 <strong>${streak}</strong> 天</span>
            </div>
          </div>
          <div class="score-orbit-wrap">
            <div class="score-orbit ${aggregate.hasPlan ? '' : 'is-empty'}" style="--ring:${info.color};--angle:${angle.toFixed(1)}deg">
              <div class="score-orbit-inner">
                ${aggregate.hasPlan ? `<strong>${scoreText(aggregate.score)}</strong><span>今日得分</span>` : `<strong>—</strong><span>尚无计划</span>`}
              </div>
            </div>
            <span class="orbit-caption">${aggregate.hasPlan ? info.label : '空白也可以被填满'}</span>
          </div>
        </article>
        <aside class="level-card">
          <div class="level-top">
            <div class="level-badge">
              <span class="num">L${level.level}</span>
              <span class="txt"><small>当前等级</small><b>${esc(level.title)}</b></span>
            </div>
            <span class="streak">${icon('flame')} ${streak} 天</span>
          </div>
          <div class="level-body">
            <div class="level-progress-label"><span>${level.level >= 7 ? '已达最高等级' : `距下一级 ${level.toNext} 能量`}</span><strong>${level.xp} XP</strong></div>
            <div class="progress-track"><div class="progress-fill" style="width:${Math.round(level.progress * 100)}%"></div></div>
            <div class="level-foot" style="margin-top:11px">
              ${unlockedBadges.length
                ? unlockedBadges.slice(0, 3).map((b) => `<span class="mini-badge on">${icon(b.icon)}${esc(b.name)}</span>`).join('')
                : '<span class="mini-badge">首个成就正在等你</span>'}
              <span class="mini-badge">${unlockedBadges.length}/${badges.length} 成就</span>
            </div>
          </div>
          <p class="quote-mini">积分来自每次真实记录。超额完成得更多，但持续出现最值钱。</p>
        </aside>
      </div>

      <div class="section-head">
        <div><h2>${isToday ? '今日计划' : isFuture ? '这一天计划' : '当日计划'}</h2><p>${entries.length ? '完成一项，就记录一项。数据只服务于你，不用追求漂亮。' : '让计划具体到交付物，执行会轻松很多。'}</p></div>
        <div class="section-head-actions">
          ${entries.length ? `<button class="btn btn-soft btn-sm" data-action="open-plan" data-date="${date}">${icon('plus')} 加一项</button>` : ''}
        </div>
      </div>
      ${planCards}
    </section>`;
  }

  function renderPlanCard(entry) {
    const program = C.programById(state, entry.programId);
    if (!program) return '';
    const phase = (program.phases || []).find((p) => p.id === entry.phaseId) || C.phaseForDate(program, entry.date);
    const score = C.entryScore(entry);
    const recorded = C.entryRecordedCount(entry);
    const total = (entry.deliverables || []).length;
    const info = C.colorInfo(score, true);
    const estimated = (entry.deliverables || []).reduce((sum, d) => sum + (Number(d.estimatedUnits) || 0), 0);
    const actual = (entry.deliverables || []).reduce((sum, d) => sum + (Number(d.actualUnits) || 0), 0);
    const locked = entry.date > TODAY;

    const deliverables = (entry.deliverables || []).map((d, index) => {
      const ratingButtons = C.COMPLETION_OPTIONS.map((opt) => {
        const active = typeof d.completion === 'number' && Math.abs(d.completion - opt.value) < 0.001;
        return `<button class="rating-btn ${active ? 'active' : ''}" data-action="rate" data-entry="${entry.id}" data-deliverable="${d.id}" data-value="${opt.value}" title="${opt.label}" ${locked ? 'disabled' : ''}>${opt.short}</button>`;
      }).join('');
      const stepper = locked
        ? `<span class="stepper locked" title="未到当天，不能填写实际用时"><span class="val">0min</span></span>`
        : `<span class="stepper">
                <button data-action="actual-step" data-entry="${entry.id}" data-deliverable="${d.id}" data-delta="-1" aria-label="减少实际用时">−</button>
                <span class="val">${timeLabel(d.actualUnits)}</span>
                <button data-action="actual-step" data-entry="${entry.id}" data-deliverable="${d.id}" data-delta="1" aria-label="增加实际用时">+</button>
              </span>`;
      return `<div class="deliverable">
        <div class="deliverable-head">
          <span class="deliverable-index">${C.pad(index + 1)}</span>
          <div class="deliverable-main">
            <h4>${esc(d.title)}</h4>
            <div class="deliverable-meta">
              <span>预计 ${timeLabel(d.estimatedUnits)}</span>
              <span class="dot-sep"></span>
              <span class="stepper-label">实际</span>
              ${stepper}
            </div>
          </div>
        </div>
        <div class="rating-group" role="group" aria-label="${esc(d.title)}完成度">${ratingButtons}</div>
      </div>`;
    }).join('');

    return `<article class="plan-card ${locked ? 'plan-future' : ''}" style="--accent:${program.color};--score-color:${info.color}">
      ${locked ? '<div class="future-note">未来计划 · 到当天再填写完成情况</div>' : ''}
      <div class="plan-head">
        <div class="program-avatar">${esc(programInitial(program.name))}</div>
        <div class="plan-title-wrap">
          <div class="plan-program-line">
            <span class="plan-program">${esc(program.name)}</span>
            ${phase ? `<span class="stage-chip">${esc(phase.name)}</span>` : ''}
          </div>
          <h3 class="plan-title">${esc(entry.content)}</h3>
        </div>
        <div class="plan-score">
          ${recorded > 0 ? `<b>${scoreText(score)}</b><span>${recorded}/${total} 已记录</span>` : `<b class="pending">待记录</b><span>0/${total} 已记录</span>`}
        </div>
      </div>
      <div class="deliverable-list">${deliverables}</div>
      <div class="plan-foot">
        <div class="foot-meta">
          <span>${total} 项交付物</span><span>·</span>
          <span>预计 ${timeLabel(estimated)}</span>
          ${!locked && actual > 0 ? `<span>·</span><span>实际 ${timeLabel(actual)}</span>` : ''}
        </div>
        <div class="actions">
          ${locked ? '' : `<button class="text-btn accent" data-action="complete-entry" data-entry="${entry.id}" title="把所有交付物标记为完成">${icon('check')}<span>全部完成</span></button>`}
          <button class="text-btn" data-action="edit-entry" data-entry="${entry.id}">${icon('edit')}<span>编辑</span></button>
          <button class="text-btn" data-action="reschedule-entry" data-entry="${entry.id}">${icon('move')}<span>调整</span></button>
        </div>
      </div>
    </article>`;
  }

  /* ---------------- Calendar ---------------- */

  function renderCalendar() {
    const month = ui.calMonth;
    const label = C.monthLabel(month);
    const cells = C.monthGrid(month);
    const [year, monthNumber] = month.split('-').map(Number);
    const monthEntries = state.entries.filter((e) => e.date.slice(0, 7) === month);
    const monthDays = new Set(monthEntries.map((e) => e.date));
    const monthRatedDays = Array.from(monthDays).filter((d) => d <= TODAY);
    let monthScoreSum = 0;
    let monthScoreCount = 0;
    monthRatedDays.forEach((date) => {
      const s = C.dayScore(state, date);
      if (s !== null) {
        monthScoreSum += s;
        monthScoreCount += 1;
      }
    });
    const monthAvg = monthScoreCount ? monthScoreSum / monthScoreCount : null;

    const nextMonday = C.addDays(C.startOfWeek(TODAY), 7);
    const nextSunday = C.addDays(nextMonday, 6);
    const nextEntries = state.entries.filter((e) => e.date >= nextMonday && e.date <= nextSunday);
    const nextPrograms = Array.from(new Set(nextEntries.map((e) => e.programId)))
      .map((id) => C.programById(state, id)).filter(Boolean);
    const nextDays = new Set(nextEntries.map((e) => e.date)).size;

    const calendarCells = cells.map((date) => {
      const d = C.parseDate(date);
      const isOther = date.slice(0, 7) !== month;
      const isToday = date === TODAY;
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      const dayEntries = C.entriesForDate(state, date);
      const uniquePrograms = Array.from(new Set(dayEntries.map((e) => e.programId)))
        .map((id) => state.programs.find((p) => p.id === id)).filter(Boolean);
      const visible = uniquePrograms.slice(0, 2);
      const pills = visible.map((p) => `<span class="cal-pill" style="--p:${p.color}"><i></i><span>${esc(programShort(p.name))}</span></span>`).join('')
        + (uniquePrograms.length > 2 ? `<span class="cal-pill more">+${uniquePrograms.length - 2}</span>` : '');
      let result = '';
      if (dayEntries.length && date <= TODAY) {
        const info = C.colorInfo(C.dayScore(state, date), true);
        result = `<span class="cal-result" style="--rc:${info.color}"></span>`;
      }
      return `<button class="cal-cell ${isOther ? 'other' : ''} ${isToday ? 'is-today' : ''} ${isWeekend ? 'is-weekend' : ''}" data-action="open-day" data-date="${date}" aria-label="${monthDateLabel(date)}">
        <span class="cal-num">${d.getDate()}</span>
        <div class="cal-plans">${pills}</div>
        ${result}
      </button>`;
    }).join('');

    const weekReminder = `<div class="side-card week-reminder">
      <span class="eyebrow">下周 · ${fmtShort(nextMonday)} – ${fmtShort(nextSunday)}</span>
      <h3>${nextDays ? '下周已经有轮廓了' : '本周内，把下周排好'}</h3>
      <p>${nextDays
        ? `已安排 ${nextDays} 天、${nextPrograms.length} 个项目。提前计划，执行时就不用再做决定。`
        : '不要等到下周再决定。现在花十分钟，把下周的计划放进日历。'}</p>
      ${nextPrograms.length ? `<div class="week-dots">${nextPrograms.map((p) => `<span class="week-dot"><i style="--p:${p.color}"></i>${esc(programShort(p.name))}</span>`).join('')}</div>` : ''}
      <button class="btn btn-sm" data-action="open-plan-next-week">${icon(nextDays ? 'plus' : 'calendar')} ${nextDays ? '继续安排' : '排下周计划'}</button>
    </div>`;

    const legend = `<div class="side-card">
      <h3>项目图例</h3>
      <div class="cal-legend" style="padding:11px 0 0">
        ${state.programs.map((p) => `<div class="legend-item"><span class="legend-dot" style="--p:${p.color}"></span>${esc(p.name)}</div>`).join('')}
      </div>
    </div>`;

    const monthly = `<div class="side-card">
      <h3>本月一览</h3>
      <div class="side-stats">
        <div class="side-stat"><b>${monthDays.size}</b><span>天有安排</span></div>
        <div class="side-stat"><b>${monthEntries.length}</b><span>项计划</span></div>
        <div class="side-stat"><b>${monthAvg === null ? '—' : scoreText(monthAvg)}</b><span>平均得分</span></div>
        <div class="side-stat"><b>${monthRatedDays.length}</b><span>天已执行</span></div>
      </div>
    </div>`;

    return `<section class="page">
      <div class="page-head">
        <div>
          <span class="eyebrow">Plan the days</span>
          <h1 class="page-title">日历</h1>
          <p>计划在时间里变得具体。点击任意一天查看、补记或调整。</p>
        </div>
        <div class="page-head-actions">
          <button class="btn btn-primary" data-action="open-plan" data-date="${ui.selectedDate || TODAY}">${icon('plus')} 排计划</button>
        </div>
      </div>
      <div class="calendar-layout">
        <div class="calendar-card card">
          <div class="calendar-toolbar">
            <div class="calendar-month">
              <h2>${label}</h2>
              <span class="count">${monthDays.size} 天有安排</span>
            </div>
            <div class="calendar-tools">
              <button class="icon-btn bare" data-action="cal-prev-month" aria-label="上个月">${icon('chevron-left')}</button>
              <button class="btn btn-ghost btn-sm" data-action="cal-today">今天</button>
              <button class="icon-btn bare" data-action="cal-next-month" aria-label="下个月">${icon('chevron-right')}</button>
            </div>
          </div>
          <div class="weekday-row">${C.WEEK_ORDER.map((d) => `<span class="${d === 0 || d === 6 ? 'weekend' : ''}">${C.WEEKDAY_SHORT[d]}</span>`).join('')}</div>
          <div class="calendar-grid">${calendarCells}</div>
        </div>
        <aside class="calendar-side">
          ${weekReminder}
          ${legend}
          ${monthly}
        </aside>
      </div>
    </section>`;
  }

  /* ---------------- Stats ---------------- */

  function heatmapForProgram(program, year) {
    const start = C.startOfWeek(`${year}-01-01`);
    const end = C.endOfWeek(`${year}-12-31`);
    const cells = C.datesBetween(start, end).map((date) => {
      if (date.slice(0, 4) !== String(year)) return '<span class="heat-cell blank"></span>';
      const entries = C.entriesForProgramDate(state, program.id, date);
      const isToday = date === TODAY;
      const future = date > TODAY;
      const score = C.programDayScore(state, program.id, date);
      if (!entries.length) {
        const cls = `heat-cell none ${future ? 'future' : ''} ${isToday ? 'is-today' : ''}`;
        return `<span class="${cls}" title="${date} · 无计划"></span>`;
      }
      const info = C.colorInfo(score, true);
      const label = `${date} · ${info.label}${future ? '（计划中）' : ` · ${scoreText(score)} 分`}`;
      return `<span class="heat-cell ${future ? 'future' : ''} ${isToday ? 'is-today' : ''}" style="--hc:${info.color}" title="${label}"></span>`;
    }).join('');
    return `<div class="heatmap">${cells}</div>`;
  }

  function combinedHeatmap(year) {
    const start = C.startOfWeek(`${year}-01-01`);
    const end = C.endOfWeek(`${year}-12-31`);
    return C.datesBetween(start, end).map((date) => {
      if (date.slice(0, 4) !== String(year)) return '<span class="heat-cell blank"></span>';
      const programs = C.dayProgramScores(state, date);
      const future = date > TODAY;
      const isToday = date === TODAY;
      if (!programs.length) {
        return `<span class="heat-cell none ${future ? 'future' : ''} ${isToday ? 'is-today' : ''}" title="${date} · 无计划"></span>`;
      }
      const segments = programs.map((item) => {
        const strong = !future && (item.score || 0) > 0.7501;
        const segColor = strong ? item.program.color : 'var(--heat-dim)';
        const label = future ? '计划中' : `${scoreText(item.score)} 分${strong ? '' : '（未达 0.75）'}`;
        return `<span class="stack-seg" style="--sc:${segColor}" title="${esc(item.program.name)} · ${label}"></span>`;
      }).join('');
      const summary = programs.map((item) => `${item.program.name} ${scoreText(item.score)}`).join(' · ');
      return `<span class="heat-cell ${future ? 'future' : ''} ${isToday ? 'is-today' : ''}" title="${date} · ${future ? '计划中' : esc(summary)}">${segments}</span>`;
    }).join('');
  }

  function yearProgramAverage(program, year) {
    const dates = Array.from(new Set(state.entries
      .filter((e) => e.programId === program.id && e.date.slice(0, 4) === String(year) && e.date <= TODAY)
      .map((e) => e.date)));
    if (!dates.length) return null;
    const total = dates.reduce((sum, date) => sum + Math.min(C.programDayScore(state, program.id, date) || 0, 1), 0);
    return total / dates.length;
  }

  function renderStats() {
    const year = ui.statsYear;
    const aggregate = C.yearAggregate(state, year);
    const streak = C.computeStreak(state);
    const level = C.levelInfo(C.computeXP(state));
    const badges = C.computeBadges(state);
    const unlocked = badges.filter((b) => b.unlocked).length;

    const programCards = state.programs.map((program) => {
      const phases = program.phases || [];
      const avg = yearProgramAverage(program, year);
      const phaseRows = phases.map((phase) => {
        const progress = C.phaseProgress(state, program, phase, TODAY);
        return `<div class="phase-row">
          <div class="phase-info"><b>${esc(phase.name)}</b><span>${fmtRange(phase.start, phase.end)} · 每周${phase.weekdays.map((d) => C.WEEKDAY_SHORT[d]).join('、')}</span></div>
          <div class="phase-bar"><i style="--p:${program.color};width:${progress.percent}%"></i></div>
          <div class="phase-pct">${progress.percent}%<small>${progress.done}/${progress.planned} 天达标</small></div>
        </div>`;
      }).join('');
      return `<article class="program-stat-card card">
        <div class="program-stat-head">
          <div class="program-avatar" style="--accent:${program.color}">${esc(programInitial(program.name))}</div>
          <div class="name"><h3>${esc(program.name)}</h3><p>${esc(program.subtitle || '')}</p></div>
          <div class="avg"><b style="color:${avg === null ? 'var(--faint)' : C.colorInfo(avg, true).color}">${avg === null ? '—' : scoreText(avg)}</b><span>记录日均分</span></div>
        </div>
        <div class="phase-list">${phaseRows || '<p class="field-hint">还没有阶段，去设置里添加一个。</p>'}</div>
      </article>`;
    }).join('');

    if (ui.statsProgram !== 'all' && !state.programs.some((p) => p.id === ui.statsProgram)) {
      ui.statsProgram = 'all';
    }
    const selectedProgram = ui.statsProgram === 'all'
      ? null
      : state.programs.find((p) => p.id === ui.statsProgram);
    const heatTabs = [
      `<button class="heat-tab ${ui.statsProgram === 'all' ? 'active' : ''}" data-action="stats-program" data-program="all">全部 · 堆叠</button>`,
      ...state.programs.map((p) => `<button class="heat-tab ${ui.statsProgram === p.id ? 'active' : ''}" data-action="stats-program" data-program="${p.id}"><i style="--p:${p.color}"></i>${esc(programShort(p.name))}</button>`)
    ].join('');
    const scoreLegend = `
          <div class="heat-legend">
            <span><i style="--c:${C.colorInfo(1.1, true).color}"></i>超额</span>
            <span><i style="--c:${C.colorInfo(1, true).color}"></i>达标</span>
            <span><i style="--c:${C.colorInfo(0.75, true).color}"></i>良好</span>
            <span><i style="--c:${C.colorInfo(0.25, true).color}"></i>起步</span>
            <span><i style="--c:${C.colorInfo(0, true).color}"></i>未完成</span>
            <span><i class="cross"></i>无计划</span>
          </div>`;
    const overallLegend = `
          <div class="heat-legend">
            ${state.programs.map((p) => `<span><i style="--c:${p.color}"></i>${esc(programShort(p.name))} ≥ 0.75</span>`).join('')}
            <span><i style="--c:var(--heat-dim)"></i>低于 0.75</span>
            <span><i class="cross"></i>无计划</span>
          </div>`;
    const heatmapCard = selectedProgram
      ? `<article class="overall-card card" style="margin-top:16px">
        <div class="overall-head">
          <div><h3>全年总览</h3><p>按项目查看一年的每一天。颜色代表当天完成质量。</p></div>
          <div class="heat-tabs">${heatTabs}</div>
        </div>
        <div class="heatmap-block" style="border-top:0;margin-top:0;padding-top:8px">
          <div class="heatmap-title"><h4>${esc(selectedProgram.name)} · 每日颜色</h4><span>${year} · 1月 → 12月 · 每格 1 天</span></div>
          ${heatmapForProgram(selectedProgram, year)}
          ${scoreLegend}
        </div>
      </article>`
      : `<article class="overall-card card" style="margin-top:16px">
        <div class="overall-head">
          <div><h3>全年总览</h3><p>每个格子由当天的项目堆叠而成。当天项目评分超过 0.75 时，显示该项目的颜色。</p></div>
          <div class="heat-tabs">${heatTabs}</div>
        </div>
        <div class="heatmap-block" style="border-top:0;margin-top:0;padding-top:8px">
          <div class="heatmap-title"><h4>全部项目 · 每日堆叠</h4><span>${year} · 1月 → 12月 · 每格 1 天</span></div>
          <div class="heatmap stack-heatmap">${combinedHeatmap(year)}</div>
          ${overallLegend}
        </div>
      </article>`;

    return `<section class="page">
      <div class="stats-head">
        <div>
          <span class="eyebrow">A year in color</span>
          <h1 class="page-title">统计</h1>
          <p class="muted" style="margin-top:5px;font-size:12px">不评判，只呈现。你走过的每一天，都在这里留下颜色。</p>
        </div>
        <div class="year-switch">
          <button data-action="stats-year-prev" aria-label="上一年">${icon('chevron-left')}</button>
          <span>${year}</span>
          <button data-action="stats-year-next" aria-label="下一年">${icon('chevron-right')}</button>
        </div>
      </div>
      <div class="kpi-grid">
        <div class="kpi accent"><div class="kpi-label">${icon('spark')} 年度积分</div><b>${aggregate.xp}<small>XP</small></b><div class="kpi-note">L${level.level} · ${level.title}</div></div>
        <div class="kpi"><div class="kpi-label">${icon('flame')} 连续达标</div><b>${streak}<small>天</small></b><div class="kpi-note">每天至少完成一半，就算出现</div></div>
        <div class="kpi"><div class="kpi-label">${icon('target')} 执行质量</div><b>${Math.round(aggregate.execution * 100)}<small>%</small></b><div class="kpi-note">按已记录的计划日平均</div></div>
        <div class="kpi"><div class="kpi-label">${icon('calendar')} 留下记录</div><b>${aggregate.days}<small>天</small></b><div class="kpi-note">${unlocked}/${badges.length} 个成就已解锁</div></div>
      </div>

      <div class="section-head"><div><h2>项目进展</h2><p>阶段进度由计划日与完成质量共同计算，未安排的天不会被虚假填满。</p></div></div>
      <div class="program-stats">${programCards}</div>

      ${heatmapCard}

      <article class="badges-card card">
        <div class="badges-head"><h3>成就徽章</h3><span>${unlocked}/${badges.length} 已解锁 · 继续出现，就会继续点亮</span></div>
        <div class="badge-grid">
          ${badges.map((b) => `<div class="badge ${b.unlocked ? 'on' : ''}" title="${esc(b.desc)}"><span class="badge-icon">${icon(b.icon)}</span><div><b>${esc(b.name)}</b><small>${esc(b.desc)}</small></div></div>`).join('')}
        </div>
      </article>
    </section>`;
  }

  /* ---------------- Settings ---------------- */

  function renderSettings() {
    const xp = C.computeXP(state);
    const level = C.levelInfo(xp);
    const backups = C.listBackups();
    const bytes = C.storageBytes();
    const storageText = bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
    const totalDeliverables = state.entries.reduce((sum, e) => sum + (e.deliverables || []).length, 0);

    const projects = state.programs.map((p) => `<div class="project-row">
      <span class="pdot" style="--p:${p.color}"></span>
      <div class="pmeta"><b>${esc(p.name)}</b><span>${p.phases.length} 个阶段 · ${C.programTotals(state, p, TODAY).planned} 个计划日</span></div>
      <span class="pcount">${state.entries.filter((e) => e.programId === p.id).length} 项</span>
      <button class="icon-btn bare" data-action="open-program" data-program="${p.id}" aria-label="编辑 ${esc(p.name)}">${icon('edit')}</button>
    </div>`).join('');

    return `<section class="page">
      <div class="page-head">
        <div><span class="eyebrow">Make it yours</span><h1 class="page-title">设置</h1><p>项目、数据与规则。LifeLog 默认把数据留在这台设备，不上传任何服务器。</p></div>
      </div>
      <div class="settings-grid">
        <div class="settings-col">
          <section class="settings-card card">
            <div class="settings-card-head">
              <div><h2>你的节奏</h2><p>${level.title} · L${level.level} · ${xp} 能量</p></div>
              <span class="icon-wrap">${icon('user')}</span>
            </div>
            <div class="profile-form">
              <input class="input" id="profile-name" maxlength="20" placeholder="怎么称呼你？" value="${attr(state.profile.name || '')}">
              <button class="btn btn-primary" data-action="save-profile">保存</button>
            </div>
            <p class="profile-note">首页会用这个名字和你打招呼。留空也完全没关系。</p>
            <div class="toggle-row" style="margin-top:9px">
              <div class="tmeta"><b>每日一句</b><span>在今日首页展示一句轻量的提醒</span></div>
              <label class="switch"><input type="checkbox" data-action="toggle-quotes" ${state.settings.showQuotes !== false ? 'checked' : ''}><i></i></label>
            </div>
          </section>

          <section class="settings-card card">
            <div class="settings-card-head">
              <div><h2>我的项目</h2><p>以后新增项目或调整阶段，都在这里</p></div>
              <button class="btn btn-soft btn-sm" data-action="open-program">${icon('plus')} 新增</button>
            </div>
            <div class="project-list">${projects}</div>
          </section>

          <section class="settings-card card">
            <div class="settings-card-head">
              <div><h2>评分规则</h2><p>简单、可解释，不需要猜</p></div>
              <span class="icon-wrap">${icon('target')}</span>
            </div>
            <div class="rule-list">
              <div class="rule-item"><span class="rule-swatch" style="--c:${C.colorInfo(1.1, true).color}"></span><div><b>每个项目每天基准 1 分。</b>项目内所有交付物等分，完成度按 0 / 50% / 75% / 100% / 120% 计入。</div></div>
              <div class="rule-item"><span class="rule-swatch" style="--c:${C.colorInfo(1, true).color}"></span><div><b>颜色不是评判。</b>深棕=超额，红=刚好达标，绿=良好，黄=起步，灰=未完成，叉=没有计划。</div></div>
              <div class="rule-item"><span class="rule-swatch" style="--c:${C.colorInfo(0.75, true).color}"></span><div><b>积分来自真实记录。</b>每个项目日按评分 ×100 获得能量；同一天两个以上项目达标，额外 +20。调整日期不扣能量；删除已填写的计划会收回对应能量。</div></div>
              <div class="rule-item"><span class="rule-swatch" style="--c:${C.colorInfo(0.25, true).color}"></span><div><b>未来的计划先不填。</b>完成度与实际用时要到当天或之后才能记录，避免「提前打卡」。</div></div>
            </div>
          </section>
        </div>

        <div class="settings-col">
          <section class="settings-card card">
            <div class="settings-card-head">
              <div><h2>数据与备份</h2><p>本地优先，随时带走</p></div>
              <span class="icon-wrap">${icon('database')}</span>
            </div>
            <div class="data-actions">
              <button class="data-action" data-action="export-json">${icon('download')}<div><b>导出 JSON</b><span>完整备份</span></div></button>
              <button class="data-action" data-action="export-csv">${icon('file')}<div><b>导出 CSV</b><span>表格查看</span></div></button>
              <button class="data-action" data-action="import-json">${icon('upload')}<div><b>导入数据</b><span>覆盖当前</span></div></button>
              <button class="data-action" data-action="backup-now">${icon('archive')}<div><b>立即备份</b><span>保存快照</span></div></button>
              <button class="data-action danger" data-action="clear-records">${icon('refresh')}<div><b>清空记录</b><span>保留项目</span></div></button>
              <button class="data-action danger" data-action="reset-all">${icon('trash')}<div><b>重置全部</b><span>恢复初始</span></div></button>
            </div>
            <div class="storage-line">
              <span>${state.entries.length} 项计划 · ${totalDeliverables} 个交付物 · ${state.adjustments.length} 次调整</span>
              <span>本地 ${storageText}</span>
            </div>
            <div class="storage-line" style="border-top:0;padding-top:4px;margin-top:4px">
              <span>最近保存 ${formatUpdated(state.meta.updatedAt)}</span>
              <span>北京时间</span>
            </div>
            <div class="backup-list">
              ${backups.length ? backups.slice(0, 4).map((b) => `<div class="backup-row">
                ${icon('shield')}
                <div class="bmeta"><b>${esc(b.label)}</b><span>${formatBackupTime(b.at)} · ${b.state && b.state.entries ? b.state.entries.length : 0} 项计划</span></div>
                <button class="text-btn" data-action="restore-backup" data-backup="${b.id}">恢复</button>
              </div>`).join('') : '<p class="field-hint">还没有本地快照。建议先做一次备份。</p>'}
            </div>
          </section>

          <section class="settings-card card">
            <div class="settings-card-head">
              <div><h2>关于 LifeLog</h2><p>一个给自己用的长期记录工具</p></div>
              <span class="icon-wrap">${icon('leaf')}</span>
            </div>
            <div class="about-box">
              <strong>LifeLog</strong><span class="version">v1.0</span><br>
              先把今天过好，再把一年过好。计划、执行、评分、回看，都留在同一条时间线里。<br><br>
              数据保存在浏览器本地，不会自动上传。换设备前，请先导出 JSON 备份。
            </div>
            <div class="storage-line"><span>时区 ${C.TIMEZONE}</span><span>本地优先 · 无账号</span></div>
          </section>
        </div>
      </div>
    </section>`;
  }

  /* ---------------- Modal scaffolding ---------------- */

  function openModal(html, opts) {
    const options = opts || {};
    ui.modal = options.type || 'generic';
    modalRoot.innerHTML = `<div class="modal-backdrop" data-action="close-modal">${html}</div>`;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => {
      const modal = modalRoot.querySelector('.modal');
      if (modal && !modal.getAttribute('tabindex')) modal.setAttribute('tabindex', '-1');
      modal && modal.focus && modal.focus();
    });
  }

  function closeModal() {
    ui.modal = null;
    modalRoot.innerHTML = '';
    document.body.style.overflow = '';
  }

  function modalHead(title, subtitle, options) {
    const opts = options || {};
    return `<div class="modal-head">
      <div><h2>${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div>
      ${opts.noClose ? '' : `<button class="icon-btn bare modal-close" data-action="close-modal" aria-label="关闭">${icon('x')}</button>`}
    </div>`;
  }

  function planRowHTML(deliverable) {
    const d = deliverable || { title: '', estimatedUnits: 1 };
    return `<div class="deliverable-edit-row" data-units="${Number(d.estimatedUnits) || 0}" data-id="${d.id || ''}">
      <span class="drag">${icon('list')}</span>
      <input class="d-title" maxlength="80" placeholder="交付物，例如：完成 3 道练习题" value="${attr(d.title || '')}">
      <div class="unit-stepper">
        <button type="button" data-action="est-step" data-delta="-1" aria-label="减少预计用时">−</button>
        <span class="uval">${timeLabel(d.estimatedUnits || 0)}<small>预计</small></span>
        <button type="button" data-action="est-step" data-delta="1" aria-label="增加预计用时">+</button>
      </div>
      <button class="icon-btn bare row-remove" type="button" data-action="remove-deliverable" aria-label="删除交付物">${icon('x')}</button>
    </div>`;
  }

  function openPlanModal(options) {
    const opts = options || {};
    const editing = opts.entryId ? state.entries.find((e) => e.id === opts.entryId) : null;
    const defaultProgram = editing
      ? state.programs.find((p) => p.id === editing.programId)
      : (state.programs.find((p) => p.id === opts.programId) || state.programs[0]);
    if (!defaultProgram) {
      showToast('还没有项目，请先在设置里新增一个项目。', 'alert');
      return;
    }
    const start = editing ? editing.date : (opts.date || ui.selectedDate || TODAY);
    const nextWeek = Boolean(opts.weekStart);
    const weekStart = opts.weekStart ? C.startOfWeek(opts.weekStart) : '';
    const defaultMode = editing ? 'single' : (nextWeek ? 'repeat' : 'single');
    const end = nextWeek ? C.addDays(weekStart, 6) : C.addDays(start, 6);
    const defaultPhase = C.phaseForDate(defaultProgram, start) || defaultProgram.phases[0];
    const defaultWeekdays = defaultPhase ? defaultPhase.weekdays.slice() : [3, 6, 0];
    const deliverables = editing ? editing.deliverables : [{ id: '', title: '', estimatedUnits: 1 }];
    const title = editing ? '编辑计划' : nextWeek ? '安排下周' : '安排计划';
    const subtitle = editing
      ? '修改内容或交付物；改变日期请使用「调整」并记录原因。'
      : nextWeek ? '先计划，再执行。下周的计划，最好在本周内完成。' : '把想法拆成可以完成的小交付物。';

    const html = `<div class="modal" data-plan-modal>
      ${modalHead(title, subtitle)}
      <form id="plan-form" novalidate>
        <div class="modal-body">
          <div class="form-grid">
            <label class="field"><span class="field-label">项目</span>
              <select class="input" id="plan-program" ${editing ? 'disabled' : ''}>
                ${state.programs.map((p) => `<option value="${p.id}" ${p.id === defaultProgram.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
              </select>
            </label>
            <div class="field"><span class="field-label">阶段 <small>按日期自动归入</small></span><div class="stage-hint" id="stage-hint"></div></div>
          </div>

          <div class="field field-block">
            <span class="field-label">安排方式</span>
            ${editing ? '<div class="stage-hint">正在编辑已存在的计划，日期保持不变。</div>' : `<div class="seg" id="plan-mode">
              <button type="button" class="${defaultMode === 'single' ? 'active' : ''}" data-action="plan-mode" data-mode="single">单日</button>
              <button type="button" class="${defaultMode === 'repeat' ? 'active' : ''}" data-action="plan-mode" data-mode="repeat">按周期重复</button>
            </div>`}
          </div>

          <div class="form-grid field-block">
            <label class="field"><span class="field-label" id="start-label">${defaultMode === 'repeat' ? '开始日期' : '日期'}</span>
              <input type="date" class="input" id="plan-start" value="${start}" ${editing ? 'disabled' : ''}>
            </label>
            <label class="field" id="end-wrap" ${defaultMode === 'single' || editing ? 'hidden' : ''}><span class="field-label">结束日期</span>
              <input type="date" class="input" id="plan-end" value="${end}">
            </label>
          </div>

          <div class="field field-block" id="weekday-wrap" ${defaultMode === 'single' || editing ? 'hidden' : ''}>
            <span class="field-label">每周执行日 <small>下周计划在本周填写</small></span>
            <div class="weekday-picker">
              ${C.WEEK_ORDER.map((d) => `<button type="button" class="${defaultWeekdays.includes(d) ? 'active' : ''}" data-action="plan-weekday" data-weekday="${d}">周${C.WEEKDAY_SHORT[d]}</button>`).join('')}
            </div>
          </div>

          <label class="field field-block"><span class="field-label">计划内容 <small>具体到今天做什么</small></span>
            <input class="input" id="plan-content" maxlength="80" placeholder="例如：算法专题 · 动态规划入门" value="${attr(editing ? editing.content : '')}">
          </label>

          <div class="field field-block">
            <span class="field-label">交付物 <small>每个交付物等分当天的基准分</small></span>
            <div class="deliverable-editor" id="deliverable-editor">
              ${deliverables.map(planRowHTML).join('')}
            </div>
            <button type="button" class="add-row-btn" data-action="add-deliverable">${icon('plus')} 添加交付物</button>
          </div>

          <div class="plan-preview" id="plan-preview"></div>
        </div>
        <div class="modal-foot">
          ${editing ? `<button type="button" class="btn btn-danger left" data-action="delete-entry" data-entry="${editing.id}">${icon('trash')} 删除计划</button>` : ''}
          <button type="button" class="btn btn-ghost" data-action="close-modal">取消</button>
          <button type="submit" class="btn btn-primary">${icon('check')} ${editing ? '保存修改' : '生成计划'}</button>
        </div>
      </form>
    </div>`;

    openModal(html, { type: 'plan' });
    updatePlanModal();
    const form = document.getElementById('plan-form');
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      savePlan(editing);
    });
    setTimeout(() => {
      const content = document.getElementById('plan-content');
      if (content) content.focus({ preventScroll: true });
    }, 120);
  }

  function updatePlanModal() {
    const modal = document.querySelector('[data-plan-modal]');
    if (!modal) return;
    const programId = document.getElementById('plan-program').value;
    const program = C.programById(state, programId);
    const start = document.getElementById('plan-start').value;
    const endInput = document.getElementById('plan-end');
    const mode = (document.querySelector('#plan-mode .active') || { dataset: { mode: 'single' } }).dataset.mode;
    const startLabel = document.getElementById('start-label');
    const endWrap = document.getElementById('end-wrap');
    const weekdayWrap = document.getElementById('weekday-wrap');
    const isEditing = !document.getElementById('plan-mode');
    if (startLabel) startLabel.textContent = (!isEditing && mode === 'repeat') ? '开始日期' : '日期';
    if (endWrap) endWrap.hidden = isEditing || mode === 'single';
    if (weekdayWrap) weekdayWrap.hidden = isEditing || mode === 'single';

    const hint = document.getElementById('stage-hint');
    const phase = program ? C.phaseForDate(program, start) : null;
    if (!program) {
      hint.className = 'stage-hint error';
      hint.innerHTML = `${icon('alert')} 请选择一个项目`;
    } else if (!phase) {
      hint.className = 'stage-hint error';
      hint.innerHTML = `${icon('alert')} 该日期不在任何阶段内，请先调整项目阶段。`;
    } else {
      hint.className = 'stage-hint';
      hint.innerHTML = `${icon('target')} 归入 ${esc(phase.name)} · ${fmtShort(phase.start)} 至 ${fmtShort(phase.end)}`;
    }

    const preview = document.getElementById('plan-preview');
    if (!preview) return;
    if (!program || !start) {
      preview.textContent = '选择日期后，这里会预览将生成的计划。';
      preview.classList.remove('error');
      return;
    }
    let dates = [];
    if (mode === 'single' || isEditing) {
      dates = [start];
    } else if (endInput && endInput.value) {
      const activeDays = Array.from(document.querySelectorAll('[data-action="plan-weekday"].active')).map((b) => Number(b.dataset.weekday));
      dates = C.datesBetween(start, endInput.value).filter((d) => activeDays.includes(C.weekday(d)));
    }
    if (mode === 'repeat' && !isEditing && endInput && endInput.value && endInput.value < start) {
      preview.className = 'plan-preview error';
      preview.textContent = '结束日期不能早于开始日期。';
      return;
    }
    if (!dates.length) {
      preview.className = 'plan-preview error';
      preview.textContent = mode === 'repeat' ? '这个日期范围内没有选中的执行日，请调整星期。' : '请选择计划日期。';
      return;
    }
    const outside = dates.filter((d) => !C.phaseForDate(program, d));
    const labels = dates.slice(0, 5).map((d) => C.monthDayLabel(d)).join('、');
    preview.className = outside.length ? 'plan-preview error' : 'plan-preview';
    preview.innerHTML = outside.length
      ? `有 ${outside.length} 天不在「${esc(program.name)}」的阶段内：${outside.slice(0, 3).map(C.monthDayLabel).join('、')}${outside.length > 3 ? ' 等' : ''}。请先调整阶段日期。`
      : `将生成 <strong>${dates.length} 天</strong>计划：${labels}${dates.length > 5 ? ` 等 ${dates.length} 天` : ''}。${mode === 'repeat' ? '已有同项目计划的日期会自动跳过。' : ''}`;
  }

  function collectPlanDeliverables() {
    const rows = Array.from(document.querySelectorAll('#deliverable-editor .deliverable-edit-row'));
    return rows.map((row) => ({
      id: row.dataset.id || '',
      title: row.querySelector('.d-title').value.trim(),
      estimatedUnits: Number(row.dataset.units) || 0
    }));
  }

  function savePlan(editing) {
    const programId = document.getElementById('plan-program').value;
    const program = C.programById(state, programId);
    const content = document.getElementById('plan-content').value.trim();
    const mode = (document.querySelector('#plan-mode .active') || { dataset: { mode: 'single' } }).dataset.mode;
    const start = document.getElementById('plan-start').value;
    const end = document.getElementById('plan-end') ? document.getElementById('plan-end').value : start;
    const isEditing = Boolean(editing);
    const deliverables = collectPlanDeliverables();

    if (!content) {
      showToast('请填写计划内容。', 'alert');
      document.getElementById('plan-content').focus();
      return;
    }
    if (!deliverables.length || deliverables.some((d) => !d.title)) {
      showToast('每个交付物都需要一个名字。', 'alert');
      return;
    }
    if (!isEditing && !start) {
      showToast('请选择计划日期。', 'alert');
      return;
    }

    if (isEditing) {
      if (deliverables.length && deliverables.some((d) => d.id === '')) {
        deliverables.forEach((d) => { if (!d.id) d.id = C.uid('dl'); });
      }
      const oldMap = new Map((editing.deliverables || []).map((d) => [d.id, d]));
      editing.content = content;
      editing.deliverables = deliverables.map((d) => {
        const old = oldMap.get(d.id);
        return {
          id: d.id || C.uid('dl'),
          title: d.title,
          estimatedUnits: d.estimatedUnits,
          actualUnits: old ? old.actualUnits : 0,
          completion: old && typeof old.completion === 'number' ? old.completion : null
        };
      });
      editing.updatedAt = new Date().toISOString();
      persist();
      closeModal();
      render();
      showToast('计划已更新。');
      return;
    }

    let dates = mode === 'single' ? [start] : C.datesBetween(start, end)
      .filter((d) => document.querySelectorAll(`[data-action="plan-weekday"][data-weekday="${C.weekday(d)}"].active`).length > 0);
    if (!dates.length) {
      showToast('没有可生成的日期，请检查日期和星期。', 'alert');
      return;
    }
    const outside = dates.filter((d) => !C.phaseForDate(program, d));
    if (outside.length) {
      showToast(`${C.monthDayLabel(outside[0])} 不在项目阶段内，请先调整阶段日期。`, 'alert');
      return;
    }
    const existing = new Set(state.entries.filter((e) => e.programId === programId).map((e) => e.date));
    const created = [];
    const skipped = [];
    dates.forEach((date) => {
      if (existing.has(date)) {
        skipped.push(date);
        return;
      }
      const phase = C.phaseForDate(program, date);
      const entry = C.buildEntry(state, programId, date, content, deliverables.map((d) => ({
        title: d.title, estimatedUnits: d.estimatedUnits
      })), { phaseId: phase.id });
      state.entries.push(entry);
      created.push(entry);
    });
    if (!created.length) {
      showToast(skipped.length ? '这些日期已经有同项目计划了，请直接编辑日历中的计划。' : '没有生成计划。', 'alert');
      return;
    }
    persist();
    closeModal();
    ui.selectedDate = created[0].date;
    if (ui.tab === 'calendar') {
      ui.calMonth = created[0].date.slice(0, 7);
    }
    render();
    showToast(`已生成 ${created.length} 天计划${skipped.length ? `，跳过 ${skipped.length} 天已有计划` : ''}。`);
  }

  /* ---------------- Reschedule ---------------- */

  function openReschedule(entryId) {
    const entry = state.entries.find((e) => e.id === entryId);
    if (!entry) return;
    const program = C.programById(state, entry.programId);
    if (!program) return;
    const defaultDate = C.addDays(entry.date, 1);
    const html = `<div class="modal">
      ${modalHead('调整计划', `${esc(program.name)} · ${esc(entry.content)}`)}
      <div class="modal-body">
        <div class="day-summary" style="margin-top:2px">
          <div class="score-badge empty">${icon('move')}</div>
          <div class="summary-text"><b>${C.fullDateLabel(entry.date)}</b><span>计划调整会保留已填写的完成度与实际用时。</span></div>
        </div>
        <div class="field">
          <span class="field-label">调整原因 <small>诚实记录，不用内疚</small></span>
          <div class="reason-grid" id="reason-grid">
            ${C.RESCHEDULE_REASONS.map((r) => `<button type="button" class="reason-btn" data-action="pick-reason" data-reason="${r.id}"><b>${r.label}</b><span>${r.hint}</span></button>`).join('')}
          </div>
        </div>
        <div class="form-grid field-block">
          <label class="field"><span class="field-label">新的日期</span><input type="date" class="input" id="reschedule-date" value="${defaultDate}"></label>
          <label class="field"><span class="field-label">备注 <small>可选</small></span><input class="input" id="reschedule-note" maxlength="80" placeholder="例如：临时出差两天"></label>
        </div>
        <div class="alert-line" id="reschedule-warning" hidden>${icon('alert')}<span></span></div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-action="close-modal">取消</button>
        <button class="btn btn-primary" data-action="save-reschedule" data-entry="${entry.id}">${icon('move')} 确认调整</button>
      </div>
    </div>`;
    openModal(html, { type: 'reschedule' });
    updateRescheduleWarning(entry.id);
  }

  function updateRescheduleWarning(entryId) {
    const entry = state.entries.find((e) => e.id === entryId);
    const input = document.getElementById('reschedule-date');
    const warning = document.getElementById('reschedule-warning');
    if (!entry || !input || !warning) return;
    const date = input.value;
    const conflict = state.entries.find((e) => e.programId === entry.programId && e.date === date && e.id !== entry.id);
    const program = C.programById(state, entry.programId);
    const phase = C.phaseForDate(program, date);
    let text = '';
    if (date === entry.date) text = '新日期与原日期相同。';
    else if (!phase) text = '这个日期不在该项目的任何阶段内，请先到设置调整阶段。';
    else if (conflict) text = '该日期已经有一个同项目计划，调整后将有两个。可以考虑先合并或删除其中一个。';
    if (text) {
      warning.hidden = false;
      warning.querySelector('span').textContent = text;
    } else {
      warning.hidden = true;
    }
  }

  function saveReschedule(entryId) {
    const entry = state.entries.find((e) => e.id === entryId);
    if (!entry) return;
    const reasonBtn = document.querySelector('#reason-grid .reason-btn.active');
    const newDate = document.getElementById('reschedule-date').value;
    const note = document.getElementById('reschedule-note').value.trim();
    if (!reasonBtn) {
      showToast('请选择一个调整原因。', 'alert');
      return;
    }
    if (!newDate) {
      showToast('请选择新的日期。', 'alert');
      return;
    }
    if (newDate === entry.date) {
      showToast('新日期与原日期相同。', 'alert');
      return;
    }
    const program = C.programById(state, entry.programId);
    if (!C.phaseForDate(program, newDate)) {
      showToast('新日期不在项目阶段内，请先调整阶段日期。', 'alert');
      return;
    }
    const conflict = state.entries.find((e) => e.programId === entry.programId && e.date === newDate && e.id !== entry.id);
    if (conflict && !window.confirm('新日期已有同项目计划，仍要移动吗？')) return;
    const oldDate = entry.date;
    const reason = C.RESCHEDULE_REASONS.find((r) => r.id === reasonBtn.dataset.reason);
    entry.date = newDate;
    entry.phaseId = C.phaseForDate(program, newDate).id;
    entry.updatedAt = new Date().toISOString();
    if (!Array.isArray(entry.adjustments)) entry.adjustments = [];
    const change = {
      id: C.uid('adj'),
      entryId: entry.id,
      programId: entry.programId,
      from: oldDate,
      to: newDate,
      reason: reason.id,
      reasonLabel: reason.label,
      note,
      at: new Date().toISOString()
    };
    entry.adjustments.push(change);
    state.adjustments.push(change);
    persist();
    closeModal();
    ui.selectedDate = newDate;
    render();
    showToast(`已调整到 ${C.monthDayLabel(newDate)}。原因：${reason.label}${note ? ` · ${note}` : ''}`);
  }

  /* ---------------- Day detail ---------------- */

  function openDayModal(date) {
    const aggregate = C.dayAggregate(state, date);
    const entries = aggregate.entries;
    const info = C.colorInfo(aggregate.score, aggregate.hasPlan);
    const list = entries.length ? `<div class="day-entry-list">${entries.map((entry) => {
      const program = C.programById(state, entry.programId);
      if (!program) return '';
      const sc = C.entryScore(entry);
      const scInfo = C.colorInfo(sc, true);
      const items = (entry.deliverables || []).map((d) => {
        const label = typeof d.completion === 'number'
          ? (C.COMPLETION_OPTIONS.find((o) => Math.abs(o.value - d.completion) < 0.001) || {}).label || `${Math.round(d.completion * 100)}%`
          : '待记录';
        const done = typeof d.completion === 'number' && d.completion >= 1;
        return `<span class="de-item ${done ? 'done' : ''}">${esc(d.title)} · ${label}</span>`;
      }).join('');
      return `<div class="day-entry" style="--p:${program.color};--c:${scInfo.color}">
        <div class="day-entry-head">
          <div class="de-title">
            <div class="de-program"><i></i>${esc(program.name)}</div>
            <h4>${esc(entry.content)}</h4>
          </div>
          <span class="de-score">${C.entryRecordedCount(entry) ? scoreText(sc) : '—'}</span>
        </div>
        <div class="de-items">${items}</div>
        <div class="de-foot">
          <span>${(entry.deliverables || []).length} 项交付物 · 预计 ${timeLabel((entry.deliverables || []).reduce((s, d) => s + (Number(d.estimatedUnits) || 0), 0))}</span>
          <div class="actions">
            <button class="text-btn" data-action="edit-entry" data-entry="${entry.id}">${icon('edit')} 编辑</button>
            <button class="text-btn" data-action="reschedule-entry" data-entry="${entry.id}">${icon('move')} 调整</button>
          </div>
        </div>
      </div>`;
    }).join('')}</div>` : `<div class="empty-state" style="padding:27px 18px;margin-bottom:12px"><div class="empty-art" style="width:58px;height:58px">${icon('sun')}</div><h3 style="font-size:19px">这一天没有计划</h3><p style="margin-bottom:0">可以留白，也可以现在就安排一件小事。</p></div>`;

    const html = `<div class="modal">
      ${modalHead(monthDateLabel(date), `${C.CN_WEEKDAY[C.weekday(date)]} · 北京时间`)}
      <div class="modal-body">
        <div class="day-summary">
          <div class="score-badge ${aggregate.hasPlan ? '' : 'empty'}" style="--c:${info.color}">${aggregate.hasPlan ? scoreText(aggregate.score) : '无'}</div>
          <div class="summary-text">
            <b>${aggregate.hasPlan ? info.label : '还没有安排'}</b>
            <span>${entries.length} 项计划 · ${aggregate.recorded}/${aggregate.deliverables.length} 个交付物已记录${date <= TODAY ? '' : ' · 未来日程'}</span>
          </div>
          <button class="btn btn-soft btn-sm" data-action="open-plan" data-date="${date}">${icon('plus')} 加计划</button>
        </div>
        ${list}
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-action="close-modal">关闭</button>
        <button class="btn btn-primary" data-action="view-day" data-date="${date}">${icon('sun')} 查看当日执行</button>
      </div>
    </div>`;
    openModal(html, { type: 'day' });
  }

  /* ---------------- Program editor ---------------- */

  function phaseRowHTML(phase) {
    const p = phase || {};
    const weekdays = Array.isArray(p.weekdays) ? p.weekdays : [3, 6, 0];
    return `<div class="phase-edit-row" data-phase-id="${p.id || ''}">
      <div class="phase-edit-top">
        <input class="input phase-name" maxlength="30" placeholder="阶段名称，例如：第一阶段 · 筑基" value="${attr(p.name || '')}">
        <button class="icon-btn bare row-remove" type="button" data-action="remove-phase" aria-label="删除阶段">${icon('trash')}</button>
      </div>
      <div class="phase-edit-dates">
        <input type="date" class="input phase-start" value="${p.start || TODAY}">
        <input type="date" class="input phase-end" value="${p.end || `${TODAY.slice(0, 4)}-12-31`}">
      </div>
      <div class="phase-edit-weekdays">
        <label>执行日</label>
        ${C.WEEK_ORDER.map((d) => `<button type="button" class="mini-weekday ${weekdays.includes(d) ? 'active' : ''}" data-action="phase-weekday" data-weekday="${d}">${C.WEEKDAY_SHORT[d]}</button>`).join('')}
      </div>
    </div>`;
  }

  function openProgramModal(programId) {
    const editing = programId ? C.programById(state, programId) : null;
    const program = editing || {
      name: '',
      subtitle: '',
      color: C.PROGRAM_COLORS[(state.programs.length + 1) % C.PROGRAM_COLORS.length],
      phases: [{
        id: '', name: '第一阶段', start: TODAY,
        end: `${TODAY.slice(0, 4)}-12-31`, weekdays: [3, 6, 0]
      }]
    };
    const html = `<div class="modal" data-program-modal>
      ${modalHead(editing ? '编辑项目' : '新增项目', '阶段让长期计划有了清晰的刻度。')}
      <form id="program-form" novalidate>
        <div class="modal-body">
          <div class="form-grid">
            <label class="field"><span class="field-label">项目名称</span><input class="input" id="program-name" maxlength="30" placeholder="例如：英语口语练习" value="${attr(program.name)}"></label>
            <label class="field"><span class="field-label">一句话定位 <small>可选</small></span><input class="input" id="program-subtitle" maxlength="40" placeholder="为什么做这件事" value="${attr(program.subtitle || '')}"></label>
          </div>
          <div class="field field-block">
            <span class="field-label">项目颜色</span>
            <div class="color-swatches" id="program-colors">
              ${C.PROGRAM_COLORS.map((color) => `<button type="button" class="color-swatch ${color === program.color ? 'active' : ''}" style="--c:${color}" data-action="program-color" data-color="${color}" aria-label="选择颜色"></button>`).join('')}
            </div>
          </div>
          <div class="field field-block">
            <span class="field-label">阶段 <small>计划会自动归入对应阶段</small></span>
            <div class="phase-editor-list" id="phase-editor-list">
              ${program.phases.map(phaseRowHTML).join('')}
            </div>
            <button type="button" class="add-row-btn" data-action="add-phase">${icon('plus')} 添加阶段</button>
          </div>
          <p class="field-hint" style="margin-top:12px">每个阶段至少选择一天作为默认执行日；它也会用于计算阶段进度。灵活的项目可把执行日设得宽一些。</p>
        </div>
        <div class="modal-foot">
          ${editing && state.programs.length > 1 ? `<button type="button" class="btn btn-danger left" data-action="delete-program" data-program="${editing.id}">${icon('trash')} 删除项目</button>` : ''}
          <button type="button" class="btn btn-ghost" data-action="close-modal">取消</button>
          <button type="submit" class="btn btn-primary">${icon('check')} 保存项目</button>
        </div>
      </form>
    </div>`;
    openModal(html, { type: 'program' });
    const form = document.getElementById('program-form');
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      saveProgram(editing);
    });
  }

  function collectPhases() {
    const rows = Array.from(document.querySelectorAll('#phase-editor-list .phase-edit-row'));
    return rows.map((row) => ({
      id: row.dataset.phaseId || '',
      name: row.querySelector('.phase-name').value.trim(),
      start: row.querySelector('.phase-start').value,
      end: row.querySelector('.phase-end').value,
      weekdays: Array.from(row.querySelectorAll('.mini-weekday.active')).map((b) => Number(b.dataset.weekday))
    }));
  }

  function saveProgram(editing) {
    const name = document.getElementById('program-name').value.trim();
    const subtitle = document.getElementById('program-subtitle').value.trim();
    const color = (document.querySelector('#program-colors .color-swatch.active') || {}).dataset
      ? document.querySelector('#program-colors .color-swatch.active').dataset.color
      : C.PROGRAM_COLORS[0];
    const phases = collectPhases();
    if (!name) {
      showToast('请填写项目名称。', 'alert');
      return;
    }
    if (!phases.length) {
      showToast('至少保留一个阶段。', 'alert');
      return;
    }
    const invalid = phases.find((p) => !p.name || !p.start || !p.end || p.end < p.start || !p.weekdays.length);
    if (invalid) {
      showToast('每个阶段都需要名称、有效日期和至少一个执行日。', 'alert');
      return;
    }
    if (editing) {
      const existingPhaseIds = new Set((editing.phases || []).map((p) => p.id));
      const removed = Array.from(existingPhaseIds).filter((id) => !phases.some((p) => p.id === id));
      if (removed.some((id) => state.entries.some((e) => e.programId === editing.id && e.phaseId === id))) {
        showToast('该阶段下已有计划，暂时不能删除。请先调整相关计划。', 'alert');
        return;
      }
      editing.name = name;
      editing.subtitle = subtitle;
      editing.color = color;
      editing.phases = phases.map((p) => Object.assign({}, p, { id: p.id || C.uid('phase') }));
      persist();
      closeModal();
      render();
      showToast('项目已更新。');
    } else {
      const newProgram = {
        id: C.uid('program'),
        name,
        subtitle,
        color,
        phases: phases.map((p) => Object.assign({}, p, { id: p.id || C.uid('phase') }))
      };
      state.programs.push(newProgram);
      persist();
      closeModal();
      render();
      showToast(`项目「${name}」已创建。`);
    }
  }

  function deleteProgram(programId) {
    if (state.programs.length <= 1) {
      showToast('至少保留一个项目。', 'alert');
      return;
    }
    const program = C.programById(state, programId);
    const count = state.entries.filter((e) => e.programId === programId).length;
    if (!window.confirm(`删除「${program.name}」会同时删除它的 ${count} 项计划。确定吗？`)) return;
    state.programs = state.programs.filter((p) => p.id !== programId);
    const removedEntryIds = new Set(state.entries.filter((e) => e.programId === programId).map((e) => e.id));
    state.entries = state.entries.filter((e) => e.programId !== programId);
    state.adjustments = state.adjustments.filter((a) => !removedEntryIds.has(a.entryId));
    persist();
    closeModal();
    render();
    showToast('项目已删除。', 'info');
  }

  /* ---------------- Welcome ---------------- */

  function openWelcome() {
    const html = `<div class="modal welcome">
      <div class="logo-big">L</div>
      <h2>把日子过成作品</h2>
      <p class="welcome-sub">LifeLog 帮你看清几个长期计划：先安排，再执行，最后回看。每天只需要几分钟。</p>
      <div class="welcome-points">
        <div class="welcome-point">${icon('calendar')}<div><b>计划具体到日</b><span>阶段、执行日、交付物，一眼知道今天做什么。</span></div></div>
        <div class="welcome-point">${icon('target')}<div><b>评分真实克制</b><span>每个项目每天 1 分，每个交付物等分，超额按 120% 计入。</span></div></div>
        <div class="welcome-point">${icon('spark')}<div><b>颜色比数字更快</b><span>红、绿、黄、棕、灰，一年 365 格，一目了然。</span></div></div>
      </div>
      <div class="welcome-actions">
        <button class="btn btn-primary btn-lg" data-action="welcome-keep">保留示例记录，开始</button>
        <button class="btn btn-soft" data-action="welcome-clear">清空示例，从空白开始</button>
      </div>
      <p class="welcome-note">数据只保存在当前浏览器。换设备前请导出备份。</p>
    </div>`;
    openModal(html, { type: 'welcome' });
  }

  function finishWelcome(keepDemo) {
    if (!keepDemo) C.clearDemoEntries(state);
    state.meta.onboarded = true;
    persist();
    C.ensureAutoBackup(state);
    closeModal();
    render();
    showToast(keepDemo ? '已保留过去两周的示例记录，随时可以在设置中清空。' : '已准备好空白 LifeLog，从今天开始。', 'info');
  }

  /* ---------------- Data tools ---------------- */

  function download(filename, content, type) {
    const blob = new Blob([content], { type: type || 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function exportJSON() {
    const payload = {
      app: 'LifeLog',
      version: C.VERSION,
      exportedAt: new Date().toISOString(),
      timezone: C.TIMEZONE,
      state
    };
    download(`LifeLog-backup-${TODAY.replace(/-/g, '')}.json`, JSON.stringify(payload, null, 2));
    showToast('完整备份已导出。');
  }

  function csvCell(value) {
    const text = String(value == null ? '' : value).replace(/"/g, '""');
    return `"${text}"`;
  }

  function exportCSV() {
    const rows = [['日期', '项目', '阶段', '计划内容', '交付物', '预计用时(h)', '实际用时(h)', '完成度', '交付物得分']];
    state.entries.slice().sort((a, b) => a.date.localeCompare(b.date)).forEach((entry) => {
      const program = C.programById(state, entry.programId);
      const phase = program && (program.phases || []).find((p) => p.id === entry.phaseId);
      (entry.deliverables || []).forEach((d) => {
        const completion = typeof d.completion === 'number'
          ? (C.COMPLETION_OPTIONS.find((o) => Math.abs(o.value - d.completion) < 0.001) || {}).label || d.completion
          : '待记录';
        rows.push([
          entry.date,
          program ? program.name : entry.programId,
          phase ? phase.name : '',
          entry.content,
          d.title,
          ((Number(d.estimatedUnits) || 0) / 2).toFixed(1),
          ((Number(d.actualUnits) || 0) / 2).toFixed(1),
          completion,
          typeof d.completion === 'number' ? d.completion.toFixed(2) : ''
        ]);
      });
    });
    const csv = '\ufeff' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
    download(`LifeLog-records-${TODAY.replace(/-/g, '')}.csv`, csv, 'text/csv;charset=utf-8');
    showToast('CSV 已导出，可用表格软件打开。');
  }

  function handleImportFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const incoming = parsed && parsed.state ? parsed.state : parsed;
        const normalized = C.normalizeState(incoming);
        if (!normalized) throw new Error('invalid');
        if (!window.confirm('导入会覆盖当前所有数据，建议先导出备份。继续导入吗？')) return;
        C.makeBackup(state, '导入前自动备份');
        state = normalized;
        persist();
        ui.selectedDate = TODAY;
        ui.tab = 'today';
        closeModal();
        render();
        showToast('数据导入成功。');
      } catch (err) {
        showToast('文件格式不正确，请选择 LifeLog 导出的 JSON 文件。', 'alert');
      }
    };
    reader.readAsText(file);
  }

  function restoreBackup(backupId) {
    const backups = C.listBackups();
    const backup = backups.find((b) => b.id === backupId);
    if (!backup) {
      showToast('找不到这个备份。', 'alert');
      return;
    }
    const normalized = C.normalizeState(backup.state);
    if (!normalized) {
      showToast('备份内容无法读取。', 'alert');
      return;
    }
    if (!window.confirm(`恢复「${backup.label}」（${formatBackupTime(backup.at)}）？当前数据会被覆盖。`)) return;
    C.makeBackup(state, '恢复前自动备份');
    state = normalized;
    persist();
    closeModal();
    render();
    showToast('备份已恢复。');
  }

  function clearRecords() {
    if (!window.confirm('清空所有计划、执行记录和调整历史？项目和设置会保留。')) return;
    C.makeBackup(state, '清空前自动备份');
    state.entries = [];
    state.adjustments = [];
    state.meta.demo = false;
    state.meta.demoEntryIds = [];
    persist();
    render();
    showToast('记录已清空，项目保留。', 'info');
  }

  function resetAll() {
    if (!window.confirm('重置 LifeLog 会删除所有项目、计划和设置。确定继续吗？')) return;
    C.makeBackup(state, '重置前自动备份');
    state = C.createSeedState();
    state.meta.onboarded = false;
    persist();
    ui.tab = 'today';
    ui.selectedDate = TODAY;
    ui.calMonth = TODAY.slice(0, 7);
    render();
    openWelcome();
  }

  /* ---------------- Event handling ---------------- */

  function handleAction(target, event) {
    const action = target.dataset.action;
    if (!action) return;
    switch (action) {
      case 'close-modal': {
        if (ui.modal === 'welcome') return;
        if (target.classList.contains('modal-backdrop') && event.target !== target) return;
        closeModal();
        break;
      }
      case 'go-tab': {
        const tab = target.dataset.tab;
        if (!tab) return;
        ui.tab = tab;
        closeModal();
        render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        break;
      }
      case 'day-prev':
        ui.selectedDate = C.addDays(ui.selectedDate, -1);
        render();
        break;
      case 'day-next':
        ui.selectedDate = C.addDays(ui.selectedDate, 1);
        render();
        break;
      case 'goto-today':
        ui.selectedDate = TODAY;
        ui.calMonth = TODAY.slice(0, 7);
        render();
        break;
      case 'open-plan':
        openPlanModal({ date: target.dataset.date || ui.selectedDate || TODAY, programId: target.dataset.program });
        break;
      case 'open-plan-next-week':
        openPlanModal({ weekStart: C.addDays(C.startOfWeek(TODAY), 7), date: C.addDays(C.startOfWeek(TODAY), 7) });
        break;
      case 'open-day':
        openDayModal(target.dataset.date);
        break;
      case 'view-day':
        ui.selectedDate = target.dataset.date;
        ui.tab = 'today';
        closeModal();
        render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        break;
      case 'cal-prev-month': {
        const [y, m] = ui.calMonth.split('-').map(Number);
        const d = new Date(y, m - 2, 1, 12);
        ui.calMonth = `${d.getFullYear()}-${C.pad(d.getMonth() + 1)}`;
        render();
        break;
      }
      case 'cal-next-month': {
        const [y, m] = ui.calMonth.split('-').map(Number);
        const d = new Date(y, m, 1, 12);
        ui.calMonth = `${d.getFullYear()}-${C.pad(d.getMonth() + 1)}`;
        render();
        break;
      }
      case 'cal-today':
        ui.calMonth = TODAY.slice(0, 7);
        ui.selectedDate = TODAY;
        render();
        break;
      case 'stats-year-prev':
        ui.statsYear -= 1;
        render();
        break;
      case 'stats-year-next':
        ui.statsYear += 1;
        render();
        break;
      case 'stats-program':
        ui.statsProgram = target.dataset.program || 'all';
        render();
        requestAnimationFrame(() => {
          const card = document.querySelector('.overall-card');
          if (card) card.scrollIntoView({ block: 'start', behavior: 'smooth' });
        });
        break;
      case 'rate': {
        const entry = state.entries.find((e) => e.id === target.dataset.entry);
        if (!entry) return;
        if (entry.date > TODAY) {
          showToast('还没到这一天，完成度要等执行后再填。', 'alert');
          return;
        }
        const deliverable = (entry.deliverables || []).find((d) => d.id === target.dataset.deliverable);
        if (!deliverable) return;
        const value = Number(target.dataset.value);
        const wasSelected = typeof deliverable.completion === 'number'
          && Math.abs(deliverable.completion - value) < 0.001;
        deliverable.completion = wasSelected ? null : value;
        entry.updatedAt = new Date().toISOString();
        persist();
        const allRated = (entry.deliverables || []).every((d) => typeof d.completion === 'number');
        const score = C.entryScore(entry);
        render();
        if (allRated) {
          if (score > 1.0001) showToast(`超额完成，${scoreText(score)} 分。留一点余力，也值得庆祝。`, 'ok');
          else if (score >= 0.9999) showToast('稳稳达标，这一项收下了。', 'ok');
          else if (score > 0.5) showToast(`已记录 ${scoreText(score)} 分。完成比完美重要。`, 'ok');
          else showToast('已记录。即使只完成一点，也算今天没有缺席。', 'info');
        }
        break;
      }
      case 'actual-step': {
        const entry = state.entries.find((e) => e.id === target.dataset.entry);
        if (!entry) return;
        if (entry.date > TODAY) {
          showToast('还没到这一天，实际用时要等执行后再填。', 'alert');
          return;
        }
        const deliverable = (entry.deliverables || []).find((d) => d.id === target.dataset.deliverable);
        if (!deliverable) return;
        const next = Math.max(0, Math.min(48, (Number(deliverable.actualUnits) || 0) + Number(target.dataset.delta)));
        deliverable.actualUnits = next;
        entry.updatedAt = new Date().toISOString();
        persist();
        render();
        break;
      }
      case 'complete-entry': {
        const entry = state.entries.find((e) => e.id === target.dataset.entry);
        if (!entry) return;
        if (entry.date > TODAY) {
          showToast('还没到这一天，等执行后再标记完成。', 'alert');
          return;
        }
        (entry.deliverables || []).forEach((d) => {
          d.completion = 1;
          if (!d.actualUnits) d.actualUnits = d.estimatedUnits || 0;
        });
        entry.updatedAt = new Date().toISOString();
        persist();
        render();
        showToast('所有交付物已标记完成，并按预计用时补齐实际用时。');
        break;
      }
      case 'edit-entry':
        if (ui.modal) closeModal();
        openPlanModal({ entryId: target.dataset.entry });
        break;
      case 'reschedule-entry':
        if (ui.modal) closeModal();
        openReschedule(target.dataset.entry);
        break;
      case 'delete-entry':
        deleteEntry(target.dataset.entry);
        break;
      case 'save-reschedule':
        saveReschedule(target.dataset.entry);
        break;
      case 'pick-reason': {
        document.querySelectorAll('#reason-grid .reason-btn').forEach((b) => b.classList.toggle('active', b === target));
        break;
      }
      case 'plan-mode': {
        document.querySelectorAll('#plan-mode button').forEach((b) => b.classList.toggle('active', b === target));
        updatePlanModal();
        break;
      }
      case 'plan-weekday': {
        target.classList.toggle('active');
        updatePlanModal();
        break;
      }
      case 'add-deliverable': {
        const container = document.getElementById('deliverable-editor');
        const wrap = document.createElement('div');
        wrap.innerHTML = planRowHTML({ title: '', estimatedUnits: 1 });
        container.appendChild(wrap.firstElementChild);
        const rows = container.querySelectorAll('.deliverable-edit-row');
        rows[rows.length - 1].querySelector('.d-title').focus();
        break;
      }
      case 'remove-deliverable': {
        const rows = document.querySelectorAll('#deliverable-editor .deliverable-edit-row');
        if (rows.length <= 1) {
          showToast('至少保留一个交付物。', 'alert');
          return;
        }
        target.closest('.deliverable-edit-row').remove();
        break;
      }
      case 'est-step': {
        const row = target.closest('.deliverable-edit-row');
        const current = Number(row.dataset.units) || 0;
        const next = Math.max(0, Math.min(24, current + Number(target.dataset.delta)));
        row.dataset.units = String(next);
        row.querySelector('.uval').innerHTML = `${timeLabel(next)}<small>预计</small>`;
        break;
      }
      case 'open-program':
        openProgramModal(target.dataset.program);
        break;
      case 'program-color': {
        document.querySelectorAll('#program-colors .color-swatch').forEach((b) => b.classList.toggle('active', b === target));
        break;
      }
      case 'add-phase': {
        const list = document.getElementById('phase-editor-list');
        const wrap = document.createElement('div');
        wrap.innerHTML = phaseRowHTML({
          id: '', name: `第${list.children.length + 1}阶段`, start: TODAY,
          end: `${TODAY.slice(0, 4)}-12-31`, weekdays: [3, 6, 0]
        });
        list.appendChild(wrap.firstElementChild);
        break;
      }
      case 'remove-phase': {
        const list = document.getElementById('phase-editor-list');
        if (list.children.length <= 1) {
          showToast('至少保留一个阶段。', 'alert');
          return;
        }
        target.closest('.phase-edit-row').remove();
        break;
      }
      case 'phase-weekday':
        target.classList.toggle('active');
        break;
      case 'save-profile': {
        const input = document.getElementById('profile-name');
        state.profile.name = input.value.trim();
        persist();
        render();
        showToast('称呼已保存。');
        break;
      }
      case 'toggle-quotes': {
        state.settings.showQuotes = target.checked;
        persist();
        break;
      }
      case 'export-json':
        exportJSON();
        break;
      case 'export-csv':
        exportCSV();
        break;
      case 'import-json':
        document.getElementById('import-file').click();
        break;
      case 'backup-now': {
        const snapshot = C.makeBackup(state, '手动备份');
        render();
        showToast(snapshot ? '本地快照已保存。' : '备份失败，可能是存储空间不足。', snapshot ? 'ok' : 'alert');
        break;
      }
      case 'restore-backup':
        restoreBackup(target.dataset.backup);
        break;
      case 'clear-records':
        clearRecords();
        break;
      case 'reset-all':
        resetAll();
        break;
      case 'welcome-keep':
        finishWelcome(true);
        break;
      case 'welcome-clear':
        finishWelcome(false);
        break;
      case 'delete-program':
        deleteProgram(target.dataset.program);
        break;
      default:
        break;
    }
  }

  function deleteEntry(entryId) {
    const entry = state.entries.find((e) => e.id === entryId);
    if (!entry) return;
    const hadScore = entry.date <= TODAY && C.entryRecordedCount(entry) > 0;
    const lostXp = hadScore ? Math.round((C.entryScore(entry) || 0) * 100) : 0;
    const hint = hadScore && lostXp > 0
      ? `\n这条记录贡献了约 ${lostXp} 能量，删除后会同步扣减。`
      : '';
    if (!window.confirm(`删除「${entry.content}」这项计划？${hint}`)) return;
    state.entries = state.entries.filter((e) => e.id !== entryId);
    state.adjustments = state.adjustments.filter((a) => a.entryId !== entryId);
    persist();
    closeModal();
    render();
    showToast(hadScore && lostXp > 0 ? `计划已删除，同时收回 ${lostXp} 能量。` : '计划已删除。', 'info');
  }

  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    handleAction(target, event);
  });

  document.addEventListener('change', (event) => {
    const target = event.target;
    if (target.id === 'plan-start' || target.id === 'plan-end') {
      updatePlanModal();
    }
    if (target.id === 'plan-program') {
      const program = C.programById(state, target.value);
      const start = document.getElementById('plan-start').value;
      const phase = program && C.phaseForDate(program, start);
      if (phase) {
        document.querySelectorAll('[data-action="plan-weekday"]').forEach((b) => {
          b.classList.toggle('active', phase.weekdays.includes(Number(b.dataset.weekday)));
        });
      }
      updatePlanModal();
    }
    if (target.id === 'reschedule-date') {
      const saveBtn = document.querySelector('[data-action="save-reschedule"]');
      if (saveBtn) updateRescheduleWarning(saveBtn.dataset.entry);
    }
    if (target.id === 'import-file') {
      handleImportFile(target.files[0]);
      target.value = '';
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && ui.modal && ui.modal !== 'welcome') closeModal();
  });

  /* ---------------- Boot ---------------- */

  render();
  if (!state.meta.onboarded) {
    openWelcome();
  } else {
    C.ensureAutoBackup(state);
  }
})();
