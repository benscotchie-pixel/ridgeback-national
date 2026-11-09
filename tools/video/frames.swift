// Dump video frames as JPEGs with AVFoundation (exact frame times, no seeking tricks).
// usage: swift frames.swift <video> <outdir> <start s> <end s> <step s> <maxDim>
import AVFoundation
import AppKit

let a = CommandLine.arguments
let url = URL(fileURLWithPath: a[1]), out = a[2]
let t0 = Double(a[3])!, t1 = Double(a[4])!, step = Double(a[5])!, maxDim = Double(a[6])!
try? FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)

let asset = AVURLAsset(url: url)
let gen = AVAssetImageGenerator(asset: asset)
gen.appliesPreferredTrackTransform = true
gen.requestedTimeToleranceBefore = .zero
gen.requestedTimeToleranceAfter = .zero
gen.maximumSize = CGSize(width: maxDim, height: maxDim)

var i = 0
var t = t0
while t <= t1 + 1e-6 {
  let time = CMTime(seconds: t, preferredTimescale: 6000)
  if let cg = try? gen.copyCGImage(at: time, actualTime: nil) {
    let rep = NSBitmapImageRep(cgImage: cg)
    let data = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.85])!
    try! data.write(to: URL(fileURLWithPath: String(format: "%@/f%04d_%.3f.jpg", out, i, t)))
  }
  i += 1
  t += step
}
print("wrote \(i) frames")
