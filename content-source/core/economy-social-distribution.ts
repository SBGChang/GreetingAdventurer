// content-source/core/economy-social-distribution.ts
// 貨幣與報價規則、玩家社交規則、共同成果分配規則。**文化無關**——四國共用同一份。
//
// ── 為什麼這三個模組同一個 domain 檔 ────────────────────────────────────────
//
// 它們是同一條金流的三段：distribution 決定「共同成果怎麼變成個人財產」，economy 決定「錢怎麼算、
// 怎麼落帳」，social 決定「玩家關係如何影響價格與求婚」。三者互相引用（distribution 的競拍款走
// economy 的 reward-rule；economy 的家教報價讀 social 的好感修正），放在同一個作者檔可以讓這些
// 引用在同一頁看得完。分包判準見 packs.ts：**四國都一樣才是 core**。
//
// ── 這裡為什麼沒有任何數字公式 ──────────────────────────────────────────────
//
// 本檔九個 kind 的契約全部只提供 `resolverId`，**沒有任何一個提供 params 欄位或 paramsDefinitionId**。
// 於是「係數 0.5」「好感每次 +3」「Companion 出價 = 餘額 × k」這類調校量在資料側**無處可放**。
// 本檔的處理方式是：填上 resolverId（那是資料的責任），把每一條缺口寫進交付回報的「契約缺口」與
// 「需要註冊的 resolverId」，**不在此處以註解偽裝成資料，也不預期實作端把數字寫進程式**。
// 規範五個合法出口的第 3 項（該 Capability 不啟用）比「先給個係數」正確。
//
// ── 來源（逐筆對照見交付回報的來源表）──────────────────────────────────────
//   * economy：`docs/00_core/architecture/08_economy_module.md` §1.2、§2.2、§3.1、§4、§7.3、§7.4、§8
//   * social：`docs/00_core/architecture/23_social_module.md` §1、§2、§4.2、§5、§6.2、§7；GDD 573、575–578 行
//   * distribution：`docs/00_core/architecture/17_asset_distribution.md` §2、§5.3、§7、§8；GDD 132、179–180 行
//   * 買賣加成歸屬：`docs/02_systems/mastery_experience_economy_v1.md` 第 130 行
//   * 商店收購 ×50%：`docs/03_content/yunhua/yunhua_content.data.mjs` 的 `craftingCatalog.economyRules`

import type {
  CurrencyDefinition,
  PriceModifierRuleDefinition,
  PriceRuleDefinition,
  RewardRuleDefinition,
  RewardRuleId,
} from '../../src/contracts/economy';
import type {
  NpcMarriageRuleDefinition,
  PlayerAffinityRuleDefinition,
  PlayerConversationRuleDefinition,
  SocialSystemDefinition,
} from '../../src/contracts/social';
import type {
  AssetDistributionRuleDefinition,
  AssetDistributionRuleId,
} from '../../src/contracts/distribution';
import type {
  CurrencyId,
  ExperienceAwardRuleId,
  NpcMarriageRuleId,
  PlayerAffinityRuleId,
  PlayerConversationRuleId,
  PriceModifierRuleId,
  PriceRuleId,
  ResolverId,
  SocialSystemDefinitionId,
} from '../../src/contracts/core';
import { cultureIds, type Authored, type AuthoredDomain, type AuthoredText } from '../authoring';

const core = cultureIds('core');

// 標準貨幣的顯示名。「文」是雲華的銅錢單位；英文取通用的 Coin（貨幣是 core，不是雲華專屬，
// 所以不用「文」的音譯 wen）。
const CURRENCY_NAME_KEY = 'currency.standard';

const ECONOMY_TEXTS: readonly AuthoredText[] = [
  { key: CURRENCY_NAME_KEY, name: { 'zh-Hant': '文', en: 'Coin' } },
];

// Resolver ID 的字串形狀是**規約**（既有落地的寫法：`resolver:<module>.<name>`，見
// `src/domain-services/statistics` 與 `src/domain-services/combat-power` 的命名）。以工具產生而不是
// 逐筆手打，讓「打錯一個字導致 Bootstrap 找不到 Resolver」變成集中一處的問題。
// 這不是規則邏輯——它只是字串組裝，與 authoring.ts 的 `definitionId` 同類。
function resolverId(module: string, local: string): ResolverId {
  return `resolver:${module}.${local}` as ResolverId;
}

// ══════════════════════════════════════════════════════════════════════════
// economy
// ══════════════════════════════════════════════════════════════════════════

