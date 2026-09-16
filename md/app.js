/* 墨页 URL / Markdown protocol v1. See README.md. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const MAX_BYTES = 2 * 1024 * 1024;
  const EXAMPLE = `# 让文字，安静成页。

一份 Markdown，就是一处可以分享的阅读空间。

> 在左侧写作，在右侧阅读。打开本地文件，或粘贴一个 Markdown 地址，就能开始。

行内公式写作 $E = mc^2$，独立公式则使用双美元符号：

$$
\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}
$$

<!-- md:toc -->

## 从一段文字开始

保留 **重点**、*语气*，以及 ~~划去的念头~~。标题、列表、引用与表格，都各得其所。

| 写作 | 阅读 |
| --- | --- |
| Markdown 源文 | 即时排版 |
| 文件与链接 | 一键打开 |
| 目录与分页 | 按章节阅读 |

## 分享一张纯净的纸

点击「复制阅读链接」，对方打开后只会看到文档。工具、编辑器与应用名称都会隐去。

<!-- md:nav -->

<!-- md:page -->

# 下一页，继续。

## 为长文留出呼吸

在段落之间单独写一行分页注释，前后各空一行：

\`\`\`markdown
<!-- md:page -->
\`\`\`

目录使用 \`<!-- md:toc -->\`，文内翻页链接使用 \`<!-- md:nav -->\`。这些注释在普通 Markdown 阅读器中不可见。

## 一份兼容的文档

普通的 \`---\` 仍然是分隔线。代码块里的指令只是示例，不会让文档意外分页。

详细的参数约定、编码示例和边界行为，见「阅读规范」。

<!-- md:nav -->`;

  let pure = document.documentElement.classList.contains('reader');
  let pages = [], headings = [], currentPage = 1, continuous = false, baseURL = location.href;
  let sourceURL = '', requestNumber = 0, controller, sourceText = '', revisionTimer;
  const host = pure ? $('readerDocument') : $('document');
  if (pure) { $('workspace').remove(); $('readerRoot').hidden = false; }

  function escapeHTML(text) {
    return text.replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]);
  }
  function mathToken(type, raw, text, displayMode) { return { type, raw, text: text.trim(), displayMode }; }
  function mathHTMLToken(raw, text, displayMode) {
    const tag = displayMode ? 'div' : 'span';
    const mode = displayMode ? 'display' : 'inline';
    return { type:'html', raw, text:`<${tag} data-md-math="${mode}">${escapeHTML(text.trim())}</${tag}>`, block:displayMode };
  }
  function installMathExtension() {
    marked.use({ extensions: [
      {
        name: 'displayMathDollar', level: 'block',
        start: source => source.indexOf('$$'),
        tokenizer(source) {
          const match = /^\$\$[ \t]*([\s\S]*?)[ \t]*\$\$(?:\n|$)/.exec(source);
          if (match && match[1].trim()) return mathToken('displayMathDollar', match[0], match[1], true);
        },
        renderer: token => `<div data-md-math="display">${escapeHTML(token.text)}</div>`
      },
      {
        name: 'displayMathBracket', level: 'block',
        start: source => source.indexOf('\\['),
        tokenizer(source) {
          const match = /^\\\[[ \t]*([\s\S]*?)[ \t]*\\\](?:\n|$)/.exec(source);
          if (match && match[1].trim()) return mathToken('displayMathBracket', match[0], match[1], true);
        },
        renderer: token => `<div data-md-math="display">${escapeHTML(token.text)}</div>`
      },
      {
        name: 'inlineMathDollar', level: 'inline',
        start: source => source.indexOf('$'),
        tokenizer(source) {
          const match = /^\$(?!\$)(?!\s)((?:\\.|[^$\\\n])+?)(?<!\s)\$(?!\$)/.exec(source);
          if (match) return mathToken('inlineMathDollar', match[0], match[1], false);
        },
        renderer: token => `<span data-md-math="inline">${escapeHTML(token.text)}</span>`
      },
      {
        name: 'inlineMathParen', level: 'inline',
        start: source => source.indexOf('\\('),
        tokenizer(source) {
          const match = /^\\\((.+?)\\\)/.exec(source);
          if (match && !match[1].includes('\n')) return mathToken('inlineMathParen', match[0], match[1], false);
        },
        renderer: token => `<span data-md-math="inline">${escapeHTML(token.text)}</span>`
      }
    ] });
  }
  function renderMath(root) {
    for (const placeholder of root.querySelectorAll('[data-md-math]')) {
      const displayMode = placeholder.dataset.mdMath === 'display';
      const wrapper = document.createElement(displayMode ? 'div' : 'span');
      wrapper.className = displayMode ? 'math-display' : 'math-inline';
      katex.render(placeholder.textContent, wrapper, {
        displayMode, throwOnError: false, strict: 'ignore', trust: false, output: 'htmlAndMathml', errorColor: '#7c0a21'
      });
      placeholder.replaceWith(wrapper);
    }
  }
  function prepareMathTokens(tokens) {
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      if (token.type !== 'paragraph') continue;
      const dollar = /^\$\$[ \t]*([\s\S]*?)[ \t]*\$\$\s*$/.exec(token.raw);
      const bracket = /^\\\[[ \t]*([\s\S]*?)[ \t]*\\\]\s*$/.exec(token.raw);
      if (dollar?.[1].trim()) tokens[index] = mathHTMLToken(token.raw, dollar[1], true);
      else if (bracket?.[1].trim()) tokens[index] = mathHTMLToken(token.raw, bracket[1], true);
    }
    marked.walkTokens(tokens, token => {
      if (['paragraph','heading'].includes(token.type) && typeof token.text === 'string' && Array.isArray(token.tokens)) {
        token.tokens = marked.Lexer.lexInline(token.text);
      }
      if (token.type === 'table') {
        for (const cell of [...token.header, ...token.rows.flat()]) cell.tokens = marked.Lexer.lexInline(cell.text);
      }
    });
    const convert = collection => collection.map(token => {
      if (token.type === 'inlineMathDollar' || token.type === 'inlineMathParen') return mathHTMLToken(token.raw, token.text, false);
      if (Array.isArray(token.tokens)) token.tokens = convert(token.tokens);
      if (token.type === 'table') {
        for (const cell of [...token.header, ...token.rows.flat()]) cell.tokens = convert(cell.tokens);
      }
      return token;
    });
    const converted = convert(tokens);
    tokens.splice(0, tokens.length, ...converted);
  }

  function status(message) { if (!pure) $('status').textContent = message; }
  function fail(message) {
    host.replaceChildren();
    const p = document.createElement('p'); p.setAttribute('role', 'alert'); p.textContent = message;
    host.append(p); status(message);
  }
  function parameters() {
    const query = new URLSearchParams(location.search);
    const fragment = new URLSearchParams(location.hash.slice(1));
    const hasFragmentSource = fragment.has('md') || fragment.has('src');
    if (hasFragmentSource && (query.has('md') || query.has('src'))) throw new Error('正文来源不能同时出现在查询参数和片段中。');
    const params = hasFragmentSource ? fragment : query;
    for (const key of ['md','src','page','anchor']) if (params.getAll(key).length > 1) throw new Error(`参数 ${key} 不能重复。`);
    if (params.has('md') && params.has('src')) throw new Error('md 与 src 只能传入一个。');
    return { params, inFragment: hasFragmentSource };
  }
  function pageOption(params) {
    const value = params.get('page') || '1';
    if (value === 'all') return 'all';
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('page 必须是从 1 开始的整数，或 all。');
    return Number(value);
  }
  function safeURL(value, base) {
    const url = new URL(value, base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('文件地址必须是 HTTP(S) 地址或站点内的相对路径，且不能包含账号密码。');
    return url;
  }
  function sanitize(html) {
    return DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['style','form','button','iframe','object','embed','video','audio'],
      FORBID_ATTR: ['style','id','name','srcset','autofocus','tabindex','hidden'],
      ALLOW_DATA_ATTR: false,
      ADD_ATTR: ['data-md-math']
    });
  }
  function parseDocument(markdown) {
    const tokens = marked.lexer(markdown);
    prepareMathTokens(tokens);
    const groups = [[]];
    // Only complete, top-level HTML comment tokens are directives. Code and nested blocks stay ordinary Markdown.
    for (const token of tokens) {
      const match = token.type === 'html' && /^<!-- md:(page|toc|nav) -->\s*$/.exec(token.raw);
      if (match?.[1] === 'page') groups.push([]);
      else if (match) groups.at(-1).push({ directive: match[1] });
      else groups.at(-1).push(token);
    }
    headings = [];
    const slugs = new Set();
    pages = groups.map((group, pageIndex) => {
      const article = document.createElement('section'); article.className = 'document-page';
      let batch = [];
      const flush = () => {
        if (!batch.length) return;
        batch.links = tokens.links;
        const template = document.createElement('template');
        template.innerHTML = sanitize(marked.parser(batch));
        // Preserve only fenced-code language metadata, never arbitrary document classes.
        for (const element of template.content.querySelectorAll('[class]')) {
          const language = element.tagName === 'CODE' && element.parentElement?.tagName === 'PRE'
            && /^language-([\w+-]+)$/.exec(element.className);
          element.removeAttribute('class');
          if (language) element.dataset.language = language[1].toLowerCase();
        }
        renderMath(template.content);
        article.append(template.content); batch = [];
      };
      for (const token of group) {
        if (token.directive) {
          flush(); const slot = document.createElement('div'); slot.dataset.directive = token.directive; article.append(slot);
        } else batch.push(token);
      }
      flush();
      for (const node of article.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
        const stem = node.textContent.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s+/g, '-') || 'section';
        let slug = stem, suffix = 2;
        while (slugs.has(slug)) slug = `${stem}-${suffix++}`;
        slugs.add(slug); node.id = `md-heading-${slug}`;
        headings.push({ id: slug, text: node.textContent, level: Number(node.tagName[1]), page: pageIndex + 1 });
      }
      for (const node of article.querySelectorAll('[href],[src]')) {
        const attr = node.hasAttribute('href') ? 'href' : 'src';
        const value = node.getAttribute(attr);
        if (attr === 'href' && value.startsWith('#')) continue;
        try {
          const url = new URL(value, baseURL);
          if (!['https:', 'http:', ...(attr === 'href' ? ['mailto:', 'tel:'] : [])].includes(url.protocol)) node.removeAttribute(attr);
          else node.setAttribute(attr, url.href);
        } catch { node.removeAttribute(attr); }
        if (node.tagName === 'A') {
          node.rel = 'noopener noreferrer';
          if (/^https?:/.test(node.getAttribute('href') || '')) node.target = '_blank';
        }
        if (node.tagName === 'IMG') { node.loading = 'lazy'; node.referrerPolicy = 'no-referrer'; }
      }
      for (const code of article.querySelectorAll('pre > code')) {
        const aliases = { 'c++':'cpp', 'cxx':'cpp', 'cc':'cpp', 'py':'python', 'js':'javascript', 'html':'xml', 'htm':'xml', 'md':'markdown', 'ts':'typescript', 'sh':'bash', 'text':'plaintext', 'txt':'plaintext' };
        const requested = code.dataset.language || 'text';
        const language = aliases[requested] || requested;
        const raw = code.textContent;
        if (window.hljs?.getLanguage(language) && raw.length <= 100000) {
          try { code.innerHTML = DOMPurify.sanitize(hljs.highlight(raw, { language, ignoreIllegals:true }).value, { ALLOWED_TAGS:['span'], ALLOWED_ATTR:['class'] }); }
          catch { code.textContent = raw; }
        }
        code.className = 'hljs';
        const wrapper = document.createElement('div'); wrapper.className = 'code-block';
        const bar = document.createElement('div'); bar.className = 'code-bar';
        const label = document.createElement('span'); label.textContent = requested;
        const button = document.createElement('button'); button.type = 'button'; button.className = 'copy-code'; button.textContent = '复制'; button.setAttribute('aria-label', `复制 ${requested} 代码`);
        const feedback = document.createElement('span'); feedback.className = 'copy-feedback'; feedback.setAttribute('role', 'status');
        const pre = code.parentElement; pre.replaceWith(wrapper); bar.append(label, feedback, button); wrapper.append(bar, pre);
      }
      return article;
    });
    document.title = headings[0]?.text || (pure ? 'Markdown' : '墨页 · Markdown 阅读与编辑');
  }
  function navigationURL(page, anchor = '') {
    const url = new URL(location.href);
    if (pure) {
      const { params, inFragment } = parameters();
      params.set('page', String(page)); params.delete('anchor');
      if (anchor) params.set('anchor', anchor);
      if (inFragment) url.hash = params.toString();
      else { url.search = params.toString(); url.hash = ''; }
    } else {
      // Modified clicks and "open link in new tab" must also open the current document.
      const params = new URLSearchParams(sourceURL ? { src: sourceURL } : { md: sourceText });
      params.set('page', String(page)); if (anchor) params.set('anchor', anchor);
      url.search = ''; url.hash = params.toString();
    }
    return url.href;
  }
  function link(text, page, anchor = '') {
    const a = document.createElement('a'); a.textContent = text; a.href = navigationURL(page, anchor);
    a.dataset.page = page; if (anchor) a.dataset.anchor = anchor;
    return a;
  }
  function makeTOC() {
    const nav = document.createElement('nav'); nav.setAttribute('aria-label', '全文目录');
    if (!headings.length) { nav.textContent = '暂无标题'; return nav; }
    const minLevel = Math.min(...headings.map(h => h.level));
    for (const h of headings) {
      const a = link(h.text, h.page, h.id); a.className = 'toc-link'; a.style.setProperty('--depth', h.level - minLevel);
      if (h.page === currentPage && !continuous) a.setAttribute('aria-current', 'page');
      const number = document.createElement('span'); number.className = 'toc-page'; number.textContent = String(h.page).padStart(2,'0'); a.append(number); nav.append(a);
    }
    return nav;
  }
  function makeNav(page) {
    const nav = document.createElement('nav'); nav.className = 'document-nav'; nav.setAttribute('aria-label','文档分页');
    if (pages.length < 2) return document.createDocumentFragment();
    if (page > 1) nav.append(link('← 上一页', page - 1));
    const number = document.createElement('span'); number.textContent = `${page} / ${pages.length}`; nav.append(number);
    if (page < pages.length) nav.append(link('下一页 →', page + 1));
    return nav;
  }
  function showPage(page = 1, anchor = '', scroll = false) {
    continuous = page === 'all';
    currentPage = continuous ? 1 : Math.max(1, Math.min(page, pages.length));
    // An anchor identifies a heading across the whole document and takes priority over the requested page.
    const target = headings.find(h => h.id === anchor);
    if (target && !continuous) currentPage = target.page;
    host.replaceChildren();
    for (let i = 0; i < pages.length; i++) {
      if (!continuous && i + 1 !== currentPage) continue;
      const content = pages[i].cloneNode(true);
      for (const slot of content.querySelectorAll('[data-directive]')) {
        if (slot.dataset.directive === 'toc') {
          const toc = document.createElement('details'); toc.className = 'document-toc'; toc.open = true;
          const summary = document.createElement('summary'); summary.textContent = '目录'; toc.append(summary, makeTOC()); slot.replaceWith(toc);
        } else slot.replaceWith(makeNav(i + 1));
      }
      host.append(content);
    }
    if (!sourceText.trim() && !pure) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = '在左侧写下第一行，或打开一份 Markdown 文件。'; host.append(p); }
    if (!pure) {
      $('outline').replaceChildren(makeTOC()); $('headingCount').textContent = `${headings.length} 节`;
      $('pager').replaceChildren();
      if (pages.length > 1) {
        const prev = document.createElement('button'); prev.textContent = '← 上一页'; prev.disabled = currentPage === 1; prev.onclick = () => navigate(currentPage - 1);
        const next = document.createElement('button'); next.textContent = '下一页 →'; next.disabled = currentPage === pages.length; next.onclick = () => navigate(currentPage + 1);
        const number = document.createElement('span'); number.textContent = `${currentPage} / ${pages.length}`; $('pager').append(prev, number, next);
      }
    }
    if (anchor) requestAnimationFrame(() => { const node = [...host.querySelectorAll('[id]')].find(n => n.id === `md-heading-${anchor}`); node?.scrollIntoView({ block: 'start' }); });
    else if (scroll) { if (pure) window.scrollTo(0,0); else $('preview').scrollTop = 0; }
  }
  function navigate(page, anchor = '') {
    if (pure) { history.pushState(null, '', navigationURL(page, anchor)); }
    showPage(page, anchor, true);
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('.copy-code');
    if (button && host.contains(button)) {
      const raw = button.closest('.code-block').querySelector('pre > code').textContent;
      const feedback = button.parentElement.querySelector('.copy-feedback');
      copy(raw, '代码已复制').then(success => {
        if (!button.isConnected) return;
        button.textContent = success ? '已复制' : '重试';
        feedback.textContent = success ? '代码已复制' : '请手动复制';
        setTimeout(() => { button.textContent = '复制'; feedback.textContent = ''; }, 2200);
      });
      return;
    }
    const a = event.target.closest('a'); if (!a || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
    if (a.dataset.page) { event.preventDefault(); navigate(Number(a.dataset.page), a.dataset.anchor || ''); }
    else if (host.contains(a) && a.getAttribute('href')?.startsWith('#')) {
      let id; try { id = decodeURIComponent(a.getAttribute('href').slice(1)); } catch { return; }
      const heading = headings.find(h => h.id === id);
      if (heading) { event.preventDefault(); navigate(heading.page, id); }
    }
  });
  function render(text, page = 1, anchor = '') {
    if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('文档超过 2 MiB，请拆分后载入。');
    sourceText = text; parseDocument(text); showPage(page, anchor);
    if (!pure) { $('charCount').textContent = `${text.length.toLocaleString()} 字`; status(`已排版 · ${pages.length} 页 · ${headings.length} 个标题`); }
  }
  async function fetchMarkdown(address) {
    const url = safeURL(address, location.href);
    controller?.abort(); controller = new AbortController();
    const active = controller;
    const timeout = setTimeout(() => active.abort(), 15000);
    try {
      const response = await fetch(url, { signal: active.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new Error(`文件加载失败（HTTP ${response.status}）。`);
      if (/text\/html/i.test(response.headers.get('content-type') || '')) throw new Error('这个地址返回网页，请提供 Markdown 原始文件链接。');
      if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('文档超过 2 MiB，请拆分后载入。');
      const reader = response.body.getReader(), chunks = []; let size = 0;
      while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > MAX_BYTES) { await reader.cancel(); throw new Error('文档超过 2 MiB，请拆分后载入。'); } chunks.push(value); }
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), url: response.url || url.href };
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('加载已取消或超时，请重试。');
      if (error instanceof TypeError) throw new Error('无法读取文件。请检查地址、UTF-8 编码、网络，以及远程服务器是否允许跨域访问（CORS）。');
      throw error;
    } finally { clearTimeout(timeout); }
  }
  async function loadAddress(address) {
    const request = ++requestNumber; status('正在载入…');
    try {
      const result = await fetchMarkdown(address); if (request !== requestNumber) return;
      baseURL = result.url; sourceURL = result.url;
      if (pure) { const { params } = parameters(); render(result.text, pageOption(params), params.get('anchor') || (!location.hash.includes('=') ? decodeURIComponent(location.hash.slice(1)) : '')); }
      else { setEditorValue(result.text); $('source').value = sourceURL; $('documentName').textContent = new URL(sourceURL).pathname.split('/').pop() || '远程文档'; render(result.text); }
    } catch (error) { if (request === requestNumber) { if (pure) fail(error.message); else status(error.message); } }
  }
  function stopLoad() { requestNumber++; controller?.abort(); sourceURL = ''; }
  function exportKaTeXStyles() {
    const href = new URL('vendor/katex.min.css', location.href).href;
    const sheet = [...document.styleSheets].find(candidate => candidate.href === href);
    try {
      const fontRoot = new URL('vendor/fonts/', location.href).href;
      return [...sheet.cssRules].map(rule => rule.cssText).join('\n').replace(/url\(["']?fonts\//g, `url("${fontRoot}`);
    } catch { return ''; }
  }
  async function copy(text, message) {
    try { await navigator.clipboard.writeText(text); status(message); return true; }
    catch {
      const box = document.createElement('textarea'); box.value = text; box.setAttribute('aria-label','待复制内容'); box.style.cssText = 'position:fixed;inset:20%;width:60%;height:60%;z-index:10;background:white'; document.body.append(box); box.focus(); box.select();
      try { if (document.execCommand('copy')) { box.remove(); status(message); return true; } } catch { /* Leave selectable fallback visible. */ }
      status('无法访问剪贴板，请从文本框手动复制，按 Escape 关闭。');
      box.addEventListener('keydown', event => { if (event.key === 'Escape') box.remove(); });
      box.addEventListener('blur', () => box.remove(), { once:true }); return false;
    }
  }
  if (!window.marked || !window.DOMPurify || !window.hljs || !window.katex) { fail('Markdown、高亮或公式组件未加载，请检查 vendor 文件是否完整后刷新。'); return; }
  installMathExtension();
  if (pure) {
    try {
      const { params } = parameters(); pageOption(params);
      if (params.has('md')) render(params.get('md'), pageOption(params), params.get('anchor') || '');
      else if (params.get('src')?.trim()) { host.textContent = '正在读取文档…'; loadAddress(params.get('src')); }
      else throw new Error('src 不能为空，请提供 Markdown 文件地址。');
    } catch (error) { fail(error.message); }
    window.addEventListener('popstate', () => location.reload());
    window.addEventListener('hashchange', () => location.reload());
    return;
  }
  // Pasting a #md / #src share URL into the same tab is a fragment navigation,
  // so the browser will not rerun this script unless we explicitly reload.
  window.addEventListener('hashchange', () => {
    const fragment = new URLSearchParams(location.hash.slice(1));
    if (fragment.has('md') || fragment.has('src')) location.reload();
  });
  const editor = $('editor'), editorHighlight = $('editorHighlight').querySelector('code');
  function updateEditorHighlight() {
    const raw = editor.value;
    const input = raw.endsWith('\n') ? `${raw} ` : raw;
    try { editorHighlight.innerHTML = DOMPurify.sanitize(hljs.highlight(input, { language:'markdown', ignoreIllegals:true }).value, { ALLOWED_TAGS:['span'], ALLOWED_ATTR:['class'] }); }
    catch { editorHighlight.textContent = input; }
  }
  function setEditorValue(value) { editor.value = value; updateEditorHighlight(); }
  setEditorValue(EXAMPLE); render(EXAMPLE);
  editor.addEventListener('scroll', () => { $('editorHighlight').scrollTop = editor.scrollTop; $('editorHighlight').scrollLeft = editor.scrollLeft; });
  editor.addEventListener('input', () => { updateEditorHighlight(); stopLoad(); clearTimeout(revisionTimer); revisionTimer = setTimeout(() => { try { render(editor.value, currentPage); } catch (error) { status(error.message); } }, 120); });
  $('example').onclick = () => { stopLoad(); baseURL = location.href; setEditorValue(EXAMPLE); $('documentName').textContent = '阅读示例.md'; render(EXAMPLE); };
  $('clear').onclick = () => { stopLoad(); baseURL = location.href; setEditorValue(''); $('source').value = ''; $('documentName').textContent = '未命名.md'; render(''); editor.focus(); };
  $('sourceForm').onsubmit = event => { event.preventDefault(); if ($('source').value.trim()) loadAddress($('source').value.trim()); else status('请先输入文件地址。'); };
  async function openFile(file) {
    if (!file) return; stopLoad(); const request = requestNumber;
    if (!/\.(md|markdown)$/i.test(file.name)) { status('请选择 .md 或 .markdown 文件。'); return; }
    if (file.size > MAX_BYTES) { status('文档超过 2 MiB，请拆分后载入。'); return; }
    try {
      const text = new TextDecoder('utf-8', { fatal:true }).decode(await file.arrayBuffer()); if (request !== requestNumber) return;
      baseURL = location.href; setEditorValue(text); $('documentName').textContent = file.name; $('source').value = ''; render(text);
    } catch { status('文件读取失败，请确认文件采用 UTF-8 编码。'); }
  }
  $('openFile').onclick = () => $('file').click(); $('file').onchange = () => { openFile($('file').files[0]); $('file').value = ''; };
  $('copySource').onclick = () => copy(editor.value, 'Markdown 原文已复制');
  document.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); });
  document.addEventListener('drop', event => { if (event.dataTransfer.files.length) { event.preventDefault(); openFile(event.dataTransfer.files[0]); } });
  $('share').onclick = () => {
    const url = new URL(location.href); url.search = ''; url.hash = '';
    const params = new URLSearchParams();
    if (sourceURL && sourceText === $('editor').value) params.set('src', sourceURL);
    else params.set('md', $('editor').value);
    params.set('page', String(currentPage)); url.hash = params.toString();
    if (url.href.length > 64000) { status('正文链接超过 64,000 字符。请将文件托管后使用 src 分享。'); return; }
    copy(url.href, '阅读链接已复制 · 打开后仅显示文档');
  };
  $('copyHtml').onclick = () => {
    try { render($('editor').value, currentPage); } catch (error) { status(error.message); return; }
    const exportHost = document.createElement('article'); exportHost.className = 'markdown';
    for (let i = 0; i < pages.length; i++) { const page = pages[i].cloneNode(true); for (const slot of page.querySelectorAll('[data-directive]')) { if (slot.dataset.directive === 'toc') { const toc = makeTOC(); for (const a of toc.querySelectorAll('a')) { a.href = `#${encodeURIComponent(a.dataset.anchor)}`; a.removeAttribute('data-page'); a.removeAttribute('data-anchor'); } slot.replaceWith(toc); } else slot.remove(); } for (const heading of page.querySelectorAll('[id]')) heading.id = heading.id.slice('md-heading-'.length); exportHost.append(page); }
    for (const bar of exportHost.querySelectorAll('.code-bar')) bar.remove();
    const syntaxCSS = document.getElementById('codeTheme').textContent;
    const mathCSS = exportKaTeXStyles();
    copy(`<style>del{color:#7c0a21;text-decoration-thickness:2px}.document-page+.document-page{break-before:page}img{max-width:100%}pre{overflow:auto;white-space:pre}code{font-family:Consolas,monospace}.math-display{overflow-x:auto;text-align:center}${syntaxCSS}${mathCSS}</style>\n${exportHost.outerHTML}`, '全文 HTML 已复制');
  };
  $('help').onclick = event => { event.preventDefault(); loadAddress('./README.md'); };
  $('editor').addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); $('copyHtml').click(); } });
})();
