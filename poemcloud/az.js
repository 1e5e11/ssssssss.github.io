// ============================================================
// 虚拟诗词云盘核心逻辑（由 index.html 加载）
// - 诗 = 字表上的 n 位大数（BaseNumber）
// - 目录树：底层 txt 每文件 10 万首诗，文件夹按层分叉
//     单句/双句(5,7,10,14字)：每层 10 万个文件夹
//     四句/八句(20,28,40,56字)：每层 8 千万个文件夹
// - 真实排版：列表行按真实行距(rowPitch)计算，
//   原生浏览器滚动（可停在任意位置，不量化行）；
//   单目录超过 MAX_CHUNK_ROWS 行时，自动拆成若干“区间子目录”
//   （容量/大小/搜索路径仍按每层 8 千万/10 万计算，浏览时每层只多一级）
// - 搜索：先像人一样平滑滚到目标行，停住后高亮，再点击进入
// ============================================================

var charactors = []
var n = 5

// ===== 超大数：字表按字典序当“进制数字” =====
class BaseNumber {
    constructor(digits, base) {
        this.base = base;
        this.digits = digits.slice(); // 高位在前
    }
    clone() {
        return new BaseNumber(this.digits, this.base);
    }
}
BaseNumber.prototype.addOne = function () {
    const base = this.base;
    const d = this.digits;
    for (let i = d.length - 1; i >= 0; i--) {
        if (d[i] + 1 < base) { d[i]++; return; }
        d[i] = 0;
    }
    throw new Error("overflow");
};
BaseNumber.prototype.subOne = function () {
    const base = this.base;
    const d = this.digits;
    for (let i = d.length - 1; i >= 0; i--) {
        if (d[i] > 0) { d[i]--; return; }
        d[i] = base - 1;
    }
    throw new Error("underflow");
};
BaseNumber.prototype.addSmall = function (k) {
    let carry = k;
    const base = this.base;
    const d = this.digits;
    for (let i = d.length - 1; i >= 0 && carry > 0; i--) {
        const sum = d[i] + carry;
        d[i] = sum % base;
        carry = Math.floor(sum / base);
    }
    if (carry > 0) throw new Error("overflow");
};
BaseNumber.prototype.toStringByTable = function (table) {
    return this.digits.map(i => table[i]).join("");
};
BaseNumber.prototype.compare = function (other) {
    const a = this.digits;
    const b = other.digits;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    }
    return 0;
};

const table = arr.split("");          // 字典字表
const base = table.length;

const indexMap = new Map();
table.forEach((c, i) => indexMap.set(c, i));

function stringToBaseNumber(str) {
    const digits = new Array(str.length);
    for (let i = 0; i < str.length; i++) {
        const v = indexMap.get(str[i]);
        if (v === undefined) throw new Error(`非法字符: ${str[i]}`);
        digits[i] = v;
    }
    return new BaseNumber(digits, base);
}
function indexToBaseNumber(index, n, base) {
    const digits = new Array(n).fill(0);
    let idx = index;
    for (let i = n - 1; i >= 0; i--) {
        digits[i] = Number(idx % BigInt(base));
        idx = idx / BigInt(base);
    }
    return new BaseNumber(digits, base);
}
function baseNumberToIndex(bn) {
    let index = 0n;
    let multiplier = 1n;
    for (let i = bn.digits.length - 1; i >= 0; i--) {
        index += BigInt(bn.digits[i]) * multiplier;
        multiplier *= BigInt(bn.base);
    }
    return index;
}
function indexToStr(idx, n) {
    return indexToBaseNumber(idx, n, base).toStringByTable(table);
}
function strToIndex(str) {
    return baseNumberToIndex(stringToBaseNumber(str));
}

