import {facilityName} from './facility-names';
// Travel and lodging for the twelve additional cities. Culture-specific commerce,
// quests and dungeons are separate content work, never copied from Yunhua.
import { cultureIds, textKeyFor, type Authored, type AuthoredDomain, type AuthoredText } from './authoring';
import { WORLD_CITIES, CONNECTING_ROUTES, worldCityId, connectingRouteId, extraRouteIdsFor } from './world-network';
import type { CityDefinition, FacilityDefinition, PopulationSupplyRuleDefinition, EscortGenerationRuleDefinition } from '../src/contracts/city';
import type { CityNodeDefinition, CultureDefinition, NationDefinition, RegionDefinition, RouteDefinition } from '../src/contracts/world';
import type { DefinitionHeader, ResolverId } from '../src/contracts/core';

const core=cultureIds('core');
const yunhua=cultureIds('yunhua');
const texts: AuthoredText[]=[];
const definitions: AuthoredDomain['definitions'][number][]=[];
function add<T extends DefinitionHeader>(definition: Authored<T>): void { definitions.push(definition); }
const cultures=[['vildun','維爾冬','Vildun'],['aurelien','奧瑞恩','Aurelien'],['safir','薩菲爾','Safir']] as const;
for(const [key,zh,en] of cultures){
  const ids=cultureIds(key);const cities=WORLD_CITIES.filter(c=>c.culture===key);
  add<CultureDefinition>({kind:'culture',id:ids.cultureId,itemPoolIds:[],nonHumanMonsterPoolIds:[],humanEnemyPoolIds:[],equipmentPoolIds:[],skillPoolIds:[]});
  const nationId=ids.id<NationDefinition['id']>('nation','realm');
  const regionId=ids.id<RegionDefinition['id']>('region','heartland');
  texts.push({key:textKeyFor(nationId),name:{'zh-Hant':zh,en}});
  add<NationDefinition>({kind:'nation',id:nationId,cultureId:ids.cultureId,passagePolicyId:core.id<NationDefinition['passagePolicyId']>('passage-policy','domestic-open'),display:{nameRef:{key:textKeyFor(nationId)}}});
  add<RegionDefinition>({kind:'region',id:regionId,nativeNationId:nationId,nativeCultureId:ids.cultureId,cityIds:cities.map(c=>worldCityId(c.key)),adventureSiteIds:[]});
  for(const city of cities){
    const cityId=worldCityId(city.key);
    texts.push({key:textKeyFor(cityId),name:city.name});
    add<CityNodeDefinition>({kind:'city-node',id:cityId,regionId,adjacentRouteIds:extraRouteIdsFor(cityId),adventureSiteIds:[],isCapital:city.capital,display:{nameRef:{key:textKeyFor(cityId)}}});
    const facilityIds: FacilityDefinition['id'][]=[];
    for(const [kind,local] of [['inn','inn'],['cityGate','city-gate']] as const){
      const id=ids.id<FacilityDefinition['id']>('facility',city.key+'-'+local);facilityIds.push(id);
      texts.push({key:textKeyFor(id),name:facilityName('culture.'+key,kind)});
      add<FacilityDefinition>({kind:'facility',id,facilityKind:kind,actionRuleIds:kind==='inn'?[yunhua.id('city-action-rule','inn-rest')]:[],display:{nameRef:{key:textKeyFor(id)}}});
    }
    const populationId=ids.id<PopulationSupplyRuleDefinition['id']>('population-supply-rule',city.key);
    const escortId=ids.id<EscortGenerationRuleDefinition['id']>('escort-generation-rule',city.key);
    add<PopulationSupplyRuleDefinition>({kind:'population-supply-rule',id:populationId,cadenceDays:28,cityOffsetDays:0,targetCountResolverId:'resolver:city.population-target-count' as ResolverId,adventurerGenerationRuleId:core.id('world-adventurer-generation-rule','standard'),batchLimit:5});
    add<EscortGenerationRuleDefinition>({kind:'escort-generation-rule',id:escortId,cadenceDays:7,cityOffsetDays:0,candidateCount:{min:0,max:5},allowedArchetypeIds:[core.id('character-archetype','escort-merchant')],destinationResolverId:'resolver:city.escort-destination' as ResolverId});
    // Existing shared city rules have stable Yunhua IDs; this pack declares that
    // dependency explicitly. No copied shops, loot or cultural enemies.
    add<CityDefinition>({kind:'city',id:ids.id('city',city.key),worldCityId:cityId,facilityIds,shopRuleIds:[],
      intelRuleId:yunhua.id('intel-rule','standard'),homeRuleId:yunhua.id('home-rule','standard'),
      escortGenerationRuleId:escortId,populationSupplyRuleId:populationId,
      playerCommerceDailyLimitId:yunhua.id('player-commerce-daily-limit','standard'),playerCommercePracticeRuleId:yunhua.id('player-commerce-practice-rule','standard'),
      initialProsperity:city.capital?70:50,initialSafety:city.capital?70:50,cityMetricEffectResolverId:'resolver:city.metric-effect' as ResolverId});
  }
}
for(const ends of CONNECTING_ROUTES)add<RouteDefinition>({kind:'route',id:connectingRouteId(ends),fromCityId:worldCityId(ends[0]),toCityId:worldCityId(ends[1]),enabledByDefault:true,passagePolicyId:core.id<NationDefinition['passagePolicyId']>('passage-policy','domestic-open'),playerTravelEventPoolId:yunhua.id('player-travel-event-pool','domestic')});
export const worldCitiesDomain: AuthoredDomain={domain:'world-city',definitions,texts};

