# Social 模組契約

> **模組 ID：** `social`
>
> **依賴：** [共用核心契約](00_shared_contracts.md)，以及 Team、City、Character 與 Combat Power 的窄化公開 Query。
>
> **責任：** 保存每名非玩家真實冒險者唯一一個「對玩家」好感度、玩家每日對話用量，解析玩家與冒險者的零時間交流，並提供玩家求婚與家教價格所需的好感度輸入。
>
> **非責任：** 不建立任意角色對角色的好感網路，不擁有隊伍、伴侶 FamilyLink、交流熟練度、金錢、家教 Post 或 NPC 自由行動。

---

## 1. 邊界與 State

```ts
type SocialState = {
  playerAffinities: Record<CharacterId, PlayerAffinityState>;
  playerConversationUsage?: PlayerConversationDailyUsage;
};

type PlayerAffinityState = {
  adventurerId: CharacterId;
  ruleId: PlayerAffinityRuleId;
  value: number;
  revision: Revision;
};

type PlayerConversationDailyUsage = {
  usageId: PlayerConversationUsageId;
  playerCharacterId: CharacterId;
  worldDay: WorldDay;
  ruleId: PlayerConversationRuleId;
  completedCount: number;
  revision: Revision;
};
```

`playerAffinities` 不是 pair map。Key 永遠只有「非玩家真實冒險者 CharacterId」，Value 永遠只代表該角色對玩家的好感度；不保存 `characterA → characterB`、隊友彼此好感、居民關係或歷史對話全文。存檔容量隨真實冒險者人數線性增加。

`playerConversationUsage` 只保留目前玩家主角在目前世界日的一筆計數；世界日或玩家主角改變時直接替換，不累積每日歷史。

玩家主角自己、任務暫時角色、Child Team 成員與沒有真實 Character 的居民都不建立可用好感度。角色日後成為玩家主角時，原值可保留作歷史但所有 Query／Resolver 必須忽略；不得將它解讀成自我好感。

---

## 2. 靜態資料契約

```ts
interface SocialDefinitionReader {
  getSocialSystem(id: DefinitionId): SocialSystemDefinition;
  getPlayerAffinityRule(id: PlayerAffinityRuleId): PlayerAffinityRuleDefinition;
  getPlayerConversationRule(id: PlayerConversationRuleId): PlayerConversationRuleDefinition;
  getNpcMarriageRule(id: NpcMarriageRuleId): NpcMarriageRuleDefinition;
}

type SocialSystemDefinition = DefinitionHeader & {
  playerAffinityRuleId: PlayerAffinityRuleId;
  playerConversationRuleId: PlayerConversationRuleId;
};

type PlayerAffinityRuleDefinition = DefinitionHeader & {
  minValue: number;
  maxValue: number;
  initialValueResolverId: ResolverId;
  conversationDeltaResolverId: ResolverId;
  playerProposalAcceptanceResolverId: ResolverId;
  homeTutorPriceModifierResolverId: ResolverId;
};

type PlayerConversationRuleDefinition = DefinitionHeader & {
  maxCompletedPerDay: 6;
  experienceAwardRuleId: ExperienceAwardRuleId;
};

type NpcMarriageRuleDefinition = DefinitionHeader & {
  acceptanceChanceResolverId: ResolverId;
};
```

- 玩家求婚的好感判定必須是 deterministic Resolver，不得消耗 RNG；低於條件時重送同一狀態只會得到相同拒絕，不能靠零時間洗骰。
- NPC 求婚先由自由行動池骰中，再以 `sharedTeamDays`、雙方 Combat Power 與戰力接近程度執行一次 RNG 判定；不得讀取任何玩家好感度。
- 好感度初始值、每次交流變化量、玩家求婚門檻與家教價格修正都屬資料數值，不寫死在 Handler。
- 玩家每天最多完成六次對話，隊友交流、酒館冒險者聊天與打聽情報共用同一計數。買賣的每日六次仍由 City 獨立計算。

---

## 3. 公開 Query

```ts
interface SocialQuery {
  getPlayerAffinity(adventurerId: CharacterId): number | undefined;
  getPlayerConversationUsage(playerCharacterId: CharacterId, worldDay: WorldDay): PlayerConversationUsageView;
  getPlayerProposalAffinityResult(adventurerId: CharacterId): PlayerProposalAffinityResult;
  getHomeTutorPriceModifier(adventurerId: CharacterId): number;
}

type PlayerProposalAffinityResult = {
  acceptedByAffinity: boolean;
  ruleId: PlayerAffinityRuleId;
};

type PlayerConversationUsageView = {
  playerCharacterId: CharacterId;
  worldDay: WorldDay;
  completedCount: number;
  remainingCount: number;
};
```

`SocialQuery` 只回答玩家中心數值。它不宣稱兩名 NPC 彼此有多少好感，也不判斷 Team Membership、性別、年齡、婚姻或家教 Post 是否可建立；那些硬條件仍由對應 Workflow 查 Team／Character／City。

---

## 4. 輸入契約

### 4.1 玩家 Game Command

| Command | 前置條件 | 結果 |
|---|---|---|
| `interactWithAdventurer` | 發話者是目前玩家主角；目標是非玩家真實冒險者，且要嘛是同隊正式成員、要嘛是同城酒館可見冒險者；沒有阻塞型 Pending／active Combat；當日對話未滿 6 次。 | 零時間完成一次交流、計數 +1、依資料調整目標對玩家的好感度，發出一次玩家交流成長來源。 |
| `proposeMarriageToTeamMember` | 目標是玩家隊成年、存活、未婚、異性的正式成員；玩家也未婚；沒有阻塞型 Pending／active Combat。 | 交給 Marriage Workflow 重驗資格與好感；接受時建立 Partner FamilyLink，拒絕時不改 State。求婚本身不消耗世界時間或每日對話次數。 |

