---
name: runtime-data-discipline
description: >
  Greeting Adventurer 的「正式 Runtime 資料驅動與零暫代」準則。動到 src/ 底下任何正式執行路徑時都要先讀：
  Kernel、GameEngine、GameSession、Transaction Runner、Composition Root、Module Handler、Workflow、
  Resolver、Query Adapter、Definition Reader、Bootstrap、Save/Load Migration、Content Compiler，以及任何
  Production UI 呼叫得到的入口。也適用於：判斷某個數值該寫在程式還是內容資料、新增或修改
  Definition/Resolver/Rule、處理「資料還沒有所以先給個預設」的情況、註冊或開放 Capability、拆解模組
  所有權、審查 Runtime 程式碼、以及回應架構複審意見。只要你正要寫下一個 ID 字串、一個倍率或機率、一個
  `?? 1`、一個 catch 之後繼續、一個 `as unknown as`、一個回傳未變 state 的 no-op，或一句「先這樣，之後
  再補」，就用這個 Skill。
---

# 正式 Runtime 資料驅動與零暫代

完整規範原文在 `references/specification.md`（十七節，權威文本，逐字保存）。
目前待清理項目與進度在 `references/cleanup-backlog.md`。
本檔是**動手當下**要用的判斷流程與辨識樣式；遇到規範文字的爭議，以原文為準。

## 為什麼這件事值得這麼嚴格

這個專案的最終目標是：**同一套 Runtime 載入不同文化或平衡 Pack，就產生不同的遊戲**。

每一個寫死在 Handler 裡的數值、每一個「資料還沒好所以先回 true」，都在悄悄把內容搬進程式。
搬進去的當下沒有人會發現——測試會過、型別會過、功能看起來能動。發現的時候，是換上真內容以後
行為沒變，或是平衡調整改不動，而那時候暫代行為已經散在幾十個 Handler 裡。

所以判準不是「這樣寫會不會出錯」，而是「**換一份 Content Pack，這行會不會跟著改變**」。

## 一句話判準

> 修改這個值，可能改變內容、平衡或文化差異嗎？

- **會** → 它是資料。必須由 Definition / Resolver / Rule / Content Pack 提供。
- **不會，而且正式規格已把它定義為結構性不變量** → 可以寫在程式裡。
- **判不出來** → **當成資料**。這是規範明訂的預設方向，因為猜錯的兩種代價不對稱：
  把不變量做成資料只是多一層間接；把資料寫成不變量會在換 Pack 時安靜地失效。

「目前不打算調整」不是不變量的理由。只要架構已經把它歸給 Definition、Rule 或 Resolver，就是資料。

真正的不變量長這樣：戰鬥場地 3×3、隊員上限 9、Mastery Lv.0～10、主屬性上限 100、
支援技能每戰每招最多 3 次、Module ID、Schema kind、錯誤碼、Kernel 安全上限、Hash 常數。
它們的共通點是：改了就不是這個遊戲的**結構**了，而不是「改了會比較好玩」。

## 資料不足時，只有五個合法出口

這是整份規範的核心。缺資料時，能做的只有這五件事：

1. **Bootstrap 失敗**——世界建不起來就不要建。
2. **Content Pack 驗證失敗**——在載入階段擋下。
3. **該 Capability 不啟用**——不註冊入口、不出現在 Manifest、UI 不顯示。
4. **Command 回傳明確 typed rejection**——讓呼叫端拿到可呈現的結果。
5. **存檔拒絕載入，或先完成正式 Migration**。

不在這五項裡的一律不行。特別是這些很像「處理了」但其實是掩蓋：

- 回一個預設 Definition。
- Resolver 不在就用固定結果。
- `?? 1`、`?? 0`、`?? 'female'`。
- catch 住 Reader 例外然後繼續成功。
- 缺 Handler／訂閱者就跳過。
- 回傳未變 state 當作「處理過了」。
- 拿 Fixture 補正式內容。
- 退回 Bring-up Bootstrap。
- 用 TODO 註解把未完成行為合理化。

**未完成不是錯誤；把未完成偽裝成可用才是錯誤。**

## 冪等 no-op vs 偽裝的 fallback

這是最容易判錯的一條，值得單獨想清楚。兩者程式碼長得幾乎一樣——都是「接受，但什麼都不做」。

差別在**為什麼不做**：

| | 合法的冪等 no-op | 偽裝的 fallback |
|---|---|---|
| 原因 | 這件事**已經發生過了** | 這件事**還沒實作** |
| 契約 | 文件明訂此情境冪等 | 沒有契約，只有 TODO |
| 資料 | 資料齊全，只是不需再套用 | 資料缺失 |
| 測試 | 有測試釘住冪等行為 | 測試只斷言 accepted |
| 換 Pack | 行為不變（本來就該不變） | 行為應該變，但不會變 |