// ===== 诗体配置 =====
const POEM_TYPES = [
    { check: "five-character single-line poem", label: "五言单句诗", n: 5 },
    { check: "seven-character single-line poem", label: "七言单句诗", n: 7 },
    { check: "five-character two-line poem", label: "五言双句诗", n: 10 },
    { check: "seven-character two-line poem", label: "七言双句诗", n: 14 },
    { check: "five-character four-line poem", label: "五言四句诗", n: 20 },
    { check: "seven-character four-line poem", label: "七言四句诗", n: 28 },
    { check: "five-character eight-line poem", label: "五言八句诗", n: 40 },
    { check: "seven-character eight-line poem", label: "七言八句诗", n: 56 }
];
const POEM_LENGTHS = POEM_TYPES.map(t => t.n);
const rootTypeByCheck = new Map(POEM_TYPES.map(t => [t.check, t]));
const rootTypeByN = new Map(POEM_TYPES.map(t => [t.n, t]));

function charsPerLine(n) { return n % 7 === 0 ? 7 : 5; }   // 五言句 5 字 / 七言句 7 字
function linesOfPoem(n) { return n / charsPerLine(n); }
// txt 中实际占用的正文行数。七言八句按律诗常见的两句一行排成四行。
function textLinesOfPoem(n) { return n === 56 ? 4 : linesOfPoem(n); }

// 下载文本排版：诗与诗之间空一行；七言八句每行两句（逗号后留一空格）。
function poemFileText(raw) {
    const n = raw.length;
    const cpl = charsPerLine(n);
    const lines = linesOfPoem(n);
    if (lines <= 1) return raw + "\n\n";

    if (n === 56) {
        const couplets = [];
        for (let i = 0; i < lines; i += 2) {
            const first = raw.slice(i * cpl, (i + 1) * cpl);
            const second = raw.slice((i + 1) * cpl, (i + 2) * cpl);
            couplets.push(first + "， " + second + "。");
        }
        return couplets.join("\n") + "\n\n";
    }

    const parts = [];
    for (let i = 0; i < lines; i++) {
        const seg = raw.slice(i * cpl, (i + 1) * cpl);
        parts.push(seg + (i === lines - 1 ? "。" : "，"));
    }
    return parts.join("\n") + "\n\n";
}

// 单个 txt 字节数 = 每首诗字节数 × 每文件诗数(10万)
function fileBytesFor(n) {
    // 从真正的排版函数计算，避免格式调整后列表中的大小与下载内容不一致。
    const sample = table[0].repeat(n);
    const perPoem = new TextEncoder().encode(poemFileText(sample)).byteLength;
    return 100000n * BigInt(perPoem);
}
const FILE_BYTES_MAP = {};
POEM_LENGTHS.forEach(n => { FILE_BYTES_MAP[n] = fileBytesFor(n); });

const SIZE_UNITS = ["B","KB","MB","GB","TB","PB","EB","ZB","YB","RB","QB"];
const QB_INDEX = SIZE_UNITS.length - 1;

function formatBytes(bytes) {
    let b = typeof bytes === "bigint" ? bytes : BigInt(Math.floor(bytes));
    if (b < 1024n) return b.toString() + " B";
    let unitIndex = 0;
    let value = b;
    while (value >= 1024n && unitIndex < QB_INDEX) { value /= 1024n; unitIndex++; }
    if (unitIndex === QB_INDEX) {
        if (value >= 1000n) { const p = value.toString().length - 1; return `10^${p} QB`; }
        return value.toString() + " QB";
    }
    const num = Number(b) / Math.pow(1024, unitIndex);
    const shown = num >= 10 ? num.toFixed(1) : num.toFixed(2);
    return shown + " " + SIZE_UNITS[unitIndex];
}

// ===== 分叉结构 =====
const FILES_PER_FILE = 100000n;   // 底层 txt 每文件装 10 万首诗（诗数不变）
// 每层文件夹数量：四句/八句诗 8 千万，其余 10 万
function folderSizeOf(n) {
    return (n === 20 || n === 28 || n === 40 || n === 56) ? 80000000n : 100000n;
}
const _spansCache = new Map();
// 某诗体的层跨度（从最外层到最内层；最内层 = 一个 txt 覆盖的诗数）
function getSpans(n) {
    if (_spansCache.has(n)) return _spansCache.get(n);
    const total = BigInt(base) ** BigInt(n);
    const fs = folderSizeOf(n);
    const spans = [FILES_PER_FILE];
    while (true) {
        const nx = spans[spans.length - 1] * fs;
        if (nx >= total) break;
        spans.push(nx);
    }
    spans.reverse();
    _spansCache.set(n, spans);
    return spans;
}
function totalOf(n) { return BigInt(base) ** BigInt(n); }

