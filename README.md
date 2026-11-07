# Carrito minimalista (Expo + SQLite + Render + Node.js)

## Contenido
- `app/index.tsx`: interfaz, funciones, useState/useEffect, SQLite local, llamadas REST y factura PDF.
- `backend/server.js`: API Express para crear, consultar, cambiar cantidades y borrar productos.
- `render.yaml`: configuración de despliegue para Render.

## Requisitos
- Node.js 20 o superior.
- Expo Go compatible con el SDK del proyecto (SDK 54), o emulador / build de desarrollo.
- Una base PostgreSQL accesible desde Render. **SQLite está en el teléfono como caché local**, PostgreSQL guarda los datos del servidor.

## Ejecutar aplicación
1. Descomprime el ZIP y abre terminal en la carpeta `carrito-minimal`.
2. Ejecuta `npm install`.
3. Copia `.env.example` a `.env` y escribe `EXPO_PUBLIC_API_URL=https://TU-SERVICIO.onrender.com` (sin barra final).
4. Ejecuta `npx expo start -c` y abre desde Expo Go compatible.

## Ejecutar backend local
1. Abre otra terminal en `backend` y ejecuta `npm install`.
2. Configura `DATABASE_URL` en el entorno (o utiliza `node --env-file=.env server.js` con un archivo `.env`).
3. Ejecuta `npm start` (o `node --env-file=.env server.js`).
4. Comprueba `http://localhost:3000/health` y `/carrito`.
5. Para probar desde un teléfono físico, usa la IP LAN del computador, no `localhost`, y asegúrate de permitir el puerto en el firewall.

## Publicar backend en Render
1. Sube este proyecto a GitHub.
2. Crea o conecta una base PostgreSQL y copia su URL de conexión interna si está en Render, o la URL de tu proveedor.
3. En Render crea un **Web Service** desde el repositorio, con **Root Directory** `backend`, **Build Command** `npm install`, **Start Command** `npm start`.
4. Agrega la variable `DATABASE_URL` en **Environment**. No la pongas en el frontend.
5. Al desplegar, comprueba `https://TU-SERVICIO.onrender.com/health`.
6. Copia esa URL en `.env` del frontend y reinicia Expo con `npx expo start -c`.

## API REST
| Método | Ruta | Función |
| --- | --- | --- |
| GET | `/health` | Estado del servicio |
| GET | `/carrito` | Leer carrito |
| POST | `/carrito` | Agregar `{ "nombre":"Cuaderno", "precio":12000 }` |
| PATCH | `/carrito/:id` | Actualizar `{ "cantidad":2 }` (0 elimina) |
| DELETE | `/carrito/:id` | Eliminar producto |
| DELETE | `/carrito` | Vaciar carrito |

## Factura PDF
El botón genera un PDF con `expo-print` y abre el diálogo de compartir/guardar mediante `expo-sharing`. En Android/iOS se puede guardar en archivos según las aplicaciones instaladas. Es un comprobante académico, **no una factura electrónica validada por DIAN**.

## Límites intencionales del ejemplo
- La SQLite local funciona como **copia de lectura** para consultar sin conexión. Para crear/modificar/eliminar se necesita el backend disponible; no se implementó cola de sincronización offline.
- El carrito es **compartido entre todos los clientes** porque no hay autenticación ni ID por usuario. Es adecuado solo como demo académica, no para producción.
- Los precios se expresan en COP y el total no incluye impuestos, descuentos ni envíos.
- Render puede suspender un servicio gratuito por inactividad; la primera consulta puede tardar.
- El PDF se genera en el dispositivo, no en Render.
