// ============================================
//  Arachne - 电脑终端 服务端脚本
//  功能: 右键开屏 / 合成台 / 游戏时间
// ============================================

// ---- 右键方块 -> 服务端直接开 AUI Screen (AUI 1.1.9.3 方案B) ----
BlockEvents.rightClicked("kubejs:computer", function(event) {
    var player = event.player;
    var hand = event.hand;

    // 仅主手 + 非潜行时触发
    if (hand !== "MAIN_HAND" || player.isCrouching()) return;

    console.log("[DEBUG] Right-clicked computer block, calling ApricityUI.openScreen()");
    player.tell("§a[调试] 右键已触发，正在打开 Arachne...");
    // 难点: 方案B, 服务端权威打开 Screen (AUI 1.1.9.3)
    // 路径 "computer/gui.html" → {游戏目录}/apricity/computer/gui.html
    // openScreen(player, path): 服务端直接开 Screen (空容器声明, UI-only)
    // bind() 的 Consumer 转换若出问题, 用此简化版最稳
    ApricityUI.openScreen(player, "computer/gui.html");
    player.tell("§a[调试] ApricityUI.openScreen 已调用");
});

// ---- 接收 HTML GUI 发来的操作 ----
NetworkEvents.dataReceived("computer_terminal", function(event) {
    var player = event.player;
    var server = event.server;
    var data = event.data;
    var action = data.action;
    console.log("[AUI-NET] 收到 action=" + action + " 玩家=" + player.getUsername());

    if (action === "close") {
        console.log("[DEBUG] 收到 close 请求, 发送 apricity_close");
        player.sendData("apricity_close", {});
        console.log("[DEBUG] apricity_close 已发送");

    } else if (action === "open_crafting") {
        // 打开合成台: 先关 ApricityUI, 再开原版 GUI
        player.sendData("apricity_close", {});
        server.scheduleInTicks(2, function() {
            openComputerCraftingGUI(player, server);
        });

    } else if (action === "get_time") {
        var level = player.getLevel();
        var dayTime = level.getDayTime() % 24000;
        // 直接发给客户端, HTML 通过 Network.receiveFromServer() 接收
        player.sendData("computer_time", { type: "time_update", time: dayTime });

    } else if (action === "size_report") {
        // GUI 固定容器尺寸上报
        var cw = data.canvasW || "?";
        var ch = data.canvasH || "?";
        var rt = data.ratio || "?";
        var sw = data.screenW || "?";
        var sh = data.screenH || "?";

        console.log("[SIZE_REPORT] ========================================");
        console.log("[SIZE_REPORT] AUI画布: " + cw + "x" + ch +
                    " | 容器: " + sw + "x" + sh +
                    " | 比例: " + rt + "x (ref " + (data.refW||"?") + "x" + (data.refH||"?") + ")");
        console.log("[SIZE_REPORT] ========================================");

        player.tell("§a[尺寸] §f画布 §e" + cw + "×" + ch +
                     " §f| 容器 §e" + sw + "×" + sh +
                     " §f| 比例 §e" + rt + "x");
    } else if (action === "size_done") {
        player.tell("§a[调试] SIZE REPORT 已输出 → 尺寸 " + (data.w||"?") + "x" + (data.h||"?") + "，查看 logs/debug.log");

    } else if (action === "ticket_craft") {
        // 车票转化: 4x 未知碎片 + 1x 车票(ticket_1) → 真车票(ticket_0)
        var inv = player.getInventory();
        var shatterNeed = 4;
        var shatterCount = 0;
        var hasTicket1 = false;
        var ticket1Slot = -1;
        var shatterSlots = [];

        // 遍历背包统计
        for (var i = 0; i < inv.getSlots(); i++) {
            var stack = inv.getStackInSlot(i);
            if (stack.getId() === "kubejs:unknown_shatter") {
                shatterCount += stack.getCount();
                shatterSlots.push(i);
            }
            if (stack.getId() === "kubejs:ticket_1" && !hasTicket1) {
                hasTicket1 = true;
                ticket1Slot = i;
            }
        }

        if (shatterCount >= shatterNeed && hasTicket1) {
            // 消耗 4 个未知碎片
            var remaining = shatterNeed;
            for (var j = 0; j < shatterSlots.length && remaining > 0; j++) {
                var slot = shatterSlots[j];
                var st = inv.getStackInSlot(slot);
                var take = Math.min(st.getCount(), remaining);
                st.shrink(take);
                remaining -= take;
            }
            // 消耗 1 个车票
            inv.getStackInSlot(ticket1Slot).shrink(1);
            // 给予真车票
            player.give("kubejs:ticket_0");
            player.sendData("computer_msg", { type: "show_msg", msg: "§a合成成功！获得 §l车票§a。" });
            server.runCommandSilent("playsound minecraft:ui.stonecutter.take_result master " + player.getUsername());
        } else {
            player.sendData("computer_msg", { type: "show_msg", msg: "§c未识别到正确物品（需要 4个 未知碎片 + 1个 车票）" });
        }

    } else if (action === "floppy_read") {
        // 软盘读取: 检测背包中的软盘, 返回类型 (客户端按类型播效果)
        console.log("[FLOPPY] 收到读取软盘请求, 检测背包");
        try {
            var inv = player.getInventory();
            var found = null;   // 软盘类型
            var foundName = ""; // 物品显示名称 (直接映射物品名)
            for (var i = 0; i < inv.getSlots(); i++) {
                var stack = inv.getStackInSlot(i);
                if (stack.isEmpty()) continue;
                if (stack.getId() === "kubejs:arachne") {
                    found = "arachne";
                    // 获取物品显示名, 清理格式码只留纯文本
                    try {
                        var rawName = String(stack.getName());
                        foundName = rawName.replace(/§[0-9a-fk-or]/gi, "").trim();
                    } catch (e2) {
                        foundName = "Arachne系统";
                    }
                    break;
                }
                // 未来扩展: 在此添加其他软盘物品
            }
            if (found) {
                player.sendData("computer_msg", {
                    type: "floppy_found",
                    floppy: found,
                    name: foundName,
                    msg: "§a" + foundName + " 软盘读取成功！\n§7软盘容量: §e1.44MB\n§f发现文件: §b车票转化.exe §f/ §b说明文档 §f/ §b备份数据"
                });
                server.runCommandSilent("playsound minecraft:block.note_block.pling master " + player.getUsername() + " 1 2");
            } else {
                player.sendData("computer_msg", {
                    type: "floppy_fail",
                    msg: "§c未检测到软盘！\n§7请将软盘放入背包后再试"
                });
            }
        } catch (e) {
            console.log("[FLOPPY] 检测异常: " + e);
        }
    }
});

