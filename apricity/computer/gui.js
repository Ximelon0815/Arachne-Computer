// ============================================
// gui.js — Arachne 全部逻辑 (合并在一个文件里)
// AUI 注意: 没有 NodeList.forEach; style 必须用 ss() 写
// ============================================

// ---- 工具: 安全遍历 (AUI 没有 forEach) ----
function each(list, fn) {
    if (!list) return;
    for (var i = 0; i < list.length; i++) {
        fn(list[i], i);
    }
}
// ---- 工具: HTML 转义 ----
function escapeHtml(s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---- 工具: 设置 style ----
/**
 * 难点: AUI 里 el.style.x = val 不生效, 只能 setAttribute("style", ...)
 * 手动合并现有内联样式再写回去
 */
function camelToKebab(s) {
    return s.replace(/[A-Z]/g, function(m) { return "-" + m.toLowerCase(); });
}
function ss(el, prop, val) {
    if (!el || !el.getAttribute) return;
    try {
        var css = el.getAttribute("style") || "";
        var rules = {};
        var parts = css.split(";");
        for (var i = 0; i < parts.length; i++) {
            var part = parts[i].trim();
            if (!part) continue;
            var idx = part.indexOf(":");
            if (idx > 0) {
                var k = part.substring(0, idx).trim();
                var v = part.substring(idx + 1).trim();
                if (k) rules[k] = v;
            }
        }
        var key = camelToKebab(prop);
        if (val === "" || val === null) {
            delete rules[key];
        } else {
            rules[key] = val;
        }
        var out = [];
        for (var k2 in rules) out.push(k2 + ":" + rules[k2]);
        el.setAttribute("style", out.join(";"));
    } catch(e) {}
}

// 禁用滚轮滚动

document.addEventListener("wheel", function(e) {
    if (e && e.preventDefault) e.preventDefault();
});

console.log("[Arachne] GUI 已加载 " + window.innerWidth + "x" + window.innerHeight);

// ============================================
//  §1 网络通信 + 时钟
// ============================================

var clockEl = document.querySelector("#clockText");
console.log("[Clock] clockEl=" + (clockEl ? "found" : "MISSING"));

function sendToServer(channel, data) {
    if (typeof Network !== "undefined" && Network.sendToServer) {
        Network.sendToServer(channel, data);
        return true;
    }
    return false;
}

function stripMCFormat(str) {
    if (!str) return "";
    return str.replace(/§[0-9a-fklmnor]/gi, "");
}

function updateClockFromTicks(t) {
    var adj = (t + 6000) % 24000;
    var h = Math.floor(adj / 1000);
    var m = Math.floor((adj % 1000) * 60 / 1000);
    var timeStr = ("0" + h).slice(-2) + ":" + ("0" + m).slice(-2);
    if (clockEl) clockEl.innerText = timeStr;
}

function requestTime() {
    sendToServer("computer_terminal", { action: "get_time" });
}



if (typeof Network !== "undefined" && Network.receiveFromServer) {
    Network.receiveFromServer(function(d) {
        if (!d) return;
        if (d.type === "time_update") updateClockFromTicks(d.time);
        if (d.type === "floppy_success") {
            // 软盘读成功: 关进度条 → 黑屏 3 秒 → 显示结果
            if (typeof closeFloppyDlg === "function") closeFloppyDlg();
            playBlackout(function() {
                if (typeof showMsg === "function") showMsg(stripMCFormat(d.msg || "Arachne 软盘读取成功！"), "icons/145.png", "读取软盘");
            });
            return;
        }
        if (d.type === "show_msg") {
            if (typeof showMsg === "function") showMsg(stripMCFormat(d.msg || ""));
        }
    });
}

// ============================================
//  §2 布局 — 固定 640x360 (元素尺寸由 CSS 控制, 这里只定义常量)
// ============================================

var canvasW = window.innerWidth;
var canvasH = window.innerHeight;

// 难点: 刚进来 window.innerHeight 是窗口尺寸(如 529), 文档激活后才变 360。
// 记录窗口 GUI 高度用于铺满桌面背景, 否则 fit 缩放时底部露出游戏画面
var windowGuiH = 0;
try { var _guh = window.innerHeight; if (isFinite(_guh) && _guh > 0) windowGuiH = _guh; } catch (e) {}

console.log("[Layout] 画布 " + canvasW + "x" + canvasH + " guiH=" + windowGuiH);

// 固定尺寸常量 (与 CSS 一致)
var taskbarH = 18;
var winW = 400;   // 窗口缩小三分之一
var winH = 213;
var treeW = 107;
var winPct = 0.9;
var availH = canvasH - taskbarH;

// 读取 body 真实渲染尺寸 (fixed 布局下即 640x360)
function getBodySize() {
    var bw = canvasW, bh = canvasH;
    try {
        var rb = document.body ? document.body.getBoundingClientRect() : null;
        if (rb) {
            if (isFinite(rb.width) && rb.width > 0) bw = rb.width;
            if (isFinite(rb.height) && rb.height > 0) bh = rb.height;
        }
    } catch (e) {}
    if (!isFinite(bw) || bw <= 0) bw = 640;
    if (!isFinite(bh) || bh <= 0) bh = 360;
    return { w: bw, h: bh };
}
// 任务栏高度固定 18px (与 CSS 一致)
function getTaskbarH() {
    return 18;
}

// 难点: AUI fixed 模式下 body 默认只等于内容高度, 不会自动填满视口, 不设高度界面只占上半截。
// 且 JS 早期执行时 window.innerWidth/innerHeight 返回窗口尺寸(如 924x529)而非布局高度(360)。
// fixed 640x360 布局下高度固定 360。
function fillViewport() {
    // 难点: scale=fit 时 renderScale = min(guiW/640, guiH/360)。
    // 窗口比 16:9 略高时(如 1856x1057 → gui 928x528.5) fit 只渲染 522 高, 底部露出游戏画面,
    // 需要布局高 = guiH/renderScale = 528.5/1.45 ≈ 365。
    // 必须一开始就用最终高度, 不能先 360 再延迟改 365, 否则打开瞬间底部闪缝
    var vh = 365;
    if (document.body) ss(document.body, "height", vh + "px");
    var dp = document.querySelector(".desktop");
    if (dp) ss(dp, "height", (vh - (getTaskbarH() + 1) - 22) + "px");
    return vh;
}

function applyLayout() {
    fillViewport();
    // 布局位置全用固定值 (与 CSS 一致)
    var sm = document.querySelector("#startMenu");
    if (sm) ss(sm, "bottom", "18px");
}

applyLayout();


// ============================================
//  §3 桌面图标 + 开始菜单
// ============================================

var selectedIcon = null, menuOpen = false;
var ic   = document.querySelector("#iconCraft");
var fm   = document.querySelector("#iconFileMgr");
var docs = document.querySelector("#iconDocs");
var btnStart   = document.querySelector("#btnStart");
var startMenu  = document.querySelector("#startMenu");
var desktopArea = document.querySelector("#desktopArea");

function selectIcon(el) {
    if (selectedIcon) selectedIcon.classList.remove("selected");
    el.classList.add("selected");
    selectedIcon = el;
}

if (ic)   ic.addEventListener("click",   function() { selectIcon(ic); });
if (fm)   fm.addEventListener("click",   function() { selectIcon(fm); });
if (docs) docs.addEventListener("click", function() { selectIcon(docs); });

if (ic) ic.addEventListener("dblclick", function() { selectIcon(ic); openCraftWin(); });
if (fm) fm.addEventListener("dblclick", function() { selectIcon(fm); openFileManager(); });
if (docs) docs.addEventListener("dblclick", function() {
    selectIcon(docs); openDocsWin();
});

if (desktopArea) desktopArea.addEventListener("click", function(e) {
    if (!e.target.closest(".desktop-icon") && selectedIcon) {
        selectedIcon.classList.remove("selected"); selectedIcon = null;
    }
});

// ---- 开始菜单开关 ----
var closeTimer = null;
function openStartMenu() {
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    if (!menuOpen) {
        menuOpen = true;
        if (startMenu) startMenu.classList.add("show");
        if (btnStart)  btnStart.classList.add("open");
    }
}
function scheduleCloseMenu() {
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = setTimeout(function() { closeMenu(); }, 50);
}
function cancelCloseMenu() {
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
}
function closeMenu() {
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    menuOpen = false;
    if (startMenu) startMenu.classList.remove("show");
    if (btnStart)  btnStart.classList.remove("open");
}

if (btnStart && startMenu) {
    // 点击开始按钮: 开/关菜单
    btnStart.addEventListener("click", function(e) {
        e.stopPropagation();
        if (menuOpen) closeMenu(); else openStartMenu();
    });
    // 移出按钮延迟关闭, 给时间把鼠标挪进菜单
    btnStart.addEventListener("mouseleave", scheduleCloseMenu);
    // 菜单内悬停 → 保持打开
    startMenu.addEventListener("mouseenter", cancelCloseMenu);
    // 移出菜单 → 自动关闭
    startMenu.addEventListener("mouseleave", scheduleCloseMenu);
}

if (startMenu) {
    var miCraft = startMenu.querySelector('[data-action="craft"]');
    var miDocs  = startMenu.querySelector('[data-action="docs"]');
    var miClose = startMenu.querySelector('[data-action="close"]');
    if (miCraft) miCraft.addEventListener("click", function() { selectIcon(ic); openCraftWin(); closeMenu(); });
    if (miDocs) miDocs.addEventListener("click", function() {
        selectIcon(docs); openDocsWin();
        closeMenu();
    });
    if (miClose) miClose.addEventListener("click", function() {
        closeMenu();
        // 难点: 页面里 ApricityUI 全局可用(AUI 的 global.js 也用它), 直接关屏幕,
        // 不依赖 KubeJS 客户端脚本是否加载; 失败再靠服务端兜底
        try {
            if (typeof ApricityUI !== "undefined" && ApricityUI.closeScreen) {
                ApricityUI.closeScreen();
            }
        } catch (e) {}
        sendToServer("computer_terminal", { action: "close" });
    });
}

document.addEventListener("click", function(e) {
    if (menuOpen && !e.target.closest(".start-menu") && !e.target.closest("#btnStart")) closeMenu();
});

// ============================================
//  §4 窗口管理 + 面板 + 对话框
// ============================================

var fileWinOpen = false, craftWinOpen = false, docsWinOpen = false;
var zTop = 40, dragInfo = null, transferTimer = null, floppyTimer = null, floppySendTimer = null;

var ICO_FOLDER  = "icons/039.png";
var ICO_HDD     = "icons/182.png";
var ICO_CONTROL = "icons/453.png";
var ICO_LOADER  = "icons/187.png";
var ICO_GEAR    = "icons/130.png";
var ICO_FLOPPY  = "icons/145.png";

var panelData = {
    mycomp: { title: "我的电脑", icon: "icons/020.png", type: "list", items: [
        { icon: ICO_HDD,     text: "(C:)",       s: "2.1GB", t: "本地磁盘",  disabled: true },
        { icon: ICO_CONTROL, text: "控制面板",   s: "",      t: "系统文件夹", disabled: true },
        { icon: ICO_LOADER,  text: "打印机",     s: "",      t: "系统文件夹", disabled: true },
        { icon: ICO_FLOPPY,  text: "读取软盘",   s: "",      t: "",         exe: "floppy" }
    ]},
    craft: { title: "工作台", icon: "icons/130.png", type: "craft" },
    docs:  { title: "文档",   icon: "icons/039.png", type: "list", items: [
        { icon: ICO_FOLDER, text: "一号车厢", s: "", t: "文件夹" },
        { icon: ICO_FOLDER, text: "二号车厢", s: "", t: "文件夹" },
        { icon: ICO_FOLDER, text: "三号车厢", s: "", t: "文件夹" },
        { icon: ICO_FOLDER, text: "四号车厢", s: "", t: "文件夹" }
    ]}
};

function bringToFront(overlay) { if (!overlay) return; zTop++; ss(overlay, "zIndex", zTop); }

/** 清掉拖拽残留定位, 恢复窗口 flex 居中 (尺寸由 CSS 控制) */
function fitWindow(win) {
    if (!win) return;
    ss(win, "position", ""); ss(win, "left", ""); ss(win, "top", ""); ss(win, "margin", "");
}

/** 清掉窗口/对话框内联定位, 恢复 flex 居中 */
function resetWindowPosition(overlay, win) {
    // 清 overlay 的 flex 对齐 (去掉拖拽时设的 inline style)
    if (overlay) {
        ss(overlay, "alignItems", ""); ss(overlay, "justifyContent", "");
    }
    // 清窗口的绝对定位 (去掉拖拽时设的 left/top/margin/position)
    if (win) {
        ss(win, "position", ""); ss(win, "left", "");
        ss(win, "top", ""); ss(win, "margin", "");
    }
}

// ---- 任务栏窗口按钮 (显示/隐藏, 点击最小化/恢复) ----
// 难点: AUI 里 el.style.x=val 不生效, 必须用 ss()
function showTaskBtn(id) {
    var b = document.getElementById(id);
    if (b) { ss(b, "display", "flex"); b.classList.add("active"); }
}
function hideTaskBtn(id) {
    var b = document.getElementById(id);
    if (b) { ss(b, "display", "none"); b.classList.remove("active"); }
}
// 难点: AUI 里 setAttribute 后 getAttribute 可能返回旧值,
// 所以 icon 由调用方直接传入, 不从 DOM 回读。
// titleId → 任务栏按钮 id 映射 (renderPanel 同步用)
var TITLE_TASK_MAP = {
    "#fileTitleText": "taskFile",
    "#craftTitleText": "taskCraft",
    "#docsTitleText": "taskDocs"
};
function syncTaskIcon(taskId, icon) {
    var b = document.getElementById(taskId); if (!b) return;
    var img = b.querySelector("img");
    if (img && icon) img.setAttribute("src", icon);
}

function closeFileManager() {
    var ov = document.querySelector("#fileWinOverlay");
    var win = ov ? ov.querySelector(".win95-window") : null;
    resetWindowPosition(ov, win);
    if (ov) ov.classList.remove("show"); fileWinOpen = false;
    hideTaskBtn("taskFile");
}
// 读取树当前选中的面板 key (重渲染时保留用户选择)
function currentTreeKey(treeId) {
    var sel = document.querySelector(treeId + " .win-tree-item.selected");
    var k = sel ? sel.getAttribute("data-panel") : "";
    return (k && panelData[k]) ? k : "mycomp";
}

function openFileManager(initialKey) {
    var ov = document.querySelector("#fileWinOverlay"); if (!ov) return;
    ov.classList.add("show"); fileWinOpen = true; bringToFront(ov);
    // 从最小化恢复保留原位置; 首次打开则居中
    if (ov.getAttribute("data-minimized") === "1") {
        ov.removeAttribute("data-minimized");
    } else {
        fitWindow(ov.querySelector(".win95-window"));
    }
    // 明确渲染目标面板 (默认"我的电脑"), 避免残留选中状态带偏
    var key = (initialKey && panelData[initialKey]) ? initialKey : "mycomp";
    renderPanel("#fileTree","#fileList","#fileStatus","#fileTitleText", key);
    showTaskBtn("taskFile");
    ensurePanelsRendered(); // 打开瞬间立即检测恢复
}

function closeCraftWin() {
    var ov = document.querySelector("#craftWinOverlay");
    var win = ov ? ov.querySelector(".win95-window") : null;
    resetWindowPosition(ov, win);
    if (ov) ov.classList.remove("show"); craftWinOpen = false;
    hideTaskBtn("taskCraft");
}
function openCraftWin() {
    var ov = document.querySelector("#craftWinOverlay"); if (!ov) return;
    ov.classList.add("show"); craftWinOpen = true; bringToFront(ov);
    // 从最小化恢复保留原位置; 首次打开则居中
    if (ov.getAttribute("data-minimized") === "1") {
        ov.removeAttribute("data-minimized");
    } else {
        fitWindow(ov.querySelector(".win95-window"));
    }
    // 明确渲染工作台面板, 避免残留选中状态 (如"文档") 污染工作台窗口
    renderPanel("#craftTree","#craftPanel","#craftStatus","#craftTitleText","craft");
    showTaskBtn("taskCraft");
    ensurePanelsRendered(); // 打开瞬间立即检测恢复
}
function closeDocsWin() {
    var ov = document.querySelector("#docsWinOverlay");
    var win = ov ? ov.querySelector(".win95-window") : null;
    resetWindowPosition(ov, win);
    if (ov) ov.classList.remove("show"); docsWinOpen = false;
    hideTaskBtn("taskDocs");
}
function openDocsWin() {
    var ov = document.querySelector("#docsWinOverlay"); if (!ov) return;
    ov.classList.add("show"); docsWinOpen = true; bringToFront(ov);
    // 从最小化恢复保留原位置; 首次打开则居中
    if (ov.getAttribute("data-minimized") === "1") {
        ov.removeAttribute("data-minimized");
    } else {
        fitWindow(ov.querySelector(".win95-window"));
    }
    // 明确渲染文档面板
    renderPanel("#docsTree","#docsList","#docsStatus","#docsTitleText","docs");
    showTaskBtn("taskDocs");
    ensurePanelsRendered(); // 打开瞬间立即检测恢复
}
// 工作台"车票转化"双击事件 (加载时绑一次)
(function() {
    try {
        var tExe = document.querySelector('#craftPanel .ticket-item');
        if (tExe) tExe.addEventListener("dblclick", function() {
            sendToServer("computer_terminal", { action: "ticket_craft" });
            showTransferThenMsg(true, "合成请求已发送！\n请查看背包获取结果");
        });
    } catch (e) {}
})();

var btnFileClose  = document.querySelector("#btnFileClose");
var btnCraftClose = document.querySelector("#btnCraftClose");
var btnDocsClose  = document.querySelector("#btnDocsClose");
if (btnFileClose)  btnFileClose.addEventListener("click", closeFileManager);
if (btnCraftClose) btnCraftClose.addEventListener("click", closeCraftWin);
if (btnDocsClose)  btnDocsClose.addEventListener("click", closeDocsWin);

// 任务栏按钮: 点击最小化/恢复窗口
var taskFile  = document.querySelector("#taskFile");
var taskCraft = document.querySelector("#taskCraft");
var taskDocs  = document.querySelector("#taskDocs");
if (taskFile) taskFile.addEventListener("click", function() {
    var ov = document.querySelector("#fileWinOverlay"); if (!ov) return;
    if (ov.classList.contains("show")) {
        ov.classList.remove("show"); fileWinOpen = false;
        ov.setAttribute("data-minimized", "1");
        taskFile.classList.remove("active");
    } else { openFileManager(); }
});
if (taskCraft) taskCraft.addEventListener("click", function() {
    var ov = document.querySelector("#craftWinOverlay"); if (!ov) return;
    if (ov.classList.contains("show")) {
        ov.classList.remove("show"); craftWinOpen = false;
        ov.setAttribute("data-minimized", "1");
        taskCraft.classList.remove("active");
    } else { openCraftWin(); }
});
if (taskDocs) taskDocs.addEventListener("click", function() {
    var ov = document.querySelector("#docsWinOverlay"); if (!ov) return;
    if (ov.classList.contains("show")) {
        ov.classList.remove("show"); docsWinOpen = false;
        ov.setAttribute("data-minimized", "1");
        taskDocs.classList.remove("active");
    } else { openDocsWin(); }
});

// 标题栏最小化按钮: 隐藏窗口并打标记, 恢复时保留原位置
function minimizeWindow(overlaySel, taskId) {
    var ov = document.querySelector(overlaySel); if (!ov) return;
    ov.classList.remove("show");
    ov.setAttribute("data-minimized", "1");
    if (overlaySel === "#fileWinOverlay") fileWinOpen = false;
    else if (overlaySel === "#craftWinOverlay") craftWinOpen = false;
    else if (overlaySel === "#docsWinOverlay") docsWinOpen = false;
    var b = document.getElementById(taskId);
    if (b) b.classList.remove("active");
}
var btnFileMin  = document.querySelector("#btnFileMin");
var btnCraftMin = document.querySelector("#btnCraftMin");
var btnDocsMin  = document.querySelector("#btnDocsMin");
if (btnFileMin)  btnFileMin.addEventListener("click", function() { minimizeWindow("#fileWinOverlay", "taskFile"); });
if (btnCraftMin) btnCraftMin.addEventListener("click", function() { minimizeWindow("#craftWinOverlay", "taskCraft"); });
if (btnDocsMin)  btnDocsMin.addEventListener("click", function() { minimizeWindow("#docsWinOverlay", "taskDocs"); });

document.addEventListener("click", function(e) {
    var win = e.target.closest(".win95-window");
    if (win) { var ov = win.closest(".window-overlay"); if (ov) bringToFront(ov); }
});

// -- 面板渲染 --
function renderPanel(treeId, listId, statusId, titleId, key) {
    var tree = document.querySelector(treeId), list = document.querySelector(listId),
        status = document.querySelector(statusId), titleEl = document.querySelector(titleId);
    if (!tree || !list || !status) return;

    each(tree.querySelectorAll(".win-tree-item"), function(el) { el.classList.remove("selected"); });
    var sel = tree.querySelector('[data-panel="' + key + '"]');
    if (sel) sel.classList.add("selected");

    var data = panelData[key] || { title: key, type: "empty" };
    status.innerText = data.title;
    if (titleEl) titleEl.innerText = data.title;
    // 同步标题栏图标与任务栏按钮图标
    if (data.icon && titleId) {
        var iconEl = document.querySelector(titleId.replace(/Text$/, "Icon"));
        if (iconEl) iconEl.setAttribute("src", data.icon);
        // 对应窗口的任务栏按钮图标跟随变化
        var taskId = TITLE_TASK_MAP[titleId];
        if (taskId) syncTaskIcon(taskId, data.icon);
    }
    // 难点: AUI 对「匹配 CSS 规则 + 带内联 style」的元素会丢弃子元素 (只留文本),
    // 所以图标背景图必须放 CSS 类里
    var ICO_CLS = {
        "icons/145.png": "ico-floppy",
        "icons/182.png": "ico-hdd",
        "icons/453.png": "ico-control",
        "icons/187.png": "ico-printer",
        "icons/039.png": "ico-folder",
        "icons/149.png": "ico-gear"
    };
    var html = '<div class="win-list-header">'
        + '<div class="col-name">名称</div><div class="col-size">大小</div><div class="col-type">类型</div>'
        + '</div>';
    if (data.type === "list") {
        each(data.items || [], function(it) {
            var ico = it.icon ? (ICO_CLS[it.icon] || "") : "";
            html += '<div class="a5' + (it.disabled ? " disabled" : "") + (ico ? " " + ico : "") + (it.exe ? " " + it.exe + "-item" : "") + '">'
                + '<div class="col-name">' + escapeHtml(it.text) + '</div>'
                + '<div class="col-size">' + escapeHtml(it.s || "") + '</div>'
                + '<div class="col-type">' + escapeHtml(it.t || "") + '</div>'
                + '</div>';
        });
        // 难点: AUI 的 innerHTML 可能异步, 软盘项事件用 document 级委托绑定
    } else if (data.type === "craft") {
        html += '<div class="a5 ico-gear ticket-item">'
            + '<div class="col-name">车票转化.exe</div>'
            + '<div class="col-size">2KB</div>'
            + '<div class="col-type">应用程序</div>'
            + '</div>';
    }
    list.innerHTML = html;
    // innerHTML 生成后重新获取元素绑定事件
    if (data.type === "craft") {
        var exe = list.querySelector('.ticket-item');
        if (exe) exe.addEventListener("dblclick", function() {
            sendToServer("computer_terminal", { action: "ticket_craft" });
            showTransferThenMsg(true, "合成请求已发送！\n请查看背包获取结果");
        });
    }
}

// ---- 难点修复: AUI 加载文档时会丢掉静态列表项的子元素 (文本贴靠/丢缩进) ----
// 用 innerHTML 重建列表可避免 (AUI 不会丢 innerHTML 新建的元素)。
// setTimeout 回调在 Render 线程跑 (AUI ClientScheduler → Minecraft.execute), 单线程安全。
setTimeout(function() {
    try {
        renderPanel("#fileTree", "#fileList", "#fileStatus", "#fileTitleText", currentTreeKey("#fileTree"));
        renderPanel("#craftTree", "#craftPanel", "#craftStatus", "#craftTitleText", currentTreeKey("#craftTree"));
        renderPanel("#docsTree", "#docsList", "#docsStatus", "#docsTitleText", currentTreeKey("#docsTree"));
    } catch (e) {}
}, 1000);

// ---- 兜底: 检测到子元素丢失就 innerHTML 重建 (打开瞬间可能闪一下) ----
function ensurePanelsRendered() {
    try {
        if (!document.querySelector(".window-overlay.show")) return;
        var list = document.querySelector("#fileList");
        if (list && list.querySelector(".a5") && !list.querySelector(".a5 .col-name")) {
            renderPanel("#fileTree", "#fileList", "#fileStatus", "#fileTitleText", currentTreeKey("#fileTree"));
        }
        var craft = document.querySelector("#craftPanel");
        if (craft && craft.querySelector(".a5") && !craft.querySelector(".a5 .col-name")) {
            renderPanel("#craftTree", "#craftPanel", "#craftStatus", "#craftTitleText", currentTreeKey("#craftTree"));
        }
        var docs = document.querySelector("#docsList");
        if (docs && docs.querySelector(".a5") && !docs.querySelector(".a5 .col-name")) {
            renderPanel("#docsTree", "#docsList", "#docsStatus", "#docsTitleText", currentTreeKey("#docsTree"));
        }
    } catch (e) {}
}
// 打开窗口后每 300ms 检测一次 (共约 15 秒)
for (var _ri = 1; _ri <= 50; _ri++) {
    setTimeout(ensurePanelsRendered, _ri * 300);
}

// ---- FX 覆盖层: VHS 信号 (参考 vhs-jump / vhs-tearing / vhs-shake) ----
// 难点: AUI 的 CSS keyframe 动画支持弱, 全部用 JS 定时驱动。
function vhsTear(top, height, opacity) {
    var t = document.querySelector("#fxTear");
    if (!t) return;
    try {
        ss(t, "top", top + "%");
        ss(t, "height", height + "px");
        ss(t, "opacity", String(opacity));
    } catch (e) {}
}
// 难点: 只抖可见内容, body 不动, 否则露出画布外的游戏画面;
// 移开后露出桌面绿背景正好形成 VHS 错位感
var VHS_MOVE_TARGETS = ".desktop, .window-overlay, .transfer-dlg, .msg-dlg, .bottombar";
function vhsShift(x, y, skew) {
    // 全局画面抖动 (vhs-shake)
    try {
        var els = document.querySelectorAll(VHS_MOVE_TARGETS);
        for (var i = 0; i < els.length; i++) {
            var e = els[i];
            if (!e) continue;
            if (x === 0 && y === 0 && skew === 0) ss(e, "transform", "none");
            else ss(e, "transform", "translate(" + x + "px," + y + "px) skewX(" + skew + "deg)");
        }
    } catch (e) {}
    // 横纹垂直跳 (vhs-jump): 只偏移第 5 层横纹背景
    try {
        var fx = document.querySelector("#fxOverlay");
        if (fx) ss(fx, "background-position", "0 0, 0 100%, 0 0, 100% 0, 0 " + y + "px");
    } catch (e) {}
}
function vhsFlicker() {
    var fx = document.querySelector("#fxOverlay");
    if (!fx) return;
    setTimeout(function() {
        // t=0: 变暗 + 向右下错位 + 撕裂线
        try { ss(fx, "background-color", "rgba(0,0,0,0.12)"); } catch (e) {}
        vhsShift(3, 8, 0.5); vhsTear(15, 3, 0.7);
        // t=130: 恢复 + 向左上错位 + 撕裂线移动
        setTimeout(function() {
            try { ss(fx, "background-color", "transparent"); } catch (e) {}
            vhsShift(-3, -4, -0.5); vhsTear(16, 1, 0.8);
        }, 130);
        // t=220: 变暗 + 偏移 + 撕裂线
        setTimeout(function() {
            try { ss(fx, "background-color", "rgba(0,0,0,0.18)"); } catch (e) {}
            vhsShift(2, 5, 0); vhsTear(12, 4, 0.8);
        }, 220);
        // t=340: 恢复 + 偏移 + 撕裂线
        setTimeout(function() {
            try { ss(fx, "background-color", "transparent"); } catch (e) {}
            vhsShift(-2, -2, 0.3); vhsTear(60, 2, 0.7);
        }, 340);
        // t=440: 泛白 + 归位 + 撕裂线
        setTimeout(function() {
            try { ss(fx, "background-color", "rgba(255,255,255,0.03)"); } catch (e) {}
            vhsShift(0, 0, 0); vhsTear(62, 5, 0.9);
        }, 440);
        // t=520: 恢复
        setTimeout(function() {
            try { ss(fx, "background-color", "transparent"); } catch (e) {}
            vhsTear(40, 1, 0.6);
        }, 520);
        // t=640: 撕裂线消失, 画面归位
        setTimeout(function() {
            vhsShift(0, 0, 0); vhsTear(0, 2, 0);
        }, 640);
        vhsFlicker(); // 下一个周期
    }, 50000 + Math.floor(Math.random() * 20001)); // 50s~70s 随机间隔
}
vhsFlicker();


// ---- 噪点动画: 随机偏移背景位置, 消除平铺瓦片感 (参考 noise-anim) ----
function noiseAnimate() {
    var n = document.querySelector("#fxNoise");
    if (!n) return;
    try {
        var x = Math.floor(Math.random() * 256);
        var y = Math.floor(Math.random() * 256);
        ss(n, "background-position", x + "px " + y + "px");
    } catch (e) {}
}
setInterval(noiseAnimate, 200);

// -- 侧边栏树 (每窗口独立, 切换只影响本窗口) --
function setupTree(treeId, listId, statusId, titleId) {
    var tree = document.querySelector(treeId); if (!tree) return;
    tree.addEventListener("click", function(e) {
        var item = e.target.closest("[data-panel]"); if (!item) return;
        var key = item.getAttribute("data-panel");
        renderPanel(treeId, listId, statusId, titleId, key);
    });
}
setupTree("#fileTree", "#fileList", "#fileStatus", "#fileTitleText");
setupTree("#craftTree", "#craftPanel", "#craftStatus", "#craftTitleText");
setupTree("#docsTree", "#docsList", "#docsStatus", "#docsTitleText");
// 难点: 别在文档加载时改 DOM 结构!
// AUI 首次渲染会遍历 document.getElements() (SlotDataBinder.countSlotElements),
// 加载时 JS 改 DOM 会与渲染线程并发 → ConcurrentModificationException 崩溃。
// 所有 DOM 修改推迟到运行时 (打开窗口/切面板时才 renderPanel)

// 难点: 静态 HTML 的 img/span 会被 AUI 解析丢弃 (只留文本),
// 树项图标直接静态写背景图 + 内联 padding, 不用 JS 重建

// -- 消息对话框 --
function showMsg(text, icon, title) {
    // 每步单独 try-catch, 防止某一步失败导致弹窗不显示
    try { var t = document.querySelector("#msgText"); if (t) t.textContent = text; } catch (e) {}
    try { var i = document.querySelector("#msgIcon"); if (i) i.setAttribute("src", icon || "icons/020.png"); } catch (e) {}
    try { var ti = document.querySelector("#msgTitle"); if (ti) ti.textContent = title || "信息"; } catch (e) {}
    var d = null;
    try { d = document.querySelector("#msgDlg"); } catch (e) {}
    if (d) {
        try { resetWindowPosition(null, d); } catch (e) {}
        // 难点: 用逻辑坐标定位 (640x360 布局, AUI 自动缩放, 除逻辑尺寸即居中)
        try {
            ss(d, "left", Math.max(0, Math.round((640 - 130) / 2)) + "px");   // 255
            ss(d, "top", Math.max(0, Math.round((360 - 78) / 2)) + "px");     // 141
        } catch (e) {}
        try {
            d.classList.add("show");
        } catch (e) {
            try { d.setAttribute("class", (d.getAttribute("class") || "") + " show"); } catch (e2) {}
        }
        // 已按逻辑坐标居中, 不再二次调整 (会跳动)
    }
}
var btnMsgOk = document.querySelector("#btnMsgOk");
if (btnMsgOk) btnMsgOk.addEventListener("click", function() {
    var d = document.querySelector("#msgDlg");
    if (d) { resetWindowPosition(null, d); d.classList.remove("show"); }
});

// -- 传输动画 --
function showTransferThenMsg(success, msg, completeTitle, titleText) {
    var dlg = document.querySelector("#transferDlg"), bar = document.querySelector("#transferBar");
    if (!dlg || !bar) return;
    try { var tt = document.querySelector("#transferTitle"); if (tt) tt.textContent = titleText || "正在复制..."; } catch (e) {}
    resetWindowPosition(null, dlg);
    // 难点: 用逻辑坐标定位 (640x360 布局, AUI 自动缩放)
    try {
        ss(dlg, "left", Math.max(0, Math.round((640 - 261) / 2)) + "px");    // 189
        ss(dlg, "top", Math.max(0, Math.round((360 - 150) / 2)) + "px");     // 105
    } catch (e) {}
    dlg.classList.add("show");
    // 已按逻辑坐标居中, 不再二次调整 (会跳动)
    ss(bar, "width", "0%");
    var p = 0;
    // 难点: setInterval 在 AUI 的 Rhino 里不可靠, 用 setTimeout 递归代替
    function step() {
        p += Math.random() * 15 + 5;
        if (p >= 100) p = 100;
        // 难点: 进度条宽度用 px, 百分比在 AUI 里可能不生效
        var ind = document.querySelector(".progress-indicator");
        var pw = 0;
        if (ind) {
            try {
                var r = ind.getBoundingClientRect() || {};
                if (isFinite(r.width) && r.width > 0) {
                    // 可用宽度 = 外框宽 - 右padding(1) - 蓝色条left(7) = r.width - 8
                    var maxW = Math.max(0, Math.round(r.width - 8));
                    // 条纹周期 7px (蓝 6px + 灰 1px): 宽度取 7 的整数倍, 小块才完整
                    pw = Math.floor(maxW * p / 100 / 7) * 7;
                }
            } catch (e) {}
        }
        ss(bar, "width", pw + "px");
        if (p < 100) {
            transferTimer = setTimeout(step, 200);
        } else {
            setTimeout(function() { resetWindowPosition(null, dlg); dlg.classList.remove("show"); showMsg(msg, "icons/099.png", completeTitle || "合成完成"); }, 350);
        }
    }
    transferTimer = setTimeout(step, 200);
}
var btnTransferCancel = document.querySelector("#btnTransferCancel");
if (btnTransferCancel) btnTransferCancel.addEventListener("click", function() {
    clearTimeout(transferTimer); var d = document.querySelector("#transferDlg");
    if (d) { resetWindowPosition(null, d); d.classList.remove("show"); }
    showMsg("传输已取消");
});

// -- 软盘读取加载窗口 (与合成加载窗口同款样式) --
function hideFloppyDlg() {
    var d = document.querySelector("#floppyDlg");
    if (d) { resetWindowPosition(null, d); d.classList.remove("show"); }
}
function closeFloppyDlg() {
    clearTimeout(floppyTimer);
    clearTimeout(floppySendTimer);
    hideFloppyDlg();
}
// 软盘读取效果映射: 每种软盘可配自己的读取效果
// 读取完成后按类型调用, 效果播完调回调显示结果
var FLOPPY_EFFECTS = {
    "arachne": function(cb) {
        // Arachne 软盘: 黑屏对话 (每段 duration 毫秒, 段间 pause 毫秒, 默认 3s/0.5s)
        playBlackoutDialog([
            { text: "你知道灵魂重量是多少吗", duration: 3000, pause: 500 },
            { text: "21克", duration: 1000, pause: 100 },
            { text: "怎么了", duration: 1000, pause: 500 },
            { text: "跟Arachne试做型的软盘重量一样", duration: 3000, pause: 200 },
            { text: "很有意思不是吗", duration: 3000 }
        ], cb);
    }
    // 以后要加: "新软盘": function(cb) { ...这个软盘的特效...; cb(); }
};
// 软盘显示名称映射
var FLOPPY_NAMES = {
    "arachne": "Arachne系统"
    // 以后要加: "新类型": "新软盘名称"
};
function showFloppyRead() {
    var dlg = document.querySelector("#floppyDlg"), bar = document.querySelector("#floppyBar"),
        status = document.querySelector("#floppyStatus");
    if (!dlg || !bar) return;
    if (dlg.classList.contains("show")) return; // 已在显示, 忽略重复触发
    resetWindowPosition(null, dlg);
    // 难点: 用逻辑坐标定位 (640x360 布局, AUI 自动缩放)
    try {
        ss(dlg, "left", Math.max(0, Math.round((640 - 261) / 2)) + "px");   // 189
        ss(dlg, "top", Math.max(0, Math.round((360 - 150) / 2)) + "px");    // 105
    } catch (e) {}
    dlg.classList.add("show");
    ss(bar, "width", "0%");
    if (status) { try { status.textContent = "正在检测可读取内容"; } catch (e) {} }
    // 请求软盘检测: 设标记 (由 client_scripts 可靠发送) + 直接发送 (双保险)
    try {
        if (document.body) document.body.setAttribute("data-floppy-request", "1");
    } catch (e) {}
    sendToServer("computer_terminal", { action: "floppy_read" });
    // 进度条: 共 10 秒 (前 3s 检测 / 中 3s 已检测到 / 后 4s 读取), 中段随机停顿
    var startTime = Date.now();
    var TOTAL_MS = 10000;
    var pauseStart = 3000 + Math.random() * 3000;   // 停顿开始: 3s~6s
    var pauseDur = 1000 + Math.random() * 1500;     // 停顿时长: 1s~2.5s
    var pauseEnd = pauseStart + pauseDur;
    var stepMs = 100;
    var detected = false;   // 是否已检测到软盘
    function getResult() {
        try { return document.body.getAttribute("data-floppy-result") || ""; } catch (e) { return ""; }
    }
    function getFloppyName() {
        // 优先用服务端返回的物品显示名, 没有则退回 FLOPPY_NAMES
        try {
            var n = document.body.getAttribute("data-floppy-name") || "";
            if (n) return n;
            var t = document.body.getAttribute("data-floppy-type") || "";
            return FLOPPY_NAMES[t] || t;
        } catch (e) { return ""; }
    }
    function progressAt(elapsed) {
        if (elapsed >= TOTAL_MS) return 100;
        if (elapsed < pauseStart) return elapsed / TOTAL_MS * 100;
        if (elapsed < pauseEnd) return pauseStart / TOTAL_MS * 100;   // 停顿: 进度卡住不动
        // 停顿完加速补足, 10 秒时正好到 100%
        var before = pauseStart / TOTAL_MS * 100;
        var after = 100 - before;
        var activeAfter = TOTAL_MS - pauseEnd;
        return before + (elapsed - pauseEnd) / activeAfter * after;
    }
    function step() {
        var elapsed = Date.now() - startTime;
        // 3 秒后检查检测结果: 无软盘则关进度条并弹窗
        if (elapsed >= 3000 && !detected) {
            var res = getResult();
            if (res === "success") {
                detected = true;
            } else if (res === "fail" || elapsed >= 6000) {
                // 未检测到软盘 (或 6s 超时): 关闭并弹窗
                closeFloppyDlg();
                showMsg("没有检测到软盘！\n请将软盘放入背包后再试", "icons/145.png", "读取软盘");
                return;
            }
        }
        // 阶段状态文字
        if (status) {
            try {
                if (elapsed < 3000) {
                    status.textContent = "正在检测可读取内容";
                } else if (detected) {
                    if (elapsed < 6000) status.textContent = "已检测到软盘：" + getFloppyName();
                    else status.textContent = "正在读取：" + getFloppyName();
                }
            } catch (e) {}
        }
        var progress = Math.min(100, progressAt(elapsed));
        // 进度条宽度用 px (7px 条纹周期)
        var ind = dlg.querySelector(".progress-indicator");
        var pw = 0;
        if (ind) {
            try {
                var r = ind.getBoundingClientRect() || {};
                if (isFinite(r.width) && r.width > 0) {
                    var maxW = Math.max(0, Math.round(r.width - 8));
                    pw = Math.floor(maxW * progress / 100 / 7) * 7;
                }
            } catch (e) {}
        }
        ss(bar, "width", pw + "px");
        if (elapsed < TOTAL_MS) {
            floppyTimer = setTimeout(step, stepMs);
        } else {
            // 读取完成: 按软盘类型播放对应读取效果
            hideFloppyDlg();
            var res = "", type = "", msg = "";
            try { res = document.body.getAttribute("data-floppy-result") || ""; } catch (e) {}
            try { type = document.body.getAttribute("data-floppy-type") || ""; } catch (e) {}
            try { msg = document.body.getAttribute("data-floppy-msg") || ""; } catch (e) {}
            var effect = FLOPPY_EFFECTS[type] || function(cb) { if (cb) cb(); };
            effect(function() {
                if (res === "success" || res === "fail") {
                    showMsg(msg, "icons/145.png", "读取软盘");
                } else {
                    showMsg("软盘读取完成", "icons/145.png", "读取软盘");
                }
            });
        }
    }
    floppyTimer = setTimeout(step, stepMs);
}
var btnFloppyCancel = document.querySelector("#btnFloppyCancel");
if (btnFloppyCancel) btnFloppyCancel.addEventListener("click", function() {
    closeFloppyDlg();
    showMsg("读取已取消", "icons/145.png", "读取软盘");
});

// 难点: AUI 不支持 cursor:none (会退回箭头), 用 cursor:url(透明图) 伪光标隐藏鼠标;
// 需 pointer-events:auto 才能被 hitTest 命中应用光标, 结束再恢复
function blackoutHideCursor(b) {
    if (!b) return;
    try { ss(b, "cursor", "url('icons/transparent.png')"); } catch (e) {}
    try { ss(b, "pointerEvents", "auto"); } catch (e) {}
}
function blackoutRestoreCursor(b) {
    if (!b) return;
    try { ss(b, "cursor", ""); } catch (e) {}
    try { ss(b, "pointerEvents", "none"); } catch (e) {}
}

// -- 读软盘成功: 黑屏 3 秒效果 --
function playBlackout(callback) {
    var b = document.querySelector("#blackout");
    if (!b) { if (callback) callback(); return; }
    try { ss(b, "opacity", "1"); } catch (e) {}
    blackoutHideCursor(b);
    // 3 秒黑屏
    setTimeout(function() {
        // 难点: 分步降透明度淡出, AUI 的 transition 不可靠
        try { ss(b, "opacity", "0.6"); } catch (e) {}
        setTimeout(function() {
            try { ss(b, "opacity", "0"); } catch (e) {}
            blackoutRestoreCursor(b);
            if (callback) callback();
        }, 120);
    }, 3000);
}

// -- 黑屏对话: 逐段显示文本 (duration 每段时长默认 3s, pause 段后停顿默认 0.5s),
//    全播完再黑 1s 淡出 (总时长 = 各段 + 各停顿 + 1s) --
function playBlackoutDialog(lines, callback) {
    var b = document.querySelector("#blackout"), txt = document.querySelector("#blackoutText");
    if (!b || !txt) { if (callback) callback(); return; }
    try { ss(b, "opacity", "1"); } catch (e) {}
    blackoutHideCursor(b);
    var idx = 0;
    function showNext() {
        if (idx >= lines.length) {
            // 全部播完: 清空文本, 再黑 1 秒后淡出
            try { txt.textContent = ""; } catch (e) {}
            setTimeout(function() {
                try { ss(b, "opacity", "0.6"); } catch (e) {}
                setTimeout(function() {
                    try { ss(b, "opacity", "0"); } catch (e) {}
                    blackoutRestoreCursor(b);
                    if (callback) callback();
                }, 120);
            }, 1000);
            return;
        }
        var line = lines[idx];
        idx++;
        try { txt.textContent = line.text; } catch (e) {}
        setTimeout(function() {
            // 段间停顿 (每段可自定义, 默认 0.5s)
            try { txt.textContent = ""; } catch (e) {}
            setTimeout(showNext, (line.pause !== undefined ? line.pause : 500));
        }, line.duration || 3000);
    }
    showNext();
}

// 软盘读取: 事件委托绑定, 单击/双击均可 (AUI innerHTML 可能异步, 直接绑不可靠)
function onFloppyTrigger(e) {
    var t = e.target;
    if (t && t.closest && t.closest(".floppy-item")) {
        showFloppyRead();
    }
}
document.addEventListener("click", onFloppyTrigger);
document.addEventListener("dblclick", onFloppyTrigger);

// -- 窗口拖动 --
document.addEventListener("mousedown", function(e) {
    var titlebar = e.target.closest(".win-titlebar"); if (!titlebar) return;
    if (e.target.closest(".win-close") || e.target.closest("button")) return;
    var win = titlebar.closest(".win95-window"); if (!win) return;
    var overlay = win.closest(".window-overlay");
    var isWin = overlay && overlay.classList.contains("show");
    var isDlg = win.closest(".transfer-dlg") && win.closest(".transfer-dlg").classList.contains("show");
    var isMsg = win.closest(".msg-dlg") && win.closest(".msg-dlg").classList.contains("show");
    if (!isWin && !isDlg && !isMsg) return;
    if (overlay) bringToFront(overlay);
    var rect = win.getBoundingClientRect() || {};
    // 难点: AUI 的 getBoundingClientRect 可能返回 x/y 而非 left/top
    var rl = (isFinite(rect.left) ? rect.left : (isFinite(rect.x) ? rect.x : 0));
    var rt = (isFinite(rect.top) ? rect.top : (isFinite(rect.y) ? rect.y : 0));
    // 难点: win.offsetWidth/offsetHeight 在 AUI 里不可靠 (可能 NaN), 用 getBoundingClientRect + 兜底
    var rw = rect.width, rh = rect.height;
    if (!isFinite(rw) || rw <= 0) rw = 520;
    if (!isFinite(rh) || rh <= 0) rh = 260;
    if (overlay && overlay.classList.contains("show")) {
        ss(overlay, "alignItems", "flex-start"); ss(overlay, "justifyContent", "flex-start");
    }
    ss(win, "position", "absolute");
    ss(win, "left", rl + "px"); ss(win, "top", Math.max(0, rt) + "px"); ss(win, "margin", "0");
    dragInfo = { win: win, overlay: overlay, startX: e.clientX, startY: e.clientY,
        origL: rl, origT: Math.max(0, rt), winWidth: rw, winHeight: rh };
    e.preventDefault();
});
document.addEventListener("mousemove", function(e) {
    if (!dragInfo) return;
    // 难点: e.clientX/clientY 在 AUI 里可能不可靠, 加兜底
    var cx = e.clientX, cy = e.clientY;
    if (!isFinite(cx)) cx = dragInfo.lastX || dragInfo.startX;
    if (!isFinite(cy)) cy = dragInfo.lastY || dragInfo.startY;
    dragInfo.lastX = cx; dragInfo.lastY = cy;
    var dx = cx - dragInfo.startX, dy = cy - dragInfo.startY;
    var nl = dragInfo.origL + dx, nt = dragInfo.origT + dy;
    // 难点: window.innerWidth 在 AUI 里不可靠, 必须用 body 真实渲染尺寸
    var bw = canvasW, bh = canvasH;
    try {
        var rb = document.body ? document.body.getBoundingClientRect() : null;
        if (rb) {
            if (isFinite(rb.width) && rb.width > 0) bw = rb.width;
            if (isFinite(rb.height) && rb.height > 0) bh = rb.height;
        }
    } catch (e) {}
    // 兜底: 尺寸异常时按窗口尺寸推算, 防止 left/top 变 NaN
    if (!isFinite(bw) || bw <= 0) bw = Math.max(dragInfo.winWidth * 2 + 200, 800);
    if (!isFinite(bh) || bh <= 0) bh = Math.max(dragInfo.winHeight * 2 + 200, 600);
    // 拖动边界 (左右留 80px, 底部任务栏 28px)
    var edge = 80;
    var bottomEdge = 28;
    nl = Math.max(edge - dragInfo.winWidth, Math.min(bw - edge, nl));
    nt = Math.max(0, Math.min(bh - bottomEdge, nt));
    if (!isFinite(nl)) nl = dragInfo.origL;
    if (!isFinite(nt)) nt = dragInfo.origT;
    ss(dragInfo.win, "left", nl + "px"); ss(dragInfo.win, "top", nt + "px");
});
document.addEventListener("mouseup", function() { dragInfo = null; });

// -- 键盘快捷键 --
document.addEventListener("keydown", function(e) {
    if (e.key === "Escape") {
        var md = document.querySelector("#msgDlg"), td = document.querySelector("#transferDlg");
        if (md && md.classList.contains("show")) { resetWindowPosition(null, md); md.classList.remove("show"); return; }
        if (td && td.classList.contains("show")) { clearInterval(transferTimer); resetWindowPosition(null, td); td.classList.remove("show"); return; }
        if (craftWinOpen) { closeCraftWin(); return; }
        if (fileWinOpen)  { closeFileManager(); return; }
        if (menuOpen)     { closeMenu(); return; }
        sendToServer("computer_terminal", { action: "close" });
    }
    if (e.key === "Enter" && selectedIcon === ic) openCraftWin();
});

// ============================================
//  §5 初始化
// ============================================
// 难点: 延迟初始化, 文档加载时改 DOM 会与 AUI 首次渲染撞车
setTimeout(function() { try { applyLayout(); } catch (e) {} }, 100);
requestTime();
// 难点: setInterval 在 AUI 的 Rhino 里不可靠, 用 setTimeout 递归
function loopRequestTime() { requestTime(); setTimeout(loopRequestTime, 10000); }
setTimeout(loopRequestTime, 10000);
// 时钟由 client_scripts 定期请求游戏时间, 不再用浏览器现实时间

// ============================================
//  难点修复: AUI 首次文本渲染 bug
//  FontDrawer 对"最前面几个"文本元素生成纹理会静默失败 (返回 null) 导致不显示,
//  延迟重写文本内容可强制 AUI 重新测量+渲染。
// ============================================
var TEXT_SELECTOR = "span, .icon-label, .menu-item, .win-tree-item, .a5, .win-titlebar span, .win-menubar span, .status-bar-field, .addr-label, .clock-text, .transfer-label, .mi-label, .msg-content p";
function forceRedrawTexts() {
    // 1) 切换 class 触发 AUI 样式重算 (刷新 isVisible / dirty 状态)
    var els = document.querySelectorAll(TEXT_SELECTOR);
    for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (!el) continue;
        try {
            el.classList.add("aui-tfix");
            el.classList.remove("aui-tfix");
        } catch (e) {}
    }
    // 2) 重写文本强制重新测量 + 渲染
    for (var j = 0; j < els.length; j++) {
        var el2 = els[j];
        if (el2 && el2.textContent !== undefined && el2.textContent !== null) {
            var t = el2.textContent;
            try {
                el2.textContent = "";
                el2.textContent = t;
            } catch (e) {}
        }
    }
}
setTimeout(forceRedrawTexts, 150);
setTimeout(forceRedrawTexts, 400);
setTimeout(forceRedrawTexts, 800);
setTimeout(forceRedrawTexts, 1500);
setTimeout(forceRedrawTexts, 2500);

// ============================================
//  §6 调试面板 — 尺寸信息 + 服务端上报
// ============================================

// 创建调试面板 DOM (防 Rhino 的 style 为 null)
var debugPanel = document.createElement("div");
debugPanel.id = "debugPanel";
debugPanel.innerHTML = '<div style="font-weight:bold;margin-bottom:2px">🔧 调试信息' +
    '<span style="float:right;cursor:pointer;color:#f66;font-size:12px" id="btnDebugHide">✕</span></div>' +
    '<div>画布: <b id="dbCanvas">--</b></div>' +
    '<div>占比: <b id="dbScale">--</b></div>' +
    '<div>窗口: <b id="dbWin">--</b></div>' +
    '<div>树宽: <b id="dbTree">--</b></div>' +
    '<div>任务栏: <b id="dbTaskbar">--</b></div>' +
    '<div>可用高: <b id="dbBody">--</b></div>' +
    '<div style="margin-top:3px;font-size:8px;color:#666">点击 ✕ 隐藏 | 点击水印重显</div>';
if (debugPanel.style) {
    debugPanel.style.cssText = "position:absolute;top:4px;right:4px;background:rgba(0,0,0,.85);" +
        "color:#0f0;font-family:monospace;font-size:10px;padding:5px 8px;" +
        "border:1px solid #0f0;z-index:99;line-height:1.5;border-radius:3px";
}
// 难点: 延迟挂载, 文档加载时改 DOM 会与 AUI 首次渲染并发崩溃
setTimeout(function() { try { document.body.appendChild(debugPanel); } catch (e) {} }, 800);

