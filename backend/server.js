const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const app = express();
app.use(cors());
app.use(express.json());
if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL (PostgreSQL)');
const db = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false } });
const consultar = (sql, valores=[]) => db.query(sql, valores);
const listar = async (res) => res.json((await consultar('SELECT id,nombre,precio::float,cantidad FROM carrito ORDER BY id')).rows);
app.get('/health', (_,res) => res.json({ok:true}));
app.get('/carrito', async (_,res,next) => { try { await listar(res); } catch(e) { next(e); } });
app.post('/carrito', async (req,res,next) => { try {
  const nombre = String(req.body.nombre || '').trim(), precio = Number(req.body.precio);
  if (!nombre || nombre.length > 120 || !Number.isFinite(precio) || precio <= 0) return res.status(400).json({error:'Nombre o precio inválido'});
  await consultar('INSERT INTO carrito(nombre,precio,cantidad) VALUES($1,$2,1)',[nombre,precio]);
  await listar(res);
} catch(e) { next(e); } });
app.patch('/carrito/:id', async (req,res,next) => { try {
  const id = Number(req.params.id), cantidad = Number(req.body.cantidad);
  if (!Number.isInteger(id) || !Number.isInteger(cantidad) || cantidad < 0 || cantidad > 9999) return res.status(400).json({error:'Cantidad inválida'});
  const r = cantidad === 0 ? await consultar('DELETE FROM carrito WHERE id=$1',[id]) : await consultar('UPDATE carrito SET cantidad=$1 WHERE id=$2',[cantidad,id]);
  if (!r.rowCount) return res.status(404).json({error:'Producto no encontrado'});
  await listar(res);
} catch(e) { next(e); } });
app.delete('/carrito/:id', async (req,res,next) => { try {
  const r = await consultar('DELETE FROM carrito WHERE id=$1',[req.params.id]);
  if (!r.rowCount) return res.status(404).json({error:'Producto no encontrado'});
  await listar(res);
} catch(e) { next(e); } });
app.delete('/carrito', async (_,res,next) => { try { await consultar('DELETE FROM carrito'); await listar(res); } catch(e) { next(e); } });
app.use((err,req,res,next) => { console.error(err); res.status(500).json({error:'Error interno del servidor'}); });
const PORT = process.env.PORT || 3000;
consultar('CREATE TABLE IF NOT EXISTS carrito (id SERIAL PRIMARY KEY, nombre VARCHAR(120) NOT NULL, precio NUMERIC(12,2) NOT NULL, cantidad INTEGER NOT NULL DEFAULT 1)')
  .then(() => app.listen(PORT, '0.0.0.0', () => console.log('API lista en puerto '+PORT)))
  .catch(e => { console.error('Error al iniciar BD',e); process.exit(1); });
