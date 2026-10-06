// ==UserScript==
// @name         课件提取器
// @namespace    http://tampermonkey.net/
// @version      12.0
// @description  纯净抓取：自动排除代码运行输出黑框/终端结果，避免把Python运行结果当正文；按钮右下角；自动探测页数；导出附带交给AI整理的指令
// @match        *://outer.example.com/*
// @match        *://deck.example.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // 消息协议：外层(top) 与 课件 iframe 之间通过 postMessage 通信
    var CH = 'SLIDE_EXTRACTOR_CH';

    // ===================== 外层网页(top)：负责按钮、进度、下载 =====================
    function initTop() {
        var btn = null, status = null, deckWin = null, deckOrigin = '*';
        var progWrap = null, progText = null, progBar = null, startTime = 0, totalCache = 0;

        function ensureUI() {
            if (btn && document.body.contains(btn)) return;
            var box = document.createElement('div');
            box.id = 'tm12-box';
            box.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:2147483647;display:flex;flex-direction:column;gap:8px;align-items:flex-end;';

            btn = document.createElement('button');
            btn.id = 'tm12-btn';
            btn.textContent = '📚 提取课件正文';
            btn.style.cssText = 'padding:12px 18px;background:#d6336c;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer;font-weight:bold;box-shadow:0 4px 12px rgba(0,0,0,.3);user-select:none;';

            status = document.createElement('div');
            status.id = 'tm12-status';
            status.style.cssText = 'padding:8px 14px;background:rgba(0,0,0,.85);color:#fff;border-radius:6px;font-size:13px;display:none;max-width:320px;';

            box.appendChild(btn); box.appendChild(status);
            progWrap = document.createElement('div');
            progWrap.id = 'tm12-prog';
            progWrap.style.cssText = 'display:none;margin-top:8px;font-size:12px;color:#374151;min-width:200px;';
            progText = document.createElement('div');
            progWrap.appendChild(progText);
            var pbg = document.createElement('div');
            pbg.style.cssText = 'width:100%;height:6px;background:#e5e7eb;border-radius:3px;margin-top:5px;overflow:hidden;';
            progBar = document.createElement('div');
            progBar.style.cssText = 'width:0%;height:6px;background:#22c55e;border-radius:3px;transition:width .25s;';
            pbg.appendChild(progBar); progWrap.appendChild(pbg);
            box.appendChild(progWrap);
            document.body.appendChild(box);
            btn.addEventListener('click', start);
        }

        function findDeck() {
            var frames = document.querySelectorAll('iframe');
            for (var i = 0; i < frames.length; i++) {
                try {
                    var src = frames[i].src || '';
                    if (/teaching|deck|slide|course/i.test(src) && !/about:blank/.test(src)) {
                        return frames[i];
                    }
                } catch (e) {}
            }
            return frames[0] || null;
        }

        function send(msg) {
            if (deckWin && deckWin.contentWindow) {
                try { deckWin.contentWindow.postMessage({ ch: CH, data: msg }, deckOrigin); } catch (e) {}
            }
        }

        function start() {
            var f = findDeck();
            if (!f) { show('没找到课件窗口，请先打开课件放映页'); return; }
            deckWin = f;
            btn.disabled = true; btn.textContent = '提取中...';
            startTime = Date.now(); totalCache = 0; setProgress(0, 0);
            show('已通知课件窗口，开始自动逐页提取...');
            send({ action: 'start' });
        }

        function show(t) { if (status) { status.style.display = 'block'; status.textContent = t; } }
        function fmt(s) { s = Math.max(0, Math.round(s)); var m = Math.floor(s / 60), ss = s % 60; return (m < 10 ? '0' : '') + m + ':' + (ss < 10 ? '0' : '') + ss; }
        function setProgress(i, total) {
            if (!progWrap) return;
            progWrap.style.display = 'block';
            var pct = total > 0 ? Math.round(i / total * 100) : 0;
            if (progBar) progBar.style.width = pct + '%';
            var el = (Date.now() - startTime) / 1000;
            var extra = '已用时 ' + fmt(el);
            if (total > 0 && i > 0) { extra += ' · 预计还需 ' + fmt((el / i) * (total - i)); }
            if (progText) progText.textContent = (total > 0 ? ('已抓取 ' + i + ' / ' + total + ' 页') : ('已抓取 ' + i + ' 页')) + ' · ' + extra;
        }

        function hideLater() { setTimeout(function () { if (status) status.style.display = 'none'; }, 8000); }

        // 接收 iframe 发来的进度 / 结果
        window.addEventListener('message', function (ev) {
            if (!ev.data || ev.data.ch !== CH) return;
            var d = ev.data.data || {};
            if (d.action === 'total') {
                totalCache = parseInt(d.total, 10) || 0;
                show('检测到总页数：' + d.total + ' 页，正在逐页抓取...');
            } else if (d.action === 'progress') {
                show('正在抓取第 ' + d.i + ' / ' + (d.total || '?') + ' 页...');
                setProgress(d.i, parseInt(d.total, 10) || totalCache);
            } else if (d.action === 'stuck') {
                show('⚠️ 翻页未生效，已停在第 ' + d.i + ' 页（可能是运行时遮罩挡住，稍后手动翻页再重试）');
            } else if (d.action === 'done') {
                if (progBar) progBar.style.width = '100%';
                if (progText) progText.textContent = '抓取完成，正在生成 Word，请勿关闭页面…';
                show('提取完成，正在生成 Word…（页数较多时可能需要一点时间，请勿关闭页面）');
                setTimeout(function () {
                    var g0 = Date.now();
                    downloadWord(d.text, d.title);
                    var gd = Math.round((Date.now() - g0) / 100) / 10;
                    if (progText) progText.textContent = '已生成并下载（生成耗时 ' + gd + ' 秒），请查看浏览器下载列表';
                    btn.disabled = false; btn.textContent = '📚 提取课件正文';
                    show('已生成并下载，请查看浏览器下载列表');
                    hideLater();
                }, 40);
            } else if (d.action === 'error') {
                show('出错：' + d.msg);
                btn.disabled = false; btn.textContent = '📚 提取课件正文';
            }
        });

        // 生成 Word（开头带 AI 指令）
        function downloadWord(rawText, title) {
            var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };

            var instr = '' +
                '<div style="background:#fff8e1;border:2px solid #f0a30a;border-radius:8px;padding:18px 22px;margin-bottom:28px;">' +
                '<h2 style="color:#b26a00;margin:0 0 10px;">【给 AI 的整理指令（请把整段连同后面的课件正文一起发给 AI）】</h2>' +
                '<p>你是一位笔记整理助手。下面这份文本是用浏览器脚本从一个<b>网页课件 iframe</b>（互动式网页课件，不是图片、也不是 PDF）里逐页抓取出来的纯文字，脚本已在抓取时<b>尽量剔除了代码运行输出黑框</b>，但仍可能有零星残留。请你按下面要求整理：</p>' +
                '<ol>' +
                '<li><b>删除每页重复的"网页外壳/无关信息"</b>，包括但不限于：' +
                '<br>· 页码与章节页眉（形如「第X章 · ×××」「数字 / 数字」「X / 总页」）；' +
                '<br>· 工具栏文字「⌂ 课程中心」「← → / 空格 翻页 · G 目录 · F 全屏 · 点"▶运行"执行代码」；' +
                '<br>· 代码框按钮残留文字「编辑」「▶运行」「▶结果」「放大」「（放大）」；' +
                '<br>· 运行状态提示「运行环境：未加载（点"运行"启用）」；' +
                '<br>· 运行时加载提示「Python 运行时首次运行要下载约 48MB…」「已加载：(等待中)」「超过 3 分钟仍无进展…改用电脑打开本页」；' +
                '<br>· 任何以「⏳」「正在逐页提取」「正在抓取第…页」开头的脚本残留行。' +
                '</li>' +
                '<li><b>识别并剔除"程序运行输出"残留</b>：如果某句话明显是代码 print 出来的运行结果（例如与代码块对应、像程序打印出的台词/数字），而它并非老师写的知识点正文，则删除，不要当成课件正文保留。</li>' +
                '<li><b>合并、去重</b>：相邻页若有完全相同的标题行/知识点（课件翻页时常见重复），合并为一条，不要重复罗列。对于内容被运行时提示挤断、前后页拼起来才完整的一句话，要拼接还原。</li>' +
                '<li><b>整理成结构清晰的章节笔记</b>：用标题层级（章节号如 2.1、2.2 作二级标题，知识点作三级标题）组织，列表、表格要点保留。</li>' +
                '<li><b>老师课件里的代码，一律用 Markdown 代码块包裹</b>（用三个反引号 ``` 并在首行标注语言，如 ```python），方便阅读与复制；表格类内容用 Markdown 表格。</li>' +
                '<li><b>同时输出两份产物</b>：① 一份排版规整、可直接阅读的 <b>Word 版</b>；② 一份 <b>Markdown（.md）版</b>。两份内容一致，代码块、表格格式在两版中都要正确呈现。</li>' +
                '<li>保持原意，不要杜撰课件中没有的知识点。以「✦」开头的"点睛/小结"句是课件要点，请保留并作为该节的小结。</li>' +
                '</ol></div>';

            var body = esc(rawText).replace(/\n/g, '<br>');

            var html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">' +
                '<head><meta charset="utf-8"></head>' +
                '<body style="font-family:宋体;font-size:15px;line-height:1.8;padding:20px;">' +
                instr + '<hr>' + body +
                '</body></html>';

            var totalPages = (rawText.match(/【第 \d+ 页】/g) || []).length || totalCache || '';
            var fname = '课件笔记_' + (title ? title : '未识别章节') + '_共' + totalPages + '页.doc';
            var blob = new Blob(['\ufeff', html], { type: 'application/msword' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url; a.download = fname;
            document.body.appendChild(a); a.click(); a.remove();
            URL.revokeObjectURL(url);
        }

        if (document.readyState === 'complete') ensureUI();
        else window.addEventListener('load', function () { setTimeout(ensureUI, 1500); });
    }

    // ===================== 课件 iframe 内部：负责翻页、抓正文、自动探测页数 =====================
    function initFrame() {
        var MAX_CAP = 200; // 安全上限，防止无限翻页

        function cleanText(t) {
            return String(t).split('\n').map(function (l) { return l.trim(); })
                    .filter(function (l) { return l.length > 0; }).join('\n');
        }

        // ---- 核心：抓取时排除"代码运行输出"黑框/终端/结果容器 ----
        // 这些是运行时打印结果（如 Python 的 print 输出、控制台/终端框），不是老师写的正文。
        var RUNTIME_KILL_SELECTORS = [
            '[class*="terminal" i]', '[class*="console" i]',
            '[class*="stdout" i]', '[class*="stderr" i]',
            '[class*="run-output" i]', '[class*="runoutput" i]',
            '[class*="exec-out" i]', '[class*="execout" i]',
            '[class*="output-area" i]', '[class*="output_area" i]',
            '[class*="ipython" i]', '[class*="pyodide" i]',
            '[id*="terminal" i]', '[id*="console" i]', '[id*="stdout" i]',
            '[id*="output" i][class*="run" i]'
        ];
        // 文本标记：命中这些词、且整体像"输出结果块"的容器一并排除
        var OUTPUT_TEXT_MARKERS = ['运行结果', '程序输出', '输出结果', '标准输出', 'stdout', 'In [', 'Out[', '>>> ', '... '];

        function isProtected(node) {
            // 避免误删课件正文/幻灯片根容器
            var cls = (node.className || '') + ' ' + (node.id || '');
            return /slide|deck|main-content|lesson|article|content-root/i.test(cls);
        }

        function collectRuntimeNodes(root) {
            var set = [];
            RUNTIME_KILL_SELECTORS.forEach(function (sel) {
                try { root.querySelectorAll(sel).forEach(function (el) { if (!isProtected(el)) set.push(el); }); } catch (e) {}
            });
            // 文本启发式：块级元素直接以输出标记开头，且自身不是超大容器
            try {
                root.querySelectorAll('pre,div,section').forEach(function (el) {
                    if (isProtected(el)) return;
                    if (set.indexOf(el) >= 0) return;
                    var txt = (el.innerText || el.textContent || '').trim();
                    if (txt.length > 4000) return; // 过大的多半是正文容器，不动
                    for (var k = 0; k < OUTPUT_TEXT_MARKERS.length; k++) {
                        if (txt.indexOf(OUTPUT_TEXT_MARKERS[k]) === 0) { set.push(el); break; }
                    }
                });
            } catch (e) {}
            return set;
        }

        // 临时把运行时输出节点隐藏（利用浏览器 innerText 跳过 display:none 的能力），返回恢复函数
        function hideRuntimeNodes() {
            var nodes = [];
            try { nodes = collectRuntimeNodes(document.body); } catch (e) { return function () {}; }
            var snap = nodes.map(function (el) { return [el, el.style.display]; });
            nodes.forEach(function (el) { try { el.style.display = 'none'; } catch (e) {} });
            return function () { snap.forEach(function (p) { try { p[0].style.display = p[1]; } catch (e) {} }); };
        }

        // 逐行剔除已知的纯噪音行（工具栏/按钮/运行时加载提示/脚本进度行），但保留页码"X / Y"行
        var NOISE_LINE_RE = /^(⌂|← →|←|→\s*\/\s*空格|.*翻页\s*·\s*G\s*目录|▶\s*运行$|▶\s*结果$|^编辑$|^放大$|^（放大）$|运行环境[:：]|Python\s*运行时首次运行|已加载[:：]\s*[（(]?等待中|超过\s*3\s*分钟仍无进展|改用电脑打开本页|⏳|正在逐页提取|正在抓取第)/i;
        function filterNoise(text) {
            return text.split('\n').filter(function (line) {
                var l = line.trim();
                if (l.length === 0) return false;
                if (NOISE_LINE_RE.test(l)) return false;
                return true;
            }).join('\n');
        }

        // 干净抓取：排除运行输出 + 过滤噪音行；保底不为空
        function grab() {
            var restore = hideRuntimeNodes();
            var raw = '';
            try { raw = document.body.innerText || ''; } catch (e) { raw = ''; }
            var out = filterNoise(cleanText(raw));
            try { restore(); } catch (e) {}
            // 保底：若因误删导致抓空，退回不过滤的整页文本，绝不出空白页
            if (!out || out.replace(/\s/g, '').length < 2) {
                out = cleanText(document.body.innerText || '');
            }
            return out;
        }

        function parsePageInfo(text) {
            var m = text.match(/(\d+)\s*\/\s*(\d+)/);
            if (m) return { cur: parseInt(m[1], 10), total: parseInt(m[2], 10) };
            return null;
        }

        function detectTotal() {
            var t = grab();
            var info = parsePageInfo(t);
            var total = info ? info.total : null;
            var title = '';
            var tm = t.match(/第\s*\d+\s*章[ ·\u00b7]+([^\n]+)/);
            if (tm) title = tm[0].trim();
            return { total: total, title: title, cur: info ? info.cur : null };
        }

        function pressRight() {
            ['ArrowRight', 'Right'].forEach(function (k) {
                try {
                    document.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k === 'ArrowRight' ? 'ArrowRight' : 'Right', keyCode: 39, which: 39, bubbles: true }));
                    document.dispatchEvent(new KeyboardEvent('keyup', { key: k, keyCode: 39, which: 39, bubbles: true }));
                } catch (e) {}
            });
            try { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); } catch (e) {}
        }

        // 兜底翻页：主动点击课件上的"下一页 / › / ›› / next"按钮
        function clickNext() {
            var ok = false;
            var cand = [];
            try {
                document.querySelectorAll('button,a,[role="button"],span,div').forEach(function (el) {
                    var txt = (el.textContent || '').trim();
                    var cls = (el.className || '') + ' ' + (el.id || '');
                    if (txt === '›' || txt === '››' || txt === '→' || txt === '下一页' ||
                        /next|forward|right|pagination-next|slide-next/i.test(cls)) {
                        // 只挑小尺寸的按钮，避免命中整个内容容器
                        var r = el.getBoundingClientRect();
                        if (r.width > 0 && r.width < 400 && r.height > 0 && r.height < 200) cand.push(el);
                    }
                });
            } catch (e) {}
            cand.forEach(function (el) { try { el.click(); ok = true; } catch (e) {} });
            return ok;
        }

        function toParent(data) {
            try { window.parent.postMessage({ ch: CH, data: data }, '*'); } catch (e) {}
        }

        function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

        async function run() {
            try {
                await sleep(800);
                var first = detectTotal();
                var total = first.total || 0;
                toParent({ action: 'total', total: total || '未知' });

                var collected = [];   // [{page, text}]
                var lastText = null;

                for (var i = 1; i <= (total || MAX_CAP); i++) {
                    await sleep(1400);
                    var text = grab();
                    toParent({ action: 'progress', i: i, total: total || '?' });
                    collected.push({ page: i, text: text });

                    if (i >= (total || MAX_CAP)) break;

                    // 翻页 + 验收：确保内容真的变了，否则重试
                    var changed = false;
                    var waits = [900, 1400, 2000, 2800];
                    for (var attempt = 0; attempt < waits.length && !changed; attempt++) {
                        pressRight();
                        clickNext();
                        await sleep(waits[attempt]);
                        var probe = grab();
                        if (probe !== lastText && probe !== text) { changed = true; text = probe; }
                    }
                    lastText = collected[collected.length - 1].text;

                    if (!changed) {
                        // 真翻不动：如实上报，不再硬塞重复页冒充
                        toParent({ action: 'stuck', i: i });
                        break;
                    }
                    // 把验收到的新内容补记为下一页
                    collected.push({ page: i + 1, text: text });
                    lastText = text;
                    i++; // 验收时已抓到下一页，循环计数+1
                    if (i >= (total || MAX_CAP)) break;
                }

                var bodyText = buildBody(collected);
                toParent({ action: 'done', text: bodyText, title: first.title });
            } catch (err) {
                toParent({ action: 'error', msg: err.message });
            }
        }

        function buildBody(collected) {
            var out = '';
            var seen = {};
            // 按页号去重（验收逻辑可能产生重复页号），并跳过完全重复的整页文本
            var maxPage = 0;
            for (var i = 0; i < collected.length; i++) {
                if (collected[i].page > maxPage) maxPage = collected[i].page;
            }
            var byPage = {};
            for (var j = 0; j < collected.length; j++) {
                var pg = collected[j].page;
                if (!byPage[pg]) byPage[pg] = collected[j].text;
            }
            for (var p = 1; p <= maxPage; p++) {
                if (byPage[p] === undefined) continue;
                if (seen[byPage[p]]) continue; seen[byPage[p]] = 1;
                out += '\n\n【第 ' + p + ' 页】\n' + byPage[p] + '\n';
            }
            return out;
        }

        window.addEventListener('message', function (ev) {
            if (!ev.data || ev.data.ch !== CH) return;
            var d = ev.data.data || {};
            if (d.action === 'start') run();
        });
    }

    // ===================== 入口分流 =====================
    try {
        if (window.self === window.top) {
            initTop();
        } else {
            initFrame();
        }
    } catch (e) {}
})();
