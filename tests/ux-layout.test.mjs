import {test} from 'node:test';import assert from 'node:assert/strict';
import {newCabinet,expandCabinet,frontDimensions,replaceDrawer} from '../dist/cabinet-layout.js';
import {splitByRatio,mergeCompartments,sameCompartmentGeometry,validateDrawer} from '../dist/storage-layout.js';
import {seedWarehouse,applyCabinetLayout,previewCabinetRelocation,applyCabinetRelocation} from '../dist/warehouse-state.js';
test('front cabinet initializes 30 drawers, 90 leaves; expansion only initializes new drawers',()=>{
 const a=newCabinet('C','C',frontDimensions(5,6),'C',{count:3,axis:'vertical'});
 assert.equal(a.cells.length,30);assert.equal(a.cells.flatMap(c=>c.drawer.compartments).length,90);
 const b=expandCabinet(a,frontDimensions(7,7),'C',{count:5,axis:'horizontal'});
 assert.equal(b.cells.length,49);assert.deepEqual(b.cells.slice(0,30),a.cells);
 assert.equal(b.cells.slice(30).flatMap(c=>c.drawer.compartments).length,95);
});
test('exact five/seven partitions, recursive ratio and complete merge',()=>{
 const d=newCabinet('C','C',frontDimensions(1,1),'C').cells[0].drawer;
 const a=splitByRatio(d,d.compartments[0].id,'vertical',[1,1,1,1,1],['a','b','c','d','e']);
 assert.equal(a.width,5);assert.equal(a.height,1);assert.ok(a.compartments.every(r=>r.width===1));
 const b=splitByRatio(a,'c','horizontal',[1,2],['c1','c2']);assert.equal(b.height,3);assert.equal(b.compartments.find(r=>r.id==='c2').height,2);
 assert.ok(sameCompartmentGeometry(a,a.compartments[0],b,b.compartments[0]));
 const c=mergeCompartments(b,['c1','c2'],'c3');const e=mergeCompartments(c,c.compartments.map(r=>r.id),'all');validateDrawer(e);assert.equal(e.compartments.length,1);
 const seven=splitByRatio(e,'all','vertical',Array(7).fill(1),Array.from({length:7},(_,i)=>'s'+i));assert.equal(seven.width,7);
});
test('rescaling preserves unaffected leaf binding and stock; affected stock must migrate',()=>{
 const w=seedWarehouse([{id:'A',rows:1,cols:1}]);let l=w.cabinets[0].layout,c=l.cells[0];
 l=replaceDrawer(l,c.id,splitByRatio(c.drawer,c.drawer.compartments[0].id,'vertical',[1,1,1],['a','b','c']));
 const w2=applyCabinetLayout(w,l,[]);c=w2.cabinets[0].layout.cells[0];const keep=w2.cabinets[0].leaves.a,source=w2.cabinets[0].leaves.b;
 const draft=replaceDrawer(w2.cabinets[0].layout,c.id,splitByRatio(c.drawer,'b','vertical',[1,2],['b1','b2']));
 const parts=[{id:'p',name:'P',stock:{[keep]:10,[source]:20}}];const p=previewCabinetRelocation(w2,draft,parts);
 assert.equal(p.warehouse.cabinets[0].leaves.a,keep);assert.equal(p.sources.length,1);assert.throws(()=>applyCabinetRelocation(w2,draft,parts,[]));
 const target=p.warehouse.cabinets[0].leaves.b1;const next=applyCabinetRelocation(w2,draft,parts,[{partId:'p',sourceId:source,targetId:target,quantity:20}]);assert.equal(next.parts[0].stock[keep],10);assert.equal(next.parts[0].stock[target],20);
});
test('reject invalid weights and capacity instead of rounding',()=>{const d=newCabinet('X','X',frontDimensions(1,1),'X').cells[0].drawer;const id=d.compartments[0].id;assert.throws(()=>splitByRatio(d,id,'vertical',[1,0],['a','b']));assert.throws(()=>splitByRatio(d,id,'vertical',[1,1000001],['a','b']));assert.throws(()=>splitByRatio(d,id,'vertical',Array(1001).fill(1),Array.from({length:1001},(_,i)=>'s'+i)))});
