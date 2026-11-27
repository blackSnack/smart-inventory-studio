// Compare the actual structured data, not lossy JSON serialization (NaN/null, missing/undefined).
 // Optional object properties may be undefined; non-finite numbers, sparse arrays and non-data objects are invalid.
 export function snapshotKey(value:unknown,ancestors=new Set<object>()):string{
  if(value===undefined)return 'u';
  if(value===null)return 'null';
  if(typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'){if(!Number.isFinite(value))throw Error('invalid journal numeric value');return Object.is(value,-0)?'-0':JSON.stringify(value)}
  if(typeof value!=='object'||ancestors.has(value))throw Error('invalid journal snapshot');
  ancestors.add(value);
  try{
   if(Array.isArray(value)){if(Object.keys(value).length!==value.length)throw Error('invalid journal array');const parts:string[]=[];for(let i=0;i<value.length;i++){if(!Object.hasOwn(value,i))throw Error('invalid journal array');parts.push(snapshotKey(value[i],ancestors))}return '['+parts.join(',')+']'}
   if(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)throw Error('invalid journal data object');
   return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+snapshotKey((value as Record<string,unknown>)[k],ancestors)).join(',')+'}';
  }finally{ancestors.delete(value)}
 }

