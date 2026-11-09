import AVFoundation
let a = AVURLAsset(url: URL(fileURLWithPath: CommandLine.arguments[1]))
print("duration", CMTimeGetSeconds(a.duration))
for t in a.tracks(withMediaType: .video) { print("video", t.naturalSize, t.nominalFrameRate) }
print("audio tracks", a.tracks(withMediaType: .audio).count)
