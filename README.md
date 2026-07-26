# Greeting Adventurer｜文件索引

本專案目前是設計文件與可讀 HTML 的歸檔庫。根目錄只保留索引與產生腳本；所有設計文件集中於 `docs/`。

## 閱讀順序

1. [核心遊戲規格](docs/00_core/game_design_document.md)
2. [世界觀與四國方向](docs/01_world/worldbuilding.md)
3. [雲華第一版內容](docs/03_content/yunhua/yunhua_catalog_v1.md)
4. [雲華第一版地圖](docs/03_content/yunhua/yunhua_first_map_plan.md)
5. [雲華文化怪物池](docs/03_content/yunhua/yunhua_monsters_v1.md)

## 歸檔結構

```text
docs/
├─ 00_core/
│  └─ game_design_document.md          核心規則、地城、戰鬥與成長
├─ 01_world/
│  ├─ worldbuilding.md                 四國世界觀與文化方向
│  ├─ national_content_catalog.md      四國內容分類目錄
│  └─ national_content_catalog.html    上述目錄的閱讀版
├─ 02_systems/
│  ├─ combat_skill_effect_spec.md      技能、反擊與裝備效果規格
│  ├─ equipment_balance.md             裝備係數與品級預算
│  └─ item_system_design.md            使用／非使用道具系統
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