判斷方法：問「如果資料**齊全**，這裡還會 no-op 嗎？」
會 → 冪等，合法。不會 → 你在用 no-op 蓋住缺口，改成 typed rejection 或不啟用 Capability。

已處理過的事件、過期的 Job、已解除的鎖，都是前者。這些必須有明確契約與測試。

## 動手前先問「這個事實歸誰」

跨模組的錯誤幾乎都源自同一件事：**在不擁有該事實的地方決定了它**。

- 只寫自己的 State Slice；別人的 State 用 Internal Command 請求。
- 只鑄造自己擁有的 Runtime ID。需要別人的實體 ID，就用 Query 取既存的。
- Definition 走窄化 Reader；其他模組的事實走 Query Port；已發生的事實用 Domain Event 公告。
- 跨模組流程用 Workflow 編排。

**不要為了避免新增 Workflow 而直接呼叫別的模組 Handler。** 那個誘惑很強，因為它「馬上就能動」，
但它把跨模組規則藏進單一模組，下一個人不會知道要去哪裡找。

如果一條規則需要同時看兩個以上模組的事實，而架構禁止它們互查——那就是**沒有實作點**，
不是驗漏了。要開一個 Workflow。

## 常見樣式：認出來，然後怎麼改

**寫死 ID**
```ts
// ✗ 換 Pack 不會變
const ruleId = 'combat-rule-standard' as CombatRuleId;
// ✓ 從擁有它的地方取
const ruleId = ctx.definitions.getEncounterRule(encounter.ruleId).id;
```

**缺資料時給預設玩法值**
```ts
// ✗ 5 是內容，不是不變量
const restored = rule?.healthRestore ?? 5;
// ✓ 缺規則就是缺資料
if (rule === undefined) return reject('combat/rest-rule-missing', { ruleId });
```

**catch 之後繼續**
```ts
// ✗ 把「內容壞了」變成「一切正常」
try { view = reader.getSkillView(id); } catch { view = FALLBACK_SKILL; }
// ✓ 讀取端可以跳過該項並回報，但不得代它決定內容
const view = tryGetSkillView(id);
if (view === undefined) continue;   // Query：跳過並讓呼叫端看見缺口
if (view === undefined) return reject('combat/skill-definition-missing', { id }); // Handler：拒絕
```
Query 與 Handler 的正確反應不同：Query 不該因一筆壞引用整個炸掉，Handler 不該假裝資料存在。

**跨語意強制轉型**
```ts
// ✗ Effect ID 不是 Status ID，型別轉換只是把契約缺口藏起來
applyStatus(effectId as unknown as StatusId);
// ✓ 缺的是對照資料，補 Schema（見下節），不是補轉型
const statusId = ctx.definitions.getEffect(effectId).statusId;
```

**不擁有卻鑄造 ID**
```ts
// ✗ Map instance 屬 Map 模組
const mapId = ctx.ids.nextMapInstanceId();
// ✓ 由擁有者建立，這裡只引用既存 ID
const mapId = ctx.world.getAdventureMapId(siteId);
```

**固定成功**
```ts
// ✗ 選項效果還沒接，於是一律成功
return accept(clearPending(state), [resolvedSuccessfully()]);
// ✓ 沒有效果資料就不能宣稱結果
const outcome = ctx.resolvers.resolveContentEventOption(optionId);
```

## Schema 不夠用的時候

想用 `Record<string, unknown>`、字串欄位暫存、或 `as unknown as` 的那一刻，就是 Schema 不夠用。
唯一的處理方式是把它補齊（原文 §7 的十步）：

確認語意與擁有模組 → 擴充 Definition/State/Command/Event Schema → 提升 `schemaVersion` →
定義舊資料與舊存檔 Migration → Content Compiler → Definition Reader → Resolver/Query Port →
正式 Content Pack → 驗證器 → 模組與整合測試。

全部完成才啟用功能。**不要先寫固定行為，打算日後補 Schema**——那個「日後」在這個專案已經被複審抓到很多次。

如果補 Schema 會動到目前不該動的檔案（例如內容軌正在被另一個工作改寫），
正確作法是：**補契約側、明確標記該 Capability 不啟用、把資料側列入待辦**，而不是先寫個預設值。

## 行為的資料化：一個 Func 一張表

上一節說「Schema 不夠用就補齊」。這一節說**補成什麼形狀**——因為補錯形狀比不補更難救。

適用時機：當同一個欄位位置要裝**好幾種功能完全不同**的東西。技能的特殊效果、事件選項的結果、
委託目標、NPC 意圖、地圖內容解析、價格修正——全都是這個形狀。

### 四層，每層只認下一層的 ID

