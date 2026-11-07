export type CachedItem={id:number;producto_id:number;nombre:string;precio:number;cantidad:number};
// En web no importamos expo-sqlite: su módulo WASM puede requerir configuración extra.
let token:string|null=null;
const cache=new Map<number,CachedItem[]>();
export async function getToken(){return token;}
export async function setToken(next:string|null){token=next;}
export async function loadCart(userId:number){return cache.get(userId)||[];}
export async function saveCart(userId:number,items:CachedItem[]){cache.set(userId,items);}
