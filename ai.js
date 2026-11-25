/* LifeLog — DeepSeek 接入与训练计划生成
 * 说明：
 * 1. 配置存在 ai.settings.v1，Key 只留在本机；备份中心会自动剔除 apiKey。
 * 2. 模型返回的 JSON 会先经过结构化校验，不通过不进入写入流程。
 * 3. 本文件不直接读写 lifelog.v1，写入动作由 app.js 在用户确认后完成。
 */
(function () {
  'use strict';

  const SETTINGS_KEY = 'ai.settings.v1';
  const DEFAULT_SETTINGS = { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: '' };
  const MODEL_PRESETS = [
    { id: 'deepseek-flash', name: 'DeepSeek Flash（快、便宜）', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' },
    { id: 'deepseek-v4-pro', name: 'DeepSeek V4-Pro（更强）', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-pro' }
  ];

  const WEEKDAY_SHORT = { 0: '日', 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六' };

  function pad(n) { return String(n).padStart(2, '0'); }

  function parseDate(str) {
    if (!str) return null;
    const [y, m, d] = String(str).split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d, 12, 0, 0, 0);
  }

  function fmtDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

  function addDays(str, amount) {
    const d = parseDate(str);
    if (!d) return str;
    d.setDate(d.getDate() + amount);
    return fmtDate(d);
  }

  function weekday(str) {
    const d = parseDate(str);
    return d ? d.getDay() : 0;
  }

  function startOfWeek(str) {
    const d = parseDate(str);
    if (!d) return str;
    const off = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - off);
    return fmtDate(d);
  }

  function daysBetween(a, b) {
    const da = parseDate(a);
    const db = parseDate(b);
    if (!da || !db) return 0;
    return Math.round((db.getTime() - da.getTime()) / 86400000);
  }

  function monthDay(str) {
    const d = parseDate(str);
    return d ? `${d.getMonth() + 1}.${d.getDate()}` : str;
  }

  /* ---------------- 配置 ---------------- */

  function loadSettings() {
    let raw = null;
    try { raw = localStorage.getItem(SETTINGS_KEY); } catch (err) { return Object.assign({}, DEFAULT_SETTINGS); }
    if (!raw) return Object.assign({}, DEFAULT_SETTINGS);
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return Object.assign({}, DEFAULT_SETTINGS);
      return {
        baseUrl: typeof parsed.baseUrl === 'string' && parsed.baseUrl ? parsed.baseUrl : DEFAULT_SETTINGS.baseUrl,
        model: typeof parsed.model === 'string' && parsed.model ? parsed.model : DEFAULT_SETTINGS.model,
        apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : ''
      };
    } catch (err) {
      // 配置损坏时只回退到默认值，不覆盖原数据；用户保存时会先留副本
      return Object.assign({}, DEFAULT_SETTINGS);
    }
  }

  function saveSettings(next) {
    const merged = {
      baseUrl: String((next && next.baseUrl) || DEFAULT_SETTINGS.baseUrl).trim().replace(/\/+$/, ''),
      model: String((next && next.model) || DEFAULT_SETTINGS.model).trim(),
      apiKey: String(next && next.apiKey != null ? next.apiKey : '').trim()
    };
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        try { JSON.parse(raw); } catch (err) {
          // 原数据损坏：先保留副本，再写入新配置
          localStorage.setItem(`__rescue.${SETTINGS_KEY}.${Date.now()}`, raw);
        }
      }
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
      return merged;
    } catch (err) {
      return null;
    }
  }

  function hasApiKey() {
    return Boolean(loadSettings().apiKey);
  }

  /* ---------------- 模型调用 ---------------- */

  async function chatRaw(options) {
    const s = (options && options.settings) || loadSettings();
    const apiKey = String(s.apiKey || '').trim();
    if (!apiKey) throw new Error('还没有填写 DeepSeek API Key，请先到设置里保存。');
    const baseUrl = String(s.baseUrl || DEFAULT_SETTINGS.baseUrl).trim().replace(/\/+$/, '');
    const model = String(s.model || DEFAULT_SETTINGS.model).trim();
    if (!baseUrl || !model) throw new Error('接口地址或模型名没有填完整，请到设置里检查。');
    if (!/^https?:\/\//i.test(baseUrl)) throw new Error('接口地址需要以 http:// 或 https:// 开头。');

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120000);
    const body = {
      model,
      temperature: typeof options.temperature === 'number' ? options.temperature : 0.35,
      max_tokens: options.maxTokens || 6000,
      stream: false,
      messages: [
        { role: 'system', content: options.system },
        { role: 'user', content: options.user }
      ]
    };
    if (options.jsonMode !== false) body.response_format = { type: 'json_object' };

    let res;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
    } catch (err) {
      clearTimeout(timer);
      if (err && err.name === 'AbortError') throw new Error('请求超时（120 秒），模型没有响应，请稍后重试。');
      throw new Error('无法连接模型服务，请检查网络、接口地址，或该服务是否允许浏览器直连（CORS）。');
    }
    clearTimeout(timer);

    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 300);
      try {
        const j = JSON.parse(text);
        detail = (j.error && j.error.message) || j.message || detail;
      } catch (err) { /* 保留原始文本 */ }
      if (res.status === 401 || res.status === 403) throw new Error(`API Key 无效或没有权限（${res.status}）：${detail}`);
      if (res.status === 404) throw new Error(`接口地址或模型名不对（404）：${detail}`);
      if (res.status === 429) throw new Error(`请求太频繁或额度用尽（429）：${detail}`);
      throw new Error(`模型服务返回 ${res.status}：${detail}`);
    }

    let data;
    try { data = JSON.parse(text); } catch (err) { throw new Error('模型返回的不是合法数据，可能被截断了。'); }
    const content = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : '';
    if (!content) throw new Error('模型返回内容为空，请稍后重试。');
    return content;
  }

  function parseJSONLoose(text) {
    let t = String(text).trim();
    t = t.replace(/```(?:json|JSON)?/g, '').trim();
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('模型没有按要求返回 JSON，请重试一次。');
    let body = t.slice(start, end + 1);
    const tryParse = (s) => { try { return JSON.parse(s); } catch (err) { return undefined; } };

    let value = tryParse(body);
    if (value !== undefined) return value;

    body = body.replace(/,\s*([}\]])/g, '$1');
    value = tryParse(body);
    if (value !== undefined) return value;

    let fixed = body.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (m) => m
      .replace(/\r/g, '').replace(/\n/g, '\\n').replace(/\t/g, '\\t'));
    value = tryParse(fixed);
    if (value !== undefined) return value;

    fixed = fixed.replace(/[\x00-\x1f]+/g, ' ');
    value = tryParse(fixed);
    if (value !== undefined) return value;

    throw new Error('模型返回的 JSON 格式有误，请重试一次。');
  }

  async function chatJSON(options) {
    try {
      const content = await chatRaw(Object.assign({}, options, { jsonMode: true }));
      return parseJSONLoose(content);
    } catch (err) {
      if (/json_object|JSON 格式|没有按要求返回 JSON/.test(String(err && err.message))) {
        const content = await chatRaw(Object.assign({}, options, { jsonMode: false }));
        return parseJSONLoose(content);
      }
      throw err;
    }
  }

  async function testConnection(override) {
    const settings = Object.assign({}, loadSettings(), override || {});
    const text = await chatRaw({
      settings,
      system: '你是一个接口测试助手，严格按用户要求回复。',
      user: '只回复两个字：可用',
      maxTokens: 20,
      temperature: 0,
      jsonMode: false
    });
    return String(text || '').trim();
  }

  /* ---------------- 训练计划生成 ---------------- */

  const SYSTEM_COACH = `你是一位严谨、务实的耐力跑步教练，擅长为业余跑者制定半程马拉松训练计划。

你的计划必须遵守这些硬性规则：
1. 只依据用户给出的信息安排训练，不虚构用户的伤病、体重、器械或既往训练量。
2. 每周至少安排 1 天完全休息；每周训练次数不能超过用户勾选的可训练日数量。
3. 每次训练只能落在用户勾选的星期（比赛日除外）。
4. 每周跑量相对上一周增幅不超过 8%；比赛前两周逐步减量，比赛周跑量不超过峰值周的 60%。
5. 训练要具体：每次给出内容、总时长、距离与 1-3 条可以勾选的交付物。
6. 高强度课（间歇、节奏跑、比赛）不要连续两天安排。
7. 如果目标成绩与当前水平差距过大，或准备周期不足，在 summary 里直说，但仍要给出当下最合理的计划，不能拒绝出计划。
8. 中文回答；只输出一个 JSON 对象，不要 Markdown 代码块，不要任何解释文字。`;

  function buildUserPrompt(input) {
    const weeks = Math.max(1, Math.ceil(daysBetween(input.today, input.raceDate) / 7));
    const dayText = input.days.slice().sort((a, b) => a - b).map((d) => `周${WEEKDAY_SHORT[d]}`).join('、');
    return `为下面这位跑者制定训练计划。

【今天】${input.today}
【目标赛事】${input.goal}
【比赛日期】${input.raceDate}
【目标成绩】${input.target}
【当前最好成绩】${input.current || '未提供'}
【每周可训练】${dayText}
【单次最长】${input.maxMinutes} 分钟
【场地与器械】${input.equipment || '未提供'}
【伤病与限制】${input.notes || '无'}

计划区间：${input.today} 至 ${input.raceDate}，共约 ${weeks} 周。请从今天之后最近的勾选训练日开始排课。

输出 JSON 结构：
{
  "summary": "3-4 句话：整体思路、关键课、最需要注意的风险",
  "program": {"name": "${input.programName}", "subtitle": "不超过 20 字", "color": "#6F8F6A"},
  "phases": [
    {"name": "第一阶段 · 基础", "start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "focus": "一句话"}
  ],
  "sessions": [
    {
      "date": "YYYY-MM-DD",
      "type": "easy|long|tempo|interval|strength|cross|race",
      "content": "不超过 18 个汉字，例如：轻松跑 8km",
      "minutes": 50,
      "distanceKm": 8,
      "deliverables": [
        {"title": "E 配速完成 8km", "minutes": 40},
        {"title": "拉伸与记录体感", "minutes": 10}
      ],
      "note": "可选，一句提醒"
    }
  ]
}

要求：
- phases 覆盖整个计划区间，2-4 个阶段，日期连续不重叠。
- sessions 覆盖每个训练日，不要排休息日；比赛日必须有一条 type=race。
- 每条 session 的 deliverables 为 1-3 条，minutes 之和等于 session.minutes（允许 ±5 分钟）。
- 单次 minutes 不超过 ${input.maxMinutes}，distanceKm 与 minutes 匹配。
- 所有日期格式为 YYYY-MM-DD。只输出 JSON。`;
  }

  function toInt(value, min, max, fallback) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function normalizeDate(value) {
    const s = String(value == null ? '' : value).trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
  }

  function normalizeType(value) {
    const list = ['easy', 'long', 'tempo', 'interval', 'strength', 'cross', 'race'];
    return list.indexOf(value) >= 0 ? value : 'easy';
  }

  // 把交付物的分钟数对齐到 5 分钟，并保证合计等于本次训练时长
  function normalizeDeliverables(rawList, minutes) {
    let items = (Array.isArray(rawList) ? rawList : []).map((d) => {
      if (typeof d === 'string') return { title: d.trim(), minutes: 0 };
      if (!d || typeof d !== 'object') return null;
      return {
        title: String(d.title || d.name || '').trim(),
        minutes: Number(d.minutes) || 0
      };
    }).filter((d) => d && d.title).slice(0, 3);

    items.forEach((d) => { d.title = d.title.slice(0, 40); });
    if (!items.length) items = [{ title: '完成本次训练', minutes: minutes }];

    const total = items.reduce((sum, d) => sum + Math.max(0, d.minutes), 0);
    if (!total) {
      const each = Math.max(5, Math.round(minutes / items.length / 5) * 5);
      items.forEach((d) => { d.minutes = each; });
    } else {
      const scale = minutes / total;
      items.forEach((d) => {
        d.minutes = Math.max(5, Math.round((Math.max(0, d.minutes) * scale) / 5) * 5);
      });
    }

    // 修正取整后的误差，落在最后一条上
    let sum = items.reduce((acc, d) => acc + d.minutes, 0);
    let guard = 0;
    while (sum !== minutes && items.length && guard < 40) {
      const delta = sum > minutes ? -5 : 5;
      const last = items[items.length - 1];
      const next = last.minutes + delta;
      if (next >= 5) { last.minutes = next; sum += delta; }
      else break;
      guard += 1;
    }
    return items;
  }

  function normalizePlan(raw, input) {
    const sessionsRaw = Array.isArray(raw && raw.sessions) ? raw.sessions : [];
    const byDate = {};

    sessionsRaw.forEach((s) => {
      if (!s || typeof s !== 'object') return;
      if (s.type === 'rest') return;
      const date = normalizeDate(s.date);
      const content = String(s.content || '').trim().slice(0, 30);
      if (!date || !content) return;
      if (byDate[date]) return;

      let minutes = toInt(s.minutes, 10, 240, 0);
      let km = Number(s.distanceKm);
      if (!Number.isFinite(km) || km < 0) km = 0;
      if (!minutes) minutes = km ? Math.round((km * 6) / 5) * 5 : 45;
      minutes = Math.max(10, Math.min(240, minutes));

      byDate[date] = {
        date,
        type: normalizeType(s.type),
        content,
        minutes,
        distanceKm: km ? Math.round(km * 10) / 10 : 0,
        note: String(s.note || '').trim().slice(0, 80),
        deliverables: normalizeDeliverables(s.deliverables, minutes)
      };
    });

    const sessions = Object.keys(byDate).sort().map((k) => byDate[k]);
    if (!sessions.length) throw new Error('模型没有返回可用的训练安排，请重试一次。');

    // 阶段：排序、去重叠、补齐首尾，保证每一天都能归入某个阶段
    let phases = (Array.isArray(raw.phases) ? raw.phases : []).map((p) => {
      if (!p || typeof p !== 'object') return null;
      const start = normalizeDate(p.start);
      const end = normalizeDate(p.end);
      if (!start || !end) return null;
      return {
        name: String(p.name || '训练阶段').trim().slice(0, 30),
        start: start <= end ? start : end,
        end: start <= end ? end : start,
        focus: String(p.focus || '').trim().slice(0, 60)
      };
    }).filter(Boolean).sort((a, b) => a.start.localeCompare(b.start));

    if (!phases.length) {
      phases = [{ name: '训练周期', start: input.today, end: input.raceDate, focus: '' }];
    }
    phases[0].start = phases[0].start < input.today ? phases[0].start : input.today;
    for (let i = 1; i < phases.length; i += 1) {
      if (phases[i].start <= phases[i - 1].end) phases[i].start = addDays(phases[i - 1].end, 1);
      if (phases[i].end < phases[i].start) phases[i].end = phases[i].start;
    }
    const lastPhase = phases[phases.length - 1];
    if (lastPhase.end < input.raceDate) lastPhase.end = input.raceDate;

    const programRaw = (raw && raw.program) || {};
    const color = /^#[0-9a-fA-F]{6}$/.test(String(programRaw.color || '')) ? programRaw.color : '#6F8F6A';

    return {
      summary: String((raw && raw.summary) || '').trim().slice(0, 500),
      program: {
        name: String(programRaw.name || input.programName || 'AI 训练计划').trim().slice(0, 30),
        subtitle: String(programRaw.subtitle || `目标 ${input.target}`).trim().slice(0, 40),
        color
      },
      phases,
      sessions
    };
  }

  function effectiveKm(session) {
    if (!session) return 0;
    if (session.distanceKm > 0) return session.distanceKm;
    return session.minutes / 6;
  }

  function validatePlan(plan, input) {
    const errors = [];
    const warnings = [];
    const sessions = (plan && plan.sessions) || [];
    const allowed = Array.isArray(input.days) ? input.days : [];
    const startDate = input.startDate || input.today;
    const raceDate = input.raceDate;

    if (!sessions.length) {
      return { errors: ['计划里没有任何训练安排。'], warnings: [], stats: null, weeks: [] };
    }

    const seen = {};
    sessions.forEach((s) => {
      const label = `${monthDay(s.date)} 周${WEEKDAY_SHORT[weekday(s.date)]}`;
      if (!s.date || !parseDate(s.date)) {
        errors.push(`有一条训练的日期无法识别：${s.date || '（空）'}`);
        return;
      }
      if (s.date < startDate) errors.push(`${label} 早于今天，不能写入。`);
      if (s.date > raceDate) errors.push(`${label} 晚于比赛日。`);
      if (s.date !== raceDate && allowed.indexOf(weekday(s.date)) === -1) {
        errors.push(`${label} 不在你勾选的训练日里。`);
      }
      if (!s.content) errors.push(`${label} 缺少训练内容。`);
      if (!Array.isArray(s.deliverables) || !s.deliverables.length) errors.push(`${label} 没有可勾选的交付物。`);
      if (s.minutes > input.maxMinutes) errors.push(`${label} 安排了 ${s.minutes} 分钟，超过单次上限 ${input.maxMinutes} 分钟。`);
      if (seen[s.date]) errors.push(`${label} 出现了两次。`);
      seen[s.date] = true;
    });

    if (!seen[raceDate]) errors.push(`比赛日 ${monthDay(raceDate)} 还没有安排比赛。`);

    // 按周汇总
    const map = {};
    sessions.forEach((s) => {
      const key = startOfWeek(s.date);
      if (!map[key]) map[key] = { start: key, sessions: [], volume: 0 };
      map[key].sessions.push(s);
      map[key].volume += effectiveKm(s);
    });
    const weeks = Object.keys(map).sort().map((key, index) => {
      const w = map[key];
      w.index = index;
      w.end = addDays(key, 6);
      w.label = `${monthDay(key)} – ${monthDay(w.end)}`;
      w.volume = Math.round(w.volume * 10) / 10;
      w.hasRace = w.sessions.some((s) => s.date === raceDate);
      return w;
    });

    weeks.forEach((w) => {
      const limit = allowed.length + (w.hasRace && allowed.indexOf(weekday(raceDate)) === -1 ? 1 : 0);
      if (w.sessions.length > limit) {
        errors.push(`${w.label} 安排了 ${w.sessions.length} 次训练，超过每周 ${limit} 次的上限。`);
      }
      if (w.sessions.length >= 7) errors.push(`${w.label} 七天都在训练，至少需要留 1 天休息。`);
    });

    // 跑量增幅
    for (let i = 1; i < weeks.length; i += 1) {
      const prev = weeks[i - 1].volume;
      const cur = weeks[i].volume;
      if (!prev || !cur) continue;
      const ratio = cur / prev;
      if (ratio > 1.2) {
        errors.push(`${weeks[i].label} 跑量比上周增加 ${Math.round((ratio - 1) * 100)}%，超过 20% 的安全上限。`);
      } else if (ratio > 1.1) {
        warnings.push(`${weeks[i].label} 跑量比上周增加 ${Math.round((ratio - 1) * 100)}%，略高于 10% 的建议值。`);
      }
    }

    // 减量：比较峰值周与最后两周
    if (weeks.length >= 4) {
      const peak = weeks.reduce((max, w) => Math.max(max, w.volume), 0);
      const last = weeks[weeks.length - 1];
      const prev = weeks[weeks.length - 2];
      if (peak > 0) {
        if (last.volume > peak * 0.85) {
          errors.push(`比赛周（${last.label}）跑量 ${last.volume}km，仍接近峰值周 ${peak}km，需要明显减量。`);
        } else if (last.volume > peak * 0.75) {
          warnings.push(`比赛周跑量约为峰值周的 ${Math.round((last.volume / peak) * 100)}%，可以再轻一点。`);
        }
        if (prev.volume > peak) warnings.push(`赛前一周（${prev.label}）没有减量，建议低于峰值周。`);
        if (weeks.length >= 6 && last.volume > prev.volume * 1.05) {
          errors.push(`比赛周跑量高于前一周，赛前没有减量。`);
        }
      }
    }

    if (weeks.length >= 4 && sessions.length < weeks.length) {
      errors.push(`计划跨 ${weeks.length} 周，但只有 ${sessions.length} 次训练，频率过低。`);
    }

    // 高强度连续两天
    const high = { interval: true, tempo: true, race: true };
    for (let i = 1; i < sessions.length; i += 1) {
      if (high[sessions[i].type] && high[sessions[i - 1].type]
        && daysBetween(sessions[i - 1].date, sessions[i].date) === 1) {
        warnings.push(`${monthDay(sessions[i - 1].date)} 和 ${monthDay(sessions[i].date)} 连续安排了两节高强度课，注意恢复。`);
      }
    }

    const totalKm = weeks.reduce((sum, w) => sum + w.volume, 0);
    const stats = {
      weeks: weeks.length,
      sessions: sessions.length,
      totalKm: Math.round(totalKm),
      peakWeekKm: Math.round(weeks.reduce((max, w) => Math.max(max, w.volume), 0)),
      firstDate: sessions[0].date,
      lastDate: sessions[sessions.length - 1].date
    };

    return {
      errors: Array.from(new Set(errors)).slice(0, 12),
      warnings: Array.from(new Set(warnings)).slice(0, 8),
      stats,
      weeks
    };
  }

  async function generatePlan(input) {
    const raw = await chatJSON({
      system: SYSTEM_COACH,
      user: buildUserPrompt(input),
      maxTokens: 6000,
      temperature: 0.35
    });
    const plan = normalizePlan(raw, input);
    return { plan, validation: validatePlan(plan, input) };
  }

  function minutesToUnits(minutes) {
    const units = Math.round((Number(minutes) || 0) / 15) / 2;
    return Math.max(0.5, units);
  }

  window.LifeLogAI = {
    SETTINGS_KEY,
    DEFAULT_SETTINGS,
    MODEL_PRESETS,
    loadSettings,
    saveSettings,
    hasApiKey,
    testConnection,
    generatePlan,
    validatePlan,
    minutesToUnits
  };
})();