// ── 貨幣 ────────────────────────────────────────────────────────────────────
//
// **四國同一種貨幣。** 08_economy_module.md §3.1 明講「第一版可只有一種貨幣，但 Runtime 與契約不把
// 貨幣 ID 寫死」；worldbuilding.md 與 GDD 沒有任何一處提到分國通貨、匯率或兌換。單一貨幣因此放在
// core：四國都一樣，正是 packs.ts 的 core 判準。（若日後要分國通貨，作法是各文化 pack 各給一筆
// currency，core 這筆保留給跨國結算——不需要改契約。）
//
// `smallestUnit: 1`：**第一版方案（待討論）**——文件沒有給這個數字，`CurrencyDefinition.smallestUnit`
// 在契約裡只是 `number`。它讓 economy 不變量 1（餘額與金額皆為最小貨幣單位整數）與不變量 12
// （均分餘數逐一分配）有明確的單位。理由是所有設計來源的價值都是整數（yunhua 材料價值 24／26／
// 28／34／110／135／420，最低一筆是「價值 1」），沒有任何一處出現小數金額或輔幣。
const currency: Authored<CurrencyDefinition> = {
  kind: 'currency',
  id: core.id<CurrencyId>('currency', 'standard'),
  smallestUnit: 1,
  // 這個 key 刻意不是 `textKeyFor(id)` 的三段式：`currency` 是已登記的 kind，三段式會被
  // 跨定義引用檢查當成定義引用（同 items.ts 的 `nameRef()` 註解）。
  display: { nameRef: { key: CURRENCY_NAME_KEY } },
};

// ── Price Modifier ──────────────────────────────────────────────────────────
//
// 每一條修正只宣告兩件事：**誰算它**（resolverId）與**怎麼疊**（stackPolicy）。修正值本身由
// Resolver 產出（`EconomyPriceModifierResolverPort.resolvePriceModifier`），Economy Query 只把
// baseValue、direction、subjectCharacterId、personalTradeBonus 與 homeTutorPriceModifier 餵給它。
//
// stackPolicy 逐筆明示的理由（規矩：不靠預設）：
//   * multiply —— 「按比例改變價格」的修正。買賣加成、收購折率、好感折扣都是比例。
//   * add      —— 絕對額修正（最小貨幣單位）。本版沒有任何一條，因為設計來源裡沒有「固定加價 N」
//                 的規則；有了才新增，不預先擺一條空的。
//   * strongest —— 同組只取最強者。本版沒有需要互斥的修正組；戰爭／市場壓力若日後落地會是這一類
//                 （多個地區效應同時成立時只取最強），見回報的契約缺口 3。

// 個人買賣加成。08_economy_module.md §2.2 是**硬要求**：「每筆角色個人買入／賣出 Quote 必須把
// personalTradeBonus 納入資料指定的 Price Modifier Resolver」。
//
// 為什麼買、賣各一筆而不是共用一筆讓 Resolver 看 `direction` 分岔：加成對兩個方向的作用方向相反
// （買入應降價、賣出應提價）。共用一筆的話，那個正負號會住在 Resolver 的 if 裡——換一份平衡 Pack
// 改不動它。拆成兩筆，「哪個方向套哪個 Resolver」就是資料決定的。
const personalTradeBonusBuy: Authored<PriceModifierRuleDefinition> = {
  kind: 'price-modifier-rule',
  id: core.id<PriceModifierRuleId>('price-modifier-rule', 'personal-trade-bonus-buy'),
  resolverId: resolverId('economy', 'personal-trade-bonus.buy'),
  stackPolicy: 'multiply',
};

const personalTradeBonusSell: Authored<PriceModifierRuleDefinition> = {
  kind: 'price-modifier-rule',
  id: core.id<PriceModifierRuleId>('price-modifier-rule', 'personal-trade-bonus-sell'),
  resolverId: resolverId('economy', 'personal-trade-bonus.sell'),
  stackPolicy: 'multiply',
};

// 商店收購折率。來源：yunhua_content.data.mjs `craftingCatalog.economyRules`
// 「商店收購 = 標示價值 ×50%；**所有工藝品使用同一基準**；城市或事件修正另以 Price Modifier 處理」。
// 那句「同一基準」＋「城市／事件修正另計」讀起來是全域基準線而不是雲華特例，所以放 core。
// **這是判讀，不是四國明文**：唯一寫下 ×50% 的檔案是**雲華**的內容檔，另三國的內容檔（aurelien／
// safir／vildun）沒有任何 economyRules 段，所以「四國都一樣」既沒有反證也沒有正證。
// 若整合時確認它其實是雲華專屬，正確作法是把這一筆下推到各文化 pack（見回報的跨包待確認項）。
//
// **並且要注意**：0.5 這個數字目前不在任何資料裡（本 kind 的契約沒有 params，見檔頭），它只能住在
// `resolver:economy.shop-buyback` 的實作或該 Resolver 的調校來源。也就是說在契約補上 params 之前，
// 把這條規則放 core 等於讓四國都改不動那個折率——這是「放 core 猜錯的代價」在本筆上的具體形狀。
const shopBuyback: Authored<PriceModifierRuleDefinition> = {
  kind: 'price-modifier-rule',
  id: core.id<PriceModifierRuleId>('price-modifier-rule', 'shop-buyback'),
  resolverId: resolverId('economy', 'shop-buyback'),
  stackPolicy: 'multiply',
};

