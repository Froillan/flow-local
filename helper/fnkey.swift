// Flow Local: dictado global con la tecla fn.
// Mantén fn → graba. Suelta fn → transcribe con el servidor local y pega el texto en la app activa.
//
// Compilar:  swiftc -O fnkey.swift -o fnkey
// Permisos (Ajustes del Sistema → Privacidad y seguridad):
//   - Accesibilidad
//   - Monitoreo de entrada (Input Monitoring)
//   - Micrófono (la primera vez que grabe)
// Variables opcionales: FLOW_MIC (por defecto ":0"), FFMPEG, FLOW_URL.

import Cocoa
import Foundation

let env = ProcessInfo.processInfo.environment
let micInput = env["FLOW_MIC"] ?? ":0"
let ffmpegPath = env["FFMPEG"] ?? "/opt/homebrew/bin/ffmpeg"
let baseURL = env["FLOW_URL"] ?? "http://127.0.0.1:4500"

var recorder: Process?
var currentWav: URL?
var targetApp: String = "Desconocida"
var fnDown = false

func startRecording() {
  let url = FileManager.default.temporaryDirectory.appendingPathComponent("flow-\(UUID().uuidString).wav")
  let p = Process()
  p.executableURL = URL(fileURLWithPath: ffmpegPath)
  p.arguments = ["-loglevel", "error", "-y", "-f", "avfoundation", "-i", micInput, "-ac", "1", "-ar", "16000", url.path]
  p.standardInput = FileHandle.nullDevice
  do {
    try p.run()
    recorder = p
    currentWav = url
    targetApp = NSWorkspace.shared.frontmostApplication?.localizedName ?? "Desconocida"
    print("● grabando (\(targetApp))")
  } catch {
    print("No pude iniciar ffmpeg: \(error)")
  }
}

func stopRecording(_ completion: @escaping (String?) -> Void) {
  guard let p = recorder, let url = currentWav else { return completion(nil) }
  recorder = nil
  currentWav = nil
  p.interrupt()  // SIGINT: ffmpeg cierra bien el WAV
  p.waitUntilExit()
  guard let audio = try? Data(contentsOf: url) else { return completion(nil) }
  try? FileManager.default.removeItem(at: url)

  var comps = URLComponents(string: baseURL + "/api/transcribe")!
  comps.queryItems = [URLQueryItem(name: "source", value: "fn"), URLQueryItem(name: "app", value: targetApp)]
  var req = URLRequest(url: comps.url!)
  req.httpMethod = "POST"
  req.httpBody = audio
  req.setValue("audio/wav", forHTTPHeaderField: "Content-Type")
  req.timeoutInterval = 120

  URLSession.shared.dataTask(with: req) { data, _, err in
    guard err == nil, let data = data,
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      print("Error con el servidor: \(err?.localizedDescription ?? "respuesta no válida")")
      return completion(nil)
    }
    completion(obj["text"] as? String)
  }.resume()
}

func paste(_ text: String) {
  let pb = NSPasteboard.general
  let previous = pb.string(forType: .string)
  pb.clearContents()
  pb.setString(text, forType: .string)

  let src = CGEventSource(stateID: .hidSystemState)
  let vKey: CGKeyCode = 9  // tecla V
  let down = CGEvent(keyboardEventSource: src, virtualKey: vKey, keyDown: true)
  down?.flags = .maskCommand
  let up = CGEvent(keyboardEventSource: src, virtualKey: vKey, keyDown: false)
  up?.flags = .maskCommand
  down?.post(tap: .cghidEventTap)
  up?.post(tap: .cghidEventTap)

  // Devuelve el portapapeles original después de que la app termine de pegar
  DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
    pb.clearContents()
    if let previous = previous { pb.setString(previous, forType: .string) }
  }
}

let callback: CGEventTapCallBack = { _, type, event, _ in
  if type == .tapDisabledByTimeout {
    return Unmanaged.passUnretained(event)
  }
  let isFn = event.flags.contains(.maskSecondaryFn)
  if isFn && !fnDown {
    fnDown = true
    DispatchQueue.main.async { startRecording() }
  } else if !isFn && fnDown {
    fnDown = false
    DispatchQueue.main.async {
      stopRecording { text in
        guard let text = text, !text.isEmpty else { return print("(nada que pegar)") }
        DispatchQueue.main.async {
          paste(text + " ")
          print("✓ pegado: \(text)")
        }
      }
    }
  }
  return Unmanaged.passUnretained(event)
}

let mask = CGEventMask(1 << CGEventType.flagsChanged.rawValue)
guard let tap = CGEvent.tapCreate(
  tap: .cgSessionEventTap,
  place: .headInsertEventTap,
  options: .listenOnly,
  eventsOfInterest: mask,
  callback: callback,
  userInfo: nil
) else {
  print("No pude escuchar el teclado. Activa Monitoreo de entrada y Accesibilidad para esta app o Terminal, y vuelve a abrirla.")
  exit(1)
}

let source = CFMachPortCreateRunLoopSource(nil, tap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)
print("Flow Local listo. Mantén fn para dictar en cualquier app.")
CFRunLoopRun()