// ===== 标点显示 =====
function fmtPoemInline(s) {
    if (!s) return s;
    const cpl = charsPerLine(s.length);
    const lines = linesOfPoem(s.length);
    if (lines <= 1) return s;
    const parts = [];
    for (let i = 0; i < lines; i++) parts.push(s.slice(i * cpl, (i + 1) * cpl));
    return parts.join("，");
}
function format_to_punctuation(p) {
    if (!p) return p;
    if (p.indexOf("-") > 0) {
        const i = p.indexOf("-");
        return fmtPoemInline(p.slice(0, i)) + "-" + fmtPoemInline(p.slice(i + 1));
    }
    return fmtPoemInline(p);
}
function format_to_no_punctuation(p) {
    // 搜索输入可带中英文标点、空格、换行、反斜杠等分隔符。
    // 只保留字表里的实际文字字符。
    return p
        .replace(/\\[a-zA-Z]/g, " ")   // 兼容字面 \n / \r / \t 等写法
        .replace(/[\p{P}\p{S}\p{Z}\s]+/gu, "");
}
function poemToIndex(poem) {
    const bn = stringToBaseNumber(poem);
    return baseNumberToIndex(bn);
}

// ===== 区间 [start,end] 的字节数（含尾部不完整 txt）=====
function calcBytesRange(n, startIdx, endIdx) {
    const covered = endIdx - startIdx + 1n;
    const fBytes = FILE_BYTES_MAP[n];
    const txtCount = (covered + FILES_PER_FILE - 1n) / FILES_PER_FILE;
    if (txtCount === 1n) return covered * fBytes / FILES_PER_FILE;
    const full = (txtCount - 1n) * fBytes;
    const last = covered - (txtCount - 1n) * FILES_PER_FILE;
    return full + last * fBytes / FILES_PER_FILE;
}

// ============================================================
//  列表模型（懒生成，纯分层）
//  列表 = 某父目录（[parentStart,parentEnd]）下，
//         rowsLayer 层（跨度 spans[rowsLayer]）的子项序列。
//  行号 i 的子项覆盖 [parentStart + i*step, min(…, parentEnd)]。
//  行数 = ceil(覆盖/step)，与分层数学完全一致
// （4句/8句每层 8 千万子项、其余 10 万子项，一个不多一个不少）。
//  行内容按行号即时计算 —— 不做额外拆分目录，显示即真实层。
// ============================================================

// 普通列表：行 = 该层的真实子项（目录行或最内层 txt 文件行）
function makeModelList(n, rowsLayer, parentStart, parentEnd) {
    const spans = getSpans(n);
    const step = spans[rowsLayer];
    const count = Number((parentEnd - parentStart + 1n + step - 1n) / step);
    const rowsAreFiles = step <= FILES_PER_FILE;   // 最内层：每个子项恰好是一个 txt
    const isDirRows = !rowsAreFiles;

    function rowAt(i) {
        const s = parentStart + BigInt(i) * step;
        let e = s + step - 1n;
        if (e > parentEnd) e = parentEnd;
        const raw = indexToStr(s, n) + "-" + indexToStr(e, n);
        return {
            name: format_to_punctuation(raw) + (rowsAreFiles ? ".txt" : ""),
            type: rowsAreFiles ? "file" : "dir",
            size: formatBytes(calcBytesRange(n, s, e)),
            mtime: "",
            check: raw
        };
    }

    return {
        kind: "list",
        n: n,
        rowsLayer: rowsLayer,
        step: step,
        parentStart: parentStart,
        parentEnd: parentEnd,
        count: count,
        isFileRows: rowsAreFiles,
        rowAt: rowAt,
        dirCount: isDirRows ? count : 0,
        fileCount: isDirRows ? 0 : count
    };
}