// 家教好感修正。08_economy_module.md §4：homeTutor 報價「必須把
// SocialQuery.getHomeTutorPriceModifier(providerCharacterId) 作為一筆**可解釋的** Modifier 納入 Quote」。
// 「可解釋」就是它必須是一條有 ID 的 Modifier Rule（才會出現在 PriceQuote.modifierBreakdown），
// 不是藏在基礎價裡的係數。同節也明講：NPC 彼此沒有好感，因此這條只掛在家教服務的 Price Rule 上。
const homeTutorAffinity: Authored<PriceModifierRuleDefinition> = {
  kind: 'price-modifier-rule',
  id: core.id<PriceModifierRuleId>('price-modifier-rule', 'home-tutor-affinity'),
  resolverId: resolverId('economy', 'home-tutor-affinity'),
  stackPolicy: 'multiply',
};

// ── Price Rule ──────────────────────────────────────────────────────────────
//
// 一條 Price Rule = 一個「價格從哪來」的來源 × 兩個方向要套哪些修正 × 進位與底價。
// `baseValueSource` 的四個值裡，本版只有三個接得上真實價格來源
// （`EconomyPriceSourcePort` 的三個方法：purchase / sell / service）；
// `'rewardDefinition'` 目前沒有任何 Query 走得到它，所以不憑空造一條規則（見回報契約缺口 5）。
//
// `roundingPolicy` 與 `minimumPrice` 都是**必填**，而契約只給一份 roundingPolicy 供買賣共用
// （見回報契約缺口 4）。本版的選擇逐筆記在各筆註解裡，全部標為第一版方案。

// 一般商品買賣。買入只套個人加成；賣出先套商店收購折率再套個人加成。
//
// 賣出的兩條都是 multiply，最終值與宣告順序無關（Query 對每條修正都以 baseValue 為輸入再依序套用），
// 所以這裡的順序只影響 modifierBreakdown 的呈現次序：先讓玩家看到「商店只出一半」，再看到
// 「你的交流熟練幫你拉回多少」。
//
// roundingPolicy `nearest`、minimumPrice 1：**第一版方案（待討論）**。
// nearest 的理由是這條規則同時服務買與賣，floor 會系統性地偏向玩家、ceil 會系統性地偏向商店，
// 而設計文件沒有指定任何一邊；nearest 是唯一不引入方向性偏差的選擇。
// minimumPrice 1 的理由是 smallestUnit 為 1：底價 0 會讓 ×50% 後歸零的低價物變成免費取得／免費賣出，
// 那是一個可被無限重複的漏洞，而不是內容。
const shopItemPriceRule: Authored<PriceRuleDefinition> = {
  kind: 'price-rule',
  id: core.id<PriceRuleId>('price-rule', 'shop-item'),
  baseValueSource: 'itemDefinition',
  buyModifierIds: [personalTradeBonusBuy.id],
  sellModifierIds: [shopBuyback.id, personalTradeBonusSell.id],
  roundingPolicy: 'nearest',
  minimumPrice: 1,
};

// 固定價 Offer（貨架自己帶價的 Offer，例如玩家寄賣後重新上架、活動固定價）。
//
// 與 shop-item 的唯一差別是**賣出側不套商店收購折率**：Offer 已經明講自己的價格，再乘一次 ×50%
// 等於把同一個折扣算兩次。個人買賣加成兩側都保留（§2.2 的「每筆」不分來源）。
const fixedOfferPriceRule: Authored<PriceRuleDefinition> = {
  kind: 'price-rule',
  id: core.id<PriceRuleId>('price-rule', 'fixed-offer'),
  baseValueSource: 'offerFixedValue',
  buyModifierIds: [personalTradeBonusBuy.id],
  sellModifierIds: [personalTradeBonusSell.id],
  roundingPolicy: 'nearest',
  minimumPrice: 1,
};

