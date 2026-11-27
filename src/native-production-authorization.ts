// Production authorization is a locally reviewed operator gate, not server permission or cryptographic attestation.
// No native writer may use a non-loopback origin without a validated target authorization.
import {validateCatalog} from './catalog.js';
import {snapshotKey} from './approved-snapshot.js';
import {contractWrites} from './inventree-contract-evidence.js';
const authorized=new WeakSet<object>();
export interface ProductionNativeTarget {readonly base:string;readonly actorId:string;readonly schemaSha256:string;readonly catalogSha256:string;readonly approvalId:string;readonly evidenceSha256:string}
const obj=(x:unknown):Record<string,unknown>=>{if(!x||typeof x!=='object'||Array.isArray(x))throw Error('invalid private deployment evidence');return x as Record<string,unknown>};
const hex=(x:unknown):x is string=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
export const nativeCatalogHash=async(catalog:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(snapshotKey(validateCatalog(catalog))))),b=>b.toString(16).padStart(2,'0')).join('');
export const productionEvidenceHash=async(e:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(snapshotKey(e)))),b=>b.toString(16).padStart(2,'0')).join('');
function httpsBase(base:string){const u=new URL(base);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/'||['127.0.0.1','[::1]','localhost'].includes(u.hostname))throw Error('production requires explicit HTTPS origin');return u}
export const productionEvidenceKeys=['environment','backupRestore','catalogFreeze','isolatedAcceptance','permissionsVisibility','referencesAndAudit'] as const;
export async function authorizeProductionNativeTarget(base:string,rawCatalog:unknown,rawEvidence:unknown,explicitApproval:boolean):Promise<ProductionNativeTarget>{
 const c=validateCatalog(structuredClone(rawCatalog)),u=httpsBase(base);
 if(c.status!=='approved_for_production'||!/^1\.0(?:\.0)?$/.test(c.catalogVersion))throw Error('catalog v1.0 freeze is required before production writes');
 if(explicitApproval!==true)throw Error('separate production activation approval required');
 const e=obj(structuredClone(rawEvidence)),catalogSha256=await nativeCatalogHash(c),refs=obj(e.evidence),permissions=obj(e.operationPermissions);
 if(e.version!==1||e.targetBase!==u.href||e.catalogVersion!==c.catalogVersion||e.catalogSha256!==catalogSha256||e.softwareVersion!=='1.7.4'||e.apiVersion!==570||typeof e.actorId!=='string'||!(/^[1-9][0-9]{0,15}$/).test(e.actorId)||!Number.isSafeInteger(Number(e.actorId))||!hex(e.schemaSha256)||typeof e.approvalId!=='string'||!e.approvalId.trim()||e.approvalId.length>128||e.productionWriteAuthorized!==true||e.exclusiveWindowConfirmed!==true||productionEvidenceKeys.some(k=>!hex(refs[k]))||contractWrites.some(w=>permissions[w.key]!==true))throw Error('incomplete or stale operator-reviewed production evidence');
 const target=Object.freeze({base:u.href,actorId:e.actorId,schemaSha256:e.schemaSha256,catalogSha256,approvalId:e.approvalId,evidenceSha256:await productionEvidenceHash(e)});
 authorized.add(target);return target;
}
export function authorizedNativeBase(base:string,production?:ProductionNativeTarget){
 if(production){const u=httpsBase(base);if(!authorized.has(production)||production.base!==u.href)throw Error('production authority scope mismatch');return u}
 const u=new URL(base);if(!['http:','https:'].includes(u.protocol)||!['127.0.0.1','[::1]'].includes(u.hostname)||!u.port||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('explicit loopback disposable instance with port required');return u;
}
export function assertNativeTarget(production:ProductionNativeTarget|undefined,actorId:string,schemaSha256:string){if(production&&(!authorized.has(production)||production.actorId!==actorId||production.schemaSha256!==schemaSha256))throw Error('approved production actor or schema changed')}
export function assertNativeMode(production:ProductionNativeTarget|undefined,approval:Record<string,unknown>){if(production){if(!authorized.has(production)||approval.productionOperationConfirmed!==true||approval.productionEvidenceSha256!==production.evidenceSha256)throw Error('exact production operation approval required')}else if(approval.disposableInstanceConfirmed!==true)throw Error('disposable instance confirmation required')}
