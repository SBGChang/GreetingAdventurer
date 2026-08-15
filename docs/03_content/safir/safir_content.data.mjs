import { createCultureData, ability, damage, counter, heal, support, stats, monsterSkill } from '../shared/content_factory.mjs';
import { wildernessLayout, twoFloorLayout, nationalDungeonLayout } from '../shared/standard_layouts.mjs';

const repeat = (condition, effects, limit = '每場戰鬥最多觸發一次') => effects.map(effect => ability(condition, effect, limit));
const equipment = [
  { id:'curved-blade',type:'單手物理',requirement:'彎刀／單手武器',baseValue:82,names:['商旅彎刀','風紋彎刀','蜃影彎刀','月銀彎刀','星井王刃'],weights:[4,5,6,7,8],coefficients:{physicalDamageMuscle:.82,physicalDamageCoordination:1.28,hitReaction:.27,hitCoordination:.28,evasionReaction:.08},abilities:repeat('使用 [quick] 或命中 [wind-mark] 目標時',['傷害係數 +0.08','下一次迅捷技 CTB 減少','使目標獲得風標 1 次結算','自身獲得沙幕 1 次結算','對風標目標傷害係數 +0.22']) },
  { id:'hook-dagger',type:'單手物理',requirement:'鉤匕／單手武器',baseValue:76,names:['駝鈴鉤匕','鹽路鉤匕','失途鉤匕','夜砂鉤匕','無月星鉤'],weights:[2,3,3,4,5],coefficients:{physicalDamageMuscle:.48,physicalDamageCoordination:1.46,hitReaction:.36,hitCoordination:.31,predictionReaction:.10},abilities:repeat('命中 [blind] 或 [lost] 目標時',['傷害 raw +8','下一次攻擊命中提高','使目標失途 1 次結算','延長目標風標 1 次結算','追加一次小額追擊傷害']) },
  { id:'moon-spear',type:'雙手物理',requirement:'月鉤長槍／雙手武器',baseValue:106,names:['棕木月槍','銅月鉤槍','星路長槍','月環鉤槍','九曜月槍'],weights:[9,11,13,15,18],coefficients:{physicalDamageMuscle:1.38,physicalDamageCoordination:1.24,hitReaction:.30,hitCoordination:.27,blockReaction:.06},abilities:repeat('使用 [thrust] 或攻擊 [wind-mark] 目標時',['命中 +8 raw','傷害係數 +0.12','擊中後目標 CTB 增加','自身獲得星引 1 次結算','對風標目標傷害係數 +0.24']) },
  { id:'double-glaive',type:'雙手物理',requirement:'雙月刃／雙手武器',baseValue:116,names:['木柄雙月刃','赤銅雙月刃','蜃景雙月刃','月蝕雙月刃','星河雙月刃'],weights:[10,12,14,17,20],coefficients:{physicalDamageMuscle:1.18,physicalDamageCoordination:1.52,hitReaction:.22,hitCoordination:.25,evasionCoordination:.05},abilities:repeat('使用 [sweep] 或自身具有 [sand-veil] 時',['最多攻擊 2 個目標','傷害後獲得沙幕 1 次結算','每命中一名目標 CTB 略減','對失途目標傷害係數 +0.16','沙幕期間暴露弱點機率降低']) },
  { id:'sling',type:'投擲與射擊',requirement:'投石索／投擲武器',baseValue:64,names:['麻繩投石索','鹽珠投石索','鳴風投石索','月砂投石索','墜星投石索'],weights:[1,1,2,2,3],coefficients:{physicalDamageMuscle:.34,physicalDamageCoordination:1.22,hitReaction:.35,hitCoordination:.33,predictionReaction:.07},abilities:repeat('使用 [throw] 時',['命中 raw +8','命中時增加目標 CTB','使目標迷目 1 次結算','迷目目標同時獲得風標','命中風標目標時回復少量 CTB']) },
  { id:'throwing-wheel',type:'投擲與射擊',requirement:'星輪／投擲武器',baseValue:78,names:['銅邊星輪','風切星輪','七芒星輪','月銀星輪','日蝕星輪'],weights:[2,3,3,4,5],coefficients:{physicalDamageMuscle:.42,physicalDamageCoordination:1.42,hitReaction:.34,hitCoordination:.30,predictionReaction:.10},abilities:repeat('命中 [wind-mark] 目標時',['傷害 raw +8','下一次投擲命中提高','使相鄰一名敵人獲得風標','本次傷害係數 +0.18','追加一次小額回旋傷害']) },
  { id:'composite-bow',type:'投擲與射擊',requirement:'複合弓／射擊武器',baseValue:88,names:['商隊角弓','棕影複合弓','逐風複合弓','月角複合弓','星井天弓'],weights:[4,5,6,7,8],coefficients:{physicalDamageMuscle:.66,physicalDamageCoordination:1.58,hitReaction:.39,hitCoordination:.33,predictionReaction:.12},abilities:repeat('使用 [shot] 或自身具有 [star-guidance] 時',['傷害 raw +8','預測 raw +8','命中時施加風標','對失途目標傷害係數 +0.16','星引期間忽略部分一般減傷']) },
  { id:'great-bow',type:'投擲與射擊',requirement:'大角弓／射擊武器',baseValue:110,names:['赤木大角弓','商站大角弓','沙脊大角弓','月蝕大角弓','九曜巨弓'],weights:[8,10,12,15,18],coefficients:{physicalDamageMuscle:.94,physicalDamageCoordination:1.78,hitReaction:.31,hitCoordination:.29,predictionReaction:.15},abilities:repeat('使用 [heavy] 射擊時',['命中時增加目標 CTB','傷害係數 +0.10','對風標目標命中提高','命中後使目標失途 1 次結算','對同時迷目與風標的目標傷害係數 +0.26']) },
  { id:'one-hand-staff',type:'法杖與樂器',requirement:'星盤短杖／單手法杖',baseValue:84,names:['銅盤短杖','旅星短杖','尋路星杖','月盤短杖','星井權杖'],weights:[3,4,4,5,6],coefficients:{magicDamageIntelligence:2.28,magicHitIntelligence:.27,magicHitReaction:.22,predictionIntelligence:.14,evasionReaction:.04},abilities:repeat('使用 [spell] 時',['魔法傷害 raw +8','預測 raw +8','使目標獲得風標','自身獲得星引 1 次結算','星引期間施法 CTB 減少']) },
  { id:'two-hand-staff',type:'法杖與樂器',requirement:'天象長杖／雙手法杖',baseValue:120,names:['棕木天象杖','黃銅天象杖','蜃海天象杖','月環天象杖','九曜星杖'],weights:[8,10,12,14,16],coefficients:{magicDamageIntelligence:2.88,magicHitIntelligence:.35,magicHitReaction:.23,predictionIntelligence:.18,magicDrIntelligence:.08},abilities:repeat('使用 [spell] 攻擊帶有文化狀態的目標時',['魔法命中 +8 raw','魔法傷害係數 +0.08','延長風標 1 次結算','使目標失途 1 次結算','對兩種以上負面狀態目標傷害係數 +0.22']) },
  { id:'reed-flute',type:'法杖與樂器',requirement:'蘆笛／管樂器',baseValue:76,names:['綠洲蘆笛','駝鈴蘆笛','風路蘆笛','夜月蘆笛','星息長笛'],weights:[1,2,2,3,4],coefficients:{instrumentDamageIntelligence:.30,instrumentDamageCoordination:.30,instrumentDamageCharisma:.62,evasionReaction:.08,predictionReaction:.08},abilities:repeat('使用 [perform] 時',['一名隊友預測 raw +8','一名隊友獲得沙幕','使一名敵人獲得風標','全隊下一次迅捷技命中提高','全隊獲得星引 1 次結算']) },
  { id:'frame-drum',type:'法杖與樂器',requirement:'框鼓／打擊樂器',baseValue:86,names:['旅隊框鼓','赤帆框鼓','鳴砂框鼓','月紋框鼓','星潮戰鼓'],weights:[3,4,5,6,7],coefficients:{instrumentDamageIntelligence:.24,instrumentDamageCoordination:.36,instrumentDamageCharisma:.66,hitReaction:.10,normalDrMuscle:.03},abilities:repeat('使用 [perform] 時',['一名隊友 CTB 減少','一名敵人 CTB 增加','全隊對風標目標命中提高','全隊獲得沙幕 1 次結算','重整全隊下一次行動節拍']) },
  { id:'cloth',type:'防具與盾牌',requirement:'布甲',baseValue:54,names:['旅人長袍','星紋長袍','蜃景長袍','月塵法袍','九曜星袍'],weights:[2,3,4,5,6],coefficients:{evasionReaction:.25,evasionCoordination:.16,magicDrIntelligence:.13,predictionIntelligence:.14},abilities:repeat('裝備法杖或樂器並成功預測時',['魔法減傷 raw +6','下一次施法 CTB 減少','自身獲得星引','自身獲得沙幕','一名隊友獲得星引']) },
  { id:'light-armor',type:'防具與盾牌',requirement:'輕甲',baseValue:68,names:['商旅皮衣','棕影皮衣','逐風皮衣','月砂皮衣','星路輕甲'],weights:[6,7,8,9,10],coefficients:{evasionReaction:.38,evasionCoordination:.31,hitReaction:.11,hitCoordination:.12,normalDrMuscle:.04},abilities:repeat('閃避成功或使用 [quick] 時',['CTB 減少','下一次命中提高','自身獲得沙幕','使攻擊者獲得風標','下一次攻擊追加追擊傷害']) },
  { id:'medium-armor',type:'防具與盾牌',requirement:'中甲',baseValue:92,names:['鹽路環甲','商站環甲','風銅環甲','月銀環甲','星井衛甲'],weights:[12,14,16,18,20],coefficients:{normalDrMuscle:.14,blockAbsorbMuscle:.14,blockReaction:.10,evasionReaction:.09,evasionCoordination:.08},abilities:repeat('受到攻擊或成功格擋時',['自身獲得沙幕','攻擊者獲得風標','下一次格擋吸收提高','一名隊友預測提高','降低下一次沉重行動的 CTB']) },
  { id:'heavy-armor',type:'防具與盾牌',requirement:'重甲',baseValue:126,names:['赤銅重衣','商站層甲','星臺重甲','月環重甲','九曜衛甲'],weights:[21,25,29,34,40],coefficients:{normalDrMuscle:.22,blockAbsorbMuscle:.23,magicDrIntelligence:.06,evasionReaction:-.06,evasionCoordination:-.05},abilities:repeat('受到沉重攻擊或 Boss 攻擊時',['一般減傷 raw +8','自身獲得星引','抵消一次 CTB 增加','自身獲得沙幕','使攻擊者失途 1 次結算']) },
  { id:'one-hand-shield',type:'防具與盾牌',requirement:'圓盾／單手盾',baseValue:74,names:['藤編圓盾','商旅圓盾','風紋圓盾','月銀圓盾','星井圓盾'],weights:[5,7,9,11,13],coefficients:{blockReaction:.27,blockCoordination:.25,blockAbsorbMuscle:.17,evasionReaction:.05},abilities:repeat('使用 [guard] 或成功格擋時',['格擋 raw +10','自身獲得沙幕','攻擊者獲得風標','下一次反擊命中提高','反擊風標目標傷害係數 +0.18']) },
  { id:'two-hand-shield',type:'防具與盾牌',requirement:'篷盾／雙手盾',baseValue:110,names:['商篷大盾','赤帆大盾','風幕大盾','月環大盾','九曜天幕'],weights:[15,19,24,30,38],coefficients:{blockReaction:.35,blockCoordination:.31,blockAbsorbMuscle:.28,normalDrMuscle:.10,magicDrIntelligence:.05},abilities:repeat('使用 [guard] 時',['格擋 raw +16','一名隊友獲得沙幕','攻擊者獲得風標','全隊抵消一次 CTB 增加','全隊對風標目標命中提高']) },
];

