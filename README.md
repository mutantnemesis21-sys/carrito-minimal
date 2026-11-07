# Carrito de compras con clientes — Expo SDK 58 + Render + PostgreSQL

Incluye registro, inicio de sesión, catálogo, carrito por cliente, confirmación de compra, facturas históricas y PDF. **No es facturación electrónica DIAN**.

## Migración desde tu proyecto actual

1. Guarda una copia del proyecto original.
2. Copia `app/`, `lib/`, `metro.config.js`, `package.json`, `app.json`, `tsconfig.json` y `backend/` sobre el proyecto existente. No sobrescribas tu `.env` real.
3. Frontend: `npm install`, `npx expo install --fix`, `npx expo-doctor`.
4. Si `expo-secure-store` no se instala, ejecuta `npx expo install expo-secure-store`.
5. En Render conserva el servicio Node existente, con `Root Directory = backend`, `Build Command = npm install`, `Start Command = npm start`. Añade la variable `JWT_SECRET` con un valor aleatorio de al menos 32 caracteres; conserva `DATABASE_URL`. Reinicia/despliega el servicio después de subir los archivos a GitHub.
6. Mantén `.env` en la raíz con `EXPO_PUBLIC_API_URL=https://TU-API.onrender.com` (sin barra final).
7. Ejecuta `npx expo start --tunnel -c` y abre el QR **nuevo** en Expo Go.
8. Registra un cliente, inicia sesión, agrega productos, confirma compra y abre `Mis facturas` para generar PDF.

## Tablas PostgreSQL

El servidor crea automáticamente `clientes`, `productos`, `carritos_clientes`, `facturas` y `factura_detalles`. Agrega las columnas `cliente_id` y `request_id` a `facturas` si ya existía. Las facturas antiguas sin cliente quedan conservadas, pero **no aparecerán en el historial de ningún cliente nuevo**. El carrito antiguo compartido no se migra a los nuevos carritos individuales.

## Seguridad y límites

- Hash scrypt con salt aleatoria, JWT firmado con HMAC SHA-256 y caducidad de 7 días; sesión móvil en `expo-secure-store`.
- Todas las rutas de catálogo/carrito/facturas requieren token; las consultas de factura verifican pertenencia al cliente.
- Precio y total se calculan en PostgreSQL, no se confía en importes enviados por el dispositivo.
- La confirmación usa transacción e identificador de solicitud para evitar duplicados si se repite exactamente el mismo identificador.
- El caché SQLite es **solo lectura sin conexión**; las modificaciones requieren red y el backend de Render. Web utiliza caché en memoria y no guarda sesión tras recargar.
- Proyecto académico: antes de producción añadir rate limiting, recuperación de contraseñas, verificación de correo, auditoría, HTTPS estricto, políticas de privacidad y revisión de SSL PostgreSQL. En Render la configuración de SSL `rejectUnauthorized:false` debe sustituirse por verificación de certificado cuando sea posible.
- El PDF se genera en el dispositivo desde una factura persistida, no se guarda como archivo binario en PostgreSQL.

## Pruebas rápidas de API

`GET /health` debe devolver `{ "ok": true }`.
`POST /auth/registro`: `{ "nombre":"Ana", "email":"ana@example.com", "password":"claveSegura123" }`.
`POST /auth/login`: `{ "email":"ana@example.com", "password":"claveSegura123" }`.
Usar `Authorization: Bearer TOKEN` en `GET /clientes/me`, `GET /productos`, `GET /carrito`, `GET /facturas`.
`POST /carrito`: `{ "producto_id": 1 }`.
`POST /compras/confirmar`: `{ "request_id": "compra-unica-0001" }`.


## Autenticación sin JWT

El backend requiere únicamente `DATABASE_URL` (además del `PORT` que Render proporciona).
No requiere `JWT_SECRET`. El registro y login devuelven un token de sesión aleatorio
con duración de 7 días. PostgreSQL guarda únicamente el hash SHA-256 del token
en `sesiones_clientes`. El frontend existente envía el token en el encabezado
`Authorization: Bearer ...`, por lo que no requiere cambiar el flujo de login.
La ruta `POST /auth/logout` revoca la sesión en el servidor; el cliente debe
llamarla antes de borrar el token local si desea cerrar sesión también en Render.
Las sesiones anteriores basadas en JWT dejarán de ser válidas: inicia sesión de nuevo.
