// Flow Local (app nativa para macOS)
// - Ventana con los paneles web (Dictado, Notas, Estadísticas, Perfil de voz, etc.)
// - Tecla fn en cualquier app:
//     mantener fn      → dicta; al soltar, transcribe y pega
//     doble toque fn   → dictado con manos libres (bloqueado)
//     toque fn         → termina el dictado manos libres y pega
// - Panel flotante de grabación (✕ cancelar, ✓ terminar) con nivel de voz.

import Cocoa
import WebKit
import AVFoundation
import ServiceManagement

// Carpeta del proyecto: build.sh la guarda en Info.plist (clave FlowDir) al compilar
let SERVER_DIR = ProcessInfo.processInfo.environment["FLOW_DIR"] ?? (Bundle.main.object(forInfoDictionaryKey: "FlowDir") as? String) ?? FileManager.default.currentDirectoryPath
let BASE = "http://127.0.0.1:4500"
let FFMPEG = "/opt/homebrew/bin/ffmpeg"
let HOME = NSHomeDirectory()
let NODE_CANDIDATES = (ProcessInfo.processInfo.environment["NODE"].map { [$0] } ?? []) + ["/opt/homebrew/bin/node", "/usr/local/bin/node", HOME + "/.local/node/bin/node", HOME + "/.volta/bin/node", HOME + "/.nvm/current/bin/node"]
let DOUBLE_TAP_WINDOW = 0.35  // segundos entre soltar y volver a presionar fn

// MARK: - Estado global

var window: NSWindow?
var statusItem: NSStatusItem?
var serverProcess: Process?
var recorder: Process?
var wavURL: URL?
var targetApp = "Desconocida"
var fnDown = false
var locked = false
var pendingStop: DispatchWorkItem?
var eventTap: CFMachPort?
var cachedMic = 0
var cachedMicName = "micrófono"
var currentLevel: CGFloat = 0
var tapRetryTimer: Timer?
var cachedPressEnter = false
var sendEnter = false

// MARK: - Utilidades

let LOG_FILE = SERVER_DIR + "/data/app.log"
func log(_ msg: String) {
  // el log no crece sin límite: pasado 1 MB se queda con una copia anterior
  if let size = (try? FileManager.default.attributesOfItem(atPath: LOG_FILE))?[.size] as? Int, size > 1_000_000 {
    try? FileManager.default.removeItem(atPath: LOG_FILE + ".1")
    try? FileManager.default.moveItem(atPath: LOG_FILE, toPath: LOG_FILE + ".1")
  }
  let line = "\(ISO8601DateFormatter().string(from: Date())) \(msg)\n"
  if let h = FileHandle(forWritingAtPath: LOG_FILE) {
    h.seekToEndOfFile()
    h.write(line.data(using: .utf8)!)
    h.closeFile()
  } else {
    try? line.write(toFile: LOG_FILE, atomically: true, encoding: .utf8)
  }
}

func setStatus(_ s: String) {
  DispatchQueue.main.async {
    window?.title = s.isEmpty ? "Flow Local" : "Flow Local · \(s)"
    statusItem?.button?.title = s.isEmpty ? "🎙" : "🎙 \(s)"
  }
}

func getJSON(_ path: String) -> Any? {
  guard let url = URL(string: BASE + path), let d = try? Data(contentsOf: url) else { return nil }
  return try? JSONSerialization.jsonObject(with: d)
}

func serverUp() -> Bool {
  guard let url = URL(string: BASE + "/api/health"), let d = try? Data(contentsOf: url) else { return false }
  return !d.isEmpty
}

func startServer() {
  if serverUp() { return }
  guard let node = NODE_CANDIDATES.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) else { return }
  let p = Process()
  p.executableURL = URL(fileURLWithPath: node)
  p.arguments = ["server.mjs"]
  p.currentDirectoryURL = URL(fileURLWithPath: SERVER_DIR)
  p.standardOutput = FileHandle.nullDevice
  p.standardError = FileHandle.nullDevice
  try? p.run()
  serverProcess = p
  for _ in 0..<50 where !serverUp() { Thread.sleep(forTimeInterval: 0.1) }
}