// 统一入口：生成某层 [parentStart,parentEnd] 内子项的显示列表
function makeListing(n, rowsLayer, parentStart, parentEnd) {
    return makeModelList(n, rowsLayer, parentStart, parentEnd);
}

// 页面中的虚拟 README：说明内容与下载内容共用同一份文本。
const README_TEXT = `# PoemCloud · 虚拟诗词云盘

PoemCloud 把汉字的排列组合展示成一个可以浏览、搜索和下载的云盘。
这里的目录与诗词文件按规则即时计算，下载时才在浏览器中生成文本；页面显示的巨大容量是组合空间对应的理论文本大小。

## 这里有什么

项目使用内置字表中的 ${base.toLocaleString("zh-CN")} 个字符，枚举指定长度的所有组合。若字表包含 B 个字符，一首诗有 N 个字，该诗体就有 B 的 N 次方种组合。
它按字表顺序排列文字，不判断语义、押韵或平仄，因此既包含可以读通的诗句，也包含大量没有意义的组合。它不是经过整理的古诗文数据库，也不是 AI 写诗工具。

支持以下八种诗体（字数不含标点和空白）：

| 诗体 | 每句字数 | 句数 | 总字数 |
| --- | --- | --- | --- |
| 五言单句诗 | 5 | 1 | 5 |
| 七言单句诗 | 7 | 1 | 7 |
| 五言双句诗 | 5 | 2 | 10 |
| 七言双句诗 | 7 | 2 | 14 |
| 五言四句诗 | 5 | 4 | 20 |
| 七言四句诗 | 7 | 4 | 28 |
| 五言八句诗 | 5 | 8 | 40 |
| 七言八句诗 | 7 | 8 | 56 |

## 浏览目录

1. 在根目录点击一种诗体，进入对应的组合空间。
2. 点击文件夹逐层浏览。文件夹名称表示其包含的起始文字与结束文字，区间包含两端。
3. 到达最底层后，点击 .txt 文件即可生成并下载该区间的全部组合。
4. 点击左上角返回按钮回到上一层。

每个文本文件最多包含 100,000 首诗，末尾文件可能不足这个数量。列表按需显示可见条目，因此不需要预先加载整个目录。

## 搜索一首诗

在顶部搜索框输入完整诗句，按 Enter 开始定位。例如输入：床前明月光。

- 可以带中英文标点、空格和换行；搜索前会移除这些分隔符。
- 去除分隔符后的字数必须为 5、7、10、14、20、28、40 或 56，且每个字都必须在内置字表中。
- 搜索根据完整文字计算位置，自动逐层进入目录，滚动并高亮目标文本文件。
- 定位完成后，页面显示目标诗在文本文件中的起止行号，以及包含空行的文件总行数。
- 点击高亮的文件下载，再用文本编辑器跳到提示的行号查看。

搜索是完整文字的精确定位，不支持按作者、标题或关键词模糊检索。搜索完成后需要手动点击文件才会下载。

## 下载与文本格式

诗词文本使用 UTF-8 编码，诗与诗之间空一行。单句诗直接输出文字；其他诗体按句分行并添加标点，其中七言八句诗每行排两句，共四行。

点击文件后，顶部会显示生成进度，完成后交给浏览器下载。一次只能生成一个文件；保存位置由浏览器的下载设置决定。下载的是整个文件区间，包含目标诗及同一文件内的其他组合。

根目录中的 README.md 就是这份说明，点击即可下载，列表大小按说明文本的实际 UTF-8 字节数计算。

## 界面与使用范围

- 支持桌面表格和手机卡片布局。
- 支持浅色、深色主题；首次使用跟随系统，手动切换后会记住选择。
- “最近”和“收藏”目前是空白占位视图，尚未实现记录或收藏功能；点击“文件”可返回文件视图。
- 这是纯前端虚拟云盘，目前没有账号登录、文件上传或云端存储功能。

保留 index.html、dictionary.js 和 az.js 的相对位置，用支持现代 JavaScript 的浏览器打开 index.html 即可使用，也可以放在静态网站服务中访问。
`;
const README_BYTES = new TextEncoder().encode(README_TEXT);