// 家教服務。08_economy_module.md §4：「必須由資料指定基礎價格，再把好感修正作為一筆可解釋的
// Modifier 納入 Quote」——基礎價格住在服務定義那一側（`serviceDefinition`），這裡只決定套哪些修正。
//
// 買賣加成**不**套用在服務上：**第一版方案（待討論）**。
// 理由是 mastery_experience_economy_v1.md 第 130 行把它定義為「買賣加成依付款／收款角色本人計算」，
// 而家教是僱用勞務、不是買賣一件商品；把它算進去會讓交流熟練度變成「僱人也打折」，
// 那個擴張沒有文件依據。sellModifierIds 為空陣列：服務只有買方，沒有賣出方向。
//
// roundingPolicy `ceil`：**第一版方案（待討論）**。服務費是按期計價的勞務對價，向上進位可保證
// 「好感折扣再深也不會出現 0 元家教」與 minimumPrice 1 同向，不需要靠底價去補。
const homeTutorServicePriceRule: Authored<PriceRuleDefinition> = {
  kind: 'price-rule',
  id: core.id<PriceRuleId>('price-rule', 'home-tutor-service'),
  baseValueSource: 'serviceDefinition',
  buyModifierIds: [homeTutorAffinity.id],
  sellModifierIds: [],
  roundingPolicy: 'ceil',
  minimumPrice: 1,
};

// ── Reward Rule ─────────────────────────────────────────────────────────────
//
// `GrantCurrencyCommand` **沒有 amount 欄位**（契約如此），發放多少錢由 RewardRuleDefinition 指名的
// Resolver 決定。所以每一種 system source 的發放都需要一筆 Reward Rule；三種來源對應 economy
// §3.1 的三個 system purpose（questRewards／dungeonGoldSource／lootDirectSaleSource）。
//
// **這些目前不閉合**：`RewardAmountResolverInput` 只帶 resolverId／rewardRuleId／toAccountId／
// targetCurrencyId／reason／sourceId／worldDay——**沒有基準值**。於是「流標直售款 = intrinsicValue × 0.8」
// 的 intrinsicValue、「任務報酬」的報酬額都到不了 Resolver 手上。詳見回報契約缺口 1。
// 這裡照契約把規則寫齊（ID 存在、形狀正確），但整合時**不得**把它們當成可啟用的 Capability。

// 委託貨幣報酬：**七種委託各一筆**。
//
// ID 的 local 名不是本檔自選的：`content-source/core/quest-crafting-sequence.ts` 的
// `QuestRewardRuleDefinition.currencyRewardRuleId` 已經以 `reward-rule.core.quest-<questKind>`
// 引用它們（purchase／delivery／escort／rescue／exploration／suppression／**hunt**）。
// `reward-rule` 這個 kind 屬 economy，也就是屬本檔，所以由本檔提供，local 名對齊消費端。
// 注意 `hunt`（討伐）在 quest 側叫 hunt、在熟練度側叫 `quest-subjugation`——各自沿用自己擁有者的
// 詞彙，這裡跟隨 quest（引用它的人是 quest）。
//
// 為什麼不是一筆「委託報酬」共用：mastery_experience_economy_v1.md「任務熟練度」表給七種類型
// **各自不同**的倍率（購買 ×0.5、送貨 ×1.0、護衛 ×1.25、救援 ×1.5、探索 ×1.5、鎮壓 ×2.0、討伐 ×2.5）。
// 那張表講的是 MXP，但它證明「委託類型」是本專案已認定的報酬分級軸；貨幣報酬共用一筆規則的話，
// 七種類型就永遠只能一起調。
//
// 為什麼七筆各給一個 Resolver ID 而不是共用一個：契約的 Reward Rule 只有 `resolverId`，沒有
// params 也沒有 paramsDefinitionId（契約缺口 1）。共用一個 Resolver 的話，「哪一類給多少」只能
// 靠 Resolver 內部對 `rewardRuleId` 做 switch——那就是把七個倍率搬進程式。
// 七個 ID 讓「哪一類套哪份調校」留在資料側。若契約補上 paramsDefinitionId，這裡可以收斂成
// 一個 Resolver + 七列 params，**那是收斂，不是把數字搬回程式**。
const QUEST_REWARD_KINDS = [
  'purchase',
  'delivery',
  'escort',
  'rescue',
  'exploration',
  'suppression',
  'hunt',
] as const;

const questCurrencyRewards: readonly Authored<RewardRuleDefinition>[] = QUEST_REWARD_KINDS.map(
  (questKind) => ({
    kind: 'reward-rule',
    id: core.id<RewardRuleId>('reward-rule', `quest-${questKind}`),
    resolverId: resolverId('economy', `reward.quest-${questKind}`),
  }),
);