// Micrófono elegido en Perfil de voz (o el primero). Se guarda en caché para no frenar el inicio de la grabación.
func micInfo() -> (Int, String) {
  let state = getJSON("/api/state") as? [String: Any]
  let wanted = ((state?["profile"] as? [String: Any])?["mic"] as? String) ?? ""
  let mics = (getJSON("/api/mics") as? [[String: Any]]) ?? []
  let pick = mics.first(where: { ($0["name"] as? String) == wanted && !wanted.isEmpty }) ?? mics.first
  return ((pick?["index"] as? Int) ?? 0, (pick?["name"] as? String) ?? "micrófono")
}

func refreshMic() {
  DispatchQueue.global().async {
    let (i, n) = micInfo()
    let state = getJSON("/api/state") as? [String: Any]
    let enter = ((state?["profile"] as? [String: Any])?["pressEnter"] as? Bool) ?? false
    DispatchQueue.main.async {
      cachedMic = i
      cachedMicName = n
      cachedPressEnter = enter
    }
  }
}

// MARK: - Panel flotante de grabación

final class PillView: NSView {
  var level: CGFloat = 0
  var phase: CGFloat = 0
  var onCancel: (() -> Void)?
  var onDone: (() -> Void)?
  override var isFlipped: Bool { true }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  private var cancelCenter: NSPoint { NSPoint(x: bounds.midX, y: 30) }
  private var doneCenter: NSPoint { NSPoint(x: bounds.midX, y: bounds.height - 30) }

  override func draw(_ dirtyRect: NSRect) {
    NSColor.black.setFill()
    NSBezierPath(roundedRect: bounds, xRadius: bounds.width / 2, yRadius: bounds.width / 2).fill()

    // ✕ cancelar
    let c = cancelCenter
    NSColor(white: 1, alpha: 0.28).setFill()
    NSBezierPath(ovalIn: NSRect(x: c.x - 16, y: c.y - 16, width: 32, height: 32)).fill()
    NSColor.white.setStroke()
    let x = NSBezierPath()
    x.lineWidth = 3
    x.lineCapStyle = .round
    x.move(to: NSPoint(x: c.x - 6, y: c.y - 6)); x.line(to: NSPoint(x: c.x + 6, y: c.y + 6))
    x.move(to: NSPoint(x: c.x + 6, y: c.y - 6)); x.line(to: NSPoint(x: c.x - 6, y: c.y + 6))
    x.stroke()

    // ✓ terminar
    let d = doneCenter
    NSColor.white.setFill()
    NSBezierPath(ovalIn: NSRect(x: d.x - 16, y: d.y - 16, width: 32, height: 32)).fill()
    NSColor.black.setStroke()
    let k = NSBezierPath()
    k.lineWidth = 3
    k.lineCapStyle = .round
    k.lineJoinStyle = .round
    k.move(to: NSPoint(x: d.x - 7, y: d.y + 0)); k.line(to: NSPoint(x: d.x - 2, y: d.y + 6)); k.line(to: NSPoint(x: d.x + 8, y: d.y - 6))
    k.stroke()

    // Puntos que reaccionan a la voz
    let top: CGFloat = 66
    let bottom = bounds.height - 66
    let n = 11
    for i in 0..<n {
      let t = CGFloat(i) / CGFloat(n - 1)
      let y = top + (bottom - top) * t
      let wave = 0.5 + 0.5 * sin(phase + CGFloat(i) * 0.9)
      let r = 1.7 + level * 2.6 * wave
      NSColor(white: 1, alpha: 0.55 + 0.45 * level).setFill()
      NSBezierPath(ovalIn: NSRect(x: bounds.midX - r, y: y - r, width: r * 2, height: r * 2)).fill()
    }
  }

  override func mouseDown(with event: NSEvent) {
    let p = convert(event.locationInWindow, from: nil)
    if hypot(p.x - cancelCenter.x, p.y - cancelCenter.y) < 20 { onCancel?() }
    else if hypot(p.x - doneCenter.x, p.y - doneCenter.y) < 20 { onDone?() }
  }
}

var pillPanel: NSPanel?
var pillView: PillView?
var toastPanel: NSPanel?
var pillTimer: Timer?
var toastWork: DispatchWorkItem?

