# Flow Local (beta 0.1)

Dictado por voz para macOS que corre **100 % en tu Mac**: sin nube, sin cuenta y sin límite de palabras.
Mantén **fn**, habla, suelta, y el texto se pega en la app donde estés. Usa [whisper.cpp](https://github.com/ggerganov/whisper.cpp) para transcribir.

## Funciones
- **Dictado con fn** en cualquier app (mantener para hablar, doble toque para manos libres, Esc para cancelar).
- **Estadísticas**: palabras, racha, ppm, uso por app y perfil de voz por niveles.
- **Diccionario, fragmentos y estilos** (natural, literal, formal, casual, por app), con sugerencias automáticas.
- **Tomador de notas** y **Reuniones** (graba por tramos y transcribe; solo captura tu micrófono).
- Panel web local en http://127.0.0.1:4500 y app nativa `Flow Local.app`.

## Requisitos
macOS 13+, `node` 20+, `ffmpeg` y `whisper-cpp` (`brew install node ffmpeg whisper-cpp`), Command Line Tools (`xcode-select --install`)
y un modelo ggml en `~/Documents/whisper-models/` (por ejemplo `ggml-large-v3-turbo.bin`, `ggml-small.bin`).

## Uso
Solo el panel web:
```bash
node server.mjs
```
App nativa (necesaria para fn):
```bash
cd app && ./build.sh
```
Luego: Ajustes del Sistema → Teclado → "Pulsa la tecla 🌐 para" → **No hacer nada**, y concede Accesibilidad, Monitoreo de entrada y Micrófono a Flow Local.

Variables útiles: `PORT`, `MODELS_DIR`, `FFMPEG`, `WHISPER`, `WHISPER_SERVER`, `FLOW_DATA`, `FLOW_DIR`.

## Limitaciones conocidas
- Reuniones: solo graba el micrófono (en llamadas, la otra persona se oye solo si va por altavoz).
- Los permisos de macOS se ligan a la firma de la app; `build.sh` usa un certificado local "Flow Local Dev" si existe.
- Estado beta: faltan licencia, rutas portables y nombre definitivo para publicarlo.
