#!/bin/bash
# Compila Flow Local.app (sin Xcode: usa swiftc de las Command Line Tools)
set -euo pipefail
cd "$(dirname "$0")"
APP="../Flow Local.app"
mkdir -p "$APP/Contents/MacOS"
cp Info.plist "$APP/Contents/Info.plist"
# La app necesita saber dónde está el servidor (sin rutas escritas a mano en el código)
/usr/libexec/PlistBuddy -c "Add :FlowDir string $(cd .. && pwd)" "$APP/Contents/Info.plist"
mkdir -p "$APP/Contents/Resources"
cp AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
swiftc -O main.swift \
  -framework Cocoa -framework WebKit -framework AVFoundation -framework ServiceManagement \
  -o "$APP/Contents/MacOS/FlowLocal"
# Firma estable: macOS liga los permisos (Accesibilidad, Micrófono...) a la firma.
# Con firma ad-hoc cambia en cada compilación y los permisos se pierden; con este certificado no.
if security find-identity -p codesigning | grep -q "Flow Local Dev"; then
  codesign --force --deep --sign "Flow Local Dev" "$APP"
else
  echo "Aviso: no existe el certificado 'Flow Local Dev'; firma ad-hoc (los permisos se perderán al recompilar)"
  codesign --force --deep --sign - "$APP"
fi
echo "Listo: $(cd .. && pwd)/Flow Local.app"

# Instala en ~/Applications para que aparezca en Spotlight y Launchpad
mkdir -p "$HOME/Applications"
ditto "$APP" "$HOME/Applications/Flow Local.app"
mdimport "$HOME/Applications/Flow Local.app" 2>/dev/null || true
echo "Instalada en: $HOME/Applications/Flow Local.app"