// 根目录（8 种诗体 + README）
const homeList = {
    kind: "home",
    count: POEM_TYPES.length + 1,
    dirCount: POEM_TYPES.length,
    fileCount: 1,
    rowAt: function (i) {
        if (i < POEM_TYPES.length) {
            const t = POEM_TYPES[i];
            return { name: t.label, type: "dir", size: "", mtime: "", check: t.check };
        }
        return { name: "README.md", type: "file", size: formatBytes(README_BYTES.byteLength), mtime: "", check: "README.md" };
    }
};

// ============================================================
//  导航状态
// ============================================================
var CUR = null;          // 当前显示的列表；null = 根目录
var navStack = [];       // 每项 { label, list }

function showCurrent() {
    const top = navStack.length ? navStack[navStack.length - 1] : null;
    CUR = top ? top.list : null;
    setSearchHit(null); // 手动导航后不再显示上一次搜索的行号
    renderListing(top ? top.label : "/", CUR ? CUR : homeList);
}
function enterList(label, list) {
    navStack.push({ label: label, list: list });
    showCurrent();
}
function back() {
    if (!navStack.length) return;
    navStack.pop();
    showCurrent();
}
function showHome() {
    navStack = [];
    showCurrent();
}

// 点击目录行（type="dir"）时进入它的子列表
function openDir(check) {
    if (!CUR) {
        // 根目录：进入诗体
        const t = rootTypeByCheck.get(check);
        if (!t) return;
        n = t.n;
        enterList("/" + t.label, makeListing(n, 0, 0n, totalOf(n) - 1n));
        return;
    }
    const seg = check.split("-");
    if (seg.length !== 2) return;
    const s = strToIndex(seg[0]);
    const e = strToIndex(seg[1]);
    const spans = getSpans(CUR.n);

    // 真实目录行：进入下一层
    const newRowsLayer = CUR.rowsLayer + 1;
    if (newRowsLayer >= spans.length) return;   // 已是最深目录层（理论上不会发生）

    const label = (navStack.length ? navStack[navStack.length - 1].label : "/") + "/" + format_to_punctuation(check);
    enterList(label, makeListing(CUR.n, newRowsLayer, s, e));
}

// ============================================================
//  下载（分批生成后直接触发浏览器下载）
// ============================================================
const DOWNLOAD_BATCH_POEMS = 512;
let downloadInProgress = false;

function setDownloadStatus(text) {
    const el = document.getElementById("downloadStatus");
    if (el) {
        el.textContent = text || "";
        el.hidden = !text;
    }
}

function yieldToBrowser() {
    if (window.scheduler && typeof window.scheduler.yield === "function") {
        return window.scheduler.yield();
    }
    return new Promise(resolve => setTimeout(resolve, 0));
}

