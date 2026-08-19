// modules/city/state.ts
// City 唯一可寫 Slice 的初始工廠與純函式讀寫 helper。
// Slice 型別權威在 contracts/city；此處不重新定義，只 re-export + 提供 immutable helper。
//
// 設計原則：
//   * 全部為決定性純函式；不 mutate 傳入 Slice，一律回傳新物件。
//   * Record 的走訪一律先排序鍵值——Job／刷新／情報列表都要可重播，物件插入順序不是可靠來源。
//   * 城市的繁榮／安全沒有程式預設值：建構子強制由呼叫端（Bootstrap／存檔）給定（doc §3.1
//     明訂第一版不自行建立數值來源）。

import type {
  CityId,
  CharacterId,
  FacilityDefinitionId,
  HomeId,
  HomeTeachingPostId,
  IntelLeadId,
  EscortCandidateId,
  ShopOfferId,
  Revision,
} from '../../contracts/core';
import type {
  CityState,
  CityRuntimeState,
  FacilityRuntimeState,
  ShopOffer,
  IntelLead,
  EscortCandidate,
  HomeInstance,
  HomeTeachingPost,
  PlayerDailyCommerceUsage,
} from '../../contracts/city';

export type { CityState };

// 空 Slice（新世界或測試起點）。
export const emptyCityState: CityState = Object.freeze({
  cities: Object.freeze({}),
  shopOffers: Object.freeze({}),
  intelLeads: Object.freeze({}),
  escortCandidates: Object.freeze({}),
  homes: Object.freeze({}),
  homeTeachingPosts: Object.freeze({}),
}) as CityState;

export function createCityState(
  input: Readonly<{
    cities?: readonly CityRuntimeState[];
    shopOffers?: readonly ShopOffer[];
    intelLeads?: readonly IntelLead[];
    escortCandidates?: readonly EscortCandidate[];
    homes?: readonly HomeInstance[];
    homeTeachingPosts?: readonly HomeTeachingPost[];
    playerCommerceUsage?: PlayerDailyCommerceUsage;
  }> = {},
): CityState {
  const cities: Record<CityId, CityRuntimeState> = {};
  for (const c of input.cities ?? []) cities[c.cityId] = c;

  const shopOffers: Record<ShopOfferId, ShopOffer> = {};
  for (const o of input.shopOffers ?? []) shopOffers[o.offerId] = o;

  const intelLeads: Record<IntelLeadId, IntelLead> = {};
  for (const i of input.intelLeads ?? []) intelLeads[i.intelId] = i;

  const escortCandidates: Record<EscortCandidateId, EscortCandidate> = {};
  for (const e of input.escortCandidates ?? []) escortCandidates[e.candidateId] = e;

  const homes: Record<HomeId, HomeInstance> = {};
  for (const h of input.homes ?? []) homes[h.homeId] = h;

  const homeTeachingPosts: Record<HomeTeachingPostId, HomeTeachingPost> = {};
  for (const p of input.homeTeachingPosts ?? []) homeTeachingPosts[p.postId] = p;

  return {
    cities,
    shopOffers,
    intelLeads,
    escortCandidates,
    homes,
    homeTeachingPosts,
    ...(input.playerCommerceUsage !== undefined
      ? { playerCommerceUsage: input.playerCommerceUsage }
      : {}),
  };
}

// 由 CityDefinition.facilityIds 建立一座城市的 Runtime State。
//
// `availability: 'open'` 不是「預設玩法值」而是**尚未套用任何限制**的狀態：限制只由
// `SetFacilityAvailability`（World／事件的合法來源，doc §5.3）產生。這與 map 的
// buildSpatialRuntime「門全關、陷阱 armed」是同一類——由結構決定的初始值。
// 繁榮與安全則相反：它們是數值，必須由呼叫端給定，沒有程式預設。
export function createCityRuntimeState(
  input: Readonly<{
    cityId: CityId;
    facilityIds: readonly FacilityDefinitionId[];
    prosperity: number;
    safety: number;
  }>,
): CityRuntimeState {
  const facilityStates: Record<FacilityDefinitionId, FacilityRuntimeState> = {};
  for (const facilityId of input.facilityIds) {
    facilityStates[facilityId] = {
      facilityId,
      availability: 'open',
      revision: 0 as Revision,
    };
  }
  return {
    cityId: input.cityId,
    facilityStates,
    prosperity: input.prosperity,
    safety: input.safety,
    revision: 0 as Revision,
  };
}

export function bumpRevision(revision: Revision): Revision {
  return (revision + 1) as Revision;
}

// ── 決定性走訪 ───────────────────────────────────────────────────────────────
// Record 的插入順序取決於建構歷史（存檔載入、逐筆 upsert 的先後），不是可重播的來源。
// 任何會影響 RNG 取用順序或事件順序的走訪都必須先排序。
function sortedValues<TKey extends string, TValue>(record: Record<TKey, TValue>): readonly TValue[] {
  return (Object.keys(record) as TKey[]).sort().map((key) => record[key]);
}

// ── City ────────────────────────────────────────────────────────────────────

export function tryGetCity(state: CityState, cityId: CityId): CityRuntimeState | undefined {
  return state.cities[cityId];
}

export function requireCity(state: CityState, cityId: CityId): CityRuntimeState {
  const found = state.cities[cityId];
  if (found === undefined) throw new Error(`CityState: unknown cityId "${String(cityId)}"`);
  return found;
}

export function listCities(state: CityState): readonly CityRuntimeState[] {
  return sortedValues(state.cities);
}

