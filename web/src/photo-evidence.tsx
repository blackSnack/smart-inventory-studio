import type {LabelEvidence,CodeObservation} from '../../src/photo-intake';
import {PhotoIntakeProvider,normalizeCodes} from '../../src/photo-intake';
import type {Catalog} from '../../src/catalog';
import type {GatewayConfig} from './receiving-page';
import {photoData} from './photo-picker';
type Detector={detect(source:ImageBitmap):Promise<{format:string;rawValue:string}[]>};
type DetectorClass={new(options:{formats:string[]}):Detector;getSupportedFormats?:()=>Promise<string[]>};
export type DecodeStatus='decoded'|'none'|'unsupported'|'failed';
export async function decodePhoto(file:File):Promise<{codes:CodeObservation[];status:DecodeStatus}>{
 const Detector=(globalThis as unknown as {BarcodeDetector?:DetectorClass}).BarcodeDetector;
 if(!Detector)return {codes:[],status:'unsupported'};
 let image:ImageBitmap|undefined;
 try{const formats=Detector.getSupportedFormats?await Detector.getSupportedFormats():['qr_code','code_128','ean_13','code_39','data_matrix'];if(!formats.length)return {codes:[],status:'unsupported'};image=await createImageBitmap(file);if(image.width*image.height>40_000_000)return {codes:[],status:'failed'};
 const codes=normalizeCodes((await new Detector({formats}).detect(image)).map(x=>({format:x.format,raw:x.rawValue})));return {codes,status:codes.length?'decoded':'none'}
 }catch{return {codes:[],status:'failed'}}finally{image?.close()}
}
export async function recognizePhoto(file:File,gateway:GatewayConfig,catalog:Catalog,signal?:AbortSignal,progress?:(s:string)=>void){
 progress?.('读取原图及编码…');const [data,decoded]=await Promise.all([photoData(file),decodePhoto(file)]);if(signal?.aborted)throw Error('cancelled');progress?.('提取标签文字…');const evidence=await new PhotoIntakeProvider(gateway.url,gateway.key,gateway.model).extract(data,catalog,decoded.codes,signal);return {evidence,status:decoded.status}
}
export function PhotoEvidence({evidence,status}:{evidence:LabelEvidence;status:DecodeStatus}){
 const hint=evidence.kind==='multiple'?'检测到多个包装，请逐个拍摄，不能将不同标签合并。':evidence.kind==='bare'?'裸元件仅提供类别候选，具体型号和参数需要人工确认。':evidence.kind!=='package'||evidence.readability==='unreadable'?'没有可靠标签，请重新拍摄或手动填写。':evidence.readability==='partial'?'标签部分可读，请核对型号、数量和缺失字段。':'请对照原始标签确认识别值。';
 return <section className="studio-surface space-y-3"><h3>标签识别证据</h3><p className="text-sm" role="status">{hint}</p>{evidence.candidateCategory&&!evidence.draft.category&&<p className="text-sm text-muted">视觉分类候选：{evidence.candidateCategory}（未自动采用）</p>}{evidence.quantity!==null&&<p className="text-sm">包装标记数量：{evidence.quantity} 件 · 待确认</p>}{evidence.conflicts.map(v=><p key={v} role="alert" className="text-sm text-warn">{v}</p>)}<details className="space-y-2"><summary className="cursor-pointer min-h-11">原始标签文字与编码</summary><pre className="whitespace-pre-wrap break-words text-sm">{evidence.rawText||'无可读文字'}</pre><p className="text-sm text-muted">{status==='unsupported'?'浏览器不支持本地解码；继续使用标签文字。':status==='failed'?'编码解码失败；继续使用标签文字。':status==='none'?'未读到编码。':'已读取编码（不自动视为商品编号）'}</p>{evidence.codes.map((c,i)=><p key={i} className="text-sm break-all">{c.format}：{c.raw}</p>)}</details></section>
}
