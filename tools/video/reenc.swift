// usage: reenc <in> <out.mp4> <bitsPerSecond>  — re-encode video as H.264 at a fixed average bitrate
import AVFoundation
let a = CommandLine.arguments
let asset = AVURLAsset(url: URL(fileURLWithPath: a[1]))
let track = asset.tracks(withMediaType: .video)[0]
let size = track.naturalSize
let reader = try! AVAssetReader(asset: asset)
let rout = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
reader.add(rout)
let out = URL(fileURLWithPath: a[2]); try? FileManager.default.removeItem(at: out)
let writer = try! AVAssetWriter(outputURL: out, fileType: .mp4)
let win = AVAssetWriterInput(mediaType: .video, outputSettings: [
  AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: size.width, AVVideoHeightKey: size.height,
  AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: Int(a[3])!, AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel]])
win.expectsMediaDataInRealTime = false
writer.add(win)
reader.startReading(); writer.startWriting(); writer.startSession(atSourceTime: .zero)
let q = DispatchQueue(label: "enc"); let sem = DispatchSemaphore(value: 0)
win.requestMediaDataWhenReady(on: q) {
  while win.isReadyForMoreMediaData {
    if let sb = rout.copyNextSampleBuffer() { win.append(sb) } else { win.markAsFinished(); writer.finishWriting { sem.signal() }; return }
  }
}
sem.wait()
print(writer.status == .completed ? "ok" : "failed \(String(describing: writer.error))")
