# Convert a Radiance .hdr (RGBE, RLE) into two lossless PNGs:
#   <out>_rgb.png  = RGB mantissa bytes,  <out>_exp.png = exponent byte (grayscale)
import sys, zlib, struct

def read_hdr(path):
    data = open(path, 'rb').read()
    i = 0
    while True:  # header until blank line
        j = data.index(b'\n', i)
        line = data[i:j]; i = j + 1
        if line == b'': break
    j = data.index(b'\n', i); res = data[i:j].split(); i = j + 1
    H, W = int(res[1]), int(res[3])
    out = bytearray(W * H * 4)
    for y in range(H):
        assert data[i] == 2 and data[i+1] == 2, 'only new-style RLE supported'
        i += 4
        row = [bytearray(W) for _ in range(4)]
        for c in range(4):
            x = 0; buf = row[c]
            while x < W:
                n = data[i]; i += 1
                if n > 128:
                    n -= 128; v = data[i]; i += 1
                    buf[x:x+n] = bytes([v]) * n
                else:
                    buf[x:x+n] = data[i:i+n]; i += n
                x += n
        base = y * W * 4
        for c in range(4):
            out[base + c: base + W * 4: 4] = row[c]
    return W, H, out

def write_png(path, W, H, rows, color_type, bpp):
    raw = b''.join(b'\x00' + r for r in rows)
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, color_type, 0, 0, 0)) \
        + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    open(path, 'wb').write(png)

W, H, px = read_hdr(sys.argv[1])
rgb_rows, exp_rows = [], []
for y in range(H):
    seg = px[y*W*4:(y+1)*W*4]
    rgb = bytearray(W * 3); rgb[0::3] = seg[0::4]; rgb[1::3] = seg[1::4]; rgb[2::3] = seg[2::4]
    rgb_rows.append(bytes(rgb)); exp_rows.append(bytes(seg[3::4]))
write_png(sys.argv[2] + '_rgb.png', W, H, rgb_rows, 2, 3)
write_png(sys.argv[2] + '_exp.png', W, H, exp_rows, 0, 1)
print(W, H)