// ============================================
// 自定义合成台 GUI (3×3 + 输出槽)
// ============================================

/**
 * 合成槽位布局
 *
 *   Chest 3行 GUI (27格):
 *   [0] [1] [2] [3] [4] [5] [6] [7] [8]     ← 第1行: 合成格第1排
 *   [9][10][11][12][13][14][15][16][17]        ← 第2行: 合成格第2排 + 输出[13]
 *  [18][19][20][21][22][23][24][25][26]        ← 第3行: 合成格第3排
 *
 *  3×3 输入: slot[0-2], slot[9-11], slot[18-20]
 *  输出槽:   slot[13]
 */

/**
 * 打开电脑终端的合成界面
 */
function openComputerCraftingGUI(player, server) {
    // 存储输入槽引用 (配方匹配时读取)
    let inputSlots = [];

    player.openChestGUI("§b电脑终端 - 合成台", 3, gui => {

        // ---- 3×3 合成输入槽 ----
        // 第1排: slot 0, 1, 2
        for (let i = 0; i < 3; i++) {
            gui.slot(i, 0, slot => {
                inputSlots[i] = slot; // row 0
            });
        }
        // 第2排: slot 9, 10, 11
        for (let i = 0; i < 3; i++) {
            gui.slot(9 + i, 0, slot => {
                inputSlots[3 + i] = slot; // row 1
            });
        }
        // 第3排: slot 18, 19, 20
        for (let i = 0; i < 3; i++) {
            gui.slot(18 + i, 0, slot => {
                inputSlots[6 + i] = slot; // row 2
            });
        }

        // ---- 输出槽 (slot 13) ----
        gui.slot(13, 0, slot => {
            // 左键点击 → 尝试合成
            slot.leftClicked = () => {
                tryCraft(player, server, inputSlots);
                player.closeMenu();
            };

            // 右键点击 → 也触发合成尝试
            slot.rightClicked = () => {
                // 右键也触发合成尝试
                tryCraft(player, server, inputSlots);
                player.closeMenu();
            };
        });

        player.tell("§b[电脑终端] §f合成台已打开 - 在3×3区域摆放材料，点击中间输出格合成");
    });
}

/**
 * 尝试执行合成
 */
function tryCraft(player, server, inputSlots) {
    // 收集 3×3 网格中的物品
    let gridItems = [];
    // 转换: inputSlots[0-2]=第1排, [3-5]=第2排, [6-8]=第3排
    for (let i = 0; i < 9; i++) {
        gridItems.push(inputSlots[i].item);
    }

    // 查找匹配配方
    let result = findCraftingResult(player, gridItems);

    if (result && !result.isEmpty()) {
        // 消耗材料: 每格减1
        for (let i = 0; i < 9; i++) {
            let stack = inputSlots[i].item;
            if (!stack.isEmpty()) {
                // 减1个
                let newCount = stack.getCount() - 1;
                if (newCount <= 0) {
                    inputSlots[i].item = Item.of("minecraft:air");
                } else {
                    stack.setCount(newCount);
                    inputSlots[i].item = stack;
                }
            }
        }
        // 给予产物
        player.give(result.copy());
        player.tell("§a🔨 合成完成! 获得: " + result.getDisplayName().getString());
        server.runCommandSilent(
            `/playsound minecraft:ui.stonecutter.take_result master ${player.getUsername()}`
        );
    } else {
        player.tell("§c✘ 无法合成 - 材料不匹配任何配方");
    }
}

