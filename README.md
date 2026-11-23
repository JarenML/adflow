# AdFlow

Desktop studio that turns a video **playbook** into a visual production pipeline:

**Preparación → Guion → Imágenes → Videos → Voz del narrador → Render final → Publicación**

Each step ends waiting for a person: you review what was produced, ask Claude for changes in a
side chat, and approve it to move on. Several episodes advance at the same time through a work
queue.

AdFlow is independent of any brand. A **playbook** (rules, catalog of episodes, templates, tools)
lives in its own repository and AdFlow only reads it. The first playbook is Robles.AI's social
videos (`creative/social/PROMPT_MAESTRO_VIDEO.md` in the robles.ai repo).

## How it works

| Piece | What it does |
|---|---|
| **Brain** | The Claude Code installed on this computer, run headless (`claude -p --output-format stream-json`) with the person's own subscription. AdFlow never sees a password or API key. Each step keeps its session, so a correction in the chat resumes it. |
| **Playbook** | Read from disk on every run. The master prompt is cut into sections (`## N.`, `### N-X.`, `**Paso N.**`) and each step gets only its sections plus the rules that always apply (`Settings → Playbook` shows the map). |
| **Files** | The brain writes the same files the team already uses (`guion.md`, `escenas.json`, `prompts_imagenes.json`, `prompts_video.json`) in the episode folder. An episode made by hand and one made with AdFlow are interchangeable. AdFlow's own state goes in `<episode>/.adflow/`. |
| **Episode sources** | Plugins that say which episodes exist and hear about their progress (`src/main/sources/`: `list`, `brief`, `claim`, `report`). **Archivos del playbook** (the catalog and tracking files, local only) and **Producción de redes** (the team admin in robles.ai, `/admin/social`): connect in Settings → Playbook with the admin address and a personal token created there (stored encrypted). Taking an episode assigns it in the admin (refused if someone else has it); every status change is reported, and reports made offline wait in `team-outbox.json` until the next call. Each local episode stores its source and a stable id from it. |
| **Team statuses** | Four statuses shared by AdFlow and the team: Pendiente, En producción (with the current step), Terminado (render approved), Publicado (marked in the Publicación step). `src/shared/progress.ts` (`toTeamStatus`) is the only place that derives them; the UI shows them and the source receives them. |
| **Playbook config** | `adflow.playbook.json` in the playbook repo: sections of the master prompt per step and the script checks. Until the repo has one, AdFlow uses its preset (`presets/robles-ai.playbook.json`), so the app itself carries no brand rules. |
| **Providers** | Plugins per capability (brain, image, video, voice, music). Paid providers are listed but **blocked** until they are implemented and `Permitir proveedores con créditos` is on. |
| **Queue** | Lanes with their own limits: Claude sessions, images, voice/render. |

### Providers today

| Capability | Working | Listed, coming next |
|---|---|---|
| Brain | Claude Code (subscription) | — |
| Images | Codex CLI (`codex exec`, Codex plan) | OpenAI Images, Firefly |
| Video | Manual upload | Firefly · Veo 3.1 Fast, HeyGen, Higgsfield |
| Voice | Windows voices, Edge TTS (free, temporary voice) | ElevenLabs (lists voices with a key), HeyGen, OpenAI TTS |
| Music | — | ElevenLabs Music |

## Requirements (each person's computer)

- Node 20+ and npm
- Claude Code installed and signed in (`claude` in the PATH)
- A clone of the playbook repository (e.g. robles.ai)
- Optional: Codex CLI signed in (images), ffmpeg, Python with `faster-whisper`, `edge-tts`

`Ajustes → Diagnóstico` checks all of this without spending anything.

## Run

```bash
npm install
npm run dev        # Vite + Electron with reload
npm run build && npm start
npm test           # parsers, checked against the real playbook when robles.ai sits next to this repo
npm run check      # TypeScript
```

If `npm install` skips Electron's download, run `node node_modules/electron/install.js`.

Editors built on Electron (VS Code) set `ELECTRON_RUN_AS_NODE=1` in their terminals; the scripts in
`scripts/` remove it before starting Electron.

### Screenshots and isolated runs

`node scripts/snapshot.mjs out.png [library|settings|episode:<id>] [delayMs]` captures the window
using `.sandbox/data` as the data folder, so real settings are never touched. `ADFLOW_DATA_DIR`
does the same for any run.

## Layout

```
src/shared/      types, file schemas (zod) and the window.adflow API contract
src/main/        Electron main: store, playbook parser, pipeline, queue, providers, brain
src/preload/     exposes window.adflow
src/renderer/    React UI: production board, library, episode pipeline, settings
scripts/         dev, build, start, snapshot
```

## Roadmap

0. **Decoupling** ✅ — episode sources as plugins, stable episode ids, the four team statuses, playbook config out of the code, Publicación step (ad text and link by Claude, mark as published).
1. **Foundations** — playbook tools without hard-coded paths (in the playbook repo); move the preset to `robles.ai/adflow.playbook.json`.
1b. **Team admin** ✅ — «Producción de redes» episode source (needs the robles.ai admin section deployed).
2. **Skeleton + script** ✅ — app, library, timeline, preparation, script with Claude and chat.
3. **Images** ✅ (Codex) — gallery, per-image correction, continuity references.
4. **Voice** — temporary voices ✅; ElevenLabs/HeyGen generation with per-spend confirmation.
5. **Videos** — manual upload ✅; Firefly/HeyGen/Higgsfield; automatic clip QA (frame sheet + transcription).
6. **Render** — Remotion project from the playbook template, Remotion Player preview, master to −14 LUFS, measured checklist.
7. **Scale** — managed Claude accounts, usage meter, cost board, team status in the playbook's tracking file (with confirmation before any git push).
