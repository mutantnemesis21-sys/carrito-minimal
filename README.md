# Carrito Pro Offline — Expo + SQLite + Render + PostgreSQL

Versión académica 3.1. Incluye registro/login, sesiones opacas sin JWT, cliente/admin, catálogo con stock, carrito SQLite, compras offline, sincronización idempotente, historial de facturas y PDF.

## Requisitos
- Node.js 20+ recomendado; Expo Go compatible con el SDK instalado.
- Servicio web Render (directorio raíz `backend`, comando `npm install`, inicio `npm start`).
- PostgreSQL Render con `DATABASE_URL` en Environment.
- Expo SDK 58 (ver `package.json`).

## Instalación frontend (CMD Windows)

```cmd
cd C:\Proyecto\carrito-minimal\carrito-minimal
npm install
npx expo install expo-secure-store
npx expo install --fix
npx expo-doctor
npx expo start --tunnel -c
```

**Importante:** `expo-secure-store` se instala con `npx expo install expo-secure-store`, porque una versión fija `~58.0.8` provocó ETARGET. No se fija en package.json. El comando la agrega automáticamente. `npm install` debe completarse primero. La instalación requiere internet.

Copia `.env.example` como `.env` y configura `EXPO_PUBLIC_API_URL=https://TU-SERVICIO.onrender.com` (sin barra final). No subas `.env` ni `DATABASE_URL` a GitHub.

## Render backend

Reemplaza `backend/server.js` y `backend/package.json`, sube a GitHub y despliega el mismo servicio web que ya tenías. No necesitas crear otro servicio. Mantén `DATABASE_URL`. **No necesita `JWT_SECRET`.**

### Administrador predefinido
En Render → Environment configura `ADMIN_PASSWORD` con una contraseña aleatoria de 12 a 128 caracteres. Al iniciar el backend por primera vez se crea la cuenta administrativa reservada. En la pantalla de login ingresa **admin** como usuario y la contraseña de Render. No uses el formulario de registro para crear administradores. La contraseña se almacena con hash; cambiar `ADMIN_PASSWORD` posteriormente **no cambia automáticamente** la contraseña de una cuenta admin existente. No compartas ni subas esa variable a GitHub.

### Imágenes por URL
El administrador puede introducir una URL pública `https://...` al crear o editar un producto. El backend guarda `imagen_url` en PostgreSQL; Expo muestra una vista previa y una imagen de sustitución si falla. SQLite guarda las URLs junto al catálogo para su uso offline; la foto remota podría no estar disponible sin internet. No es necesario Cloudinary.

**Seguridad:** el registro público crea solo clientes normales. El servidor verifica los permisos administrativos en cada operación. Las sesiones se almacenan con hash en PostgreSQL y caducan a los 7 días.

## Flujo offline
1. Con internet inicia sesión y sincroniza catálogo. SQLite guarda productos por usuario.
2. Desconecta Wi-Fi y datos móviles. Agrega productos y confirma la compra.
3. Se registra en SQLite `compras_pendientes` con ID único; el carrito local se vacía.
4. Al reconectar pulsa **Sincronizar con Render**. Se envían operaciones pendientes a `/compras/sincronizar`.
5. El servidor valida stock con transacción SQL y bloqueo de filas, descuenta inventario, crea factura y registra movimientos.
6. Si hay stock insuficiente o producto inactivo, la operación pasa a **Requiere revisión**; se puede devolver al carrito para corregirla. No se factura ni descuenta stock en ese caso.
7. Si la respuesta se pierde y se reintenta, `request_id` evita registrar la venta dos veces.

**Límite importante:** el stock local es el último conocido, no una reserva; una compra offline NO es una venta confirmada ni garantiza existencias. No hay cobro real ni factura electrónica DIAN. El PDF solo se genera de facturas confirmadas cuando hay conexión.

## Endpoints

Públicos: `GET /health`, `POST /auth/registro`, `POST /auth/login`.

Con sesión (`Authorization: Bearer <token>`): `GET /clientes/me`, `POST /auth/logout`, `GET /productos`, `GET /carrito`, `POST /carrito`, `PATCH /carrito/:id`, `DELETE /carrito/:id`, `DELETE /carrito`, `POST /compras/confirmar`, `POST /compras/sincronizar`, `GET /facturas`, `GET /facturas/:id`.

Solo administrador: `GET /admin/resumen`, `GET /admin/productos`, `POST /admin/productos`, `PATCH /admin/productos/:id`, `POST /admin/productos/:id/stock`, `GET /admin/clientes`, `GET /admin/facturas`, `GET /admin/movimientos`.

Ejemplo de operación offline:
```json
{"request_id":"op_123456789_abcde12345","items":[{"producto_id":1,"cantidad":2}]}
```

## Verificaciones
- `GET /health` debe devolver `{"ok":true,"version":"3.0"}`.
- Inicia sesión, agrega productos, compra online y consulta PDF.
- Prueba offline con 1 compra y vuelve a sincronizar: debe existir una sola factura y un solo descuento.
- Simula conflicto: reduce stock desde Admin antes de sincronizar otra compra offline; debe marcarse revisión.
- Repite la misma operación `request_id`: debe devolver la factura original, no crear otra.
- Verifica que un cliente normal reciba HTTP 403 al llamar `/admin/productos`.

## Consideraciones de despliegue
- La migración crea tablas/columnas faltantes; si tu PostgreSQL ya tenía productos, se asigna stock inicial **solo cuando se agrega la columna stock por primera vez**. Revisa cantidades reales desde Admin.
- Haz backup de PostgreSQL antes del primer despliegue. Las facturas existentes permanecen.
- Este proyecto se diseñó para iOS/Android. La variante web usa almacenamiento en memoria y NO ofrece SQLite persistente.
- La sincronización se intenta al iniciar sesión, al volver la app a primer plano y cada 30 segundos mientras está activa; también existe un botón manual. iOS puede suspender la app en segundo plano: no se garantiza sincronización hasta reabrirla.
- No se incluyen `node_modules`, `.env`, contraseñas ni credenciales.
- Se verificó sintaxis del backend. No se ejecutaron pruebas de integración con Render, PostgreSQL ni Expo Go en este entorno.