/**
 * 在3×3网格中查找匹配的合成配方
 * @param {Internal.ServerPlayer} player
 * @param {Array<Internal.ItemStack>} gridItems - 长度为9的数组
 * @returns {Internal.ItemStack | null}
 */
function findCraftingResult(player, gridItems) {
    try {
        let level = player.getLevel();
        let recipeManager = level.getRecipeManager();
        let RecipeType = Java.loadClass(
            "net.minecraft.world.item.crafting.RecipeType"
        );

        let allRecipes = recipeManager.getRecipes();
        let iterator = allRecipes.iterator();

        while (iterator.hasNext()) {
            let recipe = iterator.next();
            let recipeType = recipe.getType();

            // 只处理合成配方类型
            if (recipeType !== RecipeType.CRAFTING) continue;

            let ingredients = recipe.getIngredients();
            if (!ingredients || ingredients.size() === 0) continue;

            // 提取原料列表
            let ingrList = [];
            let ingrIter = ingredients.iterator();
            while (ingrIter.hasNext()) {
                ingrList.push(ingrIter.next());
            }

            // 尝试匹配
            if (matchRecipe(gridItems, ingrList, recipe)) {
                let resultItem = recipe.getResultItem(level.registryAccess());
                if (resultItem && !resultItem.isEmpty()) {
                    return resultItem;
                }
            }
        }
    } catch (e) {
        console.error("[电脑终端] 配方匹配异常: " + e);
    }

    return null;
}

/**
 * 匹配配方（自动识别有序/无序）
 */
function matchRecipe(gridItems, ingredients, recipe) {
    let className = String(recipe.getClass().getName()).toLowerCase();

    if (className.indexOf("shapeless") >= 0) {
        return matchShapeless(gridItems, ingredients);
    } else {
        return matchShaped(gridItems, ingredients, recipe);
    }
}

/**
 * 无序合成匹配：统计物品种类和数量
 */
function matchShapeless(gridItems, ingredients) {
    // 计数网格中的物品
    let itemCounts = new Map();
    for (let stack of gridItems) {
        if (stack.isEmpty()) continue;
        let id = stack.getId();
        itemCounts.set(id, (itemCounts.get(id) || 0) + stack.getCount());
    }

    // 检查每种原料是否满足
    for (let ingr of ingredients) {
        if (ingr.isEmpty()) continue;
        let needed = 1; // 每种原料至少需要1个
        let found = false;

        for (let [itemId, count] of itemCounts) {
            if (count >= needed && ingr.test(Item.of(itemId))) {
                itemCounts.set(itemId, count - needed);
                found = true;
                break;
            }
        }
        if (!found) return false;
    }

    // 确保网格中没有多余物品
    for (let count of itemCounts.values()) {
        if (count > 0) return false;
    }

    return true;
}

/**
 * 有序合成匹配：在3×3网格中滑动窗口
 */
function matchShaped(gridItems, ingredients, recipe) {
    let width = 3;
    let height = 3;

    try {
        width = recipe.getWidth();
        height = recipe.getHeight();
    } catch (e) {
        // 使用默认 3×3
    }

    // 在 3×3 网格中尝试每个可能的偏移
    for (let offY = 0; offY <= 3 - height; offY++) {
        for (let offX = 0; offX <= 3 - width; offX++) {
            if (checkShapedOffset(gridItems, ingredients, recipe,
                offX, offY, width, height)) {
                return true;
            }
        }
    }

    return false;
}

/**
 * 检查有序配方在指定偏移处是否匹配
 */
function checkShapedOffset(gridItems, ingredients, recipe,
    offX, offY, width, height) {

    // 检查配方区域内的格子
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let recipeIdx = y * width + x;
            let gridIdx = (y + offY) * 3 + (x + offX);

            let ingredient = ingredients.get(recipeIdx);
            let gridStack = gridItems[gridIdx];

            let ingrEmpty = !ingredient || ingredient.isEmpty();
            let gridEmpty = gridStack.isEmpty();

            if (ingrEmpty && gridEmpty) continue;
            if (ingrEmpty !== gridEmpty) return false;
            if (!ingredient.test(gridStack)) return false;
        }
    }

    // 确保配方区域外的格子为空
    for (let y = 0; y < 3; y++) {
        for (let x = 0; x < 3; x++) {
            let inRecipeArea = (y >= offY && y < offY + height &&
                x >= offX && x < offX + width);
            if (inRecipeArea) continue;
            if (!gridItems[y * 3 + x].isEmpty()) return false;
        }
    }

    return true;
}

console.log("[KubeJS] 电脑终端交互脚本已加载");
