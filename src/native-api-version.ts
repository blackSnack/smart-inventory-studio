// Native write dialects are selected by the authenticated server version, not fallback writes.
// Production requires the same independently approved version-bound evidence as the current gate.
import type {ProductionNativeTarget} from './native-production-authorization.js';
export type NativeApiVersion=232|570;
export function nativeApiVersion(raw:Record<string,unknown>,production?:ProductionNativeTarget):NativeApiVersion{
 const api=raw.server==='InvenTree'&&raw.version==='1.7.4'&&raw.apiVersion===570?570:raw.server==='InvenTree'&&raw.version==='0.16.7'&&raw.apiVersion===232?232:null;
 if(api===null||production&&(production.apiVersion!==api||production.softwareVersion!==raw.version))throw Error('isolated or approved production version mismatch');
 return api;
}
export const parameterPath=(api:NativeApiVersion)=>api===232?'api/part/parameter/':'api/parameter/';
export const parameterFilters=(api:NativeApiVersion,partId:string):Record<string,string>=>api===232?{part:partId}:{model_type:'part.part',model_id:partId};
export const parameterOwner=(api:NativeApiVersion,partId:string)=>api===232?{part:Number(partId)}:{model_type:'part.part',model_id:Number(partId)};
export function matchesPreparedApi(actual:NativeApiVersion,prepared:{apiVersion?:232}){
 if(actual!==(prepared.apiVersion??570))throw Error('API version changed after review');
}
