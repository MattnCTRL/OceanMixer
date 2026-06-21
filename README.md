# OceanMixer

A free, local desktop studio for mixing **your own video, images, and music** into finished clips — with an AI **Creative Director** that arranges your footage for you from a prompt.

OceanMixer edits the media you already have (camera-roll photos and videos, your own music). It does **not** generate AI imagery — the AI is purely an editor: it plans and performs the cuts, splices, placement, and timing. OceanMixer runs entirely on your machine; your media never leaves your computer except for the text describing your project that is sent to the AI when you use the Creative Director. Built for personal, non-commercial creative work.

> **Personal use only.** OceanMixer and anything you export with it are for personal, non-commercial use. By using this software you agree to that. See [LICENSE](./LICENSE) (PolyForm Noncommercial 1.0.0).

## Highlights

- **Multi-track timeline editor** — video, audio, image, and text tracks with trim, split, move, transitions, transforms, and effects.
- **Real preview** — a canvas compositor driven by the bundled Chromium media engine, synced to the timeline with full transport and audio.
- **FFmpeg export** — render to MP4 / MOV / WebM / GIF. FFmpeg ships with the app; nothing to install.
- **AI Creative Director** — describe what you want ("cut a 60-second highlight reel from these clips set to this track") and the assistant assembles the timeline directly from *your* media. It reads your project and applies concrete edit operations you can undo. It never generates new footage — only arranges what you import.
- **Your own AI account** — sign in with your Anthropic account or use an API key; you only ever pay for your own usage.

## Status

Early development. The editor core (import → timeline → preview → export) and the AI Director are the current focus. See the roadmap below.

## Tech stack

- **Electron** desktop shell (macOS / Windows / Linux)
- **React + TypeScript** UI, built with **electron-vite**
- **FFmpeg** (bundled) for media probing, thumbnails, waveforms, and export
- **Canvas + Chromium media elements** for timeline preview/decoding
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
- [x] Media import + library with thumbnails and waveforms
- [x] Multi-track timeline with trim / split / move
- [x] Preview player synced to the timeline
- [x] FFmpeg export pipeline (filtergraph compiler)
- [x] AI Creative Director (timeline-aware edit operations)
- [x] Effects, transforms, and text/title tools
- [ ] Drag media in from Finder/Photos; import whole folders
- [ ] Assembly aids over your own footage: auto-cut to the beat, scene & silence detection, smart trims
- [ ] Auto-captions / subtitles from your clips' audio (on-device transcription)

> OceanMixer is intentionally **not** a generator. It will never create AI imagery, video, or music — it only helps you arrange the media you bring.

## License

[PolyForm Noncommercial 1.0.0](./LICENSE) — free to use, modify, and share for
noncommercial purposes. Commercial use is not permitted.
