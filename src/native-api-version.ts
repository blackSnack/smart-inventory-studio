// Native write dialects are selected by the authenticated server version, not fallback writes.
// API 232 is admitted for disposable acceptance only; production stays on its existing gate.
export type NativeApiVersion=232|570;
export function nativeApiVersion(raw:Record<string,unknown>,production:boolean):NativeApiVersion{
 if(raw.server==='InvenTree'&&raw.version==='1.7.4'&&raw.apiVersion===570)return 570;
 if(raw.server==='InvenTree'&&raw.version==='0.16.7'&&raw.apiVersion===232&&!production)return 232;
 throw Error('isolated version mismatch');
}
export const parameterPath=(api:NativeApiVersion)=>api===232?'api/part/parameter/':'api/parameter/';
export const parameterFilters=(api:NativeApiVersion,partId:string):Record<string,string>=>api===232?{part:partId}:{model_type:'part.part',model_id:partId};
export const parameterOwner=(api:NativeApiVersion,partId:string)=>api===232?{part:Number(partId)}:{model_type:'part.part',model_id:Number(partId)};
export function matchesPreparedApi(actual:NativeApiVersion,prepared:{apiVersion?:232}){
 if(actual!==(prepared.apiVersion??570))throw Error('API version changed after review');
}
