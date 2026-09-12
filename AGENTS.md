# 專案工作規則

- 先讀 README.md 與 docs/CURRENT_STATUS.md。架構與設計文件描述目標，不代表已實作。
- 修改正式 Runtime 前讀 .claude/skills/runtime-data-discipline/SKILL.md。
- docs/CURRENT_STATUS.md 是唯一的現況與待辦來源。修復後移除已解決項目，不新增交接、日誌、階段回顧或另一份待辦。
- 過時文件直接移除；有效規則先併入其正式契約。不要把舊內容搬到 archive 資料夾繼續留在搜尋範圍。
- 刪除文件時同步處理連結與程式註解；歷史從 Git 查，不靠工作樹副本。
- 只在完整正式流程與驗證通過後宣稱功能可用。內容種類覆蓋率不是遊戲完成度。
- 修改後執行 npm run verify。不可僅靠舊文件的「全綠」宣稱或對 HEAD 的檢查代替工作樹驗證。
