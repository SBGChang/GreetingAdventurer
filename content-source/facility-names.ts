import catalog from '../content/presentation/facilities.json';
import type {FacilityKind} from '../src/contracts/city';
/** Shared authored names; the compiler emits them into the formal localization packs. */
export function facilityName(cultureId:string,kind:FacilityKind):{'zh-Hant':string;en:string}{
 const row=catalog.facilities.find(p=>p.cultureId===cultureId&&p.kind===kind);
 if(!row)throw new Error(`Missing authored facility name: ${cultureId}/${kind}`);
 return row.name;
}