const dungeonGoldReward: Authored<RewardRuleDefinition> = {
  kind: 'reward-rule',
  id: core.id<RewardRuleId>('reward-rule', 'dungeon-gold'),
  resolverId: resolverId('economy', 'reward.dungeon-gold'),
};

const lootDirectSaleReward: Authored<RewardRuleDefinition> = {
  kind: 'reward-rule',
  id: core.id<RewardRuleId>('reward-rule', 'loot-direct-sale'),
  resolverId: resolverId('economy', 'reward.loot-direct-sale'),
};

// ══════════════════════════════════════════════════════════════════════════
// social
// ══════════════════════════════════════════════════════════════════════════

// 玩家交流的 MXP 由 progression 依 `PlayerConversationCompleted.experienceAwardRuleId` 發放
// （23_social_module.md §5）。`experience-award-rule` 這個 kind 屬 **progression**，不是本檔的所有物，
// 因此照 ID 規約 `<prefix>.core.<local>` 拼字串引用，不 import 別人的檔。
//
// 指到 `social-conversation-tier-1`：這**不是**本檔的選擇，是對齊 kind 擁有者實際產出的 ID。
// `content-source/core/progression-rules.ts` 的 `socialAwardRules` 目前只發兩筆
// （`social-conversation-tier-1`／`social-shopping-tier-1`），並在同處註解裡明寫
// 「`social-conversation-tier-1` ← team.ts 的 conversationExperienceRuleId **並且**
// economy-social-distribution.ts 的 playerConversationRule.experienceAwardRuleId（兩端共用同一筆）」
// ——也就是下面這個欄位。它同時記載先前那筆 `player-conversation` 因無人引用已被移除。
//
// 該檔同時明講「**刻意不做階級展開**」：`mastery_experience_economy_v1.md` §五 的「一次購物／聊天」
// 雖然是一張依內容階級的表（I 160 … V 5,760），但吃這個 ID 的欄位每個都只吃**一個** ID，
// 沒有任何欄位選得到階級 II～V，展開只會產生永遠讀不到的死列。所以「玩家對話該不該有階級」
// 不是兩包對不對得上的問題，而是契約要不要加欄位（見回報契約缺口 7）。
// `-tier-1` 後綴因此只是提供端的命名，不代表這裡選了一個階級——本檔沒有階級可選。
//
// ⚠ **整合者必須釘住這個 ID**：本輪 progression 側在 `social-conversation`（無後綴）與
// `social-conversation-tier-1` 之間來回改過，team.ts 目前引用的是**無後綴**的
// `social-conversation`／`social-commerce`，兩者在提供端都已不存在（team.ts 的懸空引用，不是本檔的）。
// 本檔跟隨的是 kind 擁有者 progression 實際產出的那個名字。三處必須一次對齊，不能各自追對方。
const PLAYER_CONVERSATION_EXPERIENCE_RULE_ID = core.id<ExperienceAwardRuleId>(
  'experience-award-rule',
  'social-conversation-tier-1',
);

// ── 玩家好感規則 ────────────────────────────────────────────────────────────
//
// 一筆規則服務全部非玩家真實冒險者（23_social_module.md §1：`playerAffinities` 不是 pair map，
// key 只有冒險者，value 只代表「該角色對玩家」）。四個 Resolver 各自負責一件事，全部列進
// 回報的「需要註冊的 resolverId」：
//
//   initialValueResolverId                 —— Affinity Provisioning 的唯一初始值（§4.2，重送必須冪等）
//   conversationDeltaResolverId            —— 每次交流的變化量（§2「每次交流變化量…屬資料數值」）
//   playerProposalAcceptanceResolverId     —— 玩家求婚接受判定。§2 硬規則：**deterministic，不得消耗
//                                             RNG**；同狀態重送必得同結果，不能靠零時間洗骰。
//   homeTutorPriceModifierResolverId       —— 家教價格修正（economy §4 只讀這一個結果，不存副本）
//
// minValue 0 / maxValue 100：**第一版方案（待討論）**。
// 設計文件只說「好感度永遠夾在 Rule 的 min／max」（§7 不變量 2），沒有給數字。選 0..100 的理由：
//   1. 與本專案既有的「主屬性上限 100」同一量綱，UI 與平衡討論不必再換算一套刻度。
//   2. 下限取 0 而非負值，是因為設計來源裡沒有任何「厭惡／敵意」的玩法後果——負好感會多出一段
//      沒有任何規則讀它的區間，而那種區間遲早會被某個 Handler 拿來當隱含旗標。
//      要引入敵意時只需把 minValue 改成負數，不動契約。
// 求婚門檻與家教折扣曲線**不在**這裡：它們是上面兩個 Resolver 的調校量，不是值域端點。
// ID 先鑄成窄型別再用，而不是寫 `playerAffinityRule.id`：social 的四個 Definition 型別都宣告成
// 裸 `DefinitionHeader`（不是 `DefinitionHeader<PlayerAffinityRuleId>`），所以它們的 `id` 型別是
// 通用 `DefinitionId`，反過來指派不進 `SocialSystemDefinition.playerAffinityRuleId`。
// 這不是本檔資料的問題，是契約少帶型別參數（見回報契約缺口 6）；在不動別人檔案的前提下，
// 正確作法是把窄 ID 留在**作者側**當單一真相，兩邊都引用它——而不是用轉型把它壓回去。
const PLAYER_AFFINITY_RULE_ID = core.id<PlayerAffinityRuleId>('player-affinity-rule', 'adventurer');
const PLAYER_CONVERSATION_RULE_ID = core.id<PlayerConversationRuleId>(
  'player-conversation-rule',
  'player',
);

