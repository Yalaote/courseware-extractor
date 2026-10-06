// ==UserScript==
// @name         课件提取器 第11版-按钮外置+自动页数+AI整理指令
// @namespace    http://tampermonkey.net/
// @version      11.0
// @description  按钮显示在外层网页右下角；自动探测课件总页数；导出文件开头附带交给AI整理笔记的指令
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

        function ensureUI() {
            if (btn && document.body.contains(btn)) return;
            var box = document.createElement('div');
            box.id = 'tm11-box';
            box.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:2147483647;display:flex;flex-direction:column;gap:8px;align-items:flex-end;';

            btn = document.createElement('button');
            btn.id = 'tm11-btn';
            btn.textContent = '📚 提取课件正文';
            btn.style.cssText = 'padding:12px 18px;background:#d6336c;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer;font-weight:bold;box-shadow:0 4px 12px rgba(0,0,0,.3);user-select:none;';

            status = document.createElement('div');
            status.id = 'tm11-status';
            status.style.cssText = 'padding:8px 14px;background:rgba(0,0,0,.85);color:#fff;border-radius:6px;font-size:13px;display:none;max-width:320px;';

            box.appendChild(btn); box.appendChild(status);
            document.body.appendChild(box);
            btn.addEventListener('click', start);
        }

        function findDeck() {
            // 找到课件 iframe（非当前域、src 含 teaching 的子窗口）
            var frames = document.querySelectorAll('iframe');
            for (var i = 0; i < frames.length; i++) {
                try {
                    var src = frames[i].src || '';
                    if (/teaching|deck|slide|course/i.test(src) && !/about:blank/.test(src)) {
                        return frames[i];
                    }
                } catch (e) {}
            }
            // 兜底：取第一个 iframe
            return frames[0] || null;
        }

        function send(msg) {
            if (deckWin && deckWin.contentWindow) {
                try { deckWin.contentWindow.postMessage({ ch: CH, data: msg }, deckOrigin); } catch (e) {}
            }
        }

        function start() {
            var f = findDeck();
            if (!f) { show('❌ 没找到课件窗口，请先打开课件放映页'); return; }
            deckWin = f;
            btn.disabled = true; btn.textContent = '⏳ 提取中...';
            show('已通知课件窗口，开始自动逐页提取...');
            send({ action: 'start' });
        }

        function show(t) { if (status) { status.style.display = 'block'; status.textContent = t; } }

        function hideLater() { setTimeout(function () { if (status) status.style.display = 'none'; }, 8000); }

        // 接收 iframe 发来的进度 / 结果
        window.addEventListener('message', function (ev) {
            if (!ev.data || ev.data.ch !== CH) return;
            var d = ev.data.data || {};
            if (d.action === 'total') {
                show('检测到总页数：' + d.total + ' 页，正在逐页抓取...');
            } else if (d.action === 'progress') {
                show('正在抓取第 ' + d.i + ' / ' + (d.total || '?') + ' 页...');
            } else if (d.action === 'done') {
                show('✅ 提取完成，正在生成 Word...');
                downloadWord(d.text, d.title);
                btn.disabled = false; btn.textContent = '📚 提取课件正文';
                show('✅ 已生成并下载，请查看浏览器下载列表');
                hideLater();
            } else if (d.action === 'error') {
                show('❌ 出错：' + d.msg);
                btn.disabled = false; btn.textContent = '📚 提取课件正文';
            }
        });

        // 生成 Word（开头带 AI 指令）
        function downloadWord(rawText, title) {
            var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };

            var instr = '' +
                '<div style="background:#fff8e1;border:2px solid #f0a30a;border-radius:8px;padding:18px 22px;margin-bottom:28px;">' +
                '<h2 style="color:#b26a00;margin:0 0 10px;">【给 AI 的整理指令（请把整段连同后面的课件正文一起发给 AI）】</h2>' +
                '<p>你是一位笔记整理助手。下面这份文本是用浏览器脚本从一个<b>网页课件 iframe</b>（互动式网页课件，不是图片、也不是 PDF）里逐页抓取出来的纯文字。请你按下面要求整理：</p>' +
                '<ol>' +
                '<li><b>删除每页重复的“网页外壳/无关信息”</b>，包括但不限于：' +
                '<br>· 页码与章节页眉（形如「第X章 · ×××」「数字 / 数字」「X / 总页」）；' +
                '<br>· 工具栏文字「⌂ 课程中心」「← → / 空格 翻页 · G 目录 · F 全屏 · 点“▶运行”执行代码」；' +
                '<br>· 代码框按钮残留文字「编辑」「▶运行」「▶结果」「放大」「（放大）」；' +
                '<br>· 运行状态提示「运行环境：未加载（点“运行”启用）」；' +
                '<br>· 运行时加载提示「Python 运行时首次运行要下载约 48MB…」「已加载：(等待中)」「超过 3 分钟仍无进展…改用电脑打开本页」；' +
                '<br>· 任何以「⏳」「正在逐页提取」「正在抓取第…页」开头的脚本残留行。' +
                '</li>' +
                '<li><b>合并、去重</b>：相邻页若有完全相同的标题行/知识点（课件翻页时常见重复），合并为一条，不要重复罗列。' +
                '对于内容被运行时提示挤断、前后页拼起来才完整的一句话，要拼接还原。</li>' +
                '<li><b>整理成结构清晰的章节笔记</b>：用标题层级（章节号如 2.1、2.2 作二级标题，知识点作三级标题）组织，列表、表格要点保留。</li>' +
                '<li><b>老师课件里的代码，一律用 Markdown 代码块包裹</b>（用三个反引号 ``` 并在首行标注语言，如 ```python），方便阅读与复制；表格类内容用 Markdown 表格。</li>' +
                '<li><b>同时输出两份产物</b>：① 一份排版规整、可直接阅读的 <b>Word 版</b>；② 一份 <b>Markdown（.md）版</b>。两份内容一致，代码块、表格格式在两版中都要正确呈现。</li>' +
                '<li>保持原意，不要杜撰课件中没有的知识点。以「✦」开头的“点睛/小结”句是课件要点，请保留并作为该节的小结。</li>' +
                '</ol></div>';

            var body = esc(rawText).replace(/\n/g, '<br>');

            var html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">' +
                '<head><meta charset="utf-8"></head>' +
                '<body style="font-family:宋体;font-size:15px;line-height:1.8;padding:20px;">' +
                instr + '<hr>' + body +
                '</body></html>';

            var fname = '课件笔记_' + (title ? title.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '') : '提取版') + '_第11版.doc';
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
            return t.split('\n').map(function (l) { return l.trim(); })
                    .filter(function (l) { return l.length > 0; }).join('\n');
        }

        function grab() { return cleanText(document.body.innerText || ''); }

        // 从当前页文字里解析「当前页 / 总页数」，如 2 / 37
        function parsePageInfo(text) {
            var m = text.match(/(\d+)\s*\/\s*(\d+)/);
            if (m) return { cur: parseInt(m[1], 10), total: parseInt(m[2], 10) };
            return null;
        }

        // 探测总页数：抓一页，读取页码指示器；同时识别章名
        function detectTotal() {
            var t = grab();
            var info = parsePageInfo(t);
            var total = info ? info.total : null;
            // 章名识别：第X章 · 名称
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
            // 兜底：再向 window 派发一次
            try { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); } catch (e) {}
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
                var stuck = 0;        // 连续内容不变次数

                for (var i = 1; i <= (total || MAX_CAP); i++) {
                    await sleep(1400); // 等待渲染稳定
                    var text = grab();
                    toParent({ action: 'progress', i: i, total: total || '?' });

                    // 内容去重：与上一页完全相同则计数
                    if (lastText !== null && text === lastText) {
                        stuck++;
                        if (stuck >= 2) break; // 翻页卡住/到最后一页，提前停止（用于 total 未探明的情况）
                    } else {
                        stuck = 0;
                    }
                    collected.push({ page: i, text: text });
                    lastText = text;

                    if (i < (total || MAX_CAP)) pressRight();
                }

                // 若第一次没探到 total 但循环因 stuck 提前结束，去掉末尾重复页
                var bodyText = buildBody(collected);
                toParent({ action: 'done', text: bodyText, title: first.title });
            } catch (err) {
                toParent({ action: 'error', msg: err.message });
            }
        }

        function buildBody(collected) {
            var out = '';
            var seen = {};
            for (var i = 0; i < collected.length; i++) {
                var txt = collected[i].text;
                if (seen[txt]) continue; seen[txt] = 1; // 跳过完全重复的整页
                out += '\n\n【第 ' + collected[i].page + ' 页】\n' + txt + '\n';
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