同隊正式成員不需要位於酒館，角色互動畫面隨時提供交流選項；「隨時」表示不要求城市設施與不消耗世界時間，不表示可以越過戰鬥、強制 Pending、死亡或不可用狀態的全域輸入鎖。

### 4.2 Internal Command

| Internal Command | 發送者 | Social 的反應 |
|---|---|---|
| `ProvisionPlayerAffinity` | new-game／character-provisioning／adulthood workflow | 對新建立或剛取得冒險者身分的非玩家真實冒險者依 Rule 建立唯一初始值；重送必須冪等。 |
| `ConsumePlayerConversationAllowance` | City Intel Workflow | 驗證玩家主角與當日上限，計數 +1 並發出 `PlayerConversationCompleted(kind=intel)`；City 的情報揭露失敗時整筆交易回滾。 |

`ResolveNpcMarriageProposal` 是 Adventurer Lifecycle 送往 Marriage Workflow 的跨模組 Internal Command，不由 Social Handler 處理。它和玩家 Game Command `proposeMarriageToTeamMember` 都由 Marriage Workflow 擁有，因為兩者需要同時讀 Social／Team／Character／Combat Power，最後要求 Character 建立 FamilyLink；Social 不直接寫婚姻。

---

## 5. 輸出事件

| Event | 最少 payload | 訂閱者 |
|---|---|---|
| `PlayerConversationCompleted` | `interactionId`、`playerCharacterId`、`targetCharacterId?`、`kind: partyChat \| tavernChat \| intel`、`worldDay`、`experienceAwardRuleId`、`affinityDelta` | progression、ui/app。 |
| `PlayerAffinityChanged` | `adventurerId`、`oldValue?`、`newValue`、`sourceId`、`reason: provisioned \| conversation` | economy、ui/app。 |

Progression 只依 `PlayerConversationCompleted` 發放交流 MXP；`PlayerAffinityChanged` 不額外給成長。Economy 只用後者使含家教好感修正的舊 Quote 失效，不保存好感度副本。

---

## 6. 婚姻 Workflow

### 6.1 玩家求婚

```text
角色互動 Projection
  → 目標是玩家隊正式成員、成年、存活、未婚、與玩家主角異性
  → 顯示「求婚」選項
  → proposeMarriageToTeamMember
  → Team／Character 重驗硬條件
  → Social 以目標對玩家好感度做 deterministic 接受判定
  → 接受：CreatePartnerFamilyLink(required)
  → 拒絕：不改 FamilyLink、不消耗世界時間、不重骰
```

伴侶只能由玩家對符合條件的異性正式隊友求婚取得；酒館人物、其他隊伍成員、任務暫時角色與已婚角色都不顯示選項。隊友身分只在求婚當下是硬條件；建立伴侶關係本身不改 Team、資產或工作狀態。

### 6.2 NPC 彼此求婚

```text
非玩家冒險者在 cityFree 抽到 proposeToTeammate
  → 候選只含同隊、成年、未婚、異性、非玩家主角的正式成員
  → 固定一名目標
  → sharedTeamDays = currentDay - max(雙方 memberJoinedOnDay)
  → 讀雙方 Combat Power，建立戰力接近輸入
  → NpcMarriageRule 做一次 RNG 判定
  → 成功：CreatePartnerFamilyLink(required)
  → 失敗／目標已失效：本次自由行動結束
```

玩家隊友可以和另一名非玩家隊友走此流程，但任何涉及玩家主角的婚姻都只能走玩家求婚與真實好感度。若同日多筆提案競爭同一角色，Scheduler 依既有穩定 Job 順序處理；第一筆成功後，後續命令因目標已婚而拒絕，不建立訂婚或暫存鎖。

---

## 7. 不變量與驗收

1. 每名非玩家真實冒險者至多一筆 `PlayerAffinityState`；不得存在 NPC→NPC 好感資料。
2. 好感度永遠夾在 Rule 的 min／max，且同一 Interaction ID 最多套用一次。
3. 玩家對話每日總完成數最多 6；隊友、酒館與情報共用，交易不共用；Social State 最多保存一筆當日用量。
4. 被拒絕、回滾或未提交的互動不消耗次數、不改好感、不發 MXP。
5. 玩家求婚不用 RNG；NPC 求婚不用好感度。
6. 任何婚姻成功都只能透過 Character 的 `CreatePartnerFamilyLink`，每名角色同時最多一名 active partner。
7. NPC 共隊天數由既有 Team Membership 起日推導，不建立 pairwise 相處天數 State。
8. NPC 戰力接近程度只讀同一 Combat Power Service 結果，不另建婚姻戰力公式。
9. 快轉與逐日處理必須得到相同的 NPC 提案候選、RNG 與婚姻結果。
10. 世界生成、後續人口補充與子女成年成為非玩家冒險者時都必須完成 Affinity Provisioning；任務暫時角色與背景居民不得誤建。

---

## 8. 交接清單

- [ ] Social State、Affinity／Conversation／NPC Marriage JSON Schema。
- [ ] Social Query、玩家交流 Command 與情報額度 Internal Command。
- [ ] 玩家／NPC Marriage Workflow 與 Character FamilyLink 契約測試。
- [ ] 新遊戲與後續冒險者生成時的 Affinity Provisioning。
- [ ] 每日六次共用對話、零時間拒絕不重骰、家教 Quote 失效測試。
