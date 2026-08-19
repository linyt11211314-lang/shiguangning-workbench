/**
 * 存储核心（纯 Node 模块，无 Electron 依赖，便于单元测试）
 *
 * 职责：
 *  - createJsonStore: 把「键 → JSON 字符串」映射到 dataDir 下的 <key>.json 文件
 *    （供 preload 覆盖 window.localStorage 使用，实现浏览器数据的本地文件化）
 *  - createFsHandle: 暴露二进制/目录级文件读写（供报表模板等大体积数据落盘）
 *
 * 所有方法均为同步（preload 中需要同步语义以兼容既有 store 的同步调用）。
 */
const fs = require('fs');
const path = require('path');

/** 把任意键名收敛为安全文件名（仅保留字母数字与 ._- ） */
function safeKey(key) {
  return String(key).replace(/[^A-Za-z0-9._\-]/g, '_');
}

function jsonPath(dataDir, key) {
  return path.join(dataDir, safeKey(key) + '.json');
}

exports.createJsonStore = function createJsonStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });

  return {
    get(key) {
      try {
        const p = jsonPath(dataDir, key);
        if (!fs.existsSync(p)) return null;
        return fs.readFileSync(p, 'utf8');
      } catch (_) {
        return null;
      }
    },
    set(key, value) {
      const p = jsonPath(dataDir, key);
      fs.writeFileSync(p, value, 'utf8');
    },
    remove(key) {
      try {
        fs.unlinkSync(jsonPath(dataDir, key));
      } catch (_) {
        /* 不存在则忽略 */
      }
    },
    clear() {
      try {
        for (const f of fs.readdirSync(dataDir)) {
          if (f.endsWith('.json')) {
            try {
              fs.unlinkSync(path.join(dataDir, f));
            } catch (_) {
              /* 忽略单文件失败 */
            }
          }
        }
      } catch (_) {
        /* 目录不可读则忽略 */
      }
    },
    key(i) {
      try {
        const files = fs.readdirSync(dataDir).filter((f) => f.endsWith('.json'));
        const f = files[i];
        return f ? f.slice(0, -5) : null;
      } catch (_) {
        return null;
      }
    },
    length() {
      try {
        return fs.readdirSync(dataDir).filter((f) => f.endsWith('.json')).length;
      } catch (_) {
        return 0;
      }
    },
  };
};

/**
 * 二进制 / 目录级文件句柄（供报表模板/生成记录落盘）。
 * 所有路径都限制在 dataDir 之内（禁止穿越到外部）。
 */
exports.createFsHandle = function createFsHandle(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });

  function abs(rel) {
    const p = path.join(dataDir, rel);
    const rp = path.resolve(p);
    if (rp !== path.resolve(dataDir) && !rp.startsWith(path.resolve(dataDir) + path.sep)) {
      throw new Error('非法路径: ' + rel);
    }
    return rp;
  }

  return {
    get dataDir() {
      return dataDir;
    },
    readJson(rel) {
      try {
        const p = abs(rel);
        if (!fs.existsSync(p)) return null;
        return JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch (_) {
        return null;
      }
    },
    writeJson(rel, obj) {
      const p = abs(rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify(obj), 'utf8');
    },
    /** 返回 ArrayBuffer（渲染进程无 Node Buffer，统一用 ArrayBuffer） */
    readBuffer(rel) {
      try {
        const p = abs(rel);
        if (!fs.existsSync(p)) return null;
        const buf = fs.readFileSync(p);
        // ArrayBuffer.prototype.slice 返回独立拷贝，避免与 buf 内部缓冲耦合
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      } catch (_) {
        return null;
      }
    },
    /** 入参为 ArrayBuffer，返回是否写入成功 */
    writeBuffer(rel, arrayBuffer) {
      try {
        const p = abs(rel);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        const buf = Buffer.from(new Uint8Array(arrayBuffer));
        fs.writeFileSync(p, buf);
        return true;
      } catch (_) {
        return false;
      }
    },
    remove(rel) {
      try {
        fs.unlinkSync(abs(rel));
      } catch (_) {
        /* 忽略 */
      }
    },
    exists(rel) {
      try {
        return fs.existsSync(abs(rel));
      } catch (_) {
        return false;
      }
    },
    ensureDir(rel) {
      try {
        fs.mkdirSync(abs(rel), { recursive: true });
      } catch (_) {
        /* 忽略 */
      }
    },
    listDir(rel) {
      try {
        return fs.readdirSync(abs(rel));
      } catch (_) {
        return [];
      }
    },
  };
};
