import type {LabelEvidence,CodeObservation} from '../../src/photo-intake';
import {PhotoIntakeProvider,normalizeCodes,mergeLabelEvidence} from '../../src/photo-intake';
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
export async function decodePhoto(file:File):Promise<{codes:CodeObservation[];status:DecodeStatus}>{
 const Detector=(globalThis as unknown as {BarcodeDetector?:DetectorClass}).BarcodeDetector;let image:ImageBitmap|undefined;
 try{image=await createImageBitmap(file);if(image.width*image.height>40_000_000)return {codes:[],status:'failed'};
 let native:CodeObservation[]=[];if(Detector){try{const formats=Detector.getSupportedFormats?await Detector.getSupportedFormats():['qr_code','code_128','ean_13','code_39','data_matrix'];if(formats.length)native=(await new Detector({formats}).detect(image)).map(x=>({format:x.format,raw:x.rawValue}))}catch{/* use bundled fallback */}}
 let fallback:CodeObservation[]=[];try{fallback=await fallbackDecode(image)}catch{const codes=normalizeCodes(native);return {codes,status:codes.length?'decoded':'failed'}}
 const codes=normalizeCodes([...native,...fallback]);return {codes,status:codes.length?'decoded':'none'}
 }catch{return {codes:[],status:'failed'}}finally{image?.close()}
}
export async function recognizePhoto(file:File,gateway:GatewayConfig,catalog:Catalog,signal?:AbortSignal,progress?:(s:string)=>void){
 progress?.('读取原图及编码…');const [data,decoded]=await Promise.all([photoData(file),decodePhoto(file)]);if(signal?.aborted)throw Error('cancelled');progress?.('提取标签文字…');const provider=new PhotoIntakeProvider(gateway.url,gateway.key,gateway.model);let evidence=await provider.extract(data,catalog,decoded.codes,signal);if(evidence.kind==='package'&&evidence.readability!=='clear'&&evidence.bounds&&!signal?.aborted){progress?.('复核标签特写…');try{const crop=await photoData(file,evidence.bounds);const second=await provider.extract(crop,catalog,decoded.codes,signal);evidence=mergeLabelEvidence(evidence,second)}catch{if(signal?.aborted)throw Error('cancelled');evidence={...evidence,cropRetried:true}}}return {evidence,status:decoded.status}
}
export function PhotoEvidence({evidence,status}:{evidence:LabelEvidence;status:DecodeStatus}){
 const hint=evidence.kind==='multiple'?'检测到多个包装，请逐个拍摄，不能将不同标签合并。':evidence.kind==='bare'?'裸元件仅提供类别候选，具体型号和参数需要人工确认。':evidence.kind!=='package'||evidence.readability==='unreadable'?'没有可靠标签，请重新拍摄或手动填写。':evidence.readability==='partial'?'标签部分可读，请核对型号、数量和缺失字段。':'请对照原始标签确认识别值。';
 return <section className="studio-surface space-y-3"><h3>标签识别证据</h3><p className="text-sm" role="status">{hint}</p>{evidence.cropRetried&&<p className="text-xs text-muted">已尝试原始照片标签特写复核。</p>}{evidence.candidateCategory&&!evidence.draft.category&&<p className="text-sm text-muted">视觉分类候选：{evidence.candidateCategory}（未自动采用）</p>}{evidence.quantity!==null&&<p className="text-sm">包装标记数量：{evidence.quantity} 件 · 待确认</p>}{evidence.conflicts.map(v=><p key={v} role="alert" className="text-sm text-warn">{v}</p>)}<details className="space-y-2"><summary className="cursor-pointer min-h-11">原始标签文字与编码</summary><pre className="whitespace-pre-wrap break-words text-sm">{evidence.rawText||'无可读文字'}</pre><p className="text-sm text-muted">{status==='unsupported'?'浏览器不支持本地解码；继续使用标签文字。':status==='failed'?'编码解码失败；继续使用标签文字。':status==='none'?'未读到编码。':'已读取编码（不自动视为商品编号）'}</p>{evidence.codes.map((c,i)=><p key={i} className="text-sm break-all">{c.format}：{c.raw}</p>)}</details></section>
}