const playerAffinityRule: Authored<PlayerAffinityRuleDefinition> = {
  kind: 'player-affinity-rule',
  id: PLAYER_AFFINITY_RULE_ID,
  minValue: 0,
  maxValue: 100,
  initialValueResolverId: resolverId('social', 'affinity.initial'),
  conversationDeltaResolverId: resolverId('social', 'affinity.conversation-delta'),
  playerProposalAcceptanceResolverId: resolverId('social', 'affinity.player-proposal-acceptance'),
  homeTutorPriceModifierResolverId: resolverId('social', 'affinity.home-tutor-price-modifier'),
};

// ── 玩家每日對話規則 ────────────────────────────────────────────────────────
//
// `maxCompletedPerDay` 在契約裡是**字面值型別 `6`**，不是 `number`——也就是說契約已把它固定成結構性
// 不變量（23_social_module.md §2 末條「玩家每天最多完成六次對話，隊友交流、酒館冒險者聊天與打聽
// 情報共用同一計數」與 §7 不變量 3；GDD **573** 行同句）。
// 注意 GDD **574** 行是另一個 6：玩家主角每日最多 6 次**買賣**，「與對話上限分開計算」，
// 屬 city 的 `player-commerce-daily-limit`，不是這一條——兩者不可互相引用為出處。
// 這裡照抄 6 不是選了一個數字，而是型別只允許這一個值。
// （若這其實應該是可調平衡量，那是契約要改——見回報契約缺口 2。）
const playerConversationRule: Authored<PlayerConversationRuleDefinition> = {
  kind: 'player-conversation-rule',
  id: PLAYER_CONVERSATION_RULE_ID,
  maxCompletedPerDay: 6,
  experienceAwardRuleId: PLAYER_CONVERSATION_EXPERIENCE_RULE_ID,
};

// ── Social 系統入口 ─────────────────────────────────────────────────────────
//
// 一筆定義把「本局用哪條好感規則、哪條對話規則」綁起來，讓 Bootstrap 有單一入口可讀。
const socialSystem: Authored<SocialSystemDefinition> = {
  kind: 'social-system',
  id: core.id<SocialSystemDefinitionId>('social-system', 'default'),
  playerAffinityRuleId: PLAYER_AFFINITY_RULE_ID,
  playerConversationRuleId: PLAYER_CONVERSATION_RULE_ID,
};

