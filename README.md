# Greeting Adventurer｜文件索引

本專案目前是設計文件與可讀 HTML 的歸檔庫。根目錄只保留索引與產生腳本；所有設計文件集中於 `docs/`。

## 閱讀順序

1. [核心遊戲規格](docs/00_core/game_design_document.md)
2. [世界觀與四國方向](docs/01_world/worldbuilding.md)
3. [時間、迷宮與熟練度原則](docs/02_systems/time_and_mastery_progression.md)
4. [熟練度經驗經濟 v1](docs/02_systems/mastery_experience_economy_v1.md)
5. [雲華第一版內容](docs/03_content/yunhua/yunhua_catalog_v1.md)
6. [雲華第一版地圖](docs/03_content/yunhua/yunhua_first_map_plan.md)
7. [雲華文化怪物池](docs/03_content/yunhua/yunhua_monsters_v1.md)
8. [技術架構藍圖](docs/00_core/technical_architecture.md)
9. [共用核心契約](docs/00_core/architecture/00_shared_contracts.md)
10. [領域模組與服務契約](docs/00_core/technical_architecture.md#14-詳細模組契約)
11. [Engine Runtime 與交易契約](docs/00_core/architecture/12_engine_runtime.md)
12. [Data Runtime 與內容資料契約](docs/00_core/architecture/13_data_runtime.md)
13. [存檔與平台邊界](docs/00_core/architecture/14_save_platform.md)
14. [React UI 與應用層契約](docs/00_core/architecture/15_ui_application.md)
15. [Derived Statistics 純計算契約](docs/00_core/architecture/16_derived_statistics.md)
16. [Asset Distribution 模組契約](docs/00_core/architecture/17_asset_distribution.md)
17. [Adventurer Lifecycle 模組契約](docs/00_core/architecture/18_adventurer_lifecycle_module.md)
18. [Gathering Resolver 與採集 Workflow 契約](docs/00_core/architecture/19_gathering_service.md)

## 歸檔結構

```text
docs/
├─ 00_core/
│  ├─ game_design_document.md          核心規則、地城、戰鬥與成長
│  ├─ technical_architecture.md        React／TypeScript 架構藍圖
│  └─ architecture/                    共用、領域模組、純計算服務、Engine、資料、存檔平台與 UI 的詳細契約
├─ 01_world/
│  ├─ worldbuilding.md                 四國世界觀與文化方向
│  ├─ national_content_catalog.md      四國內容分類目錄
│  └─ national_content_catalog.html    上述目錄的閱讀版
├─ 02_systems/
│  ├─ combat_skill_effect_spec.md      技能、反擊與裝備效果規格
│  ├─ equipment_balance.md             裝備係數與品級預算
│  ├─ item_system_design.md            使用／非使用道具系統
│  ├─ time_and_mastery_progression.md  時間、迷宮、熟練度與生命週期原則
│  └─ mastery_experience_economy_v1.md 熟練度經驗數值與生命週期試算
└─ 03_content/
   └─ yunhua/
      ├─ yunhua_catalog_v1.md/html     雲華裝備、道具、技能與地區內容
      ├─ yunhua_first_map_plan.md/html 雲華第一版三張地圖
      └─ yunhua_monsters_v1.*          雲華文化怪物池與閱讀版
```

## HTML 閱讀版

- [四國內容目錄](docs/01_world/national_content_catalog.html)
- [雲華內容](docs/03_content/yunhua/yunhua_catalog_v1.html)
- [雲華第一版地圖](docs/03_content/yunhua/yunhua_first_maps.html)
- [雲華怪物](docs/03_content/yunhua/yunhua_monsters_v1.html)

## 產生 HTML

根目錄保留兩個產生腳本；輸出檔會寫回各自的 `docs/03_content/yunhua/` 目錄。

```powershell
node build_yunhua_html.mjs
node build_yunhua_monsters_html.mjs
```
