require('dotenv').config();
const express=require('express');
const cors=require('cors');
const crypto=require('node:crypto');
const {promisify}=require('node:util');
const {Pool}=require('pg');
const scrypt=promisify(crypto.scrypt);
const app=express();app.disable('x-powered-by');app.use(cors());app.use(express.json({limit:'128kb'}));
if(!process.env.DATABASE_URL)throw Error('Falta DATABASE_URL');
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)?false:{rejectUnauthorized:false}});
const q=(sql,args=[])=>pool.query(sql,args);
const route=fn=>(req,res,next)=>Promise.resolve().then(()=>fn(req,res,next)).catch(next);
const fail=(res,status,error,extra={})=>res.status(status).json({error,...extra});
const validId=x=>Number.isSafeInteger(Number(x))&&Number(x)>0?Number(x):null;
const validImage=x=>typeof x==='string'&&x.length<=2048&&(!x||(/^https:\/\/[^\s]+$/i.test(x)&&!/[<>\"']/g.test(x)));
const validEmail=x=>typeof x==='string'&&x.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x);
const hashToken=t=>crypto.createHash('sha256').update(t).digest('hex');
async function hashPassword(password){const salt=crypto.randomBytes(16).toString('hex');return salt+':'+(await scrypt(password,salt,64)).toString('hex');}
async function checkPassword(password,stored){try{const [salt,expected]=stored.split(':');const b=Buffer.from(expected,'hex');const a=await scrypt(password,salt,64);return b.length===a.length&&crypto.timingSafeEqual(a,b);}catch{return false;}}
async function sessionFor(id){const token=crypto.randomBytes(32).toString('hex');await q("INSERT INTO sesiones_clientes(cliente_id,token_hash,vence_en) VALUES($1,$2,NOW()+INTERVAL '7 days')",[id,hashToken(token)]);return token;}
const auth=route(async(req,res,next)=>{const token=(req.headers.authorization||'').replace(/^Bearer /,'');if(!/^[a-f0-9]{64}$/.test(token))return fail(res,401,'Sesión inválida');const u=(await q('SELECT c.id,c.nombre,c.email,c.rol FROM sesiones_clientes s JOIN clientes c ON c.id=s.cliente_id WHERE s.token_hash=$1 AND s.vence_en>NOW()',[hashToken(token)])).rows[0];if(!u)return fail(res,401,'Sesión vencida');req.user=u;req.tokenHash=hashToken(token);next();});
const admin=(req,res,next)=>req.user.rol==='admin'?next():fail(res,403,'Solo administrador');
app.get('/health',route(async(req,res)=>{await q('SELECT 1');res.json({ok:true,version:'3.0'});}));
app.post('/auth/registro',route(async(req,res)=>{const nombre=String(req.body?.nombre||'').trim(),email=String(req.body?.email||'').trim().toLowerCase(),password=req.body?.password;if(nombre.length<2||nombre.length>100||!validEmail(email)||typeof password!=='string'||password.length<8||password.length>128)return fail(res,400,'Datos de registro inválidos');try{const u=(await q('INSERT INTO clientes(nombre,email,password_hash,rol) VALUES($1,$2,$3,\'cliente\') RETURNING id,nombre,email,rol',[nombre,email,await hashPassword(password)])).rows[0];res.status(201).json({token:await sessionFor(u.id),cliente:u});}catch(e){if(e.code==='23505')return fail(res,409,'Correo ya registrado');throw e;}}));
app.post('/auth/login',route(async(req,res)=>{const email=String(req.body?.email||'').trim().toLowerCase(),password=req.body?.password;if(!(validEmail(email)||email==='admin')||typeof password!=='string')return fail(res,400,'Credenciales inválidas');const u=(await q('SELECT id,nombre,email,rol,password_hash FROM clientes WHERE email=$1',[email])).rows[0];if(!u||!(await checkPassword(password,u.password_hash)))return fail(res,401,'Correo o contraseña incorrectos');res.json({token:await sessionFor(u.id),cliente:{id:u.id,nombre:u.nombre,email:u.email,rol:u.rol}});}));
app.get('/clientes/me',auth,route(async(req,res)=>res.json(req.user)));
app.post('/auth/logout',auth,route(async(req,res)=>{await q('DELETE FROM sesiones_clientes WHERE token_hash=$1',[req.tokenHash]);res.json({ok:true});}));
app.get('/productos',auth,route(async(req,res)=>res.json((await q('SELECT id,nombre,precio::float,stock,stock_minimo,activo,imagen_url FROM productos WHERE activo=true ORDER BY id')).rows)));
const listCart=async id=>(await q('SELECT c.id,c.producto_id,p.nombre,p.precio::float,c.cantidad FROM carritos_clientes c JOIN productos p ON p.id=c.producto_id WHERE c.cliente_id=$1 ORDER BY c.id',[id])).rows;
app.get('/carrito',auth,route(async(req,res)=>res.json(await listCart(req.user.id))));
app.post('/carrito',auth,route(async(req,res)=>{const id=validId(req.body?.producto_id);if(!id)return fail(res,400,'Producto inválido');const p=(await q('SELECT id FROM productos WHERE id=$1 AND activo=true',[id])).rows[0];if(!p)return fail(res,404,'Producto no disponible');await q('INSERT INTO carritos_clientes(cliente_id,producto_id,cantidad) VALUES($1,$2,1) ON CONFLICT(cliente_id,producto_id) DO UPDATE SET cantidad=LEAST(carritos_clientes.cantidad+1,9999)',[req.user.id,id]);res.json(await listCart(req.user.id));}));
app.patch('/carrito/:id',auth,route(async(req,res)=>{const id=validId(req.params.id),n=Number(req.body?.cantidad);if(!id||!Number.isInteger(n)||n<0||n>9999)return fail(res,400,'Cantidad inválida');const r=n?await q('UPDATE carritos_clientes SET cantidad=$1 WHERE id=$2 AND cliente_id=$3',[n,id,req.user.id]):await q('DELETE FROM carritos_clientes WHERE id=$1 AND cliente_id=$2',[id,req.user.id]);if(!r.rowCount)return fail(res,404,'No encontrado');res.json(await listCart(req.user.id));}));
app.delete('/carrito/:id',auth,route(async(req,res)=>{await q('DELETE FROM carritos_clientes WHERE id=$1 AND cliente_id=$2',[validId(req.params.id),req.user.id]);res.json(await listCart(req.user.id));}));
app.delete('/carrito',auth,route(async(req,res)=>{await q('DELETE FROM carritos_clientes WHERE cliente_id=$1',[req.user.id]);res.json([]);}));
// Una compra offline contiene una instantánea de líneas. El servidor NO confía en precios ni stock del móvil.
// El UUID de operación evita descuentos duplicados incluso si la respuesta se pierde y se reintenta.
async function processPurchase(userId,body){const requestId=String(body?.request_id||'');if(!/^[a-zA-Z0-9_-]{8,80}$/.test(requestId))return {status:400,error:'Identificador de compra inválido'};
 let items=body?.items;
 if(items!==undefined&&(!Array.isArray(items)||items.length<1||items.length>100))return {status:400,error:'Lista de productos inválida'};
 const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock($1)',[userId]);
 const old=(await c.query('SELECT id,fecha,total::float FROM facturas WHERE cliente_id=$1 AND request_id=$2',[userId,requestId])).rows[0];if(old){await c.query('COMMIT');return {status:200,data:{...old,estado:'confirmada',duplicada:true}};}
 if(items===undefined){items=(await c.query('SELECT producto_id,cantidad FROM carritos_clientes WHERE cliente_id=$1 ORDER BY producto_id',[userId])).rows;}
 if(!items.length){await c.query('ROLLBACK');return {status:400,error:'Carrito vacío'};}
 const quantities=new Map();for(const item of items){const id=validId(item.producto_id),n=Number(item.cantidad);if(!id||!Number.isInteger(n)||n<1||n>9999){await c.query('ROLLBACK');return {status:400,error:'Producto o cantidad inválida'};}quantities.set(id,(quantities.get(id)||0)+n);}
 if([...quantities.values()].some(n=>n>9999)){await c.query('ROLLBACK');return {status:400,error:'Cantidad excesiva'};}
 const ids=[...quantities.keys()].sort((a,b)=>a-b);
 const products=(await c.query('SELECT id,nombre,precio,stock,activo FROM productos WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE',[ids])).rows;
 if(products.length!==ids.length||products.some(p=>!p.activo)){await c.query('ROLLBACK');return {status:409,error:'Producto no disponible',codigo:'PRODUCTO_NO_DISPONIBLE'};}
 const insufficient=products.filter(p=>p.stock<quantities.get(p.id)).map(p=>({producto_id:p.id,nombre:p.nombre,disponible:p.stock,solicitado:quantities.get(p.id)}));
 if(insufficient.length){await c.query('ROLLBACK');return {status:409,error:'Stock insuficiente',codigo:'SIN_STOCK',faltantes:insufficient};}
 const totalCents=products.reduce((sum,p)=>sum+Math.round(Number(p.precio)*100)*quantities.get(p.id),0);
 const invoice=(await c.query('INSERT INTO facturas(cliente_id,total,request_id) VALUES($1,$2,$3) RETURNING id,fecha,total::float',[userId,(totalCents/100).toFixed(2),requestId])).rows[0];
 for(const p of products){const n=quantities.get(p.id);await c.query('INSERT INTO factura_detalles(factura_id,nombre,precio,cantidad,subtotal) VALUES($1,$2,$3,$4,$5)',[invoice.id,p.nombre,p.precio,n,(Math.round(Number(p.precio)*100)*n/100).toFixed(2)]);await c.query('UPDATE productos SET stock=stock-$1 WHERE id=$2',[n,p.id]);await c.query('INSERT INTO movimientos_inventario(producto_id,delta,motivo,factura_id,actor_id) VALUES($1,$2,$3,$4,$5)',[p.id,-n,'venta',invoice.id,userId]);}
 await c.query('DELETE FROM carritos_clientes WHERE cliente_id=$1',[userId]);await c.query('COMMIT');return {status:201,data:{...invoice,estado:'confirmada'}};
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}
app.post('/compras/confirmar',auth,route(async(req,res)=>{const result=await processPurchase(req.user.id,req.body);res.status(result.status).json(result.data||{error:result.error,codigo:result.codigo,faltantes:result.faltantes});}));
app.post('/compras/sincronizar',auth,route(async(req,res)=>{const result=await processPurchase(req.user.id,req.body);res.status(result.status).json(result.data||{error:result.error,codigo:result.codigo,faltantes:result.faltantes});}));
app.get('/facturas',auth,route(async(req,res)=>res.json((await q('SELECT id,fecha,total::float FROM facturas WHERE cliente_id=$1 ORDER BY id DESC LIMIT 200',[req.user.id])).rows)));
app.get('/facturas/:id',auth,route(async(req,res)=>{const id=validId(req.params.id);if(!id)return fail(res,400,'ID inválido');const f=(await q('SELECT f.id,f.fecha,f.total::float,c.nombre cliente_nombre,c.email cliente_email FROM facturas f JOIN clientes c ON c.id=f.cliente_id WHERE f.id=$1 AND f.cliente_id=$2',[id,req.user.id])).rows[0];if(!f)return fail(res,404,'Factura no encontrada');res.json({...f,items:(await q('SELECT nombre,precio::float,cantidad,subtotal::float FROM factura_detalles WHERE factura_id=$1 ORDER BY id',[id])).rows});}));
// Panel administrativo: permisos siempre verificados en servidor.
app.get('/admin/resumen',auth,admin,route(async(req,res)=>{const [p,c,f,s]=(await Promise.all([q('SELECT count(*)::int n FROM productos WHERE activo=true'),q('SELECT count(*)::int n FROM clientes'),q('SELECT count(*)::int n FROM facturas'),q('SELECT count(*)::int n FROM productos WHERE activo=true AND stock<=stock_minimo')]));res.json({productos:p.rows[0].n,clientes:c.rows[0].n,facturas:f.rows[0].n,stock_bajo:s.rows[0].n});}));
app.get('/admin/productos',auth,admin,route(async(req,res)=>res.json((await q('SELECT id,nombre,precio::float,stock,stock_minimo,activo,imagen_url FROM productos ORDER BY id')).rows)));
app.post('/admin/productos',auth,admin,route(async(req,res)=>{const nombre=String(req.body?.nombre||'').trim(),precio=Number(req.body?.precio),stock=Number(req.body?.stock),min=Number(req.body?.stock_minimo??3),imagen_url=String(req.body?.imagen_url||'').trim();if(!nombre||nombre.length>120||!Number.isFinite(precio)||precio<=0||precio>999999999||!Number.isInteger(stock)||stock<0||!Number.isInteger(min)||min<0||!validImage(imagen_url))return fail(res,400,'Datos de producto inválidos');const p=(await q('INSERT INTO productos(nombre,precio,stock,stock_minimo,activo,imagen_url) VALUES($1,$2,$3,$4,true,$5) RETURNING *',[nombre,precio,stock,min,imagen_url])).rows[0];await q('INSERT INTO movimientos_inventario(producto_id,delta,motivo,actor_id) VALUES($1,$2,$3,$4)',[p.id,stock,'stock_inicial',req.user.id]);res.status(201).json(p);}));
app.patch('/admin/productos/:id',auth,admin,route(async(req,res)=>{const id=validId(req.params.id);if(!id)return fail(res,400,'ID inválido');const nombre=String(req.body?.nombre||'').trim(),precio=Number(req.body?.precio),min=Number(req.body?.stock_minimo),activo=req.body?.activo,imagen_url=String(req.body?.imagen_url||'').trim();if(!nombre||nombre.length>120||!Number.isFinite(precio)||precio<=0||!Number.isInteger(min)||min<0||typeof activo!=='boolean'||!validImage(imagen_url))return fail(res,400,'Datos inválidos');const p=(await q('UPDATE productos SET nombre=$1,precio=$2,stock_minimo=$3,activo=$4,imagen_url=$6 WHERE id=$5 RETURNING *',[nombre,precio,min,activo,id,imagen_url])).rows[0];if(!p)return fail(res,404,'Producto inexistente');res.json(p);}));
app.post('/admin/productos/:id/stock',auth,admin,route(async(req,res)=>{const id=validId(req.params.id),delta=Number(req.body?.delta);if(!id||!Number.isInteger(delta)||delta===0||Math.abs(delta)>100000)return fail(res,400,'Ajuste inválido');const c=await pool.connect();try{await c.query('BEGIN');const p=(await c.query('UPDATE productos SET stock=stock+$1 WHERE id=$2 AND stock+$1>=0 RETURNING *',[delta,id])).rows[0];if(!p){await c.query('ROLLBACK');return fail(res,409,'Producto inexistente o stock insuficiente');}await c.query('INSERT INTO movimientos_inventario(producto_id,delta,motivo,actor_id) VALUES($1,$2,$3,$4)',[id,delta,'ajuste_admin',req.user.id]);await c.query('COMMIT');res.json(p);}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}));
app.get('/admin/clientes',auth,admin,route(async(req,res)=>res.json((await q('SELECT id,nombre,email,rol,creado_en FROM clientes ORDER BY id DESC LIMIT 200')).rows)));
app.get('/admin/facturas',auth,admin,route(async(req,res)=>res.json((await q('SELECT f.id,f.fecha,f.total::float,c.nombre cliente_nombre,c.email cliente_email FROM facturas f LEFT JOIN clientes c ON c.id=f.cliente_id ORDER BY f.id DESC LIMIT 200')).rows)));
app.get('/admin/movimientos',auth,admin,route(async(req,res)=>res.json((await q('SELECT m.id,m.fecha,m.delta,m.motivo,p.nombre producto,m.factura_id FROM movimientos_inventario m JOIN productos p ON p.id=m.producto_id ORDER BY m.id DESC LIMIT 200')).rows)));
app.use((err,req,res,next)=>{console.error(err);if(err.code==='23505')return fail(res,409,'Registro duplicado');res.status(500).json({error:'Error interno del servidor'});});
async function init(){
 await q('CREATE TABLE IF NOT EXISTS clientes(id BIGSERIAL PRIMARY KEY,nombre VARCHAR(100) NOT NULL,email VARCHAR(254) UNIQUE NOT NULL,password_hash TEXT NOT NULL,creado_en TIMESTAMPTZ DEFAULT NOW())');
 await q("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS rol VARCHAR(12) NOT NULL DEFAULT 'cliente'");
 await q('CREATE TABLE IF NOT EXISTS sesiones_clientes(id BIGSERIAL PRIMARY KEY,cliente_id BIGINT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,token_hash CHAR(64) UNIQUE NOT NULL,vence_en TIMESTAMPTZ NOT NULL)');
 await q('CREATE TABLE IF NOT EXISTS productos(id SERIAL PRIMARY KEY,nombre VARCHAR(120) UNIQUE NOT NULL,precio NUMERIC(12,2) NOT NULL CHECK(precio>0))');
 const stockColumn=(await q("SELECT 1 FROM information_schema.columns WHERE table_name='productos' AND column_name='stock'")).rowCount>0;
 await q('ALTER TABLE productos ADD COLUMN IF NOT EXISTS stock INTEGER NOT NULL DEFAULT 0');
 // Migración única: las filas antiguas no tenían stock. No se reponen existencias en reinicios.
 if(!stockColumn)await q("UPDATE productos SET stock=CASE nombre WHEN 'Cuaderno' THEN 20 WHEN 'Lápiz' THEN 40 WHEN 'Borrador' THEN 30 WHEN 'Bolígrafo' THEN 25 WHEN 'Regla' THEN 15 WHEN 'Carpeta' THEN 20 WHEN 'Resaltador' THEN 12 WHEN 'Memoria USB 32GB' THEN 10 ELSE 0 END");
 await q('ALTER TABLE productos ADD COLUMN IF NOT EXISTS stock_minimo INTEGER NOT NULL DEFAULT 3');
 await q('ALTER TABLE productos ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true');
 await q("ALTER TABLE productos ADD COLUMN IF NOT EXISTS imagen_url TEXT NOT NULL DEFAULT ''");
 await q("INSERT INTO productos(nombre,precio,stock,stock_minimo) VALUES ('Cuaderno',12000,20,3),('Lápiz',2000,40,5),('Borrador',1500,30,5),('Bolígrafo',3500,25,5),('Regla',4000,15,3),('Carpeta',6500,20,3),('Resaltador',5500,12,3),('Memoria USB 32GB',35000,10,2) ON CONFLICT(nombre) DO NOTHING");
 await q('CREATE TABLE IF NOT EXISTS carritos_clientes(id BIGSERIAL PRIMARY KEY,cliente_id BIGINT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,producto_id INTEGER NOT NULL REFERENCES productos(id),cantidad INTEGER NOT NULL DEFAULT 1 CHECK(cantidad BETWEEN 1 AND 9999),UNIQUE(cliente_id,producto_id))');
 await q('CREATE TABLE IF NOT EXISTS facturas(id BIGSERIAL PRIMARY KEY,fecha TIMESTAMPTZ NOT NULL DEFAULT NOW(),total NUMERIC(14,2) NOT NULL)');
 await q('ALTER TABLE facturas ADD COLUMN IF NOT EXISTS cliente_id BIGINT REFERENCES clientes(id)');
 await q('ALTER TABLE facturas ADD COLUMN IF NOT EXISTS request_id VARCHAR(80)');
 await q('CREATE UNIQUE INDEX IF NOT EXISTS facturas_cliente_request_unique ON facturas(cliente_id,request_id)');
 await q('CREATE TABLE IF NOT EXISTS factura_detalles(id BIGSERIAL PRIMARY KEY,factura_id BIGINT NOT NULL REFERENCES facturas(id),nombre VARCHAR(120) NOT NULL,precio NUMERIC(12,2) NOT NULL,cantidad INTEGER NOT NULL,subtotal NUMERIC(14,2) NOT NULL)');
 await q('CREATE TABLE IF NOT EXISTS movimientos_inventario(id BIGSERIAL PRIMARY KEY,producto_id INTEGER NOT NULL REFERENCES productos(id),delta INTEGER NOT NULL,motivo VARCHAR(40) NOT NULL,factura_id BIGINT REFERENCES facturas(id),actor_id BIGINT REFERENCES clientes(id),fecha TIMESTAMPTZ DEFAULT NOW())');
 // Cuenta administrativa predefinida: nombre de acceso admin, contraseña solo en Render.
 const adminPassword=process.env.ADMIN_PASSWORD;
 if(adminPassword){
  if(adminPassword.length<12||adminPassword.length>128)throw Error('ADMIN_PASSWORD debe tener entre 12 y 128 caracteres');
  const adminEmail='admin@carrito.local';
  const existing=(await q('SELECT id,rol FROM clientes WHERE email=$1',[adminEmail])).rows[0];
  if(!existing){await q('INSERT INTO clientes(nombre,email,password_hash,rol) VALUES($1,$2,$3,$4)',['Administrador',adminEmail,await hashPassword(adminPassword),'admin']);console.log('Cuenta admin creada');}
  else if(existing.rol!=='admin')throw Error('La cuenta reservada de administrador ya existe con rol incorrecto');
 }else console.warn('ADMIN_PASSWORD no configurada: no se creará cuenta admin nueva');
 app.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('Carrito Pro API v3 lista'));
}
init().catch(e=>{console.error('Error inicializando PostgreSQL',e);process.exit(1);});
