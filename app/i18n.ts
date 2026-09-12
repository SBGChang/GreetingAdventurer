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
  'ui.menu.saveFormation': { 'zh-Hant': '儲存隊形', en: 'Save formation' },
  'ui.menu.expired': { 'zh-Hant': '已過期', en: 'Expired' },
  'ui.menu.incomplete': { 'zh-Hant': '進行中', en: 'In progress' },
  'ui.atlas.title': { 'zh-Hant': '四方輿圖', en: 'Atlas of the Four Realms' },
  'ui.atlas.reset': { 'zh-Hant': '回到所在地', en: 'My location' },
  'ui.atlas.overview': { 'zh-Hant': '全圖總覽', en: 'World overview' },
  'ui.atlas.capital': { 'zh-Hant': '主堡', en: 'Capital' },
  'ui.atlas.town': { 'zh-Hant': '小城', en: 'Town' },
  'ui.atlas.inspect': { 'zh-Hant': '查看城池模型', en: 'Inspect city' },
  'ui.atlas.back': { 'zh-Hant': '返回大地圖', en: 'Back to atlas' },
  'ui.atlas.ferry': { 'zh-Hant': '渡湖線 · 沿岸道路接乘船航段', en: 'Lake crossing · shore roads and ferry' },
  'ui.atlas.direct': { 'zh-Hant': '可直達', en: 'Direct routes' },
  'ui.atlas.unavailable': { 'zh-Hant': '此城沒有直達路線，請先前往相鄰城市。', en: 'No direct route. Travel through a neighbouring city first.' },
  'ui.atlas.help': { 'zh-Hant': '拖曳巡覽 · 滾輪縮放 · 右鍵旋轉。點選城名聚焦附近；全圖總覽查看十六城與內陸大湖。實線為陸路，湖面虛線為渡湖航路。', en: 'Drag to pan · scroll to zoom · right-drag to orbit. Select a city to focus nearby; overview shows sixteen cities and the inland lake. Solid lines are roads; dashed lake lines are ferry crossings.' },
  'ui.menu.open': { 'zh-Hant': '行囊選單', en: 'Player menu' },
  'ui.menu.equipment': { 'zh-Hant': '裝備', en: 'Equipment' },
  'ui.menu.formation': { 'zh-Hant': '隊形配置', en: 'Formation' },
  'ui.menu.quests': { 'zh-Hant': '委託狀態', en: 'Quests' },
  'ui.menu.items': { 'zh-Hant': '道具', en: 'Items' },
  'ui.menu.formationHint': { 'zh-Hant': '先選隊員，再點格位；占用格會交換站位。', en: 'Select a member, then a cell. Occupied cells swap members.' },
  'ui.menu.member': { 'zh-Hant': '隊員 {n}', en: 'Member {n}' },
  'ui.menu.formationSaved': { 'zh-Hant': '隊形已儲存', en: 'Formation saved' },
  'ui.menu.noQuests': { 'zh-Hant': '尚未接取委託，請前往冒險者公會。', en: 'No accepted quests. Visit an adventurers guild.' },
  'ui.menu.itemsHint': { 'zh-Hant': '背包內容；道具使用與書籍學習尚未開放。', en: 'Inventory contents. Item use and book learning are not available yet.' },
  'ui.menu.emptyCell': { 'zh-Hant': '空位', en: 'Empty' },
  'ui.menu.front': { 'zh-Hant': '上方為前排 · 面向敵方', en: 'Top row faces enemies' },
  'ui.scene.modelLoading': { 'zh-Hant': '正在載入城池…', en: 'Loading the town…' },
  'ui.scene.modelError': { 'zh-Hant': '3D 城池載入失敗。可以重試，或使用左側設施頁簽繼續遊戲。', en: 'The 3D town could not load. Retry or continue using the facility tabs.' },
  'ui.scene.modelRetry': { 'zh-Hant': '重新載入城池', en: 'Retry town loading' },
  'ui.scene.buildings': { 'zh-Hant': '城內設施', en: 'Town facilities' },
  'ui.scene.hoverHint': { 'zh-Hant': '移至頁簽或建築查看位置，點選即可前往。', en: 'Hover a tab or building to locate it. Click to visit.' },
  'ui.scene.backToMap': { 'zh-Hant': '← 返回探索', en: '← Back to exploration' },
  'ui.scene.mapControls': { 'zh-Hant': '點選相鄰房間 · Esc 返回探索', en: 'Select an adjacent room · Esc returns to exploration' },
  'ui.scene.controls': { 'zh-Hant': '點選場景地標 · Esc 返回城鎮', en: 'Select a landmark · Esc returns to town' },
  'ui.scene.inAction': { 'zh-Hant': '冒險進行中', en: 'Adventure in progress' },
  'ui.scene.townHint': { 'zh-Hant': '炊煙升起，渡船入港。今天的旅程從這裡開始。', en: 'Smoke rises. Boats arrive. Your next journey begins here.' },
  'ui.scene.enter': { 'zh-Hant': '前往', en: 'Visit' },

  'ui.combat.victory': { 'zh-Hant': '戰鬥勝利！可以繼續探索，或找出口帶回戰利品。', en: 'Victory! Continue exploring or find the exit to collect your spoils.' },
  'ui.sheet.body': { 'zh-Hant': '身體', en: 'Body' },
  'ui.sheet.inventory': { 'zh-Hant': '背包與重量', en: 'Inventory and weight' },
  'ui.shop.sell': { 'zh-Hant': '出售背包物品', en: 'Sell items from your bag' },
  'ui.log.sold': { 'zh-Hant': '出售 {item}，獲得 {price}。', en: 'Sold {item} for {price}.' },
  'ui.sheet.slotsFull': { 'zh-Hant': '三個招式欄已滿。先點選武器組中的招式移除，再配置新招式。', en: 'All three slots are full. Remove a skill from the weapon set first.' },
  'ui.combat.noCost': { 'zh-Hant': '無資源消耗', en: 'No resource cost' },
  'ui.play.journal': { 'zh-Hant': '旅程紀錄', en: 'Journey journal' },
  'ui.combat.member': { 'zh-Hant': '隊員 {n}', en: 'Companion {n}' },
  'ui.play.ended': { 'zh-Hant': '旅程在此落幕', en: 'Your journey has ended' },
  'ui.play.endedHint': { 'zh-Hant': '隊長已無法繼續冒險。你可以建立新的旅程；舊存檔會保留到你確認開局。', en: 'Your leader can no longer adventure. Start a new journey; your save is kept until you confirm.' },
  'ui.direction.up': { 'zh-Hant': '上樓 ↑', en: 'Upstairs ↑' },
  'ui.direction.down': { 'zh-Hant': '下樓 ↓', en: 'Downstairs ↓' },
  'ui.play.sex': { 'zh-Hant': '角色性別', en: 'Character sex' },
  "ui.play.continue": {"zh-Hant": "繼續旅程", "en": "Continue journey"},
  "ui.play.begin": {"zh-Hant": "踏上旅程", "en": "Begin journey"},
  "ui.play.tagline": {"zh-Hant": "一封委託，一段旅程。你的冒險，從雲京開始。", "en": "A commission. A journey. Your adventure begins in Yunjing."},
  "ui.play.seed": {"zh-Hant": "世界種子", "en": "World seed"},
  "ui.play.new": {"zh-Hant": "建立新旅程", "en": "Create a new journey"},
  "ui.play.guide": {"zh-Hant": "冒險指南", "en": "Field guide"},
  "ui.play.step1": {"zh-Hant": "整備｜在裝備店買環首短刀與防具，到人物頁裝備並配置「引環斬」。", "en": "Prepare · Buy equipment and assign skills on your character sheet."},
  "ui.play.step2": {"zh-Hant": "接案｜公會委託標示目標據點。整備好再出發。", "en": "Choose · Guild commissions tell you where to find your targets."},
  "ui.play.step3": {"zh-Hant": "探索｜開門、調查與戰鬥，從出口帶回戰利品。", "en": "Explore · Open doors, investigate, fight, and carry your spoils to the exit."},
  "ui.play.step4": {"zh-Hant": "成長｜回原公會領獎、休息恢復，或訓練新的熟練度。", "en": "Grow · Claim rewards at the original guild, recover, and train."},
  "ui.play.ready": {"zh-Hant": "準備下一段冒險", "en": "Your next adventure awaits"},
  "ui.play.recover": {"zh-Hant": "休息後再出發", "en": "Recover before setting out"},
  "ui.play.gold": {"zh-Hant": "旅費", "en": "Coins"},
  "ui.play.explore": {"zh-Hant": "探索", "en": "Explore"},
  "ui.play.guild": {"zh-Hant": "委託", "en": "Commissions"},
  "ui.play.party": {"zh-Hant": "人物與裝備", "en": "Character & equipment"},
  "ui.play.saveMenu": {"zh-Hant": "進度管理", "en": "Manage saves"},
  "ui.play.home": {"zh-Hant": "城鎮", "en": "Town"},
  "ui.play.health": {"zh-Hant": "生命", "en": "Health"},
  "ui.play.mana": {"zh-Hant": "魔力", "en": "Mana"},
  "ui.loot.title": {"zh-Hant": "戰利品分配", "en": "Divide the spoils"},
  "ui.loot.hint": {"zh-Hant": "出價保留物品，或放棄讓隊友競得。無人出價時出售，收益按參與者均分。", "en": "Bid to keep the item, or pass. Unclaimed items are sold and proceeds shared equally."},
  "ui.loot.bid": {"zh-Hant": "出價並結算", "en": "Bid & resolve"},
  "ui.loot.pass": {"zh-Hant": "放棄並結算", "en": "Pass & resolve"},
  "ui.loot.minimum": {"zh-Hant": "底價", "en": "Minimum"},
  "ui.loot.highest": {"zh-Hant": "目前出價", "en": "Current bid"},
  "ui.loot.remaining": {"zh-Hant": "待分配", "en": "Remaining"},
  "ui.quest.settle": {"zh-Hant": "領取報酬", "en": "Claim reward"},
  "ui.quest.settled": {"zh-Hant": "已結案", "en": "Settled"},
  "ui.quest.reward": {"zh-Hant": "報酬", "en": "Reward"},
  "ui.quest.progress": {"zh-Hant": "目標進度", "en": "Progress"},
  "ui.log.questSettled": {"zh-Hant": "公會已結案，報酬與熟練度已發放。", "en": "Commission settled. Coins and mastery experience awarded."},
  "ui.log.lootResolved": {"zh-Hant": "戰利品分配完成。", "en": "Loot round resolved."},
  'ui.save.now': { 'zh-Hant': '儲存進度', en: 'Save game' },
  'ui.save.export': { 'zh-Hant': '匯出存檔', en: 'Export save' },
  'ui.save.import': { 'zh-Hant': '匯入存檔', en: 'Import save' },
  'ui.save.confirmImport': { 'zh-Hant': '存檔驗證通過。要載入並取代目前進度嗎？', en: 'Save validated. Load it and replace current progress?' },
  'ui.save.saved': { 'zh-Hant': '進度已儲存', en: 'Progress saved' },
  'ui.save.failed': { 'zh-Hant': '儲存失敗，請勿關閉遊戲：', en: 'Save failed. Keep the game open:' },
  'ui.save.backup': { 'zh-Hant': '還原上一份備份', en: 'Restore backup' },
  'ui.save.new': { 'zh-Hant': '開始新遊戲', en: 'New game' },
  'ui.save.confirmNew': { 'zh-Hant': '要開始新遊戲並取代目前存檔嗎？目前存檔將保留為上一份備份。', en: 'Start a new game and replace the current save? The current save will be kept as a backup.' },
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

  // ── 戰鬥 ──────────────────────────────────────────────────────────────
  'ui.screen.combat': { 'zh-Hant': '戰鬥', en: 'Combat' },
  'ui.combat.yourTurn': { 'zh-Hant': '輪到你行動', en: 'Your turn' },
  'ui.combat.pickAction': { 'zh-Hant': '選一個行動', en: 'Choose an action' },
  'ui.combat.pickTarget': { 'zh-Hant': '選一個目標', en: 'Choose a target' },
  'ui.combat.rest': { 'zh-Hant': '休息（回復並讓過）', en: 'Rest (recover and pass)' },
  'ui.combat.noAction': {
    'zh-Hant': '這個武器組沒有配招——先到人物頁配置招式。',
    en: 'No skills on this weapon set — configure them on the character sheet.',
  },
  'ui.combat.order': { 'zh-Hant': '出手順序', en: 'Turn order' },
  'ui.combat.ally': { 'zh-Hant': '我方', en: 'Party' },
  'ui.combat.foe': { 'zh-Hant': '敵方', en: 'Enemies' },
  'ui.combat.row': { 'zh-Hant': '第 {n} 排', en: 'Row {n}' },
  'ui.combat.ctb': { 'zh-Hant': 'CTB {n}', en: 'CTB {n}' },
  'ui.combat.dead': { 'zh-Hant': '已倒下', en: 'Down' },
  'ui.combat.won': { 'zh-Hant': '戰鬥結束。', en: 'The fight is over.' },
  'ui.log.combatStarted': { 'zh-Hant': '遭遇 {who}！', en: 'Encountered {who}!' },
  'ui.log.usedSkill': { 'zh-Hant': '使用了 {skill}。', en: 'Used {skill}.' },
  'ui.log.combatRested': { 'zh-Hant': '調息了一下。', en: 'Caught your breath.' },
  'ui.log.combatEnded': { 'zh-Hant': '戰鬥結束（{state}）。', en: 'Combat ended ({state}).' },

  // ── 地牢小地圖 ────────────────────────────────────────────────────────
  'ui.dungeon.map': { 'zh-Hant': '地圖', en: 'Map' },
  'ui.dungeon.floor': { 'zh-Hant': '第 {n} 層', en: 'Floor {n}' },
  'ui.dir.north': { 'zh-Hant': '北', en: 'N' },
  'ui.dir.south': { 'zh-Hant': '南', en: 'S' },
  'ui.dir.west': { 'zh-Hant': '西', en: 'W' },
  'ui.dir.east': { 'zh-Hant': '東', en: 'E' },
  'ui.dungeon.locked': { 'zh-Hant': '（紅門）', en: '(door)' },
  'ui.dungeon.fight': { 'zh-Hant': '交戰', en: 'Fight' },
  'ui.dungeon.open': { 'zh-Hant': '開啟', en: 'Open' },

  // ── 人物頁 ────────────────────────────────────────────────────────────
  'ui.screen.sheet': { 'zh-Hant': '人物', en: 'Character' },
  'ui.action.sheet': { 'zh-Hant': '人物', en: 'Character' },
  'ui.sheet.attributes': { 'zh-Hant': '主屬性', en: 'Attributes' },
  'ui.sheet.attributesNote': {
    'zh-Hant': '主屬性由熟練度推導，不能直接加點。',
    en: 'Attributes are derived from masteries; they cannot be assigned directly.',
  },
  'ui.sheet.armor': { 'zh-Hant': '防具', en: 'Armor' },
  'ui.sheet.weaponSets': { 'zh-Hant': '武器組', en: 'Weapon sets' },
  'ui.sheet.weaponSet': { 'zh-Hant': '第 {n} 組', en: 'Set {n}' },
  'ui.sheet.mainHand': { 'zh-Hant': '主手', en: 'Main hand' },
  'ui.sheet.offHand': { 'zh-Hant': '副手', en: 'Off hand' },
  'ui.sheet.skillSlot': { 'zh-Hant': '招式 {n}', en: 'Skill {n}' },
  'ui.sheet.empty': { 'zh-Hant': '空', en: 'Empty' },
  'ui.sheet.skills': { 'zh-Hant': '已學招式', en: 'Known skills' },
  'ui.sheet.skillsEmpty': {
    'zh-Hant': '還沒有學會任何招式。',
    en: 'No skills learned yet.',
  },
  'ui.sheet.assigned': { 'zh-Hant': '已配置', en: 'Assigned' },
  'ui.sheet.assignTo': { 'zh-Hant': '配到第 {n} 組 →', en: 'Assign to set {n} →' },
  'ui.sheet.bag': { 'zh-Hant': '背包裡可裝備的', en: 'Equipable in bag' },
  'ui.sheet.bagEmpty': { 'zh-Hant': '背包裡沒有可裝備的東西。', en: 'Nothing equipable in the bag.' },
  'ui.sheet.masteries': { 'zh-Hant': '熟練度', en: 'Masteries' },
  'ui.sheet.masteriesEmpty': {
    'zh-Hant': '還沒有任何熟練度經驗——先去訓練所鍛鍊，或實戰累積。',
    en: 'No mastery experience yet — train at the training ground, or earn it in the field.',
  },
  'ui.sheet.equip': { 'zh-Hant': '裝備', en: 'Equip' },
  'ui.sheet.unequip': { 'zh-Hant': '卸下', en: 'Unequip' },
  'ui.attr.muscle': { 'zh-Hant': '肌力', en: 'Muscle' },
  'ui.attr.intelligence': { 'zh-Hant': '智力', en: 'Intelligence' },
  'ui.attr.reaction': { 'zh-Hant': '反應', en: 'Reaction' },
  'ui.attr.coordination': { 'zh-Hant': '協調', en: 'Coordination' },
  'ui.attr.charisma': { 'zh-Hant': '魅力', en: 'Charisma' },
  'ui.log.equipped': { 'zh-Hant': '裝備了 {item}。', en: 'Equipped {item}.' },
  'ui.log.skillSet': { 'zh-Hant': '把 {skill} 配到第 {n} 組。', en: 'Assigned {skill} to set {n}.' },

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
