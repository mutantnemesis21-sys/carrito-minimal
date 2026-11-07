import { useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as SQLite from 'expo-sqlite';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

type Item = { id: number; nombre: string; precio: number; cantidad: number };
const API = (process.env.EXPO_PUBLIC_API_URL || '').replace(/\/$/, '');
const dbPromise = SQLite.openDatabaseAsync('carrito.db');
const money = (n: number) => '$ ' + n.toLocaleString('es-CO', { maximumFractionDigits: 0 });
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

export default function Inicio() {
  const [items, setItems] = useState<Item[]>([]);
  const [nombre, setNombre] = useState('');
  const [precio, setPrecio] = useState('');
  const [busy, setBusy] = useState(false);
  const [estado, setEstado] = useState('');

  async function guardarLocal(lista: Item[]) {
    const db = await dbPromise;
    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM carrito');
      for (const i of lista) await db.runAsync('INSERT INTO carrito (id,nombre,precio,cantidad) VALUES (?,?,?,?)', i.id, i.nombre, i.precio, i.cantidad);
    });
    setItems(lista);
  }
  async function iniciar() {
    const db = await dbPromise;
    await db.execAsync('CREATE TABLE IF NOT EXISTS carrito (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, precio REAL NOT NULL, cantidad INTEGER NOT NULL)');
    setItems(await db.getAllAsync<Item>('SELECT * FROM carrito ORDER BY id'));
    await sincronizar();
  }
  async function sincronizar() {
    if (!API) { setEstado('Modo local: configura EXPO_PUBLIC_API_URL'); return; }
    try {
      const r = await fetch(API + '/carrito');
      if (!r.ok) throw new Error('Error HTTP ' + r.status);
      await guardarLocal(await r.json());
      setEstado('Conectado a Render');
    } catch { setEstado('Sin conexión: mostrando copia SQLite'); }
  }
  useEffect(() => { iniciar().catch(e => setEstado(String(e))); }, []);
  async function operacion(ruta: string, metodo: string, body?: object) {
    if (!API) return Alert.alert('Configura la URL', 'Agrega EXPO_PUBLIC_API_URL en el archivo .env');
    setBusy(true);
    try {
      const r = await fetch(API + ruta, { method: metodo, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Error HTTP ' + r.status);
      await sincronizar();
    } catch (e) { Alert.alert('Error', String(e)); } finally { setBusy(false); }
  }
  async function agregar() {
    const p = Number(precio.replace(',', '.'));
    if (!nombre.trim() || !Number.isFinite(p) || p <= 0) return Alert.alert('Datos inválidos', 'Ingresa nombre y precio mayor que cero');
    await operacion('/carrito', 'POST', { nombre: nombre.trim(), precio: p });
    setNombre(''); setPrecio('');
  }
  async function factura() {
    if (!items.length) return Alert.alert('Carrito vacío');
    const total = items.reduce((s, i) => s + i.precio * i.cantidad, 0);
    const filas = items.map(i => `<tr><td>${escapeHtml(i.nombre)}</td><td>${i.cantidad}</td><td>${money(i.precio)}</td><td>${money(i.precio*i.cantidad)}</td></tr>`).join('');
    const html = `<html><head><meta name="viewport" content="width=device-width"/><style>body{font-family:Arial;padding:24px}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #ddd;padding:9px;text-align:left}h2{text-align:right}</style></head><body><h1>Factura de compra</h1><p>Fecha: ${new Date().toLocaleString('es-CO')}</p><table><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr>${filas}</table><h2>Total: ${money(total)}</h2><p>Documento de demostración académica. No es una factura electrónica fiscal.</p></body></html>`;
    try { const { uri } = await Print.printToFileAsync({ html }); await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Guardar factura PDF', UTI: 'com.adobe.pdf' }); }
    catch (e) { Alert.alert('No se pudo generar PDF', String(e)); }
  }
  const total = items.reduce((s, i) => s + i.precio * i.cantidad, 0);
  return <SafeAreaView style={s.pagina}><Text style={s.titulo}>Mi carrito</Text><Text style={s.sub}>Expo · SQLite · Render · Node.js</Text>
    <TextInput style={s.input} placeholder="Producto" value={nombre} onChangeText={setNombre}/>
    <TextInput style={s.input} placeholder="Precio (COP)" keyboardType="decimal-pad" value={precio} onChangeText={setPrecio}/>
    <Pressable disabled={busy} style={s.boton} onPress={agregar}><Text style={s.blanco}>Agregar producto</Text></Pressable>
    <Text style={s.estado}>{estado}</Text>
    <FlatList data={items} keyExtractor={i => String(i.id)} ListEmptyComponent={<Text style={s.vacio}>Tu carrito está vacío</Text>}
      renderItem={({item}) => <View style={s.item}><View style={{flex:1}}><Text style={s.nombre}>{item.nombre}</Text><Text>{money(item.precio)} × {item.cantidad}</Text></View>
      <Pressable disabled={busy} onPress={() => operacion('/carrito/'+item.id, 'PATCH', {cantidad:item.cantidad-1})} style={s.control}><Text>−</Text></Pressable>
      <Text style={s.cantidad}>{item.cantidad}</Text>
      <Pressable disabled={busy} onPress={() => operacion('/carrito/'+item.id, 'PATCH', {cantidad:item.cantidad+1})} style={s.control}><Text>+</Text></Pressable>
      <Pressable disabled={busy} onPress={() => operacion('/carrito/'+item.id, 'DELETE')} style={s.control}><Text style={{color:'#c22'}}>✕</Text></Pressable></View>}/>
    <Text style={s.total}>Total: {money(total)}</Text>
    <Pressable style={s.boton} onPress={factura}><Text style={s.blanco}>Descargar factura PDF</Text></Pressable>
    <Pressable disabled={busy} onPress={() => operacion('/carrito', 'DELETE')} style={s.secundario}><Text>Vaciar carrito</Text></Pressable>
    <Pressable onPress={sincronizar} style={s.secundario}><Text>Actualizar desde Render</Text></Pressable>
  </SafeAreaView>;
}
const s = StyleSheet.create({pagina:{flex:1,padding:20,backgroundColor:'#fff'},titulo:{fontSize:30,fontWeight:'700',marginTop:12},sub:{color:'#777',marginBottom:20},input:{borderWidth:1,borderColor:'#ddd',borderRadius:10,padding:13,marginBottom:10},boton:{backgroundColor:'#111',padding:15,borderRadius:10,alignItems:'center',marginBottom:10},blanco:{color:'#fff',fontWeight:'600'},estado:{color:'#777',fontSize:12,marginVertical:12},item:{flexDirection:'row',alignItems:'center',paddingVertical:14,borderBottomWidth:1,borderColor:'#eee'},nombre:{fontSize:16,fontWeight:'600'},control:{backgroundColor:'#f2f2f2',padding:10,marginLeft:5,borderRadius:8},cantidad:{marginHorizontal:7},total:{fontSize:22,fontWeight:'700',marginVertical:18},secundario:{alignItems:'center',padding:10},vacio:{textAlign:'center',color:'#777',marginTop:40}});