// ── NPC 婚姻規則 ────────────────────────────────────────────────────────────
//
// 23_social_module.md §6.2：NPC 求婚先由自由行動池骰中，再以 sharedTeamDays、雙方 Combat Power 與
// 戰力接近程度執行**一次** RNG 判定；§7 不變量 5「NPC 求婚不用好感度」。
// 契約只有一個 acceptanceChanceResolverId——三個輸入與那條曲線全部住在該 Resolver。
//
// local 名 **`standard`**——這是本檔作為 kind 擁有者的定名，不是「對齊 team.ts」。
// 掛在自由行動 `freeActionKind: 'proposeToTeammate'` 上（23_social_module.md §4.2：NPC Marriage
// Workflow 由 `FreeActionCompleted(kind=proposeToTeammate)` 啟動；§6.2 的候選限定「同隊、成年、
// 未婚、異性、非玩家主角的正式成員」）。取 `standard` 的理由：doc 全篇只有**一條** NPC 婚姻規則
// （契約也只有一個 `getNpcMarriageRule`），所以它是本 kind 的唯一基準列；本檔對其他唯一基準列
// 用的也是同一個字（`currency.core.standard`）。「只允許用在 proposeToTeammate」是**契約**的限制
// （團隊自由行動那一側），不需要靠 local 名重述一次。
//
// ⚠ **整合者：這個 ID 在本輪來回擺盪過四次，請直接釘住它，不要再讓兩邊「互相對齊」。**
// 實測 `content-source/core/team.ts` 的 `NPC_MARRIAGE_RULE` 依序是
// `teammate` → `standard` → `teammate` → `standard`，而它每一版的註解都寫「local 名對齊提供端
// 本檔實際寫下的值」；本檔早期也寫過「local 名對齊消費端 team.ts」。兩邊都宣稱跟隨對方就會永遠
// 交錯——某一刻 team.ts 是 `teammate`、本檔是 `standard`，而兩邊的註解都自稱已對齊。
// 定案規則：**`npc-marriage-rule` 的擁有者是 social（＝本檔），由本檔定名，team.ts 單向跟隨。**
const npcMarriageRule: Authored<NpcMarriageRuleDefinition> = {
  kind: 'npc-marriage-rule',
  id: core.id<NpcMarriageRuleId>('npc-marriage-rule', 'standard'),
  acceptanceChanceResolverId: resolverId('social', 'npc-marriage.acceptance'),
};

// ══════════════════════════════════════════════════════════════════════════
// distribution
// ══════════════════════════════════════════════════════════════════════════

// 17_asset_distribution.md §2 的「第一版硬規則」是一張 sourceKind × 控制方 的表：
//
//   sourceKind          | 玩家隊                          | NPC 隊
//   --------------------|---------------------------------|------------------------------
//   dungeonLoot         | playerAuction + internalAuction  | npcRng + rngPerItem
//   expiredQuestCargo   | playerAuction + internalAuction  | npcRng + rngPerItem
//   questReward         | equalCurrencyOnly + none（貨幣報酬沒有實物，玩家與 NPC 同一條）
//
// 五筆定義就是這張表的五格。`currencyPolicy` 與 `remainderPolicy` 在契約裡都是單值字面型別
// （'equalSplit' / 'deterministicRotation'），對應 §2「所有可分割貨幣最後都平均分給正式參與者」與
// §8 不變量 8「三種來源使用同一餘數規則」——結構性，不是選項。
//
// 為什麼玩家與 NPC 拆成兩筆而不是一筆帶兩種政策：`controllerPolicy` 與 `itemPolicy` 必須同時切換
// （playerAuction 一定配 internalAuction，npcRng 一定配 rngPerItem），而 `auction` 與
// `npcItemRecipientResolverId` 分別只有一邊用得到。合成一筆的話那兩個欄位都得變 optional，
// 於是「不適用」與「忘了填」再也分不開——正是「一個 Func 一張表」要避免的形狀。

// 玩家競拍的 auction 區塊。四個欄位有三個在契約裡是字面值型別，只有 Resolver 是真正的選擇：
//   minimumBid 'intrinsicValue'                  —— §2、GDD 179 行「以原價值作為最低出價」；
//                                                   economy §8 不變量 11：競拍只能用 intrinsicValue，
//                                                   不得取得或套用一般 Shop Quote。
//   unclaimedSaleMultiplier 0.8                  —— §2、GDD 179 行「無人要的物品按原價值 80% 直售」；
//                                                   §8 不變量 5 固定為 floor(intrinsicValue × 0.8)。
//                                                   契約把它釘成字面 `0.8`（見回報契約缺口 2）。
//   tieBreakPolicy 'deterministicFromDistributionId' —— §7.1「同額最高 Bid 依 distributionId + itemId
//                                                   + characterId 的固定排序決定，不重骰」。
//   companionBidResolverId                       —— §7.1「Companion Resolver 依個人偏好與個人餘額
//                                                   決定 Bid／Pass」。偏好與出價上限的調校量住在
//                                                   該 Resolver；列進回報的「需要註冊的 resolverId」。
//
// 玩家地牢戰利品與玩家到期任務物資共用同一個 auction 區塊（§2 兩者都是 internalAuction），
// 但仍是兩筆 Rule：sourceKind 不同，而 sourceKind 是 Rule 的識別欄位。
const PLAYER_AUCTION = {
  minimumBid: 'intrinsicValue',
  unclaimedSaleMultiplier: 0.8,
  companionBidResolverId: resolverId('distribution', 'companion-bid'),
  tieBreakPolicy: 'deterministicFromDistributionId',
} as const;

