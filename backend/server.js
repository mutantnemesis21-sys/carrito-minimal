require('dotenv').config();
const express = require('express');
const cors = require('cors');
const {Pool} = require('pg');
const crypto = require('node:crypto');
const {promisify} = require('node:util');
const scrypt = promisify(crypto.scrypt);
const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(express.json({limit:'32kb'}));
const {DATABASE_URL,JWT_SECRET} = process.env;
if(!DATABASE_URL || !JWT_SECRET || JWT_SECRET.length<32) throw Error('Configura DATABASE_URL y JWT_SECRET (mínimo 32 caracteres)');
const db = new Pool({connectionString:DATABASE_URL,ssl:/localhost|127\.0\.0\.1/.test(DATABASE_URL)?false:{rejectUnauthorized:false}});
const q=(sql,args=[])=>db.query(sql,args);
const route=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
const fail=(res,status,error)=>res.status(status).json({error});
const numberId=v=>{const n=Number(v);return Number.isSafeInteger(n)&&n>0?n:null;};
const key=()=>crypto.randomBytes(16).toString('hex');
async function hashPassword(password){const salt=key();const hash=await scrypt(password,salt,64);return `${salt}:${hash.toString('hex')}`;}
async function verifyPassword(password,stored){try{const [salt,expected]=stored.split(':');const hash=await scrypt(password,salt,64);const a=Buffer.from(expected,'hex');return a.length===hash.length&&crypto.timingSafeEqual(a,hash);}catch{return false;}}
const b64=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
function tokenFor(user){const h=b64({alg:'HS256',typ:'JWT'});const p=b64({sub:String(user.id),iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+7*86400});const body=h+'.'+p;return body+'.'+crypto.createHmac('sha256',JWT_SECRET).update(body).digest('base64url');}
function verifyToken(token){try{const [h,p,s]=token.split('.');if(!h||!p||!s)return null;const expected=crypto.createHmac('sha256',JWT_SECRET).update(h+'.'+p).digest();const actual=Buffer.from(s,'base64url');if(actual.length!==expected.length||!crypto.timingSafeEqual(actual,expected))return null;const header=JSON.parse(Buffer.from(h,'base64url'));const payload=JSON.parse(Buffer.from(p,'base64url'));if(header.alg!=='HS256'||!Number.isFinite(payload.exp)||payload.exp<=Date.now()/1000)return null;return numberId(payload.sub);}catch{return null;}}
const auth=(req,res,next)=>{const value=req.headers.authorization||'';const id=value.startsWith('Bearer ')?verifyToken(value.slice(7)):null;if(!id)return fail(res,401,'Sesión inválida o vencida');req.userId=id;next();};
const emailValid=s=>typeof s==='string'&&s.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
app.get('/health',(_,res)=>res.json({ok:true}));
app.post('/auth/registro',route(async(req,res)=>{
 const nombre=String(req.body.nombre||'').trim();const email=String(req.body.email||'').trim().toLowerCase();const password=req.body.password;
 if(nombre.length<2||nombre.length>100||!emailValid(email)||typeof password!=='string'||password.length<8||password.length>128)return fail(res,400,'Nombre (2-100), correo válido y contraseña (8-128) requeridos');
 const hash=await hashPassword(password);
 try{const u=(await q('INSERT INTO clientes(nombre,email,password_hash) VALUES($1,$2,$3) RETURNING id,nombre,email',[nombre,email,hash])).rows[0];res.status(201).json({token:tokenFor(u),cliente:u});}
 catch(e){if(e.code==='23505')return fail(res,409,'El correo ya está registrado');throw e;}
}));
app.post('/auth/login',route(async(req,res)=>{
 const email=String(req.body.email||'').trim().toLowerCase();const password=req.body.password;
 if(!emailValid(email)||typeof password!=='string')return fail(res,400,'Credenciales inválidas');
 const u=(await q('SELECT id,nombre,email,password_hash FROM clientes WHERE email=$1',[email])).rows[0];
 if(!u||!(await verifyPassword(password,u.password_hash)))return fail(res,401,'Correo o contraseña incorrectos');
 res.json({token:tokenFor(u),cliente:{id:u.id,nombre:u.nombre,email:u.email}});
}));
app.get('/clientes/me',auth,route(async(req,res)=>{const u=(await q('SELECT id,nombre,email FROM clientes WHERE id=$1',[req.userId])).rows[0];if(!u)return fail(res,401,'Cliente no disponible');res.json(u);}));
app.get('/productos',auth,route(async(req,res)=>res.json((await q('SELECT id,nombre,precio::float FROM productos ORDER BY id')).rows)));
const listCart=async userId=>(await q(`SELECT c.id,c.producto_id,p.nombre,p.precio::float,c.cantidad FROM carritos_clientes c JOIN productos p ON p.id=c.producto_id WHERE c.cliente_id=$1 ORDER BY c.id`,[userId])).rows;
app.get('/carrito',auth,route(async(req,res)=>res.json(await listCart(req.userId))));
app.post('/carrito',auth,route(async(req,res)=>{
 const id=numberId(req.body.producto_id);if(!id)return fail(res,400,'Producto inválido');
 const p=(await q('SELECT id FROM productos WHERE id=$1',[id])).rows[0];if(!p)return fail(res,404,'Producto inexistente');
 await q(`INSERT INTO carritos_clientes(cliente_id,producto_id,cantidad) VALUES($1,$2,1) ON CONFLICT(cliente_id,producto_id) DO UPDATE SET cantidad=LEAST(carritos_clientes.cantidad+1,9999)`,[req.userId,id]);res.json(await listCart(req.userId));
}));
app.patch('/carrito/:id',auth,route(async(req,res)=>{
 const id=numberId(req.params.id),cantidad=Number(req.body.cantidad);
 if(!id||!Number.isInteger(cantidad)||cantidad<0||cantidad>9999)return fail(res,400,'Cantidad inválida');
 const r=cantidad===0?await q('DELETE FROM carritos_clientes WHERE id=$1 AND cliente_id=$2',[id,req.userId]):await q('UPDATE carritos_clientes SET cantidad=$1 WHERE id=$2 AND cliente_id=$3',[cantidad,id,req.userId]);
 if(!r.rowCount)return fail(res,404,'Elemento no encontrado');res.json(await listCart(req.userId));
}));
app.delete('/carrito/:id',auth,route(async(req,res)=>{const id=numberId(req.params.id);if(!id)return fail(res,400,'ID inválido');await q('DELETE FROM carritos_clientes WHERE id=$1 AND cliente_id=$2',[id,req.userId]);res.json(await listCart(req.userId));}));
app.delete('/carrito',auth,route(async(req,res)=>{await q('DELETE FROM carritos_clientes WHERE cliente_id=$1',[req.userId]);res.json(await listCart(req.userId));}));
app.post('/compras/confirmar',auth,route(async(req,res)=>{
 const requestId=String(req.body?.request_id||'');if(!/^[a-zA-Z0-9_-]{8,80}$/.test(requestId))return fail(res,400,'Identificador de compra inválido');
 const client=await db.connect();
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock($1)',[req.userId]);
  const existing=(await client.query('SELECT id,fecha,total::float FROM facturas WHERE cliente_id=$1 AND request_id=$2',[req.userId,requestId])).rows[0];
  if(existing){await client.query('COMMIT');return res.json(existing);}
  const items=(await client.query(`SELECT c.producto_id,p.nombre,p.precio,c.cantidad FROM carritos_clientes c JOIN productos p ON p.id=c.producto_id WHERE c.cliente_id=$1 ORDER BY c.id FOR UPDATE OF c`,[req.userId])).rows;
  if(!items.length){await client.query('ROLLBACK');return fail(res,400,'El carrito está vacío');}
  const total=items.reduce((sum,i)=>sum+Math.round(Number(i.precio)*100)*i.cantidad,0)/100;
  const f=(await client.query('INSERT INTO facturas(cliente_id,total,request_id) VALUES($1,$2,$3) RETURNING id,fecha,total::float',[req.userId,total,requestId])).rows[0];
  for(const i of items)await client.query('INSERT INTO factura_detalles(factura_id,nombre,precio,cantidad,subtotal) VALUES($1,$2,$3,$4,$5)',[f.id,i.nombre,i.precio,i.cantidad,Number(i.precio)*i.cantidad]);
  await client.query('DELETE FROM carritos_clientes WHERE cliente_id=$1',[req.userId]);
  await client.query('COMMIT');res.status(201).json(f);
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
}));
app.get('/facturas',auth,route(async(req,res)=>res.json((await q('SELECT id,fecha,total::float FROM facturas WHERE cliente_id=$1 ORDER BY id DESC LIMIT 100',[req.userId])).rows)));
app.get('/facturas/:id',auth,route(async(req,res)=>{
 const id=numberId(req.params.id);if(!id)return fail(res,400,'ID inválido');
 const f=(await q('SELECT f.id,f.fecha,f.total::float,c.nombre AS cliente_nombre,c.email AS cliente_email FROM facturas f JOIN clientes c ON c.id=f.cliente_id WHERE f.id=$1 AND f.cliente_id=$2',[id,req.userId])).rows[0];
 if(!f)return fail(res,404,'Factura no encontrada');
 const items=(await q('SELECT nombre,precio::float,cantidad,subtotal::float FROM factura_detalles WHERE factura_id=$1 ORDER BY id',[id])).rows;res.json({...f,items});
}));
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:'Error interno del servidor'});});
async function init(){
 await q('CREATE TABLE IF NOT EXISTS clientes(id BIGSERIAL PRIMARY KEY,nombre VARCHAR(100) NOT NULL,email VARCHAR(254) UNIQUE NOT NULL,password_hash TEXT NOT NULL,creado_en TIMESTAMPTZ DEFAULT NOW())');
 await q('CREATE TABLE IF NOT EXISTS productos(id SERIAL PRIMARY KEY,nombre VARCHAR(120) UNIQUE NOT NULL,precio NUMERIC(12,2) NOT NULL CHECK(precio>0))');
 await q(`INSERT INTO productos(nombre,precio) VALUES ('Cuaderno',12000),('Lápiz',2000),('Borrador',1500),('Bolígrafo',3500),('Regla',4000),('Carpeta',6500),('Resaltador',5500),('Memoria USB 32GB',35000) ON CONFLICT(nombre) DO NOTHING`);
 await q('CREATE TABLE IF NOT EXISTS carritos_clientes(id BIGSERIAL PRIMARY KEY,cliente_id BIGINT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,producto_id INTEGER NOT NULL REFERENCES productos(id),cantidad INTEGER NOT NULL DEFAULT 1 CHECK(cantidad BETWEEN 1 AND 9999),UNIQUE(cliente_id,producto_id))');
 await q('CREATE TABLE IF NOT EXISTS facturas(id BIGSERIAL PRIMARY KEY,fecha TIMESTAMPTZ NOT NULL DEFAULT NOW(),total NUMERIC(14,2) NOT NULL)');
 await q('ALTER TABLE facturas ADD COLUMN IF NOT EXISTS cliente_id BIGINT REFERENCES clientes(id)');
 await q('ALTER TABLE facturas ADD COLUMN IF NOT EXISTS request_id VARCHAR(80)');
 await q('CREATE UNIQUE INDEX IF NOT EXISTS facturas_cliente_request_unique ON facturas(cliente_id,request_id)');
 await q('CREATE TABLE IF NOT EXISTS factura_detalles(id BIGSERIAL PRIMARY KEY,factura_id BIGINT NOT NULL REFERENCES facturas(id),nombre VARCHAR(120) NOT NULL,precio NUMERIC(12,2) NOT NULL,cantidad INTEGER NOT NULL,subtotal NUMERIC(14,2) NOT NULL)');
 app.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('Carrito API con clientes listo'));
}
init().catch(e=>{console.error('Error inicializando PostgreSQL',e);process.exit(1)});
