// ============================================
//  Arachne系统 - 软盘物品注册
//  一张能被电脑读取的网盘
// ============================================
StartupEvents.registry("item", event => {
    event.create("arachne")
        .displayName("§bArachne软盘")
        .maxStackSize(64)
        .rarity("epic")
        .tooltip("§7一张可被电脑读取的软盘")
        .tooltip("§7在电脑终端中双击「读取软盘」访问");
});