```text
技能        ── effectIds ──▶  效果表        ── kind ──▶  該 Func 專屬欄位   ──▶  策略實作
(不知道效果做什麼)          (不知道 Func 怎麼算)     (不知道誰呼叫它)        (不知道有哪些內容)
```

每一層只認下一層的 **ID，不認它的意義**。所以任何一層改動都不會往上下擴散，而且：

- **新增一個「效果」是內容改動**——挑一個 Func、填它的欄位。不碰程式，數量無上限。
- **新增一個「Func」是程式改動**——要寫策略、定 Schema、指定擁有模組、補 Validator 與測試。

第二點是這套設計最值錢的地方，而且**那個成本是特性，不是缺點**：它把「引擎表達不出這個效果」
從一句可以含混帶過的藉口，變成一個要簽名、可被計數的決定。缺了它，新特例就會長在某個 Handler
的 if 分支裡，而下一個人不會知道要去哪裡找。

### 規矩一：一個 Func 一張表

**功能不同的東西不得共用一張表。**

把所有 Func 塞進同一張表，那張表的欄位必然變成「所有 Func 欄位的聯集」，後果是四件事同時發生：

| 後果 | 具體長相 |
|---|---|
| 欄位語意模糊 | `value: number` 到底是傷害、秒數還是機率？要看 `kind` 才知道 |
| 無法加必填約束 | 任何欄位對別的 Func 都不適用，於是全部只能 optional |
| 驗證器寫不出來 | 「這一列該填哪幾格」沒有單一答案 |
| 內容作者看不出要填什麼 | 一整排空欄位，不知道哪些是「不適用」哪些是「忘了填」 |

**那不是解耦，那是把耦合藏進 nullable 欄位裡。** 型別不再是內容作者與策略實作者之間的契約,
於是「資料填錯」與「內容本來就是這樣」再也分不開——而這正是本規範存在的理由。

正解：**每個 Func 一張自己的表，欄位全部緊、全部有意義、全部必填。** 在本專案裡,
「一張表」就是**一個 Definition kind**：一個 kind、一份 Schema、一個窄化 Reader、一個 View 型別。
這也是 `kind` 欄位的正確用法（家族識別),與「用 `kind` 裝領域變體」那個反樣式相反。

`ConditionDefinition` / `EffectDefinition` 的判別聯集（`13_data_runtime.md` §6）就是這個形狀的
標準實例：`grantItem` 只有 `itemDefinitionId / amount`,`applyStatus` 只有 `statusId / duration`,
`changeCityMetric` 只有 `cityId / metric / amount`。**兩個 kind 不共用任何欄位，也不需要共用。**

### 規矩二：共用表只放「所有 Func 都必填且語意相同」的欄位

如果確實需要一張共用的效果表（見下方零跳／一跳),它的欄位受這條規則約束：

> 共用表只能放**所有 Func 都必填、且語意完全相同**的欄位。一旦出現「只有某個 Func 用得到」的
> 欄位，就必須下推到該 Func 自己的表。

這條是可檢查的，而且它是共用表唯一的防腐機制。共用表腐化永遠是同一個過程：某人為了一個 Func
加了一個欄位，對其他 Func 標成 optional;第二個人照做。三次之後就回到規矩一要避免的狀態。

### 規矩三：零跳優先，有共同欄位才升成一跳

- **零跳**：效果**就是**它那張 Func 表裡的一列（`kind` 直接是 Func),技能直接指向它。
- **一跳**：效果表獨立一張，指向 Func 表的一列。

一跳只有在**同一份 Func 參數要被多個效果共用**,或效果本身有跨 Func 的共同中介資料時才值得。
判準就是規矩二：先找出真正「所有 Func 都必填且同義」的欄位——找得到就一跳，找不到就零跳。
**不要預先付這個間接成本。**（`13_data_runtime.md` §6 目前是零跳。）

### 規矩四：轉換層在載入邊界，轉不出來就是內容驗證失敗

資料側是字串 kind,程式側是**有限的聯集／Enum**。程式知道有哪些動作，只透過轉換層才知道
資料的含意。這一層的位置與失敗方式都是硬規定：

- 轉換發生在**載入／驗證階段**,不是執行期。
- 未登記的 kind = **Content Pack 驗證失敗**（五個合法出口的第 2 項),不得啟動遊戲。
- **不得**在執行期對未知 kind 給預設行為、跳過該筆、或 catch 後繼續。那是規範 §6 點名的偽裝。

### 規矩五：派發表的完整性由編譯器保證

策略註冊表用**非 Partial** 的 `Record<FuncKind, Strategy>` 宣告。新增一個 Func 卻沒寫策略,
`tsc` 直接擋下——不要靠「記得去補」。