const route = (id, name, requirement, entries) => ({ id, name, requirement, entries });
const skillRoutes = [
  route('curved-blade','彎刀','單手武器熟練',[['掠風斬','物理攻擊','迅捷',damage(.86),'快速傷害'],['回砂刃','物理攻擊','標準',damage(.94),'命中後獲得沙幕'],['逐標斬','物理攻擊','標準',damage(1.02),'對風標目標係數提高'],['月下回鋒','反擊','架勢',counter(1.16),'閃避後反擊並施加風標'],['星井連環','物理攻擊','沉重',damage(1.42),'風標目標受到追加傷害']]),
  route('hook-dagger','鉤匕','單手武器熟練',[['鉤影刺','物理攻擊','迅捷',damage(.78),'快速傷害'],['折向','輔助','迅捷',support,'使目標失途'],['盲隙刺','物理攻擊','標準',damage(.96),'對迷目目標提高命中'],['夜路追鉤','物理攻擊','迅捷',damage(1.08),'對失途目標追擊'],['無月奪星','物理攻擊','沉重',damage(1.34),'目標狀態越多傷害越高']]),
  route('moon-spear','月鉤長槍','雙手武器熟練',[['平沙刺','物理攻擊','標準',damage(.94),'基礎突刺'],['鉤月迎擊','反擊','架勢',counter(.92),'守勢迎擊'],['立標長刺','物理攻擊','標準',damage(1.04),'施加風標'],['追星貫陣','物理攻擊','沉重',damage(1.24),'增加目標 CTB'],['月環裁線','反擊','架勢',counter(1.38),'對風標目標強力迎擊']]),
  route('double-glaive','雙月刃','雙手武器熟練',[['雙弧斬','物理攻擊','標準',damage(.92),'基礎傷害'],['流砂輪舞','物理攻擊','沉重',damage(.84),'最多攻擊三名敵人'],['回月護身','輔助','架勢',support,'自身獲得沙幕'],['蝕影雙斷','物理攻擊','沉重',damage(1.24),'失途目標追加傷害'],['星河輪轉','物理攻擊','沉重',damage(1.52),'依命中數減少 CTB']]),
  route('sling','投石索','投擲武器熟練',[['鹽珠擊','物理攻擊','迅捷',damage(.70),'快速投擲'],['鳴額石','物理攻擊','標準',damage(.80),'使目標迷目'],['偏路投','輔助','迅捷',support,'使目標失途'],['沙暴連珠','物理攻擊','沉重',damage(1.06),'最多攻擊三名敵人'],['墜星一擊','物理攻擊','沉重',damage(1.30),'大幅增加目標 CTB']]),
  route('throwing-wheel','星輪','投擲武器熟練',[['銅輪擲','物理攻擊','迅捷',damage(.76),'快速投擲'],['風切回旋','物理攻擊','標準',damage(.86),'施加風標'],['七芒折返','物理攻擊','標準',damage(.92),'追加小額回旋傷害'],['月蝕環割','物理攻擊','沉重',damage(1.14),'對迷目目標提高命中'],['日蝕歸輪','物理攻擊','沉重',damage(1.38),'風標可傳至另一目標']]),
  route('composite-bow','複合弓','射擊武器熟練',[['商路箭','物理攻擊','標準',damage(.90),'基礎射擊'],['逐風箭','物理攻擊','迅捷',damage(.78),'快速射擊'],['星引瞄準','輔助','架勢',support,'自身獲得星引'],['失途追箭','物理攻擊','標準',damage(1.08),'對失途目標提高傷害'],['穿蜃一矢','物理攻擊','沉重',damage(1.46),'忽略部分一般減傷']]),
  route('great-bow','大角弓','射擊武器熟練',[['赤木重箭','物理攻擊','沉重',damage(1.00),'重型射擊'],['釘影箭','物理攻擊','標準',damage(.94),'增加目標 CTB'],['沙脊遠望','輔助','架勢',support,'自身獲得星引'],['月蝕貫射','物理攻擊','沉重',damage(1.28),'對風標目標提高命中'],['九曜落矢','物理攻擊','沉重',damage(1.58),'對迷目與風標目標強化']]),
  route('one-hand-shield','圓盾','單手盾熟練',[['藤盾架勢','防禦','架勢',support,'建立守勢'],['偏光盾擊','物理攻擊','標準',damage(.66),'格擋後使目標迷目'],['護路轉身','輔助','架勢',support,'一名隊友獲得沙幕'],['風紋反照','反擊','架勢',counter(1.06),'格擋後反擊並施加風標'],['星井圓陣','輔助','沉重',support,'全隊獲得短暫沙幕']]),
  route('two-hand-shield','篷盾','雙手盾熟練',[['張篷','防禦','架勢',support,'提高自身格擋'],['遮星幕','輔助','架勢',support,'保護一名隊友'],['定路樁','輔助','架勢',support,'抵消一次 CTB 增加'],['風幕推進','物理攻擊','沉重',damage(.76),'使攻擊者失途'],['九曜天幕','輔助','沉重',support,'全隊獲得沙幕與星引']]),
  route('reed-flute','蘆笛','管樂器熟練',[['綠洲短調','輔助演奏','演奏',support,'一名隊友獲得星引'],['逐風長音','輔助演奏','演奏',support,'一名隊友 CTB 減少'],['迷途變奏','樂器攻擊','演奏',damage(.76,'instrument'),'使目標失途'],['月夜息音','輔助演奏','演奏',support,'全隊獲得沙幕'],['星息合奏','輔助演奏','演奏',support,'全隊提高預測與命中']]),
  route('frame-drum','框鼓','打擊樂器熟練',[['旅鼓一拍','輔助演奏','演奏',support,'一名隊友命中提高'],['赤帆催程','輔助演奏','演奏',support,'一名隊友 CTB 減少'],['鳴砂震步','樂器攻擊','演奏',damage(.82,'instrument'),'一名敵人 CTB 增加'],['月紋錯拍','輔助演奏','演奏',support,'使一名敵人失途'],['星潮大合拍','輔助演奏','演奏',support,'重整全隊下一次行動節拍']]),
  route('attack-magic','攻擊魔法','法杖或魔法媒介',[['砂針','魔法攻擊','施法',damage(.92,'magic'),'魔法傷害'],['蜃光','魔法攻擊','施法',damage(.86,'magic'),'使目標迷目'],['風刃','魔法攻擊','施法',damage(.98,'magic'),'施加風標'],['月蝕','魔法攻擊','施法',damage(1.16,'magic'),'對失途目標提高傷害'],['九曜墜光','魔法攻擊','施法',damage(1.54,'magic'),'依負面狀態數提高傷害']]),
  route('defense-magic','防禦魔法','法杖或魔法媒介',[['薄砂幕','輔助魔法','施法',support,'一名隊友獲得沙幕'],['折光壁','輔助魔法','施法',support,'提高一名隊友魔法減傷'],['移星位','輔助魔法','施法',support,'抵消一次 CTB 增加'],['月環障','輔助魔法','施法',support,'最多三名隊友獲得沙幕'],['天幕無隙','輔助魔法','施法',support,'全隊獲得高額短期減傷']]),
  route('blessing-magic','祝福魔法','法杖或魔法媒介',[['井水祝詞','輔助魔法','施法',heal(.58),'治療一名隊友'],['路星指引','輔助魔法','施法',support,'一名隊友獲得星引'],['旅隊復甦','輔助魔法','施法',heal(.80),'治療並解除迷目'],['月下同程','輔助魔法','施法',support,'最多三名隊友獲得星引'],['星井回響','輔助魔法','施法',heal(1.08),'治療全隊並改善 CTB']]),
  route('curse-magic','詛咒魔法','法杖或魔法媒介',[['揚砂','詛咒魔法','施法',support,'使目標迷目'],['錯路','詛咒魔法','施法',support,'使目標失途'],['風標記','詛咒魔法','施法',support,'使目標獲得風標'],['蜃景迴圈','詛咒魔法','施法',support,'增加最多三名敵人 CTB'],['群星失序','詛咒魔法','施法',support,'最多三名敵人迷目、失途並獲得風標']]),
];

