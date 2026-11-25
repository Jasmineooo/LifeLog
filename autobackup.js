(function () {
  var MARK = '__autoBackupAt';
  var WEEK = 7 * 24 * 60 * 60 * 1000;
  var SKIP = ['__autoBackupAt', '__lastBackupAt'];
  var IDB_FALLBACK = ['yebian-db'];

  // 备份时剔除的敏感字段：键名 → 字段名
  var REDACT = { 'yebian.settings.v1': ['apiKey'], 'ai.settings.v1': ['apiKey'] };
  var REDACTED = ['yebian.settings.v1.apiKey', 'ai.settings.v1.apiKey'];

  function redactValue(key, raw) {
    var fields = REDACT[key];
    if (!fields || typeof raw !== 'string') return raw;
    try {
      var obj = JSON.parse(raw);
      fields.forEach(function (f) { delete obj[f]; });
      return JSON.stringify(obj);
    } catch (e) {
      return raw;
    }
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function openDb(name) {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(name);
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
      req.onblocked = function () { reject(new Error('blocked')); };
    });
  }

  function readStore(db, storeName) {
    return new Promise(function (resolve, reject) {
      var os = db.transaction(storeName, 'readonly').objectStore(storeName);
      var meta = { keyPath: os.keyPath, autoIncrement: os.autoIncrement, records: [] };
      var req = os.openCursor();
      req.onsuccess = function () {
        var c = req.result;
        if (c) {
          meta.records.push({ k: c.primaryKey, v: c.value });
          c.continue();
        } else {
          resolve(meta);
        }
      };
      req.onerror = function () { reject(req.error); };
    });
  }

  function listDbNames() {
    if (indexedDB.databases) {
      return indexedDB.databases().then(function (list) {
        return (list || []).map(function (d) { return d.name; }).filter(Boolean);
      }).catch(function () { return IDB_FALLBACK; });
    }
    return Promise.resolve(IDB_FALLBACK);
  }

  function dumpIndexedDB() {
    if (!window.indexedDB) return Promise.resolve({});
    return listDbNames().then(function (names) {
      var out = {};
      return names.reduce(function (chain, name) {
        return chain.then(function () {
          return openDb(name).then(function (db) {
            var storeNames = Array.prototype.slice.call(db.objectStoreNames);
            var stores = {};
            return storeNames.reduce(function (inner, s) {
              return inner.then(function () {
                return readStore(db, s).then(function (m) { stores[s] = m; });
              });
            }, Promise.resolve()).then(function () {
              out[name] = { version: db.version, stores: stores };
              db.close();
            });
          }).catch(function () { /* 单个库失败不影响其他库 */ });
        });
      }, Promise.resolve()).then(function () { return out; });
    });
  }

  try {
    var last = Number(localStorage.getItem(MARK)) || 0;
    if (Date.now() - last < WEEK) return;

    var data = {};
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (SKIP.indexOf(k) !== -1) continue;
      data[k] = redactValue(k, localStorage.getItem(k));
    }

    if (!Object.keys(data).length) return;

    dumpIndexedDB().then(function (idb) {
      var now = new Date();
      var name = 'autobackup-' + now.getFullYear() + '-' +
        pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + '.json';

      var payload = {
        exportedAt: now.toISOString(),
        origin: location.origin,
        count: Object.keys(data).length,
        data: data,
        indexedDB: idb || {},
        redacted: REDACTED
      };

      var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(url);
        a.remove();
      }, 2000);

      try {
        localStorage.setItem(MARK, String(Date.now()));
        localStorage.setItem('__lastBackupAt', String(Date.now()));
      } catch (e) {}
    }).catch(function () {
      /* 读取失败时不记录时间，下次打开重试 */
    });
  } catch (e) {
    /* 隐私模式或存储被禁用时静默跳过 */
  }
})();
