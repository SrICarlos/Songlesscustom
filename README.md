# 🎵 Adivina la canción

Una web para poner a prueba tu oído: escucha un fragmento y adivina qué canción es. Usa la **API de Spotify** para obtener las canciones y te permite **añadir tus propias canciones** para personalizar el juego.

> 🔗 **Demo:** _añade aquí el enlace cuando lo despliegues_

<!-- Cuando tengas capturas, guárdalas en /docs y descomenta esto:
![Captura de la web](docs/captura.png)
-->

## ✨ Características

- 🎧 Adivina canciones a partir de su audio.
- ➕ Añade canciones propias para crear tu propia lista de juego.
- 🔎 Búsqueda de canciones mediante la API de Spotify.
- ⚡ Rápida y ligera, construida con Vite.

## 🛠️ Tecnologías

- [Vite](https://vitejs.dev/)
- [API web de Spotify](https://developer.spotify.com/documentation/web-api)
- _Añade aquí tu framework (React, Vue, Svelte, JavaScript puro...)_

## 🚀 Puesta en marcha

### Requisitos

- [Node.js](https://nodejs.org/) 18 o superior
- Una cuenta de Spotify y una app creada en el [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)

### Instalación

```bash
git clone https://github.com/TU_USUARIO/NOMBRE_DEL_REPO.git
cd NOMBRE_DEL_REPO
npm install
```

### Configuración de Spotify

1. Crea una app en el [Dashboard de Spotify](https://developer.spotify.com/dashboard).
2. Añade en **Redirect URIs** la URL donde corre la web:
   - En local: `http://127.0.0.1:5173/callback` (ajusta el puerto y la ruta a los de tu proyecto).
   - En producción: la URL de tu dominio.
3. Copia `.env.example` a `.env` y rellénalo:

```bash
cp .env.example .env
```

```env
VITE_SPOTIFY_CLIENT_ID=tu_client_id
VITE_SPOTIFY_REDIRECT_URI=http://127.0.0.1:5173/callback
```

> ⚠️ **No subas nunca tu archivo `.env` a GitHub.** Todo lo que empieza por `VITE_` acaba visible en el navegador, así que **no pongas aquí tu Client Secret**. Si lo necesitas, gestiona esa parte desde un backend o usa el flujo de autorización con PKCE, que no requiere secreto.

### Ejecutar en desarrollo

```bash
npm run dev
```

Abre la dirección que aparece en la terminal (normalmente `http://localhost:5173`).

### Compilar para producción

```bash
npm run build
npm run preview   # para probar la versión compilada
```

El resultado queda en la carpeta `dist/`.

## 🎮 Cómo se juega

1. Inicia el juego y escucha la canción.
2. Escribe o elige tu respuesta.
3. Suma puntos por cada acierto.
4. ¿Quieres otro repertorio? Añade tus propias canciones desde la sección de personalización.

_Ajusta esta sección a las reglas reales de tu juego (puntuación, número de rondas, tiempo, etc.)._

## ☁️ Despliegue

La web es estática, así que se puede desplegar gratis en [Cloudflare Workers (static assets)](https://developers.cloudflare.com/workers/static-assets/), [Vercel](https://vercel.com/) o [Netlify](https://www.netlify.com/):

- **Comando de build:** `npm run build`
- **Carpeta de salida:** `dist`
- **Variables de entorno:** configura `VITE_SPOTIFY_CLIENT_ID` y `VITE_SPOTIFY_REDIRECT_URI` en el panel del servicio, y añade la URL final en los Redirect URIs de Spotify.

## 🗺️ Próximas mejoras

- [ ] _Idea 1_
- [ ] _Idea 2_

## 🤝 Contribuir

Las sugerencias y los _pull requests_ son bienvenidos. Abre un _issue_ para comentar lo que te gustaría cambiar.

## 📄 Licencia

Distribuido bajo la licencia MIT. Consulta el archivo `LICENSE` para más información.

## 🙏 Créditos

- Datos de música proporcionados por la [API de Spotify](https://developer.spotify.com/).
- Este proyecto no está afiliado ni respaldado por Spotify.