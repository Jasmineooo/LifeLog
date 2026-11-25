/* LifeLog — DeepSeek 接入与训练计划生成
 * 说明：
 * 1. 配置存在 ai.settings.v1，Key 只留在本机；备份中心会自动剔除 apiKey。
 * 2. 模型返回的 JSON 会先经过结构化校验，不通过不进入写入流程。
 * 3. 本文件不直接读写 lifelog.v1，写入动作由 app.js 在用户确认后完成。
 */
(function () {
  'use strict';

  const SETTINGS_KEY = 'ai.settings.v1';
  const AI_VERSION = 'v11';
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

  const NETWORK_HINT = '网络连接中断（Failed to fetch）：模型生成时间较长时，连接可能被浏览器或网络掐断。已自动重试，如仍失败请换一个网络（Wi‑Fi 与流量互换）或稍后再试。';
  const IDLE_TIMEOUT = 90000;
  const TOTAL_TIMEOUT = 300000;

  function taggedError(message, kind) {
    const err = new Error(message);
    err.kind = kind;
    return err;
  }

  function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

  function resolveEndpoint(options) {
    const s = (options && options.settings) || loadSettings();
    const apiKey = String(s.apiKey || '').trim();
    if (!apiKey) throw new Error('还没有填写 DeepSeek API Key，请先到设置里保存。');
    const baseUrl = String(s.baseUrl || DEFAULT_SETTINGS.baseUrl).trim().replace(/\/+$/, '');
    const model = String(s.model || DEFAULT_SETTINGS.model).trim();
    if (!baseUrl || !model) throw new Error('接口地址或模型名没有填完整，请到设置里检查。');
    if (!/^https?:\/\//i.test(baseUrl)) throw new Error('接口地址需要以 http:// 或 https:// 开头。');
    return { apiKey, baseUrl, model };
  }

  function buildBody(options, model, stream) {
    const body = {
      model,
      temperature: typeof options.temperature === 'number' ? options.temperature : 0.35,
      max_tokens: options.maxTokens || 4000,
      stream: Boolean(stream),
      messages: [
        { role: 'system', content: options.system },
        { role: 'user', content: options.user }
      ]
    };
    if (options.jsonMode !== false) body.response_format = { type: 'json_object' };
    return body;
  }

  async function statusError(res) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 300); } catch (err) { detail = ''; }
    try {
      const j = JSON.parse(detail);
      detail = (j.error && j.error.message) || j.message || detail;
    } catch (err) { /* 保留原始文本 */ }
    if (res.status === 401 || res.status === 403) return new Error(`API Key 无效或没有权限（${res.status}）：${detail}`);
    if (res.status === 404) return new Error(`接口地址或模型名不对（404）：${detail}`);
    if (res.status === 429) return new Error(`请求太频繁或额度用尽（429）：${detail}`);
    return new Error(`模型服务返回 ${res.status}：${detail}`);
  }

  // 兼容字符串、数组分段（部分中转服务会返回 [{type:'text',text:'…'}]）
  function normalizeContent(value) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      return value.map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part.text === 'string') return part.text;
        return '';
      }).join('');
    }
    return '';
  }

  function emptyContentError(choice, reasoning) {
    const finish = (choice && choice.finish_reason) || 'unknown';
    if (reasoning) {
      return taggedError(`模型把输出额度都用在了思考上（finish: ${finish}），没有给出计划正文。建议在设置里换用非思考型的对话模型。`, 'empty');
    }
    if (finish === 'length') {
      return taggedError('模型输出被截断：计划太长，超出了本次生成上限。', 'empty');
    }
    return taggedError(`模型返回内容为空（finish: ${finish}）。`, 'empty');
  }

  function extractContent(text) {
    let data;
    try { data = JSON.parse(text); } catch (err) { throw new Error('模型返回的不是合法数据，可能被截断了。'); }
    const choice = data && data.choices && data.choices[0];
    const message = (choice && choice.message) || {};
    const content = normalizeContent(message.content) || normalizeContent(choice && choice.text);
    const reasoning = normalizeContent(message.reasoning_content || message.reasoning);
    if (!content) {
      if (choice && choice.finish_reason === 'length') {
        throw new Error('模型输出被截断：计划太长，超出了本次生成上限。');
      }
      throw emptyContentError(choice, reasoning);
    }
    if (choice && choice.finish_reason === 'length') {
      throw new Error('模型输出被截断：计划太长，超出了本次生成上限。');
    }
    return content;
  }

  // 流式请求：边生成边接收，避免长时间无数据被网络掐断
  async function requestStream(options, ctx) {
    const ctrl = new AbortController();
    let totalTimer = setTimeout(() => ctrl.abort(), TOTAL_TIMEOUT);
    let idleTimer = null;
    const armIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => ctrl.abort(), IDLE_TIMEOUT);
    };
    const cleanup = () => {
      clearTimeout(totalTimer);
      if (idleTimer) clearTimeout(idleTimer);
      totalTimer = null;
      idleTimer = null;
    };

    let res;
    try {
      armIdle();
      res = await fetch(`${ctx.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ctx.apiKey}`
        },
        body: JSON.stringify(buildBody(options, ctx.model, true)),
        signal: ctrl.signal
      });
    } catch (err) {
      cleanup();
      if (err && err.name === 'AbortError') throw taggedError('连接超时：模型长时间没有响应。', 'timeout');
      throw taggedError(NETWORK_HINT, 'network');
    }

    if (!res.ok) {
      cleanup();
      throw await statusError(res);
    }

    if (!res.body || typeof res.body.getReader !== 'function') {
      let text = '';
      try { text = await res.text(); } catch (err) { cleanup(); throw taggedError(NETWORK_HINT, 'network'); }
      cleanup();
      return extractContent(text);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let content = '';
    let reasoning = '';
    let finish = '';
    let serverError = '';
    let sawSSE = false;
    let done = false;

    try {
      while (!done) {
        const chunk = await reader.read();
        if (chunk.done) break;
        armIdle();
        buffer += decoder.decode(chunk.value, { stream: true });
        if (!sawSSE && buffer.trim().charAt(0) === '{') {
          // 服务端忽略了 stream 参数，直接返回完整 JSON
          let rest = '';
          try { rest = await res.text(); } catch (err) { rest = ''; }
          buffer += rest;
          break;
        }
        let index = buffer.indexOf('\n');
        while (index >= 0 && !done) {
          const line = buffer.slice(0, index).replace(/\r$/, '').trim();
          buffer = buffer.slice(index + 1);
          index = buffer.indexOf('\n');
          if (!line || line.charAt(0) === ':') continue;
          if (line.indexOf('data:') !== 0) continue;
          sawSSE = true;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          if (payload === '[DONE]') { done = true; break; }
          let obj;
          try { obj = JSON.parse(payload); } catch (err) { continue; }
          if (obj && obj.error) {
            serverError = obj.error.message || '模型返回错误。';
            done = true;
            break;
          }
          const choice = obj && obj.choices && obj.choices[0];
          if (!choice) continue;
          if (choice.finish_reason) finish = choice.finish_reason;
          const piece = normalizeContent(choice.delta && choice.delta.content);
          if (piece) content += piece;
          const think = normalizeContent(choice.delta && (choice.delta.reasoning_content || choice.delta.reasoning));
          if (think) reasoning += think;
        }
      }
    } catch (err) {
      cleanup();
      if (err && err.name === 'AbortError') throw taggedError('生成中断：模型超过 90 秒没有输出。', 'timeout');
      throw taggedError(NETWORK_HINT, 'network');
    }
    cleanup();

    if (serverError) throw new Error(serverError);
    if (!sawSSE) {
      // 整体 JSON
      const trimmed = buffer.trim();
      if (trimmed.charAt(0) === '{' || trimmed.charAt(0) === '[') return extractContent(trimmed);
      throw taggedError('模型返回的格式无法识别。', 'empty');
    }
    if (!content) throw emptyContentError({ finish_reason: finish }, reasoning);
    if (finish === 'length') {
      throw taggedError('模型输出被截断：计划太长，超出了本次生成上限，正在改用分段生成。', 'empty');
    }
    return content;
  }

  async function requestPlain(options, ctx) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TOTAL_TIMEOUT);
    let res;
    try {
      res = await fetch(`${ctx.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ctx.apiKey}`
        },
        body: JSON.stringify(buildBody(options, ctx.model, false)),
        signal: ctrl.signal
      });
    } catch (err) {
      clearTimeout(timer);
      if (err && err.name === 'AbortError') throw taggedError('请求超时，模型没有响应，请稍后重试。', 'timeout');
      throw taggedError(NETWORK_HINT, 'network');
    }
    clearTimeout(timer);
    if (!res.ok) throw await statusError(res);

    let text = '';
    try { text = await res.text(); } catch (err) { throw taggedError(NETWORK_HINT, 'network'); }
    return extractContent(text);
  }

  // 先流式两次，仍失败则退回普通请求；只对网络类错误重试
  async function chatRaw(options) {
    const ctx = resolveEndpoint(options);
    const plan = [true, true, false];
    let lastError = null;
    for (let i = 0; i < plan.length; i += 1) {
      try {
        return plan[i] ? await requestStream(options, ctx) : await requestPlain(options, ctx);
      } catch (err) {
        lastError = err;
        if (!err || (err.kind !== 'network' && err.kind !== 'timeout')) throw err;
        if (i < plan.length - 1) await sleep(1500);
      }
    }
    throw lastError;
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
    // 依次尝试：标准 → 去掉 json_object（额度小幅上调）
    // lowBudget 模式只给两次、且上限很小，避免思考型模型把额度拉满
    const base = options.maxTokens || 4000;
    const attempts = options.lowBudget
      ? [
        { jsonMode: true, maxTokens: base, hint: '' },
        { jsonMode: false, maxTokens: base * 2, hint: '直接给出结果，最多思考 3 步，不要输出思考过程。' }
      ]
      : [
        { jsonMode: true, maxTokens: base, hint: '' },
        { jsonMode: false, maxTokens: Math.max(base, 8000), hint: '' },
        { jsonMode: false, maxTokens: Math.max(base, 16000), hint: '直接输出结果，不要输出任何思考、分析或解释过程。' }
      ];
    let lastError = null;
    for (let i = 0; i < attempts.length; i += 1) {
      const attempt = attempts[i];
      try {
        const content = await chatRaw({
          settings: options.settings,
          system: attempt.hint ? `${options.system}\n${attempt.hint}` : options.system,
          user: options.user,
          temperature: options.temperature,
          maxTokens: attempt.maxTokens,
          jsonMode: attempt.jsonMode
        });
        return parseJSONLoose(content);
      } catch (err) {
        lastError = err;
        const retryable = (err && err.kind === 'empty')
          || /json_object|JSON 格式|没有按要求返回 JSON|max_tokens/i.test(String(err && err.message));
        if (!retryable) throw err;
      }
    }
    throw lastError;
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

  /* ---------------- 训练计划生成（每次只排 2 周，控制 token） ---------------- */

  const BATCH_WEEKS = 2;

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

  // 质量课是否写清了配速或组数
  function hasPaceDetail(session) {
    const text = [
      session.content || '',
      session.note || '',
      (session.deliverables || []).map((d) => d && d.title || '').join(' ')
    ].join(' ');
    return /配速|@|\d+\s*[×xX*]\s*\d+|\d+['′:：]\d{2}/.test(text);
  }

  function validatePlan(plan, input, options) {
    const partial = Boolean(options && options.partial);
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
      if (s.minutes > input.maxMinutes) {
        if (s.date === raceDate || s.type === 'race') {
          warnings.push(`${label} 比赛用时 ${s.minutes} 分钟，超过日常单次上限，属正常情况。`);
        } else {
          errors.push(`${label} 安排了 ${s.minutes} 分钟，超过单次上限 ${input.maxMinutes} 分钟。`);
        }
      }
      if (seen[s.date]) errors.push(`${label} 出现了两次。`);
      seen[s.date] = true;
    });

    if (!partial && !seen[raceDate]) errors.push(`比赛日 ${monthDay(raceDate)} 还没有安排比赛。`);

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
      const raceSession = w.sessions.find((s) => s.date === raceDate);
      w.volumeNoRace = Math.round((w.volume - (raceSession ? effectiveKm(raceSession) : 0)) * 10) / 10;
      return w;
    });

    weeks.forEach((w) => {
      const cap = maxSessionsPerWeek(input);
      const limit = cap + (w.hasRace && allowed.indexOf(weekday(raceDate)) === -1 ? 1 : 0);
      if (w.sessions.length > limit) {
        errors.push(`${w.label} 安排了 ${w.sessions.length} 次训练，超过每周 ${limit} 次的上限。`);
      }
      if (w.sessions.length >= 7) errors.push(`${w.label} 七天都在训练，至少需要留 1 天休息。`);

      if (w.hasRace) return;
      const longest = w.sessions.reduce((best, s) => (effectiveKm(s) > effectiveKm(best) ? s : best), w.sessions[0]);
      w.sessions.forEach((s) => {
        if (s.type === 'long' && s !== longest && effectiveKm(longest) - effectiveKm(s) > 0.5) {
          warnings.push(`${monthDay(s.date)} 标为长距离，但不是本周最长的一次，建议把最长的一课单独安排。`);
        }
        if ((s.type === 'interval' || s.type === 'tempo') && !hasPaceDetail(s)) {
          warnings.push(`${monthDay(s.date)} 的${s.type === 'interval' ? '间歇' : '节奏'}课没写配速或组数。`);
        }
      });
    });

    // 跑量增幅（比赛周含比赛距离，单独判断，不参与增幅比较）
    for (let i = 1; i < weeks.length; i += 1) {
      if (weeks[i].hasRace) continue;
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

    // 减量：比赛周只看除比赛外的训练量
    if (weeks.length >= 3) {
      const trainingWeeks = weeks.slice(0, weeks.length - 1);
      const peak = trainingWeeks.reduce((max, w) => Math.max(max, w.volume), 0);
      const last = weeks[weeks.length - 1];
      const prev = weeks[weeks.length - 2];
      if (peak > 0) {
        if (last.volumeNoRace > peak * 0.7) {
          errors.push(`比赛周（${last.label}）除比赛外还安排了 ${last.volumeNoRace}km，赛前应只留少量轻松跑。`);
        } else if (last.volumeNoRace > peak * 0.55) {
          warnings.push(`比赛周除比赛外还有 ${last.volumeNoRace}km 训练，可以再轻一点。`);
        }
        if (prev.volume > peak) warnings.push(`赛前一周（${prev.label}）没有减量，建议低于峰值周 ${peak}km。`);
        if (weeks.length >= 5 && last.volumeNoRace > prev.volume * 0.8) {
          warnings.push(`比赛周的训练量和前一周接近，赛前减量不明显。`);
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
      const longA = effectiveKm(sessions[i - 1]) >= 14;
      const longB = effectiveKm(sessions[i]) >= 14;
      if (longA && longB && daysBetween(sessions[i - 1].date, sessions[i].date) === 1) {
        warnings.push(`${monthDay(sessions[i - 1].date)} 和 ${monthDay(sessions[i].date)} 连续两天都是长距离，建议错开。`);
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

  /* ---------------- 分段生成：单次生成失败时自动启用 ---------------- */

  const SYSTEM_COACH_CHUNK = `你是严谨的耐力跑步教练，正在为业余跑者分段制定半程马拉松训练计划。
只依据给出的信息安排，不虚构伤病或器械；只输出一个 JSON 对象，不要 Markdown，不要解释。`;

  function eachDate(start, end, limit) {
    const list = [];
    let cursor = start;
    const cap = limit || 10;
    while (cursor <= end && list.length < cap) {
      list.push(cursor);
      cursor = addDays(cursor, 1);
    }
    return list;
  }

  function mondayOf(dateStr) {
    const d = parseDate(dateStr);
    if (!d) return dateStr;
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return fmtDate(d);
  }

  function parseTimeToMinutes(value) {
    const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(value || '').trim());
    if (!m) return 0;
    if (m[3] !== undefined) return Number(m[1]) * 60 + Number(m[2]);
    const first = Number(m[1]);
    const second = Number(m[2]);
    return first <= 5 ? first * 60 + second : first;
  }

  // 每周最多训练几次：优先用表单里的上限，其次读备注里的「最多四天」，最后按勾选天数
  const CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6 };

  function noteSessionCap(notes) {
    const m = /最多[^0-9一二两三四五六]{0,4}([1-6一二两三四五六])\s*(?:天|次)/.exec(String(notes || ''));
    if (!m) return 0;
    const ch = m[1];
    return /[1-6]/.test(ch) ? Number(ch) : (CN_NUM[ch] || 0);
  }

  function maxSessionsPerWeek(input) {
    const allowed = Array.isArray(input.days) ? input.days.length : 0;
    let cap = Number(input.maxSessions);
    if (!Number.isFinite(cap) || cap < 1) cap = noteSessionCap(input.notes) || allowed;
    if (allowed) cap = Math.min(cap, allowed);
    return Math.max(1, Math.min(6, cap || 1));
  }

  // 从目标赛事里识别比赛距离，交给模型按对应项目标准安排课量
  function raceDistanceKm(input) {
    const text = `${input.goal || ''} ${input.programName || ''}`;
    if (/全马|全程马拉松|42(\.195)?/.test(text)) return 42.2;
    if (/半马|半程|21(\.0975)?/.test(text)) return 21.1;
    if (/10\s*(km|公里)|十公里/.test(text)) return 10;
    if (/5\s*(km|公里)|五公里/.test(text)) return 5;
    return 21.1;
  }

  // 由程序给出每周可选日期与参考跑量，具体课表交给模型安排
  function buildWeekPlan(input) {
    const weeks = [];
    let cursor = mondayOf(input.today);
    while (cursor <= input.raceDate && weeks.length < 40) {
      weeks.push(cursor);
      cursor = addDays(cursor, 7);
    }
    const n = weeks.length;
    const sessionCap = maxSessionsPerWeek(input);
    const raceDist = raceDistanceKm(input);
    const perSessionKm = Math.max(3, input.maxMinutes / 6);
    const weeklyCap = Math.max(14, Math.round(perSessionKm * sessionCap * 0.9));
    const peakIndex = Math.max(0, n - 3);
    // 参考周跑量随比赛距离变化：全马需要更高基础，5/10km 则更低
    const perSessionHint = raceDist >= 40 ? 12 : raceDist >= 20 ? 9 : 6;
    const base = Math.max(20, Math.min(Math.round(sessionCap * perSessionHint), weeklyCap));
    const peakVolume = Math.round(Math.min(base * Math.pow(1.06, peakIndex), weeklyCap));

    return weeks.map((start, i) => {
      const end = addDays(start, 6);
      const dates = eachDate(start, end).filter((d) => {
        if (d < input.today || d > input.raceDate) return false;
        return input.days.indexOf(weekday(d)) >= 0 || d === input.raceDate;
      });
      let volume;
      if (i === n - 1) volume = Math.round(raceDist + (dates.length > 1 ? 5 : 0));
      else if (i > peakIndex) volume = Math.max(8, Math.round(peakVolume * 0.62));
      else volume = Math.round(Math.min(base * Math.pow(1.06, i), weeklyCap));
      return {
        start,
        end,
        dates,
        volume,
        hasRace: dates.indexOf(input.raceDate) >= 0
      };
    });
  }

  function buildChunkPrompt(input, batch, index, total) {
    const weekLines = batch.map((w, i) => {
      const dateLines = w.dates.map((d) => {
        const tag = d === input.raceDate ? '（比赛日）' : '';
        return `${d}（周${WEEKDAY_SHORT[weekday(d)]}）${tag}`;
      }).join('、');
      const weekTag = w.hasRace ? ' · 比赛周' : '';
      return `第 ${i + 1} 周（${w.start} 至 ${w.end}${weekTag}）可训练日：${dateLines || '无'}；参考周跑量约 ${w.volume}km`;
    }).join('\n');

    return `你是耐力跑步教练，请为下面的跑者安排这两周的训练，课型、内容、距离和时长都由你决定。

【跑者】目标 ${input.goal}（比赛距离 ${raceDistanceKm(input)}km），${input.raceDate} 比赛，目标成绩 ${input.target}，当前最好 ${input.current || '未提供'}
【限制】每周最多 ${maxSessionsPerWeek(input)} 次训练；单次最长 ${input.maxMinutes} 分钟；场地 ${input.equipment || '未提供'}；伤病与备注：${input.notes || '无'}
【本次负责】整份计划的第 ${index}/${total} 周，只排这两周

${weekLines}

要求：
1. 只能从当周列出的可训练日里选日期，每个日期最多 1 次训练；每周不超过 ${maxSessionsPerWeek(input)} 次，且至少留 1 天完全休息。
2. 课型要有变化，不要全是轻松跑：每周安排 1 次长距离（尽量放在周末）、1 次质量课（节奏跑或间歇跑），其余为轻松跑、力量或交叉训练；减量与比赛周降低强度。
3. 课量按这个比赛距离的专业备赛标准判断，不要套用固定数字：不同比赛距离的长距离与日常课量差别很大（全马与半马的长距离标准并不同），由你决定什么算长距离、轻松跑该跑多远，并在 summary 里说明你的判断依据。
4. 质量课必须在 content 或 deliverables 里写清配速或组数，例如「间歇 6×800m @4:40/km」「节奏跑 2×2km @5:10/km」，不能只写「间歇跑」。
5. 比赛日必须有 type=race 的一条，content 写比赛日的项目名称，并给出目标配速与赛后恢复的交付物。
6. distanceKm 与 minutes 要和课型匹配（力量课可以 distanceKm=0）；单次 minutes 不得超过 ${input.maxMinutes}。若该项目的标准课量超过这个上限，按上限安排并在 summary 中说明取舍。
7. 每周总跑量相对上一周增幅不超过 8%（第一周不必受限），参考周跑量已给出，尽量接近。
8. content 不超过 18 个汉字；deliverables 1-2 条，每条给分钟数，合计等于该次 minutes。
先想清楚再答，但不要输出思考过程，只输出结果。

只输出 JSON：
{"summary":"一句话说明这两周的安排思路","sessions":[{"date":"YYYY-MM-DD","type":"easy|long|tempo|interval|strength|cross|race","content":"不超过18字","minutes":50,"distanceKm":8,"deliverables":[{"title":"完成 8km","minutes":40},{"title":"拉伸放松","minutes":10}]}]}`;
  }

  function buildPhases(weekPlan, input) {
    const n = weekPlan.length;
    if (n <= 2) {
      return [{ name: '备战期', start: input.today, end: input.raceDate, focus: '保持节奏，熟悉比赛配速' }];
    }
    const cut1 = Math.max(1, Math.round(n * 0.4));
    const cut2 = Math.max(cut1 + 1, n - 2);
    const blocks = [
      { name: '第一阶段 · 基础', from: 0, to: cut1 - 1, focus: '建立跑量，打有氧底子' },
      { name: '第二阶段 · 强化', from: cut1, to: cut2 - 1, focus: '加入节奏与长距离，接近目标配速' },
      { name: '第三阶段 · 减量', from: cut2, to: n - 1, focus: '减量恢复，比赛日全力发挥' }
    ];
    return blocks.filter((b) => b.from <= b.to).map((b) => ({
      name: b.name,
      start: b.from === 0 ? input.today : weekPlan[b.from].start,
      end: b.to === n - 1 ? input.raceDate : weekPlan[b.to].end,
      focus: b.focus
    }));
  }

  function defaultRaceSession(input) {
    const targetMinutes = parseTimeToMinutes(input.target);
    const raceDist = raceDistanceKm(input);
    const minutes = Math.max(30, Math.min(400, targetMinutes || Math.round(raceDist * 6.5)));
    const runPart = Math.max(20, minutes - 10);
    return {
      date: input.raceDate,
      type: 'race',
      content: `比赛日 · ${String(input.goal || '比赛').replace(/目标|计划/g, '').trim().slice(0, 8)}`,
      minutes,
      distanceKm: raceDistanceKm(input),
      note: '按目标配速执行，前程保守',
      deliverables: normalizeDeliverables([
        { title: '按目标配速完成比赛', minutes: runPart },
        { title: '赛后拉伸与补给', minutes: Math.max(5, minutes - runPart) }
      ], minutes)
    };
  }

  // 只生成指定的若干周（默认 2 周），一次请求，控制 token 消耗
  async function generateBatch(input, fromIndex, onStage) {
    const notify = typeof onStage === 'function' ? onStage : function () {};
    const weekPlan = buildWeekPlan(input);
    if (!weekPlan.length) throw new Error('比赛日期太近，无法排出训练周。');

    const start = Math.max(0, Math.min(Number(fromIndex) || 0, weekPlan.length));
    const batch = weekPlan.slice(start, start + BATCH_WEEKS);
    if (!batch.length) throw new Error('这份计划的周次已经排完了。');

    notify({ stage: 'batch', index: start + batch.length, total: weekPlan.length });
    const prompt = buildChunkPrompt(input, batch, start + 1, weekPlan.length);

    let raw = null;
    let lastError = null;
    for (let attempt = 0; attempt < 2 && !raw; attempt += 1) {
      try {
        raw = await chatJSON({
          system: SYSTEM_COACH_CHUNK,
          user: prompt,
          maxTokens: 1500,
          lowBudget: true,
          temperature: 0.3
        });
      } catch (err) {
        lastError = err;
        if (!err || (err.kind !== 'empty' && err.kind !== 'network' && err.kind !== 'timeout')) throw err;
      }
    }

    const allowed = {};
    batch.forEach((w) => w.dates.forEach((d) => { allowed[d] = true; }));

    // 采用模型给出的课表，只保留本段合法的日期
    const sessions = [];
    if (raw) {
      const list = Array.isArray(raw.sessions) ? raw.sessions : [];
      list.forEach((s) => {
        if (!s || typeof s !== 'object') return;
        const date = normalizeDate(s.date);
        if (!date || !allowed[date]) return;
        if (sessions.some((x) => x.date === date)) return;
        sessions.push({
          date,
          type: normalizeType(s.type),
          content: String(s.content || '').trim(),
          minutes: Number(s.minutes) || 0,
          distanceKm: Number(s.distanceKm) || 0,
          note: String(s.note || '').trim(),
          deliverables: Array.isArray(s.deliverables) ? s.deliverables : []
        });
      });
    }
    if (!sessions.length) {
      const detail = String((lastError && lastError.message) || '模型没有返回可用的训练安排').replace(/[。.\s]+$/, '');
      throw new Error(`${detail}。可以稍后重试，或把每周次数调低一点。`);
    }

    // 比赛日落在本段却没排比赛时补上（比赛本身是既定日程，不是训练安排）
    const raceInBatch = batch.some((w) => w.dates.indexOf(input.raceDate) >= 0);
    if (raceInBatch && !sessions.some((s) => s.date === input.raceDate)) {
      sessions.push(defaultRaceSession(input));
    }
    sessions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    const rawPlan = {
      summary: String((raw && raw.summary) || '').trim(),
      program: { name: input.programName, subtitle: `目标 ${input.target}`, color: '#6F8F6A' },
      phases: buildPhases(weekPlan, input),
      sessions
    };
    const plan = normalizePlan(rawPlan, input);
    return {
      plan,
      validation: validatePlan(plan, input, { partial: true }),
      degraded: false,
      error: '',
      batch: {
        from: start,
        to: start + batch.length,
        total: weekPlan.length,
        firstDate: sessions.length ? sessions[0].date : '',
        lastDate: sessions.length ? sessions[sessions.length - 1].date : ''
      }
    };
  }

  function minutesToUnits(minutes) {
    const units = Math.round((Number(minutes) || 0) / 15) / 2;
    return Math.max(0.5, units);
  }

  window.LifeLogAI = {
    SETTINGS_KEY,
    VERSION: AI_VERSION,
    BATCH_WEEKS,
    DEFAULT_SETTINGS,
    MODEL_PRESETS,
    loadSettings,
    saveSettings,
    hasApiKey,
    testConnection,
    generateBatch,
    validatePlan,
    minutesToUnits
  };
})();





