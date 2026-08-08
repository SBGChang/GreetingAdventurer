# Greeting Adventurer｜文件索引

本專案目前是設計文件與可讀 HTML 的歸檔庫。根目錄只保留索引與產生腳本；所有設計文件集中於 `docs/`。

## 閱讀順序

1. [核心遊戲規格](docs/00_core/game_design_document.md)
2. [世界觀與四國方向](docs/01_world/worldbuilding.md)
3. [時間、迷宮與熟練度原則](docs/02_systems/time_and_mastery_progression.md)
4. [熟練度經驗經濟 v1](docs/02_systems/mastery_experience_economy_v1.md)
5. [雲華內容規格](docs/03_content/yunhua/yunhua_content.md)
6. [雲華實際數值與平衡閱讀版](docs/03_content/yunhua/yunhua_content.html)
7. [技術架構藍圖](docs/00_core/technical_architecture.md)
8. [共用核心契約](docs/00_core/architecture/00_shared_contracts.md)
9. [領域模組與服務契約](docs/00_core/technical_architecture.md#14-詳細模組契約)
10. [Engine Runtime 與交易契約](docs/00_core/architecture/12_engine_runtime.md)
11. [Data Runtime 與內容資料契約](docs/00_core/architecture/13_data_runtime.md)
12. [存檔與平台邊界](docs/00_core/architecture/14_save_platform.md)
13. [React UI 與應用層契約](docs/00_core/architecture/15_ui_application.md)
14. [Derived Statistics 純計算契約](docs/00_core/architecture/16_derived_statistics.md)
15. [Asset Distribution 模組契約](docs/00_core/architecture/17_asset_distribution.md)
16. [NPC Behavior 模組契約](docs/00_core/architecture/18_npc_behavior_module.md)
17. [Gathering Resolver 與採集 Workflow 契約](docs/00_core/architecture/19_gathering_service.md)
18. [Crafting & Cuisine 模組契約](docs/00_core/architecture/20_crafting_and_cuisine_module.md)
19. [Combat Sequence 模組契約](docs/00_core/architecture/21_combat_sequence_module.md)
20. [Combat Power 純計算契約](docs/00_core/architecture/22_combat_power_service.md)
21. [Social 模組與婚姻 Workflow 契約](docs/00_core/architecture/23_social_module.md)

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
      ├─ yunhua_content.md              雲華唯一正式內容規格
      ├─ yunhua_content.data.mjs        雲華平衡閱讀資料來源
      └─ yunhua_content.html            雲華實際數值閱讀版
```

> `docs/review/` 為架構複審的決策紀錄（見該資料夾 README）；文件內 file:line 為複審當時位置，僅供 provenance，不作定位依據。

## HTML 閱讀版

- [四國內容目錄（舊版內容草稿）](docs/01_world/national_content_catalog.html)
- [雲華內容與平衡](docs/03_content/yunhua/yunhua_content.html)

## 產生 HTML

根目錄只保留現行雲華閱讀版的產生腳本；輸出檔會寫回 `docs/03_content/yunhua/`。

```powershell
node build_yunhua_content_html.mjs
```
