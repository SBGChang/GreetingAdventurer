import catalog from '../content/presentation/facilities.json';
import type {FacilityView} from './engine/game-facade';
import type {UiLocale} from './i18n';

export type ReceptionExpression='normal'|'happy'|'angry'|'sad';
export type ReceptionEvent='welcome'|'selected'|'unavailable'|'empty'|'accepted'|'rejected'|'failed';
export type ReceptionProfile=(typeof catalog.facilities)[number];
const art=import.meta.glob<string>('./assets/facilities/*.png',{eager:true,query:'?url',import:'default'});
export function facilityPresentation(cultureId:string,kind:FacilityView['kind']):ReceptionProfile{
 const profile=catalog.facilities.find(p=>p.cultureId===cultureId&&p.kind===kind);
 if(!profile)throw new Error(`Missing facility presentation: ${cultureId}/${kind}`);
 return profile;
}
export function receptionArt(file:string):string{
 const url=art[`./assets/facilities/${file}`];
 if(!url)throw new Error(`Missing reception art: ${file}`);
 return url;
}
export function receptionExpression(event:ReceptionEvent):ReceptionExpression{
 const states:Record<ReceptionEvent,ReceptionExpression>={welcome:'normal',selected:'normal',unavailable:'sad',empty:'sad',accepted:'happy',rejected:'angry',failed:'sad'};
 return states[event];
}
export function facilityLabel(cultureId:string,kind:FacilityView['kind'],locale:UiLocale):string{return facilityPresentation(cultureId,kind).name[locale]}
export const receptionProfiles=catalog.facilities;
