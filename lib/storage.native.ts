import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
export type CachedItem={id:number;producto_id:number;nombre:string;precio:number;cantidad:number};
const db=SQLite.openDatabaseAsync('carrito_clientes.db');
export async function getToken(){return SecureStore.getItemAsync('carrito_token');}
export async function setToken(token:string|null){if(token)await SecureStore.setItemAsync('carrito_token',token);else await SecureStore.deleteItemAsync('carrito_token');}
export async function loadCart(userId:number):Promise<CachedItem[]>{const d=await db;await d.execAsync('CREATE TABLE IF NOT EXISTS carrito_cache(cliente_id INTEGER NOT NULL,id INTEGER NOT NULL,producto_id INTEGER NOT NULL,nombre TEXT NOT NULL,precio REAL NOT NULL,cantidad INTEGER NOT NULL,PRIMARY KEY(cliente_id,id))');return d.getAllAsync<CachedItem>('SELECT id,producto_id,nombre,precio,cantidad FROM carrito_cache WHERE cliente_id=? ORDER BY id',userId);}
export async function saveCart(userId:number,items:CachedItem[]){const d=await db;await d.execAsync('CREATE TABLE IF NOT EXISTS carrito_cache(cliente_id INTEGER NOT NULL,id INTEGER NOT NULL,producto_id INTEGER NOT NULL,nombre TEXT NOT NULL,precio REAL NOT NULL,cantidad INTEGER NOT NULL,PRIMARY KEY(cliente_id,id))');await d.withExclusiveTransactionAsync(async tx=>{await tx.runAsync('DELETE FROM carrito_cache WHERE cliente_id=?',userId);for(const i of items)await tx.runAsync('INSERT INTO carrito_cache(cliente_id,id,producto_id,nombre,precio,cantidad) VALUES(?,?,?,?,?,?)',userId,i.id,i.producto_id,i.nombre,i.precio,i.cantidad);});}