// 使用“大块 Blob”触发标准浏览器下载：不会弹出 showSaveFilePicker 的保存对话框，
// 同时避免为 10 万首诗分别创建一个小 Uint8Array。
async function createDownloadSink(filename) {
    const chunks = [];
    return {
        write: chunk => { chunks.push(chunk); },
        close: () => {
            const blob = new Blob(chunks, { type: "text/plain;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename;
            a.hidden = true;
            document.body.appendChild(a);
            a.click();
            a.remove();
            // 立即回收在部分浏览器中会让尚未开始的下载失效。
            setTimeout(() => URL.revokeObjectURL(url), 60000);
        },
        abort: () => { chunks.length = 0; }
    };
}

async function downloadRange(segCheck, filename) {
    const seg = segCheck.split("-");
    if (seg.length !== 2) throw new Error("无效的下载区间");
    const s = stringToBaseNumber(seg[0]);
    const e = stringToBaseNumber(seg[1]);
    if (s.compare(e) > 0) throw new Error("下载区间起点大于终点");

    const startIndex = baseNumberToIndex(s);
    const endIndex = baseNumberToIndex(e);
    const total = endIndex - startIndex + 1n;
    const encoder = new TextEncoder();
    const sink = await createDownloadSink(filename);
    if (!sink) return false;

    const cur = s.clone();
    let generated = 0n;
    let batch = [];

    try {
        while (true) {
            batch.push(poemFileText(cur.toStringByTable(table)));
            generated++;

            // 先判断终点再自增，修复区间以字典最大值结尾时的 overflow。
            const atEnd = cur.compare(e) === 0;
            if (batch.length >= DOWNLOAD_BATCH_POEMS || atEnd) {
                await sink.write(encoder.encode(batch.join("")));
                batch = [];
                const percent = Number(generated * 1000n / total) / 10;
                setDownloadStatus("正在生成 " + percent.toFixed(1) + "%");
                await yieldToBrowser();
            }
            if (atEnd) break;
            cur.addOne();
        }

        await sink.close();
        return true;
    } catch (error) {
        try { await sink.abort(error); } catch (_) { /* 忽略清理错误 */ }
        throw error;
    }
}

async function downloadfile(type, check) {
    if (type === "dir") { openDir(check); return; }
    if (downloadInProgress) {
        alert("已有文件正在生成，请稍候。");
        return;
    }

    downloadInProgress = true;
    setDownloadStatus("准备下载…");
    try {
        if (check === "README.md") {
            const sink = await createDownloadSink("README.md");
            await sink.write(README_BYTES);
            await sink.close();
        } else {
            await downloadRange(check, format_to_punctuation(check) + ".txt");
        }
    } catch (error) {
        console.error(error);
        alert("下载失败：" + (error && error.message ? error.message : error));
    } finally {
        downloadInProgress = false;
        setDownloadStatus("");
    }
}

// ============================================================
//  搜索：数学定位 + 平滑滚动 → 高亮目标文件 → 显示 txt 内行号
// ============================================================
function rootFolderByN(n) {
    const t = rootTypeByN.get(n);
    return t ? t.check : null;
}

function locatePathByIndex(n, index) {
    const spans = getSpans(n);
    const total = totalOf(n);
    let start = 0n;
    let end = total - 1n;
    const path = [];
    for (let m = 0; m < spans.length; m++) {
        const step = spans[m];
        const i = (index - start) / step;
        const segStart = start + i * step;
        let segEnd = segStart + step - 1n;
        if (segEnd > end) segEnd = end;
        path.push({
            start: indexToStr(segStart, n),
            end: indexToStr(segEnd, n),
            sIdx: segStart,
            eIdx: segEnd
        });
        start = segStart;
        end = segEnd;
    }
    return path;
}

function findRowByCheck(check) {
    return document.querySelector(`#fileList tr.clickable[data-check="${CSS.escape(check)}"]`);
}
function flashNTimes(tr, times) {
    let i = 0;
    function once() {
        tr.classList.remove("flash");
        void tr.offsetWidth;
        tr.classList.add("flash");
        i++;
        if (i < times) setTimeout(once, 650);
    }
    once();
}
function simulateClick(tr) {
    tr.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
}
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// 平滑滚动到第 idx 行（行顶对齐到信息条下方），停稳后回调。
// 沿用旧版的 requestAnimationFrame + 900ms easeOutCubic 动画。
function scrollToRowSmooth(idx, cb) {
    const c = document.getElementById("scrollContainer");
    const maxTop = Math.max(0, c.scrollHeight - c.clientHeight);
    const target = Math.min(maxTop, scrollTopForRow(idx));
    const from = c.scrollTop;
    const dist = target - from;

    if (Math.abs(dist) < 3) {
        c.scrollTop = target;
        lastStart = -1;
        renderVirtual(idx);
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(cb, 90)));
        return;
    }

    const duration = 900;
    const startedAt = performance.now();
    let done = false;

    function finish() {
        if (done) return;
        done = true;
        c.scrollTop = target;
        // 强制把精确目标行渲染出来，再等待两帧让 DOM 稳定。
        lastStart = -1;
        renderVirtual(idx);
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(cb, 90)));
    }

    function step(now) {
        if (done) return;
        const k = Math.min(1, (now - startedAt) / duration);
        const eased = 1 - Math.pow(1 - k, 3);
        c.scrollTop = from + dist * eased;
        if (k < 1) {
            requestAnimationFrame(step);
        } else {
            finish();
        }
    }
    requestAnimationFrame(step);

    // 标签页切到后台时 rAF 可能暂停，兜底保证搜索流程能继续。
    setTimeout(function () {
        if (!done) finish();
    }, duration + 2000);
}