const monsters = [
  {id:'sandglass-beetle',tier:'I',threat:'一般',size:'小型',name:'砂漏甲蟲',stats:stats(140,24,4,24,21),role:'CTB 干擾',skills:[monsterSkill('漏砂撞','physical',.84,'standard','命中後增加 CTB')],drops:'甲殼、砂囊'},
  {id:'saltback-lizard',tier:'I',threat:'一般',size:'小型',name:'鹽背蜥',stats:stats(155,27,3,26,22),role:'迷目突襲',skills:[monsterSkill('鹽尾掃','physical',.88,'quick','命中後迷目 1 次結算')],drops:'鹽背皮、蜥肉'},
  {id:'mirage-moth',tier:'I',threat:'一般',size:'小型',name:'蜃粉夜蛾',stats:stats(125,2,28,29,18),role:'失途干擾',skills:[monsterSkill('蜃粉','magic',.82,'cast','使目標失途')],drops:'蜃粉、薄翼'},
  {id:'date-jackal',tier:'I',threat:'一般',size:'小型',name:'棗林胡狼',stats:stats(170,29,2,28,25),role:'風標追擊',skills:[monsterSkill('循味撲','physical',.92,'quick','對風標目標提高傷害')],drops:'胡狼皮、棗核'},
  {id:'dune-scorpion',tier:'I',threat:'菁英',size:'中型',name:'丘殼蠍',stats:stats(430,45,12,27,31),role:'束尾與厚殼',skills:[monsterSkill('鉤尾定路','physical',1.04,'standard','增加目標 CTB'),monsterSkill('埋砂殼','support',null,'stance','獲得沙幕')],drops:'丘殼、蠍毒'},
  {id:'glasswing-serpent',tier:'I',threat:'菁英',size:'中型',name:'玻翼砂蛇',stats:stats(390,34,29,35,32),role:'高閃避魔物',skills:[monsterSkill('折光咬','magic',1.02,'quick','使目標迷目'),monsterSkill('玻翼閃','support',null,'stance','提高閃避')],drops:'玻翼膜、蛇牙'},
  {id:'star-sand-idol',tier:'I',threat:'菁英',size:'中型',name:'星砂偶',stats:stats(480,39,36,20,24),role:'星引與魔法',skills:[monsterSkill('錯星光','magic',1.10,'cast','使目標失途'),monsterSkill('砂偶護幕','support',null,'stance','獲得魔法減傷')],drops:'星砂、偶核'},
  {id:'red-dune-hornbeast',tier:'I',threat:'Boss',size:'大型',name:'赤丘角獸',stats:stats(1120,72,8,25,31),role:'鹽澤 Boss',skills:[monsterSkill('赤丘衝','physical',1.28,'heavy','全隊 CTB 壓力'),monsterSkill('角踏沙暴','physical',1.02,'standard','最多三名目標迷目')],drops:'赤丘角、厚皮'},
  {id:'buried-caravan-devourer',tier:'I',threat:'Boss',size:'大型',name:'埋商吞獸',stats:stats(1060,64,22,30,34),role:'商站 Boss',skills:[monsterSkill('吞貨伏擊','physical',1.22,'heavy','對失途目標提高傷害'),monsterSkill('埋沙翻身','support',null,'stance','獲得沙幕並施加風標')],drops:'吞獸骨、舊貨囊'},
  {id:'moon-dust-moth',tier:'II',threat:'一般',size:'小型',name:'月塵蛾',stats:stats(245,4,44,39,25),role:'魔法迷目',skills:[monsterSkill('月塵','magic',.98,'cast','魔法傷害並迷目')],drops:'月塵、蛾絲'},
  {id:'compass-scarab',tier:'II',threat:'一般',size:'小型',name:'銅針聖甲',stats:stats(280,37,18,34,39),role:'風標追蹤',skills:[monsterSkill('指北撞','physical',1.00,'standard','施加風標')],drops:'銅針、甲片'},
  {id:'tower-gecko',tier:'II',threat:'一般',size:'中型',name:'星臺脊蜥',stats:stats(330,42,15,37,33),role:'高命中突襲',skills:[monsterSkill('脊牆撲','physical',1.06,'quick','對星引目標提高命中')],drops:'脊蜥皮、吸盤'},
  {id:'oath-stone-sentinel',tier:'II',threat:'菁英',size:'中型',name:'路誓石衛',stats:stats(760,58,43,24,35),role:'格擋與反擊',skills:[monsterSkill('石盾偏光','support',null,'stance','格擋並使攻擊者迷目'),monsterSkill('誓路反擊','physical',1.20,'standard','反擊風標目標')],drops:'誓石、星銅'},
  {id:'lost-star-echo',tier:'II',threat:'菁英',size:'中型',name:'失星回聲',stats:stats(690,8,68,42,31),role:'失途與延遲',skills:[monsterSkill('錯軌回聲','magic',1.14,'cast','使最多三名目標失途'),monsterSkill('晚一拍','support',null,'perform','增加全隊 CTB')],drops:'回聲砂、月銀'},
  {id:'moonring-astral-beast',tier:'II',threat:'Boss',size:'大型',name:'月環星獸',stats:stats(1880,76,84,38,46),role:'星臺 Boss',skills:[monsterSkill('九曜錯落','magic',1.34,'cast','依目標負面狀態提高傷害'),monsterSkill('月環天幕','support',null,'stance','獲得沙幕與星引'),monsterSkill('墜星踏','physical',1.20,'heavy','大幅增加目標 CTB')],drops:'月環星核、星獸角'},
];

