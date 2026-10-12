# Flow Local (beta 0.1.0)

Dictado por voz para Mac que corre **100 % en tu computadora**: sin nube, sin cuenta y sin límite de palabras.
Mantén la tecla para hablar, suelta, y el texto se pega donde estés. Transcribe con [whisper.cpp](https://github.com/ggerganov/whisper.cpp).

## Instalación rápida

**Requisitos:** macOS 13 o más nuevo.

1. **Instala las herramientas** (en Terminal):

   ```bash
   brew install node ffmpeg whisper-cpp
   ```

   Si no tienes Homebrew, instálalo desde https://brew.sh. Si `brew` no existe, el comando de arriba no funciona.

2. **Descarga un modelo** a la carpeta `~/Documents/whisper-models`:

   ```bash
   mkdir -p ~/Documents/whisper-models && curl -L -o ~/Documents/whisper-models/ggml-small.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin
   ```

   `small` pesa unos 500 MB y funciona en cualquier Mac. Para más precisión, cambia `small` por `large-v3-turbo` (pesa unos 1.6 GB y necesita más memoria).

3. **Compila e instala la app:**

   ```bash
   cd app && ./build.sh
   ```

   Esto crea `Flow Local.app` y la instala en `~/Applications`. Ábrela desde Spotlight.

4. **Da permisos** en Ajustes del Sistema → Privacidad y seguridad, a **Flow Local**:
   - **Accesibilidad**
   - **Monitoreo de entrada**
   - **Micrófono**

   Si macOS te pide reiniciar la app después de dar permisos, ciérrala y vuelve a abrirla.

5. **Elige la tecla para dictar** en Perfil de voz. Por defecto es **fn**. Si tu teclado no tiene fn (por ejemplo, un Logi), usa **Detectar tecla** o elige F9–F20. En Ajustes del Sistema → Teclado, pon "Pulsa la tecla 🌐 para" en **No hacer nada** para que fn no abra el selector de emojis.

## Cómo se usa

- **Dictar:** mantén la tecla, habla y suelta. Doble toque para dictar con manos libres; otro toque para terminar.
- **Panel:** la app abre un panel con Dictado, Estadísticas, Notas, Reuniones, Perfil de voz, Diccionario, Fragmentos y Estilos.
- **Solo el panel web** (sin la app nativa, sin tecla): `node server.mjs` y abre http://127.0.0.1:4500.

## Limitaciones de la beta

- **Reuniones:** solo graba tu micrófono. En una llamada, la otra persona se oye únicamente si va por altavoz. Whisper a veces inventa frases en los silencios.
- **Notas:** se guardan solo en este Mac, sin sincronización ni exportación.
- **Modelos grandes:** el primer dictado después de cambiar de modelo tarda más, y `large-v3-turbo` necesita bastante memoria.
- **Diccionario y Fragmentos:** dependen de que Whisper escriba igual lo que configuras.
- **Permisos y firma:** la app firmada con el certificado local "Flow Local Dev" conserva los permisos al recompilar. Sin ese certificado, macOS puede pedirlos de nuevo cada vez que compilas.
- **Tu historial** se guarda en `data/db.json`, que no se sube al repo.

## Variables útiles

`PORT`, `MODELS_DIR`, `FFMPEG`, `WHISPER`, `WHISPER_SERVER`, `FLOW_DATA`, `FLOW_DIR`, `NODE`.

## Licencia

Ver [LICENSE](LICENSE). Versión beta de uso personal, todavía sin licencia definitiva.