func makePanel(_ size: NSSize) -> NSPanel {
  let p = NSPanel(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
  p.isOpaque = false
  p.backgroundColor = .clear
  p.hasShadow = true
  p.level = .statusBar
  p.hidesOnDeactivate = false
  p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
  return p
}

func showOverlay() {
  let size = NSSize(width: 60, height: 210)
  let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
  let origin = NSPoint(x: screen.maxX - size.width - 14, y: screen.midY - size.height / 2)

  let panel = pillPanel ?? makePanel(size)
  let view = pillView ?? PillView(frame: NSRect(origin: .zero, size: size))
  view.onCancel = { cancelRecording() }
  view.onDone = { finishRecording() }
  panel.contentView = view
  panel.setFrameOrigin(origin)
  panel.orderFrontRegardless()
  pillPanel = panel
  pillView = view

  pillTimer?.invalidate()
  pillTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) { _ in
    view.level = max(currentLevel, view.level * 0.85)
    view.phase += 0.35
    view.needsDisplay = true
  }

  showToast("Usando \(cachedMicName)", beside: origin, height: size.height)
}

func showToast(_ text: String, beside origin: NSPoint, height: CGFloat) {
  let label = NSTextField(labelWithString: text)
  label.font = .systemFont(ofSize: 17, weight: .regular)
  label.textColor = .white
  label.sizeToFit()
  let size = NSSize(width: label.frame.width + 44, height: 48)
  let view = NSView(frame: NSRect(origin: .zero, size: size))
  view.wantsLayer = true
  view.layer?.backgroundColor = NSColor.black.cgColor
  view.layer?.cornerRadius = size.height / 2
  label.frame.origin = NSPoint(x: 22, y: (size.height - label.frame.height) / 2)
  view.addSubview(label)

  let panel = toastPanel ?? makePanel(size)
  panel.setContentSize(size)
  panel.contentView = view
  panel.setFrameOrigin(NSPoint(x: origin.x - size.width - 12, y: origin.y + height / 2 - size.height / 2))
  panel.orderFrontRegardless()
  toastPanel = panel

  toastWork?.cancel()
  let w = DispatchWorkItem { toastPanel?.orderOut(nil) }
  toastWork = w
  DispatchQueue.main.asyncAfter(deadline: .now() + 2.4, execute: w)
}

func hideOverlay() {
  pillTimer?.invalidate()
  pillTimer = nil
  currentLevel = 0
  pillPanel?.orderOut(nil)
  toastPanel?.orderOut(nil)
}

// MARK: - Botón flotante (dictar con el mouse)

final class FloatButtonView: NSView {
  var recording = false { didSet { needsDisplay = true } }
  private var lastMouse: NSPoint?
  private var moved = false
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override func draw(_ dirtyRect: NSRect) {
    (recording ? NSColor(red: 0.79, green: 0.29, blue: 0.24, alpha: 1) : NSColor(red: 0.18, green: 0.36, blue: 0.35, alpha: 1)).setFill()
    NSBezierPath(ovalIn: bounds.insetBy(dx: 3, dy: 3)).fill()
    NSColor.white.setFill()
    NSColor.white.setStroke()
    let cx = bounds.midX, cy = bounds.midY
    NSBezierPath(roundedRect: NSRect(x: cx - 4.5, y: cy - 1, width: 9, height: 14), xRadius: 4.5, yRadius: 4.5).fill()
    let u = NSBezierPath()
    u.lineWidth = 1.8
    u.lineCapStyle = .round
    u.appendArc(withCenter: NSPoint(x: cx, y: cy + 2), radius: 8, startAngle: 180, endAngle: 360)
    u.move(to: NSPoint(x: cx, y: cy - 6)); u.line(to: NSPoint(x: cx, y: cy - 10))
    u.stroke()
  }

  override func mouseDown(with event: NSEvent) {
    lastMouse = NSEvent.mouseLocation
    moved = false
  }

  override func mouseDragged(with event: NSEvent) {
    guard let last = lastMouse, let w = window else { return }
    let now = NSEvent.mouseLocation
    if hypot(now.x - last.x, now.y - last.y) > 3 { moved = true }
    if moved {
      w.setFrameOrigin(NSPoint(x: w.frame.origin.x + now.x - last.x, y: w.frame.origin.y + now.y - last.y))
      lastMouse = now
    }
  }

