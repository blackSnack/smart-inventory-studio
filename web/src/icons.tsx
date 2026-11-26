// Reicon 1.2.6. Shared sizing contract; controls own accessible labels.
import type {ComponentProps,ComponentType} from 'react';
import {Camera as RCamera,Home as RHome,Package as RPackage,Warehouse as RWarehouse,Settings as RSettings,Keyboard as RKeyboard,ChevronRight as RChevronRight,Grid3 as RGrid3,Images as RImages,File as RFile,ArrowLeft as RArrowLeft,Plus as RPlus,X as RX,Search3 as RSearch3} from 'reicon-react';
type SourceProps=ComponentProps<typeof RHome>;
type Props={className?:string};
function icon(Icon:ComponentType<SourceProps>){return function StudioIcon({className}:Props){return <span aria-hidden="true" className={['studio-icon',className].filter(Boolean).join(' ')}><Icon aria-hidden="true" size={18} strokeWidth={1.5} weight="Outline"/></span>}}
export const Camera=icon(RCamera);
export const House=icon(RHome);
export const Package=icon(RPackage);
export const Warehouse=icon(RWarehouse);
export const Settings=icon(RSettings);
export const Keyboard=icon(RKeyboard);
export const ChevronRight=icon(RChevronRight);
export const Grid3X3=icon(RGrid3);
export const Images=icon(RImages);
export const FileImage=icon(RFile);
export const ArrowLeft=icon(RArrowLeft);
export const Plus=icon(RPlus);
export const X=icon(RX);
export const Search=icon(RSearch3);
