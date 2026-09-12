// Formal city and route catalogue. Visual coordinates live in atlas.json;
// this authoring data owns connectivity, including the Yunxing lake crossing.
import { cultureIds } from './authoring';
import type { CityId, RouteId } from '../src/contracts/core';
export const WORLD_CITIES = [
  {
    "key": "yunjing",
    "culture": "yunhua",
    "name": {
      "zh-Hant": "雲京",
      "en": "Yunjing"
    },
    "capital": true
  },
  {
    "key": "qingcen",
    "culture": "yunhua",
    "name": {
      "zh-Hant": "青岑城",
      "en": "Qingcen"
    },
    "capital": false
  },
  {
    "key": "chengpu",
    "culture": "yunhua",
    "name": {
      "zh-Hant": "澄浦城",
      "en": "Chengpu"
    },
    "capital": false
  },
  {
    "key": "chiling",
    "culture": "yunhua",
    "name": {
      "zh-Hant": "赤嶺城",
      "en": "Chiling"
    },
    "capital": false
  },
  {
    "key": "frostbay",
    "culture": "vildun",
    "name": {
      "zh-Hant": "霜灣",
      "en": "Frostbay"
    },
    "capital": true
  },
  {
    "key": "cedarkeep",
    "culture": "vildun",
    "name": {
      "zh-Hant": "杉脊堡",
      "en": "Cedarkeep"
    },
    "capital": false
  },
  {
    "key": "dawncrown",
    "culture": "aurelien",
    "name": {
      "zh-Hant": "晨冠城",
      "en": "Dawncrown"
    },
    "capital": true
  },
  {
    "key": "greyshield",
    "culture": "aurelien",
    "name": {
      "zh-Hant": "灰楯堡",
      "en": "Greyshield"
    },
    "capital": false
  },
  {
    "key": "starwell",
    "culture": "safir",
    "name": {
      "zh-Hant": "星井城",
      "en": "Starwell"
    },
    "capital": true
  },
  {
    "key": "redsail",
    "culture": "safir",
    "name": {
      "zh-Hant": "赤帆驛",
      "en": "Redsail"
    },
    "capital": false
  },
  {
    "key": "icechisel",
    "culture": "vildun",
    "name": {
      "zh-Hant": "冰鑿城",
      "en": "Icechisel"
    },
    "capital": false
  },
  {
    "key": "emberforge",
    "culture": "vildun",
    "name": {
      "zh-Hant": "燼鐵城",
      "en": "Emberforge"
    },
    "capital": false
  },
  {
    "key": "windharvest",
    "culture": "aurelien",
    "name": {
      "zh-Hant": "風穗城",
      "en": "Windharvest"
    },
    "capital": false
  },
  {
    "key": "whitecliff",
    "culture": "aurelien",
    "name": {
      "zh-Hant": "白崖港",
      "en": "Whitecliff"
    },
    "capital": false
  },
  {
    "key": "saltmirror",
    "culture": "safir",
    "name": {
      "zh-Hant": "鹽鏡城",
      "en": "Saltmirror"
    },
    "capital": false
  },
  {
    "key": "ochrestep",
    "culture": "safir",
    "name": {
      "zh-Hant": "赭階城",
      "en": "Ochrestep"
    },
    "capital": false
  }
] as const;
export const CONNECTING_ROUTES = [
  [
    "frostbay",
    "cedarkeep"
  ],
  [
    "frostbay",
    "icechisel"
  ],
  [
    "frostbay",
    "emberforge"
  ],
  [
    "icechisel",
    "emberforge"
  ],
  [
    "dawncrown",
    "greyshield"
  ],
  [
    "dawncrown",
    "windharvest"
  ],
  [
    "dawncrown",
    "whitecliff"
  ],
  [
    "greyshield",
    "windharvest"
  ],
  [
    "windharvest",
    "whitecliff"
  ],
  [
    "starwell",
    "redsail"
  ],
  [
    "starwell",
    "saltmirror"
  ],
  [
    "starwell",
    "ochrestep"
  ],
  [
    "redsail",
    "saltmirror"
  ],
  [
    "saltmirror",
    "ochrestep"
  ],
  [
    "qingcen",
    "emberforge"
  ],
  [
    "chengpu",
    "redsail"
  ],
  [
    "saltmirror",
    "windharvest"
  ],
  [
    "whitecliff",
    "frostbay"
  ],
  [
    "yunjing",
    "starwell"
  ]
] as const;
export function worldCityId(key: string): CityId {
  const city=WORLD_CITIES.find(c=>c.key===key);
  if(!city)throw new Error('Unknown authored city: '+key);
  return cultureIds(city.culture).id<CityId>('city-node',city.key);
}
export function connectingRouteId(ends: readonly string[]): RouteId {
  return cultureIds('core').id<RouteId>('route',ends.join('-'));
}
export function extraRouteIdsFor(cityId: CityId): RouteId[] {
  return CONNECTING_ROUTES.filter(ends=>ends.some(k=>worldCityId(k)===cityId)).map(connectingRouteId);
}