  override func mouseUp(with event: NSEvent) {
    if moved, let w = window {
      UserDefaults.standard.set(Double(w.frame.origin.x), forKey: "floatX")
      UserDefaults.standard.set(Double(w.frame.origin.y), forKey: "floatY")
    } else {
      toggleFromButton()
    }
    lastMouse = nil
  }
}

var floatPanel: NSPanel?
var floatView: FloatButtonView?

func updateFloatButton() { floatView?.recording = recorder != nil }

// Un clic empieza un dictado con manos libres; otro clic lo termina y pega
func toggleFromButton() {
  if recorder == nil {
    startRecording()
    guard recorder != nil else { return }
    locked = true
    setStatus("🔒 manos libres")
  } else {
    finishRecording()
  }
}

func setFloatButton(visible: Bool) {
  UserDefaults.standard.set(visible, forKey: "floatButton")
  if !visible { floatPanel?.orderOut(nil); return }
  let size = NSSize(width: 54, height: 54)
  let panel = floatPanel ?? makePanel(size)
  let view = floatView ?? FloatButtonView(frame: NSRect(origin: .zero, size: size))
  panel.contentView = view
  let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
  let d = UserDefaults.standard
  let origin = d.object(forKey: "floatX") != nil
    ? NSPoint(x: d.double(forKey: "floatX"), y: d.double(forKey: "floatY"))
    : NSPoint(x: screen.maxX - size.width - 24, y: screen.minY + 90)
  panel.setFrameOrigin(origin)
  panel.orderFrontRegardless()
  floatPanel = panel
  floatView = view
  updateFloatButton()
}

// MARK: - Grabación

func startRecording() {
  if recorder != nil { return }
  let url = FileManager.default.temporaryDirectory.appendingPathComponent("flow-\(UUID().uuidString).wav")
  let p = Process()
  p.executableURL = URL(fileURLWithPath: FFMPEG)
  // Dos salidas: el WAV que se transcribe y un flujo crudo para medir el nivel de voz
  p.arguments = ["-loglevel", "error", "-y", "-f", "avfoundation", "-i", ":\(cachedMic)",
                 "-ac", "1", "-ar", "16000", url.path,
                 "-f", "s16le", "-ac", "1", "-ar", "16000", "pipe:1"]
  p.standardInput = FileHandle.nullDevice
  let pipe = Pipe()
  p.standardOutput = pipe
  pipe.fileHandleForReading.readabilityHandler = { h in
    let data = h.availableData
    guard data.count >= 2 else { return }
    var sum: Double = 0
    data.withUnsafeBytes { raw in
      let s = raw.bindMemory(to: Int16.self)
      for v in s { sum += Double(v) * Double(v) }
    }
    let rms = sqrt(sum / Double(data.count / 2))
    let lvl = CGFloat(min(1, rms / 5000))
    DispatchQueue.main.async { currentLevel = lvl }
  }
  do {
    try p.run()
  } catch {
    setStatus("error de micrófono")
    return
  }
  recorder = p
  wavURL = url
  targetApp = NSWorkspace.shared.frontmostApplication?.localizedName ?? "Desconocida"
  showOverlay()
  updateFloatButton()
}

func stopRecorderProcess(_ p: Process) {
  (p.standardOutput as? Pipe)?.fileHandleForReading.readabilityHandler = nil
  p.interrupt()  // SIGINT: ffmpeg cierra bien el WAV
}

func cancelRecording() {
  pendingStop?.cancel()
  pendingStop = nil
  locked = false
  guard let p = recorder, let url = wavURL else { return hideOverlay() }
  recorder = nil
  wavURL = nil
  stopRecorderProcess(p)
  DispatchQueue.global().async {
    p.waitUntilExit()
    try? FileManager.default.removeItem(at: url)
  }
  hideOverlay()
  updateFloatButton()
  setStatus("")
}

func finishRecording() {
  pendingStop?.cancel()
  pendingStop = nil
  sendEnter = locked  // solo el dictado con manos libres puede terminar con Enter
  locked = false
  stopAndSend()
}