本專案已有現成樣板：`app/composition/messages.ts` 的 `GAME_COMMAND_ENTRY` 與
`INTERNAL_COMMAND_OWNER` 都是非 Partial Record,所以「新增一筆訊息卻沒指定入口」是編譯錯誤。
派發表照這個寫。

### 這不是 expression DSL

慣例明文禁止 expression DSL 與「資料夾帶可執行腳本」，而 `13_data_runtime.md` §6 的標題卻寫著
「Effect DSL」。兩者不衝突，但值得講清楚差別在哪：

| | 封閉 tagged variant（**允許**） | expression DSL（**禁止**） |
|---|---|---|
| 資料能表達的 | 只能從**已註冊的有限 kind** 中選一個，填它的欄位 | 任意運算式、任意組合 |
| 新行為 | 必須改程式（新 kind + 策略 + Schema） | 只改資料就能造出新行為 |
| 可驗證性 | 每個 kind 一個 Validator,靜態驗得完 | 只能執行才知道對不對 |
| 決定性 | 由策略實作保證 | 由資料作者保證（= 沒有保證） |

同時一律禁止：`eval`、函式本文或 JavaScript 字串、由資料指定 import path、以反射呼叫未註冊方法、
資料直接呼叫平台 API。

### 反樣式：看到這些就是形狀補錯了

| 反樣式 | 為什麼是病 | 正解 |
|---|---|---|
| `params: Record<string, unknown>` | 把「我不想定 Schema」寫成型別 | 一個 Func 一張表 |
| `value: number` + 「看 kind 才知道意思」 | 欄位名稱不再描述內容 | 各表用具名欄位（`durationActions` / `multiplier`） |
| 一張表裡大量 optional 欄位 | 「不適用」與「忘了填」無法區分 | 下推到各自的 Func 表 |
| `directive` / `details` / `payload` 這類袋子欄位 | 名字本身就在說「這裡什麼都能放」 | 補成判別聯集 |
| 策略註冊表是 `Partial<Record<...>>` | 少一個 Func 不會有人發現 | 改成非 Partial |

## Capability 只有閉合了才開放

一項功能要開放，它宣告的依賴必須**全部存在且通過驗證**：Reader、Query、相關模組、Rule/Resolver、
Internal Command Handler、Domain Event Subscriber、Pending Interaction Query、以及完整的收斂流程
（例如地牢要有離場與返城）。

沒閉合的 Capability：不進正式 Manifest、UI 不顯示、不註冊 Game Command 入口、不被其他 Workflow 呼叫、
**也不要等玩家按下去才拋「尚未實作」**。

本專案的具體作法：列入 `src/app/composition/manifest.ts` 的 `UNAVAILABLE_CAPABILITIES`，
每一項附**書面理由**，Router 回 `engine/feature-not-available`。這份清單只能變短。

## Fixture 與正式路徑必須完全隔離

Fixture 與 Bring-up 工具本身不違規——**被正式路徑碰到才違規**。

正式依賴圖裡不得出現：`fixtures.ts`、`*.test.ts`、`session-fixture.ts`、Bring-up Bootstrap、
`docs/03_content`、測試 Content Pack。

注意 `docs/03_content/**/*.data.mjs` 是**設計來源**，不是 Runtime 資料。
它必須經 Content Compiler 產生正式 Definition，正式 Runtime 不得直接讀。

## 收工前的自我審查

改完正式 Runtime，逐條回答（原文 §15）。任何一條答不出來就不要交：

1. 這個數字是系統不變量還是可調資料？
2. 這個 ID 從哪個 Definition／Command／Query 取得？
3. 這項資料的擁有者是哪個模組？
4. 資料不存在時是否明確失敗？
5. 是否出現固定成功或 accepted no-op？
6. 是否用型別轉換掩蓋契約缺失？
7. 是否從 Fixture 或文件內容取得資料？
8. 是否新增尚未閉合的公開 Capability？
9. 是否需要 Schema Migration？
10. 更換 Content Pack 後行為是否會改變？

最後一條是總驗證：如果答案是「不會變」，而這段邏輯又跟內容有關，那就還沒做完。

另外，如果這次改動讓**同一個欄位位置要裝好幾種功能不同的東西**（效果、條件、目標、意圖、
結果…），再加一條：**我是不是把它們塞進了同一張表?** 判斷流程見上面「行為的資料化：
一個 Func 一張表」。

## 回報時要誠實標示

做不完的部分要明說，而且要說清楚**卡在哪個具體缺口**（缺哪個 Schema 欄位、哪個模組沒實作、
哪個檔案被別的工作佔用），不要只寫「待辦」。把它同時記進 `HANDOFF.md` 與
`references/cleanup-backlog.md`，讓下一個人不必重新調查一次。
