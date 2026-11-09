// usage: crop <in> <out.mp4> <y0> <height>  — crops a band of rows, exports H.264 at 1280 wide
import AVFoundation
let a = CommandLine.arguments
let asset = AVURLAsset(url: URL(fileURLWithPath: a[1]))
let y0 = CGFloat(Double(a[3])!), hgt = CGFloat(Double(a[4])!)
let track = asset.tracks(withMediaType: .video)[0]
let comp = AVMutableVideoComposition()
comp.renderSize = CGSize(width: track.naturalSize.width, height: hgt)
comp.frameDuration = CMTime(value: 1, timescale: 30)
let ins = AVMutableVideoCompositionInstruction()
ins.timeRange = CMTimeRange(start: .zero, duration: asset.duration)
let li = AVMutableVideoCompositionLayerInstruction(assetTrack: track)
li.setTransform(CGAffineTransform(translationX: 0, y: -y0), at: .zero)
ins.layerInstructions = [li]
comp.instructions = [ins]
let out = URL(fileURLWithPath: a[2])
try? FileManager.default.removeItem(at: out)
let ex = AVAssetExportSession(asset: asset, presetName: AVAssetExportPreset1280x720)!
ex.outputURL = out; ex.outputFileType = .mp4; ex.videoComposition = comp
let sem = DispatchSemaphore(value: 0)
ex.exportAsynchronously { sem.signal() }
sem.wait()
print(ex.status == .completed ? "ok" : "failed \(String(describing: ex.error))")