const humanEncounters = [
  {id:'salt-road-raiders',tier:'I',threat:'一般群',name:'沙路劫隊',members:'5 彎刀手＋3 投石手',role:'迷目、追擊與搶拍',drops:'彎刀、輕甲、鹽貨'},
  {id:'false-caravan-guards',tier:'I',threat:'一般群',name:'假商護衛',members:'4 圓盾手＋4 複合弓手',role:'遮蔽、射擊與風標',drops:'圓盾、角弓、商貨'},
  {id:'broken-beastmaster',tier:'I',threat:'菁英',name:'失約馴獸師',members:'1 框鼓手＋2 鉤匕手＋2 胡狼',role:'節拍、失途與追擊',drops:'樂器、鉤匕、獸材'},
  {id:'observatory-diggers',tier:'II',threat:'一般群',name:'星臺私掘隊',members:'3 篷盾手＋3 星輪手＋3 法師',role:'沙幕、投擲與 CTB 干擾',drops:'星砂、月銀、高級書'},
  {id:'exiled-astrologer',tier:'II',threat:'菁英',name:'流亡星官',members:'1 天象杖師＋1 蘆笛手＋1 大角弓手',role:'預測、失途與條件爆發',drops:'精品裝備、星盤件、Boss 書池前置'},
];