func stopAndSend() {
  guard let p = recorder, let url = wavURL else { return }
  recorder = nil
  wavURL = nil
  hideOverlay()
  updateFloatButton()
  setStatus("transcribiendo…")
  let app = targetApp
  let enter = sendEnter && cachedPressEnter
  sendEnter = false
  stopRecorderProcess(p)
  DispatchQueue.global().async {
    p.waitUntilExit()
    let audio = (try? Data(contentsOf: url)) ?? Data()
    try? FileManager.default.removeItem(at: url)
    var comps = URLComponents(string: BASE + "/api/transcribe")!
    comps.queryItems = [URLQueryItem(name: "source", value: "fn"), URLQueryItem(name: "app", value: app)]
    var req = URLRequest(url: comps.url!)
    req.httpMethod = "POST"
    req.httpBody = audio
    req.timeoutInterval = 120
    URLSession.shared.dataTask(with: req) { data, _, _ in
      let obj = data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
      let text = (obj?["text"] as? String) ?? ""
      DispatchQueue.main.async {
        if !text.isEmpty {
          paste(text + " ")
          if enter { DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { pressReturn() } }
        }
        setStatus("")
        refreshMic()
      }
    }.resume()
  }
}

// MARK: - Pegado

func pressReturn() {
  let src = CGEventSource(stateID: .hidSystemState)
  CGEvent(keyboardEventSource: src, virtualKey: 36, keyDown: true)?.post(tap: .cghidEventTap)
  CGEvent(keyboardEventSource: src, virtualKey: 36, keyDown: false)?.post(tap: .cghidEventTap)
}

func paste(_ text: String) {
  let pb = NSPasteboard.general
  let previous = pb.string(forType: .string)
  pb.clearContents()
  pb.setString(text, forType: .string)
  let src = CGEventSource(stateID: .hidSystemState)
  let vKey: CGKeyCode = 9
  let down = CGEvent(keyboardEventSource: src, virtualKey: vKey, keyDown: true)
  down?.flags = .maskCommand
  let up = CGEvent(keyboardEventSource: src, virtualKey: vKey, keyDown: false)
  up?.flags = .maskCommand
  down?.post(tap: .cghidEventTap)
  up?.post(tap: .cghidEventTap)
  DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
    pb.clearContents()
    if let previous = previous { pb.setString(previous, forType: .string) }
  }
}

// MARK: - Máquina de estados de la tecla fn

func onFnDown() {
  if locked {  // un toque durante manos libres termina el dictado y envía
    finishRecording()
    return
  }
  if let w = pendingStop {  // doble toque: bloquea
    w.cancel()
    pendingStop = nil
    locked = true
    setStatus("🔒 manos libres")
    return
  }
  startRecording()
  setStatus("● grabando")
}

func onFnUp() {
  if locked { return }
  let w = DispatchWorkItem {
    pendingStop = nil
    stopAndSend()
  }
  pendingStop = w
  DispatchQueue.main.asyncAfter(deadline: .now() + DOUBLE_TAP_WINDOW, execute: w)
}

let tapCallback: CGEventTapCallBack = { _, type, event, _ in
  if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
    if let t = eventTap { CGEvent.tapEnable(tap: t, enable: true) }
    return Unmanaged.passUnretained(event)
  }
  // La tecla fn/🌐 también llega como tecla normal (códigos 63 y 179): se traga para que macOS no cambie de idioma
  if type == .keyDown || type == .keyUp {
    let code = event.getIntegerValueField(.keyboardEventKeycode)
    if code == 53 && type == .keyDown && recorder != nil {  // Esc cancela el dictado en curso
      DispatchQueue.main.async { cancelRecording() }
      return nil
    }
    if code == 53 && type == .keyUp && recorder != nil { return nil }
    return (code == 63 || code == 179) ? nil : Unmanaged.passUnretained(event)
  }
  let isFn = event.flags.contains(.maskSecondaryFn)
  if isFn && !fnDown {
    fnDown = true
    DispatchQueue.main.async { onFnDown() }
    return nil  // se traga el evento: el sistema no cambia de idioma ni abre emojis
  } else if !isFn && fnDown {
    fnDown = false
    DispatchQueue.main.async { onFnUp() }
    return nil
  }
  return Unmanaged.passUnretained(event)
}

func installKeyTap() -> Bool {
  if eventTap != nil { return true }
  let mask = CGEventMask((1 << CGEventType.flagsChanged.rawValue) | (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.keyUp.rawValue))
  guard let tap = CGEvent.tapCreate(tap: .cghidEventTap, place: .headInsertEventTap, options: .defaultTap,
                                    eventsOfInterest: mask, callback: tapCallback, userInfo: nil) else { return false }
  eventTap = tap
  let src = CFMachPortCreateRunLoopSource(nil, tap, 0)
  CFRunLoopAddSource(CFRunLoopGetCurrent(), src, .commonModes)
  CGEvent.tapEnable(tap: tap, enable: true)
  return true
}

