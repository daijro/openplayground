# OpenPlayground

Use open-source, clean-room alternatives to popular creative and office apps, by [ArtCraft](https://github.com/storytold) and others, in your browser.

Releases are fetched every 15min.

> [!NOTE]
> Note: Hardware accelerated GPU is highly recommended!

---

## Optimizations

- Apps are recompiled with -O3 & SIMD acceleration
- WASM files compressed with gzip for faster load time
- Compile shaders in the background to prevent hanging
- Render viewers on the page's own GPU instead of in background workers
- Video frames are copied straight to the GPU as YUV & skips late frames so stacked clips play smoother
- Preload neighboring photos in background workers so LightCraft and LightCraft Classic don't freeze

## Features

- [Community plugins](https://github.com/akkk09/artcraft-store) integration
- Support for reading your system's fonts
- Dark theme follows your system preference
- Workaround to enable clipboard access
- In browser file explorer & file menu (draggable into your apps)

## Real time collaboration

Work alongside others, in every app:

https://github.com/user-attachments/assets/5ac6496a-4166-4658-b998-c0fd142a35c6

## Source code and licences

- Every app's bar has a Source button: it links the app's code at the exact release or commit you're running, its licence, and the patches Playground built it with, at the commit that built it
- Each app's patches are licensed under that app's own licence (see [patches/README.md](patches/README.md))

---

## Trademarks

This site and the apps it serves are not affiliated with, endorsed by or sponsored by Adobe, Microsoft, Autodesk, Avid, Image-Line, Ableton, Apple, dotPDN, Blackmagic Design or Figma, Inc. Photoshop, Illustrator, InDesign, Lightroom, Premiere Pro, After Effects, Audition, Acrobat and Substance Painter are trademarks of Adobe; Word, Excel, PowerPoint and Outlook of Microsoft; AutoCAD and Fusion 360 of Autodesk; Pro Tools of Avid; FL Studio and FL Studio Mobile of Image-Line; Ableton Live of Ableton AG; Logic Pro of Apple Inc.; Paint.NET of dotPDN LLC; DaVinci Resolve of Blackmagic Design Pty Ltd; Figma of Figma, Inc. Their names appear only to say which product each open-source app is an alternative to. Altered Audio Editor is a trademark of The GeekCast Radio Network, LLC: Retake is based on it, and isn't made or endorsed by them.