const items = {
  combat:[['I','井水藥劑','0.3／30','迅捷','小量治療','基礎店貨、製藥書'],['I','清目鹽瓶','0.3／34','迅捷','解除迷目','鹽路素材'],['I','蜃粉煙瓶','0.4／40','標準','使一名敵人失途','素材配方'],['II','濃縮井水藥劑','0.4／94','標準','中量治療','高級製藥書'],['II','星引滴劑','0.4／112','標準','自身獲得星引','星臺素材'],['III','行旅合劑','0.5／300','沉重','治療並獲得沙幕','探索配方'],['IV','月環靈藥','0.6／940','沉重','高量治療並解除迷目或失途','Boss 素材'],['V','九曜復原劑','0.8／3150','沉重','大量治療、解除一負面、星引','終局配方']],
  nonCombat:[['星砂路標','Tier I／0.3／24','迷宮分鐘','標記已走過的指定分岔','不揭露未知格'],['折光罩燈','Tier I／0.8／42','迷宮分鐘','延長既有照明狀態','不建立潛行系統'],['商站繩組','Tier II／2.0／126','迷宮分鐘','處理指定攀越障礙','無 Handler 時 disabled'],['旅隊整備篷','Tier II／3.2／176','Team Plan','建立既有整備狀態','不引入營地建造']],
  general:[
    {title:'商旅與補給',rows:[['鹽磚箱','I','8.0','138','料理／送貨'],['棗乾袋','I','1.0','64','料理／補貨'],['角弓弦束','I','0.8','96','工藝／探索'],['駝鈴組','I','1.4','102','樂器／送貨']]},
    {title:'星圖與文書',rows:[['商路圖卷','I','0.3','40','購買／書籍'],['月相抄本','II','0.4','236','探索／購買'],['星臺刻度表','II','0.5','276','探索／情報'],['路誓契片','I','0.3','58','送貨／委託']]},
    {title:'家具與器物',rows:[['折腳矮桌','I','12.0','190','家具／送貨'],['黃銅罩燈','I','3.0','116','家具／工藝'],['織紋掛毯','I','5.0','148','家具／購買'],['星盤書架','II','20.0','382','家具／送貨']]},
    {title:'珍藏與器件',rows:[['月環星盤片','IV','1.0','2860','收藏／工藝'],['赤帆船鈴','II','2.0','420','收藏／樂器'],['九曜指針','III','0.5','760','法杖／收藏'],['星井王印','V','1.6','6300','收藏／工藝']]},
  ],
};

