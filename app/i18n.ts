// app/i18n.ts
// UI 自己的介面文字（按鈕、標題、狀態標籤）。
//
// ── 為什麼跟內容文字分開 ────────────────────────────────────────────────────
//
// 兩者的**擁有者**不同，所以不能住在一起：
//   * 內容文字（城市名、設施名、據點名）屬 Content Pack——換一份 Pack 就該換一批名字，
//     由 `content/locale/**` 提供，經 LocalizationCatalog 解析。
//   * 介面文字（「推進時間」「回主城」）屬 UI——換 Content Pack 不會改變它們。
//
// 但**語系維度是共用的**：兩邊必須支援同一組語系，否則切到英文時畫面會一半中文一半英文。
// 這個約束由 `assertLocaleParity()` 在啟動時檢查（見 game-facade.ts），漂移就明確失敗。
//
// 形狀刻意與內容側的 `LocalizedName` 一致：每個 key 都必須寫出全部語系，漏一個是編譯錯誤。

export const UI_LOCALES = ['zh-Hant', 'en'] as const;
export type UiLocale = (typeof UI_LOCALES)[number];

export type UiText = Readonly<Record<UiLocale, string>>;

// `satisfies` 而非型別標註：保留每個 key 的字面型別（讓 `UiTextKey` 是精確聯集），
// 同時仍然強制每筆都寫滿所有語系。
export const UI_TEXT = {
  'ui.app.title': { 'zh-Hant': '問候冒險者', en: 'Greeting Adventurer' },
  'ui.app.subtitle': {
    'zh-Hant': '資料驅動引擎 · 真實內容包',
    en: 'Data-driven engine on real content packs',
  },
  'ui.locale.label': { 'zh-Hant': '語言', en: 'Language' },

  'ui.status.worldDay': { 'zh-Hant': '世界日', en: 'World day' },
  'ui.status.day': { 'zh-Hant': '第 {day} 日', en: 'Day {day}' },
  'ui.status.location': { 'zh-Hant': '所在地', en: 'Location' },
  'ui.status.health': { 'zh-Hant': '生命 / 魔力', en: 'HP / MP' },
  'ui.status.party': { 'zh-Hant': '隊伍人數', en: 'Party size' },
  'ui.status.busy': { 'zh-Hant': '行程', en: 'Activity' },
  'ui.status.free': { 'zh-Hant': '可自由行動', en: 'Free to act' },
  'ui.status.travelling': { 'zh-Hant': '旅行中', en: 'Travelling' },

  'ui.screen.city': { 'zh-Hant': '主城', en: 'City' },
  'ui.screen.worldMap': { 'zh-Hant': '世界地圖', en: 'World map' },
  'ui.screen.adventure': { 'zh-Hant': '選擇冒險地', en: 'Choose a site' },
  'ui.screen.shop': { 'zh-Hant': '商店', en: 'Shop' },
  'ui.action.shop': { 'zh-Hant': '買賣', en: 'Trade' },
  'ui.shop.balance': { 'zh-Hant': '持有金錢', en: 'Money' },
  'ui.shop.buy': { 'zh-Hant': '購買', en: 'Buy' },
  'ui.shop.tooExpensive': { 'zh-Hant': '買不起', en: 'Too expensive' },
  'ui.shop.empty': { 'zh-Hant': '貨架上目前沒有東西。', en: 'The shelves are empty.' },
  'ui.log.bought': { 'zh-Hant': '買下了 {item}（付 {price}）。', en: 'Bought {item} for {price}.' },

  'ui.screen.home': { 'zh-Hant': '家', en: 'Home' },
  'ui.action.home': { 'zh-Hant': '進門', en: 'Go inside' },
  'ui.home.notOwned': {
    'zh-Hant': '你在這座城市還沒有房子。',
    en: 'You do not own a house in this city yet.',
  },
  'ui.home.buy': { 'zh-Hant': '買下', en: 'Buy' },
  'ui.home.slots': { 'zh-Hant': '{n} 格', en: '{n} slots' },
  'ui.home.owned': { 'zh-Hant': '你的房子', en: 'Your house' },
  'ui.home.capacity': { 'zh-Hant': '格數', en: 'Capacity' },
  'ui.home.used': { 'zh-Hant': '{used} / {total} 格已用', en: '{used} / {total} slots used' },
  'ui.home.upgrades': { 'zh-Hant': '已建', en: 'Built' },
  'ui.home.noUpgradeAvailable': {
    'zh-Hant': '這份內容包沒有授權可加建的房間。',
    en: 'This content pack authors no further rooms to build.',
  },
  'ui.log.homeBought': {
    'zh-Hant': '在{place}買下了一間 {slots} 格的房子（付 {price}）。',
    en: 'Bought a {slots}-slot house at {place} for {price}.',
  },

  'ui.screen.training': { 'zh-Hant': '訓練', en: 'Training' },
  'ui.action.train': { 'zh-Hant': '鍛鍊', en: 'Train' },
  'ui.training.intro': {
    'zh-Hant': '選一項熟練度鍛鍊 {days} 日。期間世界照常運轉。',
    en: 'Pick one mastery to train for {days} days. The world keeps turning meanwhile.',
  },
  'ui.training.level': { 'zh-Hant': 'Lv.{n}', en: 'Lv.{n}' },
  'ui.training.exp': { 'zh-Hant': '{n} MXP', en: '{n} MXP' },
  'ui.training.here': { 'zh-Hant': '這裡也可以鍛鍊', en: 'You can also train here' },
  'ui.log.freePeriodBegan': {
    'zh-Hant': '開始城鎮自由活動。',
    en: 'Started free time in the city.',
  },
  'ui.log.trainingStarted': {
    'zh-Hant': '開始鍛鍊 {mastery}（{days} 日）。',
    en: 'Started training {mastery} for {days} days.',
  },

  'ui.screen.tavern': { 'zh-Hant': '酒館', en: 'Tavern' },
  'ui.action.tavern': { 'zh-Hant': '進去看看', en: 'Look inside' },
  'ui.tavern.intro': {
    'zh-Hant': '這裡的冒險者可以邀請入隊。成功與否由對方決定。',
    en: 'Adventurers here can be invited. Whether they accept is up to them.',
  },
  'ui.tavern.empty': { 'zh-Hant': '今天酒館裡沒有人。', en: 'Nobody is at the tavern today.' },
  'ui.tavern.recruit': { 'zh-Hant': '邀請入隊', en: 'Invite' },
  'ui.tavern.teamFull': { 'zh-Hant': '隊伍已滿', en: 'Party is full' },
  'ui.tavern.who': { 'zh-Hant': '{sex} · {age} 歲', en: '{sex} · {age}' },
  'ui.sex.female': { 'zh-Hant': '女', en: 'F' },
  'ui.sex.male': { 'zh-Hant': '男', en: 'M' },
  'ui.log.recruitSucceeded': {
    'zh-Hant': '{who} 加入了隊伍。',
    en: '{who} joined the party.',
  },
  'ui.log.recruitFailed': {
    'zh-Hant': '{who} 婉拒了邀請。',
    en: '{who} turned down the invitation.',
  },

  'ui.screen.guild': { 'zh-Hant': '冒險者公會', en: 'Adventurers’ Guild' },
  'ui.action.guild': { 'zh-Hant': '看委託板', en: 'Check the board' },
  'ui.guild.board': { 'zh-Hant': '委託板', en: 'Available' },
  'ui.guild.accepted': { 'zh-Hant': '進行中', en: 'In progress' },
  'ui.guild.empty': { 'zh-Hant': '板上現在沒有委託。', en: 'The board is empty right now.' },
  'ui.guild.accept': { 'zh-Hant': '接下', en: 'Accept' },
  'ui.guild.deadline': { 'zh-Hant': '第 {day} 日前接取', en: 'Accept by day {day}' },
  'ui.guild.endBy': { 'zh-Hant': '第 {day} 日前完成', en: 'Finish by day {day}' },
  'ui.guild.targets': { 'zh-Hant': '目標 {n}', en: '{n} target(s)' },
  'ui.quest.kind.suppression': { 'zh-Hant': '肅清', en: 'Suppression' },
  'ui.quest.kind.hunt': { 'zh-Hant': '狩獵', en: 'Hunt' },
  'ui.quest.kind.rescue': { 'zh-Hant': '救援', en: 'Rescue' },
  'ui.quest.kind.purchase': { 'zh-Hant': '採買', en: 'Purchase' },
  'ui.quest.kind.delivery': { 'zh-Hant': '運送', en: 'Delivery' },
  'ui.quest.kind.escort': { 'zh-Hant': '護衛', en: 'Escort' },
  'ui.quest.kind.exploration': { 'zh-Hant': '探索', en: 'Exploration' },
  'ui.log.questAccepted': { 'zh-Hant': '接下了委託：{quest}。', en: 'Accepted the {quest} quest.' },

  'ui.action.back': { 'zh-Hant': '← 回主城', en: '← Back to city' },
  'ui.action.rest': { 'zh-Hant': '休息', en: 'Rest' },
  'ui.action.leaveCity': { 'zh-Hant': '出城', en: 'Leave city' },
  'ui.action.goAdventure': { 'zh-Hant': '去冒險', en: 'Go adventuring' },
  'ui.action.travelHere': { 'zh-Hant': '前往', en: 'Travel here' },
  'ui.action.descend': { 'zh-Hant': '下圖', en: 'Enter map' },

  'ui.worldMap.chooseMode': { 'zh-Hant': '選擇行進方式', en: 'Choose travel speed' },
  'ui.worldMap.days': { 'zh-Hant': '{days} 日', en: '{days} days' },
  'ui.worldMap.neighbours': { 'zh-Hant': '鄰近城市', en: 'Adjacent cities' },
  'ui.worldMap.current': { 'zh-Hant': '目前所在', en: 'You are here' },
  'ui.worldMap.capital': { 'zh-Hant': '首都', en: 'Capital' },

  'ui.adventure.national': { 'zh-Hant': '國家迷宮', en: 'National dungeon' },
  'ui.adventure.none': { 'zh-Hant': '這座城市沒有冒險地。', en: 'No adventure sites near this city.' },

  'ui.dungeon.title': { 'zh-Hant': '地城探索', en: 'Dungeon' },
  'ui.dungeon.currentRoom': { 'zh-Hant': '目前房間', en: 'Current room' },
  'ui.dungeon.elapsed': { 'zh-Hant': '已耗時', en: 'Time spent' },
  'ui.dungeon.minutes': { 'zh-Hant': '{n} 分', en: '{n} min' },
  'ui.dungeon.explored': { 'zh-Hant': '已探索', en: 'Explored' },
  'ui.dungeon.rooms': { 'zh-Hant': '{a} / {b} 間', en: '{a} / {b} rooms' },
  'ui.dungeon.exits': { 'zh-Hant': '通往', en: 'Exits' },
  'ui.dungeon.roomContents': { 'zh-Hant': '這個房間', en: 'In this room' },
  'ui.dungeon.roomEmpty': { 'zh-Hant': '空無一物。', en: 'Nothing here.' },
  'ui.dungeon.remaining': { 'zh-Hant': '本圖剩餘內容', en: 'Remaining on this map' },
  'ui.dungeon.count': { 'zh-Hant': '{n} 筆', en: '{n}' },
  'ui.dungeon.kind.monsterGroup': { 'zh-Hant': '怪群', en: 'Monsters' },
  'ui.dungeon.kind.boss': { 'zh-Hant': 'Boss', en: 'Boss' },
  'ui.dungeon.kind.chest': { 'zh-Hant': '寶箱', en: 'Chest' },
  'ui.dungeon.kind.mapEvent': { 'zh-Hant': '事件', en: 'Event' },
  'ui.dungeon.kind.other': { 'zh-Hant': '內容', en: 'Content' },
  'ui.dungeon.combatPending': {
    'zh-Hant': '戰鬥尚未接進畫面（P1 敵方 AI／P2 命中判定）',
    en: 'Combat is not wired into the UI yet (P1 enemy AI / P2 hit resolution)',
  },
  'ui.dungeon.enter': { 'zh-Hant': '進入探索', en: 'Begin exploring' },
  'ui.dungeon.notStarted': {
    'zh-Hant': '隊伍已在冒險地，尚未進入探索。',
    en: 'The party is at the site but has not started exploring.',
  },
  'ui.dungeon.redDoorClosed': { 'zh-Hant': '紅門（關）', en: 'Red door (closed)' },
  'ui.dungeon.redDoorOpen': { 'zh-Hant': '紅門（開）', en: 'Red door (open)' },
  'ui.dungeon.passage': { 'zh-Hant': '通道', en: 'Passage' },
  'ui.dungeon.openDoor': { 'zh-Hant': '開門', en: 'Open door' },
  'ui.dungeon.unexplored': { 'zh-Hant': '未探索', en: 'Unexplored' },
  'ui.dungeon.atExit': { 'zh-Hant': '這裡是出口。', en: 'This is an exit.' },
  'ui.dungeon.leave': { 'zh-Hant': '離開地城 → 返城', en: 'Leave dungeon → return to city' },
  'ui.log.exploreStarted': { 'zh-Hant': '進入 {place}。', en: 'Entered {place}.' },
  'ui.log.moved': { 'zh-Hant': '移動到 {place}。', en: 'Moved to {place}.' },
  'ui.log.doorOpened': { 'zh-Hant': '打開了紅門。', en: 'Opened the red door.' },
  'ui.log.leftDungeon': { 'zh-Hant': '離開地城，返回城市。', en: 'Left the dungeon, heading back.' },
  'ui.log.enteredSite': { 'zh-Hant': '啟程前往 {place}。', en: 'Set out for {place}.' },

  'ui.facility.unavailable': { 'zh-Hant': '尚未開放', en: 'Not yet available' },

  // 擋住某個能力的工作包。包編號（P3/P7/P8）兩語系相同，括號裡的說明要翻。
  'ui.blocked.adventureMap': {
    'zh-Hant': 'P3 DungeonMapPort ＋ P4 map context',
    en: 'P3 DungeonMapPort + P4 map context',
  },
  'ui.blocked.shop': { 'zh-Hant': 'P8 city（商店）', en: 'P8 city (shops)' },
  'ui.blocked.quest': { 'zh-Hant': 'P8 city（委託板生成）', en: 'P8 city (quest board)' },
  'ui.blocked.tavern': { 'zh-Hant': 'P7 social ＋ P8 city', en: 'P7 social + P8 city' },
  'ui.blocked.training': { 'zh-Hant': 'P8 city（訓練行動）', en: 'P8 city (training)' },
  'ui.blocked.home': { 'zh-Hant': 'P8 city（家園）', en: 'P8 city (home)' },
  'ui.blocked.mapContent': {
    'zh-Hant': 'P4 地圖內容（候選池尚未授權）',
    en: 'P4 map content (candidate pools not authored)',
  },
  'ui.facility.unavailableHint': {
    'zh-Hant': '此設施的模組尚未接線，因此不提供操作（不是壞掉，是還沒做）。',
    en: 'This facility’s module is not wired yet, so no action is offered.',
  },

  'ui.log.newGame': { 'zh-Hant': '新遊戲已開始。', en: 'New game started.' },
  'ui.log.rejected': { 'zh-Hant': '被拒：{code}', en: 'Rejected: {code}' },
  'ui.log.arrived': { 'zh-Hant': '抵達 {place}。', en: 'Arrived at {place}.' },
  // 世界自己走過的日子。玩家看到的是「過了幾天」，不是「我按了幾次推進」。
  'ui.log.daysPassed': { 'zh-Hant': '（過了 {days} 日，來到第 {day} 日）', en: '({days} days pass — now day {day})' },
  'ui.log.oneDayPassed': { 'zh-Hant': '（過了 1 日，來到第 {day} 日）', en: '(a day passes — now day {day})' },
  'ui.log.settleBlocked': { 'zh-Hant': '世界結算中止：{code}', en: 'World settling halted: {code}' },
  'ui.log.travelStarted': { 'zh-Hant': '啟程前往 {place}。', en: 'Departed for {place}.' },
  'ui.log.rested': { 'zh-Hant': '在{place}休息。', en: 'Rested at {place}.' },
  'ui.log.actionRejected': { 'zh-Hant': '{action} 被拒：{code}', en: '{action} rejected: {code}' },
  'ui.log.jobBlocked': { 'zh-Hant': '無法推進：{code}', en: 'Cannot advance: {code}' },

  'ui.error.cannotStart': { 'zh-Hant': '無法開始遊戲。', en: 'Cannot start the game.' },
  'ui.error.missingText': { 'zh-Hant': '（缺文字：{key}）', en: '(missing text: {key})' },
} satisfies Readonly<Record<string, UiText>>;

export type UiTextKey = keyof typeof UI_TEXT;

// 具名佔位符替換，與內容側 `interpolate` 同一個規則：只做字面替換，沒有運算。
// 缺參數時保留佔位符——那是缺參數的證據，不該被抹平。
export function t(
  locale: UiLocale,
  key: UiTextKey,
  params?: Readonly<Record<string, string | number>>,
): string {
  const template = UI_TEXT[key][locale];
  if (params === undefined) return template;
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}
