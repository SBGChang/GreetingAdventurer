# Greeting Adventurer｜文件索引

本專案目前是設計文件與可讀 HTML 的歸檔庫。根目錄只保留索引與產生腳本；所有設計文件集中於 `docs/`。

## 閱讀順序

1. [核心遊戲規格](docs/00_core/game_design_document.md)
2. [世界觀與四國方向](docs/01_world/worldbuilding.md)
3. [時間、迷宮與熟練度原則](docs/02_systems/time_and_mastery_progression.md)
4. [熟練度經驗經濟 v1](docs/02_systems/mastery_experience_economy_v1.md)
5. [雲華內容重製規格 V2（現行內容基線）](docs/03_content/yunhua/yunhua_content_v2.md)
6. [雲華 V2 實際數值與平衡閱讀版](docs/03_content/yunhua/yunhua_content_v2.html)
7. [雲華第一版地圖](docs/03_content/yunhua/yunhua_first_map_plan.md)
8. [雲華內容與版型草稿（舊版數值，僅歸檔）](docs/03_content/yunhua/yunhua_catalog_v1.md)
9. [雲華文化怪物池灰盒（舊版數值，僅歸檔）](docs/03_content/yunhua/yunhua_monsters_v1.md)
10. [技術架構藍圖](docs/00_core/technical_architecture.md)
11. [共用核心契約](docs/00_core/architecture/00_shared_contracts.md)
12. [領域模組與服務契約](docs/00_core/technical_architecture.md#14-詳細模組契約)
13. [Engine Runtime 與交易契約](docs/00_core/architecture/12_engine_runtime.md)
14. [Data Runtime 與內容資料契約](docs/00_core/architecture/13_data_runtime.md)
15. [存檔與平台邊界](docs/00_core/architecture/14_save_platform.md)
16. [React UI 與應用層契約](docs/00_core/architecture/15_ui_application.md)
17. [Derived Statistics 純計算契約](docs/00_core/architecture/16_derived_statistics.md)
18. [Asset Distribution 模組契約](docs/00_core/architecture/17_asset_distribution.md)
19. [NPC Behavior 模組契約](docs/00_core/architecture/18_npc_behavior_module.md)
20. [Gathering Resolver 與採集 Workflow 契約](docs/00_core/architecture/19_gathering_service.md)
21. [Crafting & Cuisine 模組契約](docs/00_core/architecture/20_crafting_and_cuisine_module.md)
22. [Combat Sequence 模組契約](docs/00_core/architecture/21_combat_sequence_module.md)
23. [Combat Power 純計算契約](docs/00_core/architecture/22_combat_power_service.md)
24. [Social 模組與婚姻 Workflow 契約](docs/00_core/architecture/23_social_module.md)

## 歸檔結構

```text
docs/
├─ 00_core/
│  ├─ game_design_document.md          核心規則、地城、戰鬥與成長
│  ├─ technical_architecture.md        React／TypeScript 架構藍圖
│  └─ architecture/                    共用、領域模組、純計算服務、Engine、資料、存檔平台與 UI 的詳細契約
├─ 01_world/
│  ├─ worldbuilding.md                 四國世界觀與文化方向
│  ├─ national_content_catalog.md      四國內容分類草稿（非現行數值）
│  └─ national_content_catalog.html    上述目錄的閱讀版
├─ 02_systems/
│  ├─ combat_skill_effect_spec.md      技能、反擊與裝備效果規格
│  ├─ equipment_balance.md             裝備係數與品級預算（歷史草稿，非現行規格）
│  ├─ item_system_design.md            使用／非使用道具系統
│  ├─ time_and_mastery_progression.md  時間、迷宮、熟練度與生命週期原則
│  └─ mastery_experience_economy_v1.md 熟練度經驗數值與生命週期試算
└─ 03_content/
   └─ yunhua/
      ├─ yunhua_content_v2.md          雲華目前內容重製基線
      ├─ yunhua_content_v2.data.mjs    雲華 V2 平衡閱讀資料來源
      ├─ yunhua_content_v2.html        雲華 V2 實際數值閱讀版
      ├─ yunhua_catalog_v1.md/html     雲華裝備、道具、技能與地區內容
      ├─ yunhua_first_map_plan.md/html 雲華第一版三張地圖
      └─ yunhua_monsters_v1.*          雲華文化怪物池與閱讀版
```

## HTML 閱讀版

- [四國內容目錄（舊版內容草稿）](docs/01_world/national_content_catalog.html)
- [雲華 V2（實際數值與平衡）](docs/03_content/yunhua/yunhua_content_v2.html)
- [雲華內容（舊版數值與版型草稿）](docs/03_content/yunhua/yunhua_catalog_v1.html)
- [雲華第一版地圖](docs/03_content/yunhua/yunhua_first_maps.html)
- [雲華怪物（舊版數值灰盒）](docs/03_content/yunhua/yunhua_monsters_v1.html)

## 產生 HTML

根目錄保留三個產生腳本；輸出檔會寫回各自的 `docs/03_content/yunhua/` 目錄。

```powershell
node build_yunhua_html.mjs
node build_yunhua_monsters_html.mjs
node build_yunhua_content_v2_html.mjs
```
