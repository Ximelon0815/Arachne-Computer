// ============================================
// 自定义方块注册 - 电脑终端
// ============================================

StartupEvents.registry("block", event => {
    event.create("kubejs:computer")
        .displayName("§b电脑终端")
        .hardness(2.0)
        .resistance(6.0)
        .requiresTool(true)
        .property(BlockProperties.HORIZONTAL_FACING)
        .tagBlock("minecraft:mineable/pickaxe")
        .tagBlock("minecraft:needs_iron_tool")
        .item(item => {
            item.rarity("uncommon")
                .tooltip("§7右键打开操作界面")
                .maxStackSize(64);
        });

    console.log("[KubeJS] 电脑终端方块已注册");
});
