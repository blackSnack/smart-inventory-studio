// A retired native leaf is kept as a real record; never delete or reuse its ID.
export const retiredLocationPrefix='__studio_retired_';
export function retiredLocationName(id:string){if(!/^[1-9][0-9]{0,15}$/.test(id))throw Error('invalid retired ID');return retiredLocationPrefix+id}
export const isRetiredLocationName=(name:string)=>name.trim().toLowerCase().startsWith(retiredLocationPrefix);