export function upsertCity(state: CityState, next: CityRuntimeState): CityState {
  return { ...state, cities: { ...state.cities, [next.cityId]: next } };
}

export function tryGetFacilityState(
  city: CityRuntimeState,
  facilityId: FacilityDefinitionId,
): FacilityRuntimeState | undefined {
  return city.facilityStates[facilityId];
}

export function upsertFacilityState(
  city: CityRuntimeState,
  next: FacilityRuntimeState,
): CityRuntimeState {
  return {
    ...city,
    facilityStates: { ...city.facilityStates, [next.facilityId]: next },
    revision: bumpRevision(city.revision),
  };
}

// ── ShopOffer ───────────────────────────────────────────────────────────────

export function tryGetOffer(state: CityState, offerId: ShopOfferId): ShopOffer | undefined {
  return state.shopOffers[offerId];
}

export function upsertOffer(state: CityState, next: ShopOffer): CityState {
  return { ...state, shopOffers: { ...state.shopOffers, [next.offerId]: next } };
}

export function listOffers(state: CityState): readonly ShopOffer[] {
  return sortedValues(state.shopOffers);
}

export function listOffersForFacility(
  state: CityState,
  cityId: CityId,
  facilityId: FacilityDefinitionId,
): readonly ShopOffer[] {
  return listOffers(state).filter((o) => o.cityId === cityId && o.facilityId === facilityId);
}

// 不變量 3：同一 ItemInstance 同時最多對應一個 available Offer。
export function hasAvailableOfferForItem(state: CityState, offer: ShopOffer): boolean {
  return listOffers(state).some(
    (o) => o.itemId === offer.itemId && o.state === 'available' && o.offerId !== offer.offerId,
  );
}

export function findAvailableOfferForItemId(
  state: CityState,
  itemId: ShopOffer['itemId'],
): ShopOffer | undefined {
  return listOffers(state).find((o) => o.itemId === itemId && o.state === 'available');
}

// ── IntelLead ───────────────────────────────────────────────────────────────

export function tryGetIntel(state: CityState, intelId: IntelLeadId): IntelLead | undefined {
  return state.intelLeads[intelId];
}

export function upsertIntel(state: CityState, next: IntelLead): CityState {
  return { ...state, intelLeads: { ...state.intelLeads, [next.intelId]: next } };
}

export function listIntel(state: CityState): readonly IntelLead[] {
  return sortedValues(state.intelLeads);
}

// ── EscortCandidate ─────────────────────────────────────────────────────────

export function upsertEscortCandidate(state: CityState, next: EscortCandidate): CityState {
  return {
    ...state,
    escortCandidates: { ...state.escortCandidates, [next.candidateId]: next },
  };
}

export function listEscortCandidates(state: CityState): readonly EscortCandidate[] {
  return sortedValues(state.escortCandidates);
}

// ── Home ────────────────────────────────────────────────────────────────────

export function tryGetHome(state: CityState, homeId: HomeId): HomeInstance | undefined {
  return state.homes[homeId];
}

export function upsertHome(state: CityState, next: HomeInstance): CityState {
  return { ...state, homes: { ...state.homes, [next.homeId]: next } };
}

export function listHomes(state: CityState): readonly HomeInstance[] {
  return sortedValues(state.homes);
}

// doc §3.6：同一城市對同一所有者最多一間房（transferred 的舊記錄不佔用該唯一性）。
export function findHomeInCityForOwner(
  state: CityState,
  cityId: CityId,
  ownerCharacterId: CharacterId,
): HomeInstance | undefined {
  return listHomes(state).find(
    (h) => h.cityId === cityId && h.ownerCharacterId === ownerCharacterId && h.state !== 'transferred',
  );
}

// ── HomeTeachingPost ────────────────────────────────────────────────────────

export function tryGetTeachingPost(
  state: CityState,
  postId: HomeTeachingPostId,
): HomeTeachingPost | undefined {
  return state.homeTeachingPosts[postId];
}

export function upsertTeachingPost(state: CityState, next: HomeTeachingPost): CityState {
  return {
    ...state,
    homeTeachingPosts: { ...state.homeTeachingPosts, [next.postId]: next },
  };
}

export function listTeachingPosts(state: CityState): readonly HomeTeachingPost[] {
  return sortedValues(state.homeTeachingPosts);
}

// ── PlayerDailyCommerceUsage ────────────────────────────────────────────────
//
// doc §3.6：只保留「玩家目前控制主角在目前世界日」的一筆。玩家主角或世界日改變時**直接替換**，
// 因而跨日自然歸零——不排歸零 Job、不累積歷史。這裡是那條規則的唯一實作點。
export function usageCountFor(
  state: CityState,
  playerCharacterId: CharacterId,
  worldDay: number,
): number {
  const usage = state.playerCommerceUsage;
  if (usage === undefined) return 0;
  if (usage.playerCharacterId !== playerCharacterId) return 0;
  if (usage.worldDay !== worldDay) return 0;
  return usage.commerceInteractionCount;
}

export function setPlayerCommerceUsage(
  state: CityState,
  next: PlayerDailyCommerceUsage,
): CityState {
  return { ...state, playerCommerceUsage: next };
}

// ── Home slot 記帳 ──────────────────────────────────────────────────────────
// 已安裝功能間的 slotCost 總和。slotCost 是資料（HomeUpgradeDefinition），此處只做加總。
export function installedSlotCost(
  home: HomeInstance,
  slotCostOf: (upgradeId: HomeInstance['installedUpgradeIds'][number]) => number,
): number {
  return home.installedUpgradeIds.reduce((sum, id) => sum + slotCostOf(id), 0);
}