// MARK: - Permisos

func missingPermissions() -> [(String, String)] {
  var missing: [(String, String)] = []
  if !AXIsProcessTrusted() {
    missing.append(("Accesibilidad", "Privacy_Accessibility"))
  }
  if !CGPreflightListenEventAccess() {
    missing.append(("Monitoreo de entrada", "Privacy_ListenEvent"))
  }
  if AVCaptureDevice.authorizationStatus(for: .audio) != .authorized {
    missing.append(("Micrófono", "Privacy_Microphone"))
  }
  return missing
}

func openPrivacy(_ pane: String) {
  if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(pane)") {
    NSWorkspace.shared.open(url)
  }
}

func explainMissingPermissions() {
  let missing = missingPermissions()
  let a = NSAlert()
  guard !missing.isEmpty else {
    a.messageText = "Permisos listos"
    a.informativeText = eventTap == nil ? "Falta conectar la tecla fn; reintentando…" : "La tecla fn está activa."
    a.runModal()
    return
  }
  a.messageText = "Faltan permisos para la tecla fn"
  a.informativeText = "Activa Flow Local en: " + missing.map { $0.0 }.joined(separator: ", ")
    + ".\n\nSe abrirá cada ajuste. La app se reconecta sola al activarlos."
  a.addButton(withTitle: "Abrir ajustes")
  a.addButton(withTitle: "Ahora no")
  if a.runModal() == .alertFirstButtonReturn {
    missing.forEach { openPrivacy($0.1) }
  }
}

// MARK: - App

