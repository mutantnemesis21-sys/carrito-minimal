import {useEffect,useState} from 'react';
import {ActivityIndicator,Alert,FlatList,Pressable,SafeAreaView,ScrollView,StyleSheet,Text,TextInput,View} from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import {getToken,setToken,loadCart,saveCart,type CachedItem} from '../lib/storage';
type Cliente={id:number;nombre:string;email:string};
type Auth={token:string;cliente:Cliente};
type Producto={id:number;nombre:string;precio:number};
type FacturaResumen={id:number;fecha:string;total:number};
type Factura=FacturaResumen & {cliente_nombre:string;cliente_email:string;items:{nombre:string;precio:number;cantidad:number;subtotal:number}[]};
const API=(process.env.EXPO_PUBLIC_API_URL||'').replace(/\/$/,'');
const money=(n:number)=>'$ '+Number(n).toLocaleString('es-CO',{maximumFractionDigits:2});
const htmlEscape=(v:string)=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
async function api<T>(path:string,method='GET',body?:object,token?:string):Promise<T>{
 if(!API)throw Error('Configura EXPO_PUBLIC_API_URL en .env');
 const r=await fetch(API+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||`HTTP ${r.status}`);return data as T;
}
function Button({label,onPress,disabled=false,secondary=false}:{label:string;onPress:()=>void;disabled?:boolean;secondary?:boolean}){return <Pressable onPress={onPress} disabled={disabled} style={[styles.button,secondary&&styles.secondary,disabled&&{opacity:.5}]}><Text style={[styles.buttonText,secondary&&{color:'#1e293b'}]}>{label}</Text></Pressable>;}
export default function Index(){
 const [token,setCurrentToken]=useState<string|null>(null);const [cliente,setCliente]=useState<Cliente|null>(null);
 const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);const [register,setRegister]=useState(false);
 const [nombre,setNombre]=useState('');const [email,setEmail]=useState('');const [password,setPassword]=useState('');
 const [vista,setVista]=useState<'tienda'|'facturas'>('tienda');const [catalogo,setCatalogo]=useState<Producto[]>([]);
 const [items,setItems]=useState<CachedItem[]>([]);const [facturas,setFacturas]=useState<FacturaResumen[]>([]);
 const [estado,setEstado]=useState('');
 async function refresh(t:string,u:Cliente){
  try{
   const [products,cart,invoices]=await Promise.all([api<Producto[]>('/productos','GET',undefined,t),api<CachedItem[]>('/carrito','GET',undefined,t),api<FacturaResumen[]>('/facturas','GET',undefined,t)]);
   setCatalogo(products);setItems(cart);setFacturas(invoices);await saveCart(u.id,cart);setEstado('Sincronizado con Render');
  }catch(e){setItems(await loadCart(u.id));setEstado('Sin conexión: mostrando carrito guardado en SQLite (solo lectura)');throw e;}
 }
 useEffect(()=>{(async()=>{try{const t=await getToken();if(t){const u=await api<Cliente>('/clientes/me','GET',undefined,t);setCurrentToken(t);setCliente(u);await refresh(t,u).catch(()=>{});}}catch{await setToken(null);}finally{setLoading(false);}})();},[]);
 async function submitAuth(){setBusy(true);try{
  const data=await api<Auth>(register?'/auth/registro':'/auth/login','POST',register?{nombre,email,password}:{email,password});
  await setToken(data.token);setCurrentToken(data.token);setCliente(data.cliente);setPassword('');setNombre('');setEstado('');await refresh(data.token,data.cliente).catch(()=>{});
 }catch(e){Alert.alert('Acceso',String(e));}finally{setBusy(false);}}
 async function logout(){await setToken(null);setCurrentToken(null);setCliente(null);setItems([]);setCatalogo([]);setFacturas([]);setVista('tienda');setEstado('');}
 async function mutation(path:string,method:string,body?:object){if(!token||!cliente)return;setBusy(true);try{await api(path,method,body,token);await refresh(token,cliente);}catch(e){Alert.alert('Error',String(e));}finally{setBusy(false);}}
 async function confirmar(){if(!token||!cliente||!items.length)return;
  Alert.alert('Confirmar compra','¿Registrar esta compra y vaciar el carrito?', [{text:'Cancelar',style:'cancel'},{text:'Confirmar',onPress:async()=>{
   setBusy(true);try{const id='c'+Date.now().toString(36)+Math.random().toString(36).slice(2,12);const f=await api<FacturaResumen>('/compras/confirmar','POST',{request_id:id},token);await refresh(token,cliente);setVista('facturas');Alert.alert('Compra registrada','Factura #'+f.id+' guardada en PostgreSQL');}catch(e){Alert.alert('Error',String(e));}finally{setBusy(false);}
  }}]);
 }
 async function pdf(id:number){if(!token)return;setBusy(true);try{
  const f=await api<Factura>('/facturas/'+id,'GET',undefined,token);
  const rows=f.items.map(i=>`<tr><td>${htmlEscape(i.nombre)}</td><td>${i.cantidad}</td><td>${money(i.precio)}</td><td>${money(i.subtotal)}</td></tr>`).join('');
  const html=`<html><head><meta name="viewport" content="width=device-width"><style>body{font-family:Arial;padding:28px;color:#172033}table{border-collapse:collapse;width:100%}td,th{padding:10px;text-align:left;border-bottom:1px solid #ddd}h2{text-align:right}</style></head><body><h1>Comprobante #${f.id}</h1><p>Cliente: ${htmlEscape(f.cliente_nombre)} (${htmlEscape(f.cliente_email)})</p><p>Fecha: ${new Date(f.fecha).toLocaleString('es-CO')}</p><table><tr><th>Producto</th><th>Cantidad</th><th>Precio</th><th>Subtotal</th></tr>${rows}</table><h2>Total: ${money(f.total)}</h2><p>Comprobante académico. No es factura electrónica validada por la DIAN.</p></body></html>`;
  const {uri}=await Print.printToFileAsync({html});if(await Sharing.isAvailableAsync())await Sharing.shareAsync(uri,{mimeType:'application/pdf',UTI:'com.adobe.pdf'});else Alert.alert('PDF creado',uri);
 }catch(e){Alert.alert('PDF',String(e));}finally{setBusy(false);}}
 if(loading)return <SafeAreaView style={styles.page}><ActivityIndicator size="large"/></SafeAreaView>;
 if(!token||!cliente)return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={{paddingTop:60,paddingBottom:30}}>
  <Text style={styles.title}>Mi tienda</Text><Text style={styles.subtitle}>{register?'Crear cuenta de cliente':'Inicia sesión para comprar'}</Text>
  {register&&<TextInput style={styles.input} placeholder="Nombre completo" value={nombre} onChangeText={setNombre} autoCapitalize="words"/>}
  <TextInput style={styles.input} placeholder="Correo electrónico" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false}/>
  <TextInput style={styles.input} placeholder="Contraseña (mínimo 8 caracteres)" value={password} onChangeText={setPassword} secureTextEntry/>
  <Button label={busy?'Procesando...':register?'Registrarme':'Ingresar'} disabled={busy} onPress={submitAuth}/>
  <Button secondary label={register?'Ya tengo cuenta':'Crear una cuenta'} disabled={busy} onPress={()=>setRegister(!register)}/>
 </ScrollView></SafeAreaView>;
 const total=items.reduce((sum,i)=>sum+i.precio*i.cantidad,0);
 return <SafeAreaView style={styles.page}>
  <Text style={styles.title}>Mi tienda</Text><Text style={styles.subtitle}>Hola, {cliente.nombre} · {cliente.email}</Text>
  <View style={styles.tabs}><Pressable style={[styles.tab,vista==='tienda'&&styles.selected]} onPress={()=>setVista('tienda')}><Text style={styles.tabText}>Tienda</Text></Pressable><Pressable style={[styles.tab,vista==='facturas'&&styles.selected]} onPress={()=>setVista('facturas')}><Text style={styles.tabText}>Mis facturas ({facturas.length})</Text></Pressable></View>
  <Text style={styles.status}>{estado}</Text>
  {vista==='tienda'?<ScrollView contentContainerStyle={{paddingBottom:40}}>
   <Text style={styles.heading}>Catálogo</Text>
   {catalogo.map(p=><View key={p.id} style={styles.line}><View style={{flex:1}}><Text style={styles.name}>{p.nombre}</Text><Text>{money(p.precio)}</Text></View><Pressable style={styles.mini} disabled={busy} onPress={()=>mutation('/carrito','POST',{producto_id:p.id})}><Text style={styles.buttonText}>+ Agregar</Text></Pressable></View>)}
   {!catalogo.length&&<Text style={styles.status}>Conéctate a Render para ver el catálogo.</Text>}
   <Text style={styles.heading}>Mi carrito</Text>
   {items.map(i=><View key={i.id} style={styles.line}><View style={{flex:1}}><Text style={styles.name}>{i.nombre}</Text><Text>{money(i.precio)} × {i.cantidad}</Text></View><Pressable disabled={busy} style={styles.counter} onPress={()=>mutation('/carrito/'+i.id,'PATCH',{cantidad:i.cantidad-1})}><Text>−</Text></Pressable><Text>{i.cantidad}</Text><Pressable disabled={busy} style={styles.counter} onPress={()=>mutation('/carrito/'+i.id,'PATCH',{cantidad:i.cantidad+1})}><Text>+</Text></Pressable><Pressable disabled={busy} style={styles.counter} onPress={()=>mutation('/carrito/'+i.id,'DELETE')}><Text>×</Text></Pressable></View>)}
   {!items.length&&<Text style={styles.status}>No hay productos agregados.</Text>}
   <Text style={styles.total}>Total: {money(total)}</Text>
   <Button label="Confirmar compra" disabled={busy||!items.length} onPress={confirmar}/>
   <Button label="Vaciar carrito" secondary disabled={busy||!items.length} onPress={()=>mutation('/carrito','DELETE')}/>
   <Button label="Actualizar desde Render" secondary disabled={busy} onPress={()=>refresh(token,cliente).catch(e=>Alert.alert('Conexión',String(e)))}/>
   <Button label="Cerrar sesión" secondary onPress={logout}/>
  </ScrollView>:<FlatList data={facturas} keyExtractor={i=>String(i.id)} ListEmptyComponent={<Text style={styles.status}>No tienes facturas registradas.</Text>} ListFooterComponent={<View><Button secondary label="Actualizar facturas" onPress={()=>refresh(token,cliente).catch(e=>Alert.alert('Conexión',String(e)))}/><Button secondary label="Cerrar sesión" onPress={logout}/></View>} renderItem={({item})=><View style={styles.line}><View style={{flex:1}}><Text style={styles.name}>Factura #{item.id}</Text><Text>{new Date(item.fecha).toLocaleString('es-CO')}</Text><Text style={styles.name}>{money(item.total)}</Text></View><Pressable disabled={busy} style={styles.mini} onPress={()=>pdf(item.id)}><Text style={styles.buttonText}>Ver PDF</Text></Pressable></View>}/>}
 </SafeAreaView>;
}
const styles=StyleSheet.create({page:{flex:1,padding:18,backgroundColor:'#fff'},title:{fontSize:30,fontWeight:'800',color:'#172033'},subtitle:{color:'#64748b',marginBottom:16},input:{borderWidth:1,borderColor:'#cbd5e1',borderRadius:10,padding:15,marginBottom:12,fontSize:16},button:{backgroundColor:'#2563eb',padding:15,borderRadius:10,alignItems:'center',marginTop:9},secondary:{backgroundColor:'#e2e8f0'},buttonText:{color:'#fff',fontWeight:'700'},tabs:{flexDirection:'row',gap:8},tab:{flex:1,backgroundColor:'#e2e8f0',padding:12,borderRadius:9,alignItems:'center'},selected:{backgroundColor:'#bfdbfe'},tabText:{fontWeight:'700'},status:{color:'#64748b',fontSize:12,marginVertical:12},heading:{fontSize:19,fontWeight:'700',marginTop:15,marginBottom:8},line:{flexDirection:'row',alignItems:'center',gap:7,borderBottomWidth:1,borderColor:'#e2e8f0',paddingVertical:11},name:{fontWeight:'700',color:'#172033'},mini:{backgroundColor:'#2563eb',padding:10,borderRadius:8},counter:{backgroundColor:'#e2e8f0',padding:10,borderRadius:7},total:{fontSize:23,fontWeight:'800',marginVertical:16}});