// 对当前列表第 idx 行执行：自然滚动 → 停住 → 高亮 →（可点击）。
function actRow(idx, doClick, isLast) {
    return new Promise(resolve => {
        if (idx < 0 || idx >= countRows()) { console.warn("行号越界:", idx); resolve(); return; }
        function afterShow() {
            const row = rowOf(idx);
            if (!row) { console.warn("行不存在:", idx); resolve(); return; }
            const tr = findRowByCheck(row.check);
            if (!tr) {
                // 兜底：强制把该行渲染进当前窗口
                pinToRow(idx);
                setTimeout(() => {
                    const tr2 = findRowByCheck(row.check);
                    if (!tr2) { console.warn("DOM 仍未出现:", idx, "total=" + countRows()); resolve(); return; }
                    flashNTimes(tr2, isLast ? 3 : 2);
                    if (doClick) {
                        setTimeout(() => { simulateClick(tr2); resolve(); }, 550);
                    } else {
                        setTimeout(resolve, 320);
                    }
                }, 120);
                return;
            }
            flashNTimes(tr, isLast ? 3 : 2);
            if (doClick) {
                setTimeout(() => { simulateClick(tr); resolve(); }, 550);
            } else {
                setTimeout(resolve, 320);
            }
        }

        // 超大目录已由 scrollTopForRow() 比例映射，不再因浏览器高度上限直接跳转。
        scrollToRowSmooth(idx, afterShow);
    });
}

async function search(poemRaw) {
    setSearchHit(null);
    const poem = format_to_no_punctuation(poemRaw);
    const len = poem.length;
    if (!POEM_LENGTHS.includes(len)) {
        alert("长度不对：请输入 " + POEM_LENGTHS.join("/") + " 字的诗（可带标点、空格、换行）");
        return;
    }
    n = len;

    let index;
    try {
        index = poemToIndex(poem);
    } catch (e) {
        alert("诗中含有字表外的字符: " + e.message);
        return;
    }

    const path = locatePathByIndex(n, index);   // 每层(0..最深)目标区间
    showHome();
    await delay(150);

    // step 0：点诗体类型
    const rootKey = rootFolderByN(n);
    const homeIdx = POEM_TYPES.findIndex(t => t.check === rootKey);
    await actRow(homeIdx, true, false);
    await delay(160);

    // 逐层推进：当前列表的父区间 = path[L-1]（首层为整个诗体）
    for (let L = 0; L < path.length; L++) {
        const seg = path[L];
        if (!CUR) { console.warn("搜索定位中断(未在子目录)"); return; }
        const rIdx = Number((seg.sIdx - CUR.parentStart) / CUR.step);
        const isLast = L === path.length - 1;
        await actRow(rIdx, !isLast, isLast);
        await delay(120);
    }

    // txt 中每首诗占“诗句行数 + 1 个空行”。
    // 目标诗在文件内的序号 × 每首占用行数 + 1，即为它的起始行。
    const targetFile = path[path.length - 1];
    const poemOffset = Number(index - targetFile.sIdx);
    const poemCount = Number(targetFile.eIdx - targetFile.sIdx + 1n);
    const textLines = textLinesOfPoem(n);
    const linesPerPoemBlock = textLines + 1;
    const startLine = poemOffset * linesPerPoemBlock + 1;
    setSearchHit({
        line: startLine,
        endLine: startLine + textLines - 1,
        totalLines: poemCount * linesPerPoemBlock
    });
}

// ============================================================
//  启动
// ============================================================
window.onload = function () {
    showHome();
}
