import type {LabelEvidence,PackageCandidate,CodeObservation,LabelBounds} from '../../src/photo-intake';
import {hasStrongPhotoIdentity} from '../../src/photo-intake';
import {Button} from './ui';
import {PhotoIntakeProvider,normalizeCodes,mergeLabelEvidence,reconcileLcscEvidence,parseLcscLabelCode,lcscLabelCodes} from '../../src/photo-intake';
import type {Catalog} from '../../src/catalog';
import type {GatewayConfig} from './receiving-page';
import {photoData} from './photo-picker';
type Detector={detect(source:ImageBitmap):Promise<{format:string;rawValue:string}[]>};
type DetectorClass={new(options:{formats:string[]}):Detector;getSupportedFormats?:()=>Promise<string[]>};
export type DecodeStatus='decoded'|'none'|'unsupported'|'failed';
// Native detector when available, bundled ZXing fallback on desktop/iOS/Android.
// All decoding stays local, with bounded image resolution and no network URLs.
async function fallbackDecode(image:ImageBitmap):Promise<CodeObservation[]>{
 if(image.width<32||image.height<32)return [];
 const {BarcodeFormat,BinaryBitmap,DecodeHintType,HybridBinarizer,MultiFormatReader,RGBLuminanceSource}=await import('@zxing/library');
 const scale=Math.min(1,2000/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('decoder canvas unavailable');ctx.drawImage(image,0,0,canvas.width,canvas.height);
 const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data,gray=new Uint8ClampedArray(canvas.width*canvas.height);for(let i=0;i<gray.length;i++)gray[i]=(rgba[4*i]+2*rgba[4*i+1]+rgba[4*i+2])/4;
 const bitmap=new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(gray,canvas.width,canvas.height))),reader=new MultiFormatReader(),out:CodeObservation[]=[];
 for(const formats of [[BarcodeFormat.QR_CODE,BarcodeFormat.DATA_MATRIX,BarcodeFormat.PDF_417,BarcodeFormat.AZTEC],[BarcodeFormat.CODE_128,BarcodeFormat.CODE_39,BarcodeFormat.EAN_13,BarcodeFormat.EAN_8,BarcodeFormat.UPC_A,BarcodeFormat.UPC_E,BarcodeFormat.ITF,BarcodeFormat.CODABAR]]){
  try{const hints=new Map<import('@zxing/library').DecodeHintType,unknown>([[DecodeHintType.POSSIBLE_FORMATS,formats],[DecodeHintType.TRY_HARDER,true]]);const result=reader.decode(bitmap,hints);out.push({format:BarcodeFormat[result.getBarcodeFormat()].toLowerCase(),raw:result.getText()})}catch{/* no code found for this family */}finally{reader.reset()}
 }
 return out;
}
export async function decodePhoto(file:File,bounds?:LabelBounds):Promise<{codes:CodeObservation[];status:DecodeStatus}>{
 const Detector=(globalThis as unknown as {BarcodeDetector?:DetectorClass}).BarcodeDetector;let image:ImageBitmap|undefined;
 try{image=await createImageBitmap(file);if(image.width*image.height>40_000_000)return {codes:[],status:'failed'};if(bounds){const original=image;const x=Math.floor(bounds[0]*original.width),y=Math.floor(bounds[1]*original.height),w=Math.min(original.width-x,Math.ceil(bounds[2]*original.width)),h=Math.min(original.height-y,Math.ceil(bounds[3]*original.height));image=await createImageBitmap(original,x,y,w,h);original.close()}
 let native:CodeObservation[]=[];if(Detector){try{const formats=Detector.getSupportedFormats?await Detector.getSupportedFormats():['qr_code','code_128','ean_13','code_39','data_matrix'];if(formats.length)native=(await new Detector({formats}).detect(image)).map(x=>({format:x.format,raw:x.rawValue}))}catch{/* use bundled fallback */}}
 let fallback:CodeObservation[]=[];try{fallback=await fallbackDecode(image)}catch{const codes=normalizeCodes(native);return {codes,status:codes.length?'decoded':'failed'}}
 const codes=normalizeCodes([...native,...fallback]);return {codexport async function recognizePhoto(file:File,gateway:GatewayConfig,catalog:Catalog,signal?:AbortSignal,progress?:(s:string)=>void){
 progress?.('读取原图及编码…');const [data,decoded]=await Promise.all([photoData(file),decodePhoto(file)]);if(signal?.aborted)throw Error('cancelled');progress?.('提取标签文字…');const provider=new PhotoIntakeProvider(gateway.url,gateway.key,gateway.model);let evidence=await provider.extract(data,catalog,decoded.codes,signal);let status=decoded.status;
 if(evidence.kind==='multiple'){
  const candidates:PackageCandidate[]=[];
  for(const candidate of evidence.packages??[]){
   if(signal?.aborted)throw Error('cancelled');
   let current:LabelEvidence=candidate;
   if(candidate.bounds){
    const local=await decodePhoto(file,candidate.bounds);if(signal?.aborted)throw Error('cancelled');
    if(local.codes.length){current=reconcileLcscEvidence(current,local.codes);status='decoded'}
    if(current.readability!=='clear'){
     progress?.('复核独立包装特写…');
     try{const crop=await photoData(file,candidate.bounds),second=await provider.extract(crop,catalog,current.codes,signal);if(second.kind==='package')current=mergeLabelEvidence(current,second)}catch{if(signal?.aborted)throw Error('cancelled');current={...current,cropRetried:true}}
    }
   }
   if(current.kind!=='package')throw Error('invalid package candidate state');
   const {packages:_nested,...fields}=current;candidates.push({...fields,id:candidate.id});
  }
  evidence={...evidence,packages:candidates};
 }else if(evidence.kind==='package'&&evidence.bounds&&!signal?.aborted){
  const bounds=evidence.bounds;if(!lcscLabelCodes(evidence.codes).length){progress?.('复核标签编码…');const local=await decodePhoto(file,bounds);if(signal?.aborted)throw Error('cancelled');evidence=reconcileLcscEvidence(evidence,local.codes);if(local.codes.length)status='decoded'}
  if(evidence.readability!=='clear'){progress?.('复核标签特写…');try{const crop=await photoData(file,bounds);const second=await provider.extract(crop,catalog,evidence.codes,signal);evidence=mergeLabelEvidence(evidence,second)}catch{if(signal?.aborted)throw Error('cancelled');evidence={...evidence,cropRetried:true}}}
 }
 return {evidence,status}
}
export function PhotoEvidence({evidence,status,onSelectPackage}:{evidence:LabelEvidence;status:DecodeStatus;onSelectPackage?:(candidate:PackageCandidate)=>void}){
 const hint=evidence.kind==='multiple'?'检测到多个包装。每个包装独立列出，选择一个后单独审核；不同标签不会合并。':evidence.kind==='bare'?'裸元件仅提供类别候选，具体型号和参数需要人工确认。':evidence.kind!=='package'||evidence.readability==='unreadable'?'没有可靠标签，请重新拍摄或手动填写。':evidence.readability==='partial'?'标签部分可读，请核对型号、数量和缺失字段。':'请对照原始标签确认识别值。';
 return <section className="studio-surface space-y-3"><h3>标签识别证据</h3><p className="text-sm" role="status">{hint}</p>
 {evidence.kind==='multiple'&&<div className="space-y-3">{evidence.packages?.length?evidence.packages.map((candidate,index)=><div key={candidate.id} className="studio-inset space-y-2"><div className="flex items-center justify-between gap-2"><strong>包装 {index+1}</strong><span className="text-xs text-muted">{candidate.readability==='clear'?'标签清晰':candidate.readability==='partial'?'部分可读':'无法辨认'}</span></div><p className="text-sm">{candidate.draft.name??'名称未知'} · {candidate.draft.mpn??'型号未知'}</p><p className="text-xs text-muted">{candidate.draft.manufacturer??'制造商未知'} · {candidate.draft.supplier??'供应商未知'} · {candidate.quantity===null?'数量待填写':candidate.quantity+' 件（待确认）'}</p>{candidate.candidateCategory&&!candidate.draft.category&&<p className="text-xs text-muted">分类候选：{candidate.candidateCategory}（未自动采用）</p>}<details><summary className="cursor-pointer min-h-9 text-sm">查看该包装原始文字</summary><pre className="whitespace-pre-wrap break-words text-sm">{candidate.rawText||'无可读文字'}</pre></details><Button type="button" variant="secondary" className="w-full" disabled={!onSelectPackage} onClick={()=>onSelectPackage?.(candidate)}>选择包装 {index+1}</Button></div>):<p className="text-sm text-warn">无法可靠分离每个包装。请重新拍摄单个包装，或手动录入；不会把整张照片猜成一个元件。</p>}</div>}
 {evidence.kind==='package'&&evidence.cropRetried&&<p className="text-xs text-muted">已尝试原始照片标签特写复核。</p>}
 {evidence.kind==='package'&&lcscLabelCodes(evidence.codes).map((v,i)=><p key={'lcsc'+i} className="text-sm">立创编码：{v.sku} · {v.mpn} · {v.quantity} 件（待确认）</p>)}
 {evidence.kind==='package'&&evidence.candidateCategory&&!evidence.draft.category&&<p className="text-sm text-muted">视觉分类候选：{evidence.candidateCategory}（未自动采用）</p>}


 {evidence.kind==='package'&&evidence.quantity!==null&&<p className="text-sm">包装标记数量：{evidence.quantity} 件 · 待确认</p>}
 {evidence.kind==='package'&&evidence.conflicts.map(v=><p key={v} role="alert" className="text-sm text-warn">{v}</p>)}
 <details className="space-y-2"><summary className="cursor-pointer min-h-11">原始标签文字与编码</summary><pre className="whitespace-pre-wrap break-words text-sm">{evidence.rawText||'无可读文字'}</pre><p className="text-sm text-muted">{status==='unsupported'?'浏览器不支持本地解码；继续使用标签文字。':status==='failed'?'编码解码失败；继续使用标签文字。':status==='none'?'未读到编码。':'已读取编码（不自动视为商品编号）'}</p>{evidence.codes.map((c,i)=><p key={i} className="text-sm break-all">{c.format}：{parseLcscLabelCode(c.raw)?'立创商品编码（订单字段已隐藏）':c.raw}</p>)}</details>
 </section>
}