// Franja superior arrastrable (la ventana no tiene barra de título visible, como Wispr)
final class DragStrip: NSView {
  override var mouseDownCanMoveWindow: Bool { true }
  override func mouseDown(with event: NSEvent) {
    if event.clickCount == 2 { window?.zoom(nil) } else { window?.performDrag(with: event) }
  }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate {
  func applicationDidFinishLaunching(_ note: Notification) {
    // Estas llamadas hacen que la app aparezca en las listas de permisos de macOS
    AVCaptureDevice.requestAccess(for: .audio) { _ in }
    _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
    _ = CGRequestListenEventAccess()

    log("inicio · AX=\(AXIsProcessTrusted()) · InputMonitoring=\(CGPreflightListenEventAccess()) · mic=\(AVCaptureDevice.authorizationStatus(for: .audio).rawValue) · pid=\(ProcessInfo.processInfo.processIdentifier) · ruta=\(Bundle.main.bundlePath)")
    startServer()
    refreshMic()
    buildMenu()
    buildWindow()
    buildStatusItem()
    if UserDefaults.standard.bool(forKey: "floatButton") { setFloatButton(visible: true) }

    // Reintenta conectar la tecla fn hasta que los permisos estén dados (sin reiniciar la app)
    let tapOK = installKeyTap()
    log("tap fn instalado=\(tapOK)")
    if !tapOK {
      setStatus("faltan permisos")
      tapRetryTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { t in
        if installKeyTap() {
          t.invalidate()
          setStatus("")
        }
      }
      explainMissingPermissions()
    } else {
      setStatus("")
    }
  }

  func buildWindow() {
    let config = WKWebViewConfiguration()
    config.applicationNameForUserAgent = "FlowLocalApp"  // la web usa esto para ajustar la barra superior
    let wv = WKWebView(frame: .zero, configuration: config)
    wv.uiDelegate = self
    wv.load(URLRequest(url: URL(string: BASE)!))

    let container = NSView()
    wv.translatesAutoresizingMaskIntoConstraints = false
    container.addSubview(wv)
    let strip = DragStrip()
    strip.translatesAutoresizingMaskIntoConstraints = false
    container.addSubview(strip)
    NSLayoutConstraint.activate([
      wv.topAnchor.constraint(equalTo: container.topAnchor),
      wv.bottomAnchor.constraint(equalTo: container.bottomAnchor),
      wv.leadingAnchor.constraint(equalTo: container.leadingAnchor),
      wv.trailingAnchor.constraint(equalTo: container.trailingAnchor),
      strip.topAnchor.constraint(equalTo: container.topAnchor),
      strip.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 90),  // deja libres los botones de la ventana
      strip.trailingAnchor.constraint(equalTo: container.trailingAnchor),
      strip.heightAnchor.constraint(equalToConstant: 38),
    ])

    let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1100, height: 760),
                     styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                     backing: .buffered, defer: false)
    w.title = "Flow Local"
    w.titleVisibility = .hidden
    w.titlebarAppearsTransparent = true
    w.appearance = NSAppearance(named: .aqua)  // diseño claro siempre
    w.backgroundColor = NSColor(red: 0.957, green: 0.949, blue: 0.933, alpha: 1)
    w.minSize = NSSize(width: 820, height: 560)
    w.isMovableByWindowBackground = true
    w.contentView = container
    if !w.setFrameUsingName("FlowLocalMain") || w.frame.width < 820 || w.frame.height < 560 {
      w.setContentSize(NSSize(width: 1100, height: 760))  // tamaño guardado inválido: vuelve al predeterminado
      w.center()
    }
    w.setFrameAutosaveName("FlowLocalMain")
    w.makeKeyAndOrderFront(nil)
    window = w
    NSApp.activate(ignoringOtherApps: true)
  }

  func buildStatusItem() {
    statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    statusItem?.button?.title = "🎙"
    let m = NSMenu()
    m.addItem(withTitle: "Abrir Flow Local", action: #selector(showWindow), keyEquivalent: "")
    m.addItem(withTitle: "Revisar permisos de fn", action: #selector(checkPerms), keyEquivalent: "")
    let floatItem = NSMenuItem(title: "Botón flotante para dictar con el mouse", action: #selector(toggleFloat(_:)), keyEquivalent: "")
    floatItem.target = self
    floatItem.state = UserDefaults.standard.bool(forKey: "floatButton") ? .on : .off
    m.addItem(floatItem)
    let login = NSMenuItem(title: "Abrir al iniciar sesión", action: #selector(toggleLogin(_:)), keyEquivalent: "")
    login.target = self
    login.state = SMAppService.mainApp.status == .enabled ? .on : .off
    m.addItem(login)
    m.addItem(.separator())
    m.addItem(withTitle: "Salir", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    statusItem?.menu = m
  }

  @objc func showWindow() {
    window?.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  @objc func checkPerms() { explainMissingPermissions() }

  @objc func toggleFloat(_ item: NSMenuItem) {
    let on = !UserDefaults.standard.bool(forKey: "floatButton")
    setFloatButton(visible: on)
    item.state = on ? .on : .off
  }

  @objc func toggleLogin(_ item: NSMenuItem) {
    do {
      if SMAppService.mainApp.status == .enabled {
        try SMAppService.mainApp.unregister()
      } else {
        try SMAppService.mainApp.register()
      }
    } catch {
      log("login item: \(error)")
    }
    item.state = SMAppService.mainApp.status == .enabled ? .on : .off
  }

  // Permite que la web use el micrófono (dictado dentro de los paneles)
  func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
               initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
               decisionHandler: @escaping (WKPermissionDecision) -> Void) {
    decisionHandler(.grant)
  }

  func buildMenu() {
    let main = NSMenu()
    let appItem = NSMenuItem()
    main.addItem(appItem)
    let appMenu = NSMenu()
    appMenu.addItem(withTitle: "Salir de Flow Local", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    appItem.submenu = appMenu

    // Menú Edición: sin esto no funcionan copiar y pegar dentro de la web
    let editItem = NSMenuItem()
    main.addItem(editItem)
    let edit = NSMenu(title: "Edición")
    edit.addItem(withTitle: "Deshacer", action: Selector(("undo:")), keyEquivalent: "z")
    edit.addItem(withTitle: "Rehacer", action: Selector(("redo:")), keyEquivalent: "Z")
    edit.addItem(.separator())
    edit.addItem(withTitle: "Cortar", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    edit.addItem(withTitle: "Copiar", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    edit.addItem(withTitle: "Pegar", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    edit.addItem(withTitle: "Seleccionar todo", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    editItem.submenu = edit
    NSApp.mainMenu = main
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