// NPC 逐件 RNG 的收受者選擇。§7.2「npcItemRecipientResolverId 從正式參與者中選一人」；
// §8 不變量 9：RNG Stream 綁 Distribution ID，快轉／存讀檔／重播結果一致。
const NPC_ITEM_RECIPIENT_RESOLVER_ID = resolverId('distribution', 'npc-item-recipient');

const playerDungeonLootRule: Authored<AssetDistributionRuleDefinition> = {
  kind: 'asset-distribution-rule',
  id: core.id<AssetDistributionRuleId>('asset-distribution-rule', 'player-dungeon-loot'),
  sourceKind: 'dungeonLoot',
  controllerPolicy: 'playerAuction',
  currencyPolicy: 'equalSplit',
  itemPolicy: 'internalAuction',
  auction: PLAYER_AUCTION,
  remainderPolicy: 'deterministicRotation',
};

const npcDungeonLootRule: Authored<AssetDistributionRuleDefinition> = {
  kind: 'asset-distribution-rule',
  id: core.id<AssetDistributionRuleId>('asset-distribution-rule', 'npc-dungeon-loot'),
  sourceKind: 'dungeonLoot',
  controllerPolicy: 'npcRng',
  currencyPolicy: 'equalSplit',
  itemPolicy: 'rngPerItem',
  npcItemRecipientResolverId: NPC_ITEM_RECIPIENT_RESOLVER_ID,
  remainderPolicy: 'deterministicRotation',
};

const playerExpiredCargoRule: Authored<AssetDistributionRuleDefinition> = {
  kind: 'asset-distribution-rule',
  id: core.id<AssetDistributionRuleId>('asset-distribution-rule', 'player-expired-quest-cargo'),
  sourceKind: 'expiredQuestCargo',
  controllerPolicy: 'playerAuction',
  currencyPolicy: 'equalSplit',
  itemPolicy: 'internalAuction',
  auction: PLAYER_AUCTION,
  remainderPolicy: 'deterministicRotation',
};

const npcExpiredCargoRule: Authored<AssetDistributionRuleDefinition> = {
  kind: 'asset-distribution-rule',
  id: core.id<AssetDistributionRuleId>('asset-distribution-rule', 'npc-expired-quest-cargo'),
  sourceKind: 'expiredQuestCargo',
  controllerPolicy: 'npcRng',
  currencyPolicy: 'equalSplit',
  itemPolicy: 'rngPerItem',
  npcItemRecipientResolverId: NPC_ITEM_RECIPIENT_RESOLVER_ID,
  remainderPolicy: 'deterministicRotation',
};

// 任務貨幣報酬。§2「任務貨幣報酬使用 equalCurrencyOnly」；economy §7.3：只有在原接取公會合法結案
// 才建立這筆分配，Distribution 把已驗證報酬放進清算帳戶再平均發給 Quest 保存的正式參與角色。
// itemPolicy 'none'：貨幣報酬沒有實物，所以沒有競拍也沒有 RNG——不是「還沒填」。
// 沒有 auction、也沒有 npcItemRecipientResolverId：玩家隊與 NPC 隊走同一條規則（§2 只有貨幣時
// 兩者行為相同），這是本表唯一不需要分玩家／NPC 的一格。
const questRewardCurrencyRule: Authored<AssetDistributionRuleDefinition> = {
  kind: 'asset-distribution-rule',
  id: core.id<AssetDistributionRuleId>('asset-distribution-rule', 'quest-reward-currency'),
  sourceKind: 'questReward',
  controllerPolicy: 'equalCurrencyOnly',
  currencyPolicy: 'equalSplit',
  itemPolicy: 'none',
  remainderPolicy: 'deterministicRotation',
};

// ══════════════════════════════════════════════════════════════════════════

export const economySocialDistributionDomain: AuthoredDomain = {
  domain: 'economy-social-distribution',
  definitions: [
    // economy
    currency,
    personalTradeBonusBuy,
    personalTradeBonusSell,
    shopBuyback,
    homeTutorAffinity,
    shopItemPriceRule,
    fixedOfferPriceRule,
    homeTutorServicePriceRule,
    ...questCurrencyRewards,
    dungeonGoldReward,
    lootDirectSaleReward,
    // social
    playerAffinityRule,
    playerConversationRule,
    socialSystem,
    npcMarriageRule,
    // distribution
    playerDungeonLootRule,
    npcDungeonLootRule,
    playerExpiredCargoRule,
    npcExpiredCargoRule,
    questRewardCurrencyRule,
  ],
  texts: ECONOMY_TEXTS,
};