const materials = [
  ['鹽銅錠','I','affix.safir.clear-edge','彎刀、星輪、盾'],['棕木','I','affix.safir.road-grip','弓、槍、家具'],['胡狼皮','I','affix.safir.pursuit-step','輕甲、弓具'],['赤丘肉材','I','affix.safir.hearty-journey','料理'],['棗乾','I','affix.safir.satiety','麵餅、燉肉'],['井鹽','I','affix.safir.clear-sight','飲品、藥劑'],['蜃粉','I','affix.safir.mirage','法杖、藥劑'],['駝鈴銅','I','affix.safir.resonant-road','樂器、工藝'],['舊星圖','I','無','卷軸、書籍'],['角弓筋','I','affix.safir.measured-shot','弓、機件'],['丘殼片','I','affix.safir.dune-guard','中甲、盾'],['玻翼膜','I','無','藥劑、輕甲'],
  ['月環石','II','affix.safir.moon-ward','盾、法杖、工藝'],['星井砂','II','affix.safir.astral-focus','法術命中'],['路誓銅','II','affix.safir.unlost-path','重甲、篷盾'],['風鳴蘆','II','affix.safir.clear-breath','蘆笛、祝福'],['赤丘角','II','affix.safir.pursuit','槍、大角弓'],['月塵絲','II','affix.safir.light-veil','布甲、輕甲'],
  ['日盤金','III','affix.safir.solar-order','高階法杖、星輪'],['綠洲鋼','III','affix.safir.caravan-fortress','高階重甲、雙月刃'],['蝕月銀','IV','affix.safir.eclipse','傳說武器、法杖'],['月環星核','IV','affix.safir.ninefold-guidance','傳說盾、法袍'],['星井之心','V','affix.safir.wellspring','神話法袍、樂器'],['墜曜金鋼','V','affix.safir.falling-star','神話弓、槍、星輪'],
];
const cuisine = [['棗泥薄餅','I','棗乾、井鹽','小量恢復飽食','赤帆驛旅店料理'],['井鹽乳茶','I','井鹽、棗乾','解除迷目並恢復少量生命','星井城茶攤'],['赤丘肉串','I','赤丘肉材、井鹽','提高下一次物理命中','鹽澤獵人料理'],['商旅燉鍋','II','赤丘肉材、棗乾、井鹽','全隊獲得短期沙幕','星臺前置委託'],['月塵甜湯','II','月塵絲、棗乾','解除失途並獲得星引','高級料理書'],['九曜行路宴','II','井鹽、棗乾、赤丘肉材','全隊改善 CTB 與預測','國家迷宮配方']];
const books = [['行路者基礎篇','Lv.3','赤帆驛書商','彎刀、鉤匕、投石索、複合弓基礎書'],['行路者進階篇','Lv.6','商隊委託與菁英','月槍、雙月刃、星輪、大角弓進階書'],['行路者大師篇','Lv.10','Boss 書池','武器、盾牌與樂器大師書'],['觀星者基礎篇','Lv.3','星井城學舍','四系魔法與法杖基礎書'],['觀星者進階篇','Lv.6','月環星臺菁英','法術、蘆笛與框鼓進階書'],['觀星者大師篇','Lv.10','Boss 書池','星官、樂器與四系魔法大師書']];

