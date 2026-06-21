# OceanMixer

A free, local desktop studio for mixing **video, images, and music** into finished clips — with an AI **Creative Director** that can plan and build edits for you from a prompt.

OceanMixer runs entirely on your machine. Your media never leaves your computer except when you explicitly call a cloud AI model. It is built for personal, non-commercial creative work.

> **Personal use only.** OceanMixer and anything you export with it are for personal, non-commercial use. By using this software you agree to that. See [LICENSE](./LICENSE) (PolyForm Noncommercial 1.0.0).

## Highlights

- **Multi-track timeline editor** — video, audio, image, and text tracks with trim, split, move, transitions, transforms, and effects.
- **Real preview** — GPU-accelerated playback via the browser WebCodecs engine bundled with the app.
- **FFmpeg export** — render to MP4 / MOV / WebM / GIF. FFmpeg ships with the app; nothing to install.
- **AI Creative Director** — describe what you want ("cut a 60-second highlight reel from these clips set to this track") and the assistant edits the timeline directly. It reads your project and applies concrete edit operations you can undo.
- **Local-first, hybrid AI** — cheap/frequent work runs locally where possible; heavy generation uses cloud models with your own API key, so you only ever pay for your own AI usage.

## Status

Early development. The editor core (import → timeline → preview → export) and the AI Director are the current focus. See the roadmap below.

## Tech stack

- **Electron** desktop shell (macOS / Windows / Linux)
- **React + TypeScript** UI, built with **electron-vite**
- **FFmpeg** (bundled) for media probing, thumbnails, waveforms, and export
- **WebCodecs** for timeline preview/decoding
- **Zustand** for editor state, **Tailwind CSS** for the interface

## Getting started

Requires **Node.js 20+**.

```bash
git clone https://github.com/MattnCTRL/OceanMixer.git
cd OceanMixer
npm install
npm run dev
```

To create a distributable app:

```bash
npm run dist:mac   # or: npm run dist
```

### AI setup

The Creative Director uses the Anthropic API. Add your key in **Settings** inside the app (it is stored locally on your machine, never committed). Without a key, the editor works fully; only the AI panel is disabled.

## Project layout

```
src/
  main/      Electron main process — windows, FFmpeg, AI, project I/O (IPC handlers)
  preload/   Secure bridge exposing a typed `window.api` to the renderer
  renderer/  React editor UI (timeline, preview, library, inspector, director)
  shared/    Cross-process contracts: data model, IPC types, AI edit operations
```

The core document model lives in `src/shared/types.ts`. The editing operations the
AI Director (and undo/redo) use are defined in `src/shared/ai-ops.ts`.

## Roadmap

- [x] Project scaffold, data model, IPC contracts
- [ ] Media import + library with thumbnails and waveforms
- [ ] Multi-track timeline with trim / split / move / transitions
- [ ] WebCodecs preview player synced to the timeline
- [ ] FFmpeg export pipeline (filtergraph compiler)
- [ ] AI Creative Director (timeline-aware edit operations)
- [ ] Effects, transforms, and text/title tools
- [ ] Generative media (text-to-image / video, music) via cloud providers
- [ ] Enhancement (upscale, denoise, background removal)

## License

[PolyForm Noncommercial 1.0.0](./LICENSE) — free to use, modify, and share for
noncommercial purposes. Commercial use is not permitted.
