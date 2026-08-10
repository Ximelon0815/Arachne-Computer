// ============================================
//  Arachne - 客户端桥接层 (AUI 1.1.9.3 适配版)
//  架构: 屏幕打开绑定 DOM 事件; 点击 sendData 给服务端;
//        服务端 player.sendData → dataReceived; 操作 DOM 用 ApricityUI
// ============================================

// ---- 工具: 获取当前 AUI 屏幕文档 ----
function getAuiDoc() {
    try {
        // 难点: getCurrentScreenDocument() 只对 ApricityScreen 有效,
        // 服务端 openScreen() 打开的是 ApricityContainerScreen → 返回 null,
        // 所以优先用 getDocument(path), 拿不到再兜底
        var docs = ApricityUI.getDocument("computer/gui.html");
        if (docs && docs.length > 0) return docs[0];
        return ApricityUI.getCurrentScreenDocument();
    } catch (e) {
        return null;
    }
}

// ---- 工具: 安全设置元素文本 ----
function setElText(doc, selector, text) {
    try {
        var el = doc.querySelector(selector);
        if (el) el.textContent = String(text);
    } catch (e) {}
}

// ---- 工具: 安全绑定点击 ----
function onElClick(doc, selector, fn) {
    try {
        var el = doc.querySelector(selector);
        if (el) el.addEventListener("click", fn);
    } catch (e) {}
}

// ---- 全局客户端玩家引用 (LoggedIn 时获取) ----
var clientPlayer = null;

// ---- 发送数据到服务端 ----
function sendToServer(channel, data) {
    try {
        if (clientPlayer && clientPlayer.sendData) {
            clientPlayer.sendData(channel, data);
            return true;
        }
    } catch (e) {
        console.error("[Arachne] sendToServer 失败: " + e);
    }
    return false;
}

// ---- 屏幕交互初始化 (屏幕打开后绑定) ----
function initScreenInteractions(doc) {
    if (!doc) return;
    console.log("[Arachne] 屏幕交互初始化");

    // 车票转化.exe (双击) -> 服务端 ticket_craft
    var exe = doc.querySelector("[data-exe='ticket']");
    if (exe) exe.addEventListener("dblclick", function() {
        sendToServer("computer_terminal", { action: "ticket_craft" });
    });

    // 关闭系统菜单项
    var closeBtn = doc.querySelector("[data-action='close']");
    if (closeBtn) closeBtn.addEventListener("click", function() {
        sendToServer("computer_terminal", { action: "close" });
    });

    // 难点: 工作台图标双击由 gui.js 的 openCraftWin() 处理 (文件管理器风格窗口),
    //       这里不再绑 open_crafting, 避免关掉 AUI 屏幕跳到原版合成界面

    // 请求游戏时间
    sendToServer("computer_terminal", { action: "get_time" });

    // 每 3 秒请求游戏时间, 仅在 GUI 开启时 (避免无谓开销)
    if (!global.__timeLoopStarted) {
        global.__timeLoopStarted = true;
        function loopGetTime() {
            try {
                var doc = getAuiDoc();
                if (doc) {
                    sendToServer("computer_terminal", { action: "get_time" });
                }
            } catch (e) {}
            setTimeout(loopGetTime, 3000);
        }
        setTimeout(loopGetTime, 3000);
    }

    console.log("[Arachne] 屏幕交互绑定完成");
}

// ---- 接收服务端时间 -> 更新时钟 ----
NetworkEvents.dataReceived("computer_time", function(event) {
    var d = event.data;
    if (!d || d.type !== "time_update") return;
    var doc = getAuiDoc();
    if (!doc) return;

    var t = d.time;
    var adj = (t + 6000) % 24000;
    var h = Math.floor(adj / 1000);
    var m = Math.floor((adj % 1000) * 60 / 1000);
    var timeStr = ("0" + h).slice(-2) + ":" + ("0" + m).slice(-2);
    setElText(doc, "#clockText", timeStr);
});

// ---- 接收服务端消息 -> 显示消息框 / 黑屏效果 ----
NetworkEvents.dataReceived("computer_msg", function(event) {
    var d = event.data;
    if (!d) return;
    var doc = getAuiDoc();
    if (!doc) return;

    if (d.type === "show_msg") {
        var msg = String(d.msg || "").replace(/§[0-9a-fklmnor]/gi, "");
        var msgText = doc.querySelector("#msgText");
        var msgDlg = doc.querySelector("#msgDlg");
        if (msgText) msgText.textContent = msg;
        if (msgDlg) msgDlg.classList.add("show");
    } else if (d.type === "floppy_found") {
        // 软盘读取结果暂存到 body, 由 gui.js 按类型播效果
        try {
            doc.body.setAttribute("data-floppy-result", "success");
            doc.body.setAttribute("data-floppy-type", d.floppy || "");
            doc.body.setAttribute("data-floppy-name", d.name || "");
            doc.body.setAttribute("data-floppy-msg", String(d.msg || "").replace(/§[0-9a-fklmnor]/gi, ""));
        } catch (e) {}
    } else if (d.type === "floppy_fail") {
        // 软盘读取失败
        try {
            doc.body.setAttribute("data-floppy-result", "fail");
            doc.body.setAttribute("data-floppy-type", "");
            doc.body.setAttribute("data-floppy-name", "");
            doc.body.setAttribute("data-floppy-msg", String(d.msg || "").replace(/§[0-9a-fklmnor]/gi, ""));
        } catch (e) {}
    }
});

// ---- 登录时获取玩家引用 ----
ClientEvents.loggedIn(function(event) {
    try {
        clientPlayer = event.player;
        console.log("[Arachne] 已登录, 玩家引用就绪");
    } catch (e) {
        console.error("[Arachne] loggedIn 处理失败: " + e);
    }
});

// ---- 每 tick 检查屏幕文档是否打开, 打开则初始化交互 ----
ClientEvents.tick(function(event) {
    // 诊断: 每 40 tick (约 2 秒) 打印一次文档/玩家状态
    if (!global.__auiDiagN) global.__auiDiagN = 0;
    global.__auiDiagN++;
    if (global.__auiDiagN % 40 === 1) {
        try {
            var ds = ApricityUI.getDocument("computer/gui.html");
            console.log("[Arachne] diag docs=" + (ds ? ds.length : "null")
                + " player=" + (clientPlayer ? "OK" : "NULL"));
        } catch (e) {
            console.log("[Arachne] diag err " + e);
        }
    }

    var doc = getAuiDoc();
    if (!doc) return;

    var body;
    try { body = doc.body; } catch (e) { return; }
    if (!body) return;

    // 难点: 软盘请求由 gui.js 直发 + 此处兜底 (双保险, 多发无害)
    try {
        if (body.getAttribute("data-floppy-request") === "1") {
            body.setAttribute("data-floppy-request", "0");
            sendToServer("computer_terminal", { action: "floppy_read" });
        }
    } catch (e) {}

    if (body.getAttribute("data-aui-bridged") === "1") return;
    body.setAttribute("data-aui-bridged", "1");
    initScreenInteractions(doc);
});


// ---- 接收服务端关闭指令 -> 关闭 AUI 屏幕 ----
NetworkEvents.dataReceived("apricity_close", function(event) {
    try {
        ApricityUI.closeScreen();
        console.log("[Arachne] 已收到关闭指令, closeScreen 调用");
    } catch (e) {
        console.error("[Arachne] closeScreen 失败: " + e);
    }
});

console.log("[Arachne] 客户端桥接层已加载 (AUI 1.1.9.3 适配版)");