const mapLayouts = [
  wildernessLayout({
    name: '棕影鹽澤', city: '赤帆驛', type: '一般野外型；8×8 單層',
    label: '單層鹽澤：棕影路脊',
    note: '白鹽地、棕櫚影與乾涸水道交錯；風標與迷目是主要壓力，兩道紅門各守一條捷徑。',
  }),
  twoFloorLayout({
    name: '埋砂商站', city: '星井城', type: '一般建築型；5×5 地上／地下',
    floors: [
      { label: '地上 1F：傾斜貨廳', note: '中央樓梯 (3,3) 與地下同座標；商隊貨架以紅門庫房封住。' },
      { label: '地下 1F：埋貨獸穴', note: '中央樓梯 (3,3) 上返；埋商吞獸占 2×2 獸穴，舊貨囊為事件偏好。' },
    ],
  }),
  nationalDungeonLayout({
    name: '月環星臺', city: '星井城', type: '建築型國家迷宮；6×6 塔 1～4F＋地下 1～2F',
    floors: [
      { label: '塔 1F：迎星門廳', note: '入口層建立路誓石衛、星盤採集點與下行樓梯 (2,5)。' },
      { label: '塔 2F：折光迴廊', note: '上行 (2,5)、下行 (5,2)；折光紅門改變探索路線，但不揭露未知格。' },
      { label: '塔 3F：月塵書庫', note: '上行 (5,2)、下行 (2,5)；月塵蛾與失星回聲共同施加迷目、失途。' },
      { label: '塔 4F：九曜盤室', note: '上行 (2,5)、下行 (5,2)；盤室集中高階星砂、書籍與菁英遭遇。' },
      { label: '地下 1F：失路基座', note: '上行 (5,2)、下行 (2,5)；舊觀測基座與私掘隊占據地下通道。' },
      { label: '地下 2F：月環心室', note: '上行 (2,5)；最深層為 2×2 月環星獸 Boss 與星核寶箱。' },
    ],
  }),
];
const mapConfigs = [
  {name:'棕影鹽澤',city:'赤帆驛',tier:'I',kind:'一般野外型',layout:'8×8 單層',materialPools:{gathering:[['棕木',30],['胡狼皮',25],['井鹽',20],['鹽銅錠',25]],treasure:[['角弓筋',25],['丘殼片',20],['玻翼膜',20],['棗乾',20],['蜃粉',15]]}},
  {name:'埋砂商站',city:'星井城',tier:'I',kind:'一般建築型',layout:'5×5 地上／地下',materialPools:{gathering:[['駝鈴銅',35],['井鹽',25],['棕木',20],['鹽銅錠',20]],treasure:[['角弓筋',25],['駝鈴銅',25],['舊星圖',20],['月塵絲',10],['蜃粉',20]]}},
  {name:'月環星臺',city:'星井城',tier:'II',kind:'建築型國家迷宮',layout:'6×6；塔 1～4F＋地下 1～2F',materialPools:{gathering:[['月環石',30],['星井砂',30],['路誓銅',25],['風鳴蘆',15]],treasure:[['月環石',20],['星井砂',30],['路誓銅',25],['風鳴蘆',20],['赤丘角',5]]}},
];

const data = createCultureData({
  key:'safir',
  meta:{name:'薩菲爾',direction:'南方',pillars:['商旅路誓','綠洲城市','星象學舍','風砂技藝'],cities:['星井城','赤帆驛'],scope:'Tier I～II 首批可玩內容；Tier III～V 保留裝備與素材成長骨架。'},
  statusRules:[['迷目','負面','降低一種命中或預測 raw','2 次有效結算','refresh'],['失途','負面','提高下一次行動 CTB 或降低一種閃避 raw','2 次有效結算','refresh'],['風標','負面','啟用追擊、條件射擊與文化技藝','2 次有效結算','refresh'],['沙幕','正面','提高一種閃避或一般減傷 raw','2 次有效結算','strongest'],['星引','正面','提高一種命中、預測或改善下一次 CTB','2 次有效結算','strongest']],
  equipment,skillRoutes,monsters,humanEncounters,items,materials,cuisine,books,mapLayouts,mapConfigs,
});

export const { cultureMeta,balanceModel,equipmentCatalog,skillCatalog,monsterCatalog,itemCatalog,materialCatalog,craftingCatalog,firstMapConfigs,firstMapLayouts,validationSummary } = data;
