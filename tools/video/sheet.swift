// usage: swift sheet.swift <out.jpg> <cols> <cellW> <img>...
import AppKit
let a = CommandLine.arguments
let cols = Int(a[2])!, cw = CGFloat(Double(a[3])!)
let files = Array(a[4...])
let first = NSImage(contentsOfFile: files[0])!
let ch = cw * first.size.height / first.size.width
let rows = (files.count + cols - 1) / cols
let img = NSImage(size: NSSize(width: cw * CGFloat(cols), height: ch * CGFloat(rows)))
img.lockFocus()
for (i, f) in files.enumerated() {
  let im = NSImage(contentsOfFile: f)!
  let r = NSRect(x: CGFloat(i % cols) * cw, y: CGFloat(rows - 1 - i / cols) * ch, width: cw, height: ch)
  im.draw(in: r)
  let name = (f as NSString).lastPathComponent.split(separator: "_").last!.replacingOccurrences(of: ".jpg", with: "")
  (name as NSString).draw(at: NSPoint(x: r.minX + 4, y: r.maxY - 18), withAttributes: [.font: NSFont.boldSystemFont(ofSize: 14), .foregroundColor: NSColor.yellow])
}
img.unlockFocus()
let rep = NSBitmapImageRep(data: img.tiffRepresentation!)!
try! rep.representation(using: .jpeg, properties: [.compressionFactor: 0.8])!.write(to: URL(fileURLWithPath: a[1]))
