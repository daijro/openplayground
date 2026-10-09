# OpenPlayground

Use [ArtCraft](https://github.com/storytold)'s clean-room implementations of Adobe & Microsoft Office products in your browser.

Releases are fetched every 15min.

> [!NOTE]
> Note: Hardware accelerated GPU is highly recommended!

### Optimizations

- Apps are recompiled with -O3 & SIMD acceleration
- WASM files compressed with gzip for faster load time
- Compile shaders in the background to prevent hanging
- Render viewers on the page's own GPU instead of in background workers
- Video frames are copied straight to the GPU as YUV & skips late frames so stacked clips play smoother
- Preload neighboring photos in background workers so Lightroom doesn't freeze

### Features

- [Community plugins](https://github.com/akkk09/artcraft-store) integration
- Support for reading your system's fonts
- Dark theme follows your system preference
- Workaround to enable clipboard access
- In browser file explorer & file menu (draggable into your apps)