// 填调试数据
function updateDebugPanel() {
    var dbC = document.querySelector("#dbCanvas");
    var dbS = document.querySelector("#dbScale");
    var dbW = document.querySelector("#dbWin");
    var dbT = document.querySelector("#dbTree");
    var dbTb = document.querySelector("#dbTaskbar");
    var dbB = document.querySelector("#dbBody");
    if (dbC) dbC.innerText = canvasW + " × " + canvasH;
    if (dbS) dbS.innerText = "任务栏 " + taskbarH + "px";
    if (dbW) dbW.innerText = winW + " × " + winH + " (" + Math.round(winW/canvasW*100) + "%)";
    if (dbT) dbT.innerText = treeW + "px";
    if (dbTb) dbTb.innerText = winPct*100 + "% 占比";
    if (dbB) dbB.innerText = availH + "px 可用";
}
updateDebugPanel();

// ---- 隐藏调试面板 ----
function hideDebug() { ss(debugPanel, "display", "none"); }

// 点击 ✕ 隐藏
var btnHide = document.querySelector("#btnDebugHide");
if (btnHide) btnHide.addEventListener("click", function(e) {
    e.stopPropagation(); hideDebug();
});

// 5 秒后自动隐藏
setTimeout(function() { hideDebug(); }, 5000);

// 尺寸上报服务端 (同时在 console 打印)
function reportSize() {
    var report = {
        action: "size_report",
        canvasW: canvasW,
        canvasH: canvasH,
        winW: winW,
        winH: winH,
        taskbarH: taskbarH,
        treeW: treeW
    };
    console.log("[SIZE] 画布=" + canvasW + "x" + canvasH +
                " | 窗口=" + winW + "x" + winH +
                "(" + Math.round(winW/canvasW*100) + "%x" + Math.round(winH/availH*100) + "%)" +
                " | 任务栏=" + taskbarH);
    sendToServer("computer_terminal", report);
}

// 延迟 500ms 上报 (等 Network 就绪)
setTimeout(function() { reportSize(); }, 500);

console.log("[Arachne] 初始化完成");
