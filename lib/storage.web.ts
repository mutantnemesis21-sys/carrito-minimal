import type {Producto,Item,Pendiente} from './storage.native';
// Fallback web para demostración; la persistencia SQLite real funciona en Android/iOS.
let token:string|null=null,user:any=null;
const products=new Map<number,Producto[]>(),cart=new Map<number,Item[]>(),pending=new Map<number,Pendiente[]>();
export async function getToken(){return token;}export async function setToken(t:string|null){token=t;}
export async function getUser(){return user;}export async function setUser(u:any){user=u;}
export async function loadProducts(uid:number){return products.get(uid)||[];}export async function saveProducts(uid:number,p:Producto[]){products.set(uid,p);}
export async function loadCart(uid:number){return cart.get(uid)||[];}
export async function changeCart(uid:number,p:Producto,delta:number){const a=[...(cart.get(uid)||[])];const i=a.findIndex(x=>x.producto_id===p.id);if(i>=0){a[i].cantidad=Math.max(0,a[i].cantidad+delta);if(!a[i].cantidad)a.splice(i,1);}else if(delta>0)a.push({producto_id:p.id,nombre:p.nombre,precio:p.precio,cantidad:delta});cart.set(uid,a);}
export async function clearCart(uid:number){cart.set(uid,[]);}
export async function queuePurchase(uid:number,id:string,items:Item[]){pending.set(uid,[...(pending.get(uid)||[]),{request_id:id,items,estado:'pendiente',error:null,creado_en:new Date().toISOString()}]);cart.set(uid,[]);}
export async function loadPending(uid:number){return pending.get(uid)||[];}
export async function updatePending(uid:number,id:string,estado:string,error:string|null){pending.set(uid,(pending.get(uid)||[]).map(x=>x.request_id===id?{...x,estado,error}:x));}
export async function removePending(uid:number,id:string){pending.set(uid,(pending.get(uid)||[]).filter(x=>x.request_id!==id));}
