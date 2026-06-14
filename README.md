# AI Audio/Video Transcription

## Demo

[transcribe.lukhausen.de](https://transcribe.lukhausen.de)

Turn audio or video files into transcripts, then use an AI model to summarize, rewrite, or transform the text. The app runs as a local-first browser tool: media conversion, recording, queue state, and cached transcripts stay in the browser. Transcription and AI transformation requests go directly from the browser to Groq or OpenAI using your own API key.

## Features

- **Audio and video transcription**
  - Drop multiple audio or video files, or click to choose them.
  - Transcribe one file at a time or all pending files.
  - Pause, resume, retry, remove, copy, and download from the file list.

- **Large file handling**
  - Converts media in the browser with FFmpeg.
  - Splits large files into smaller segments before transcription.
  - Supports common audio and video formats such as `.mp3`, `.wav`, `.flac`, `.m4a`, `.mp4`, `.mov`, `.avi`, `.mkv`, and `.webm`.

- **Provider support**
  - Groq transcription models: `whisper-large-v3` and `whisper-large-v3-turbo`.
  - OpenAI transcription models: `gpt-4o-transcribe` and `gpt-4o-mini-transcribe`.
  - Text AI models can be selected separately for transcript transformation.

- **Browser audio recording**
  - Record audio directly in the app.
  - Live waveform and timer show whether the microphone is receiving signal.
  - Uses browser audio processing such as echo cancellation, noise suppression, and automatic gain control when available.
  - Draft recordings are cached locally so an interrupted recording can be recovered and transcribed.

- **Local browser persistence**
  - API provider, model choices, automation settings, and saved instructions are stored locally.
  - The last transcript from the browser is cached for quick access after reopening the page.

- **Transcript output**
  - Preview transcript text directly in the file list.
  - Copy or download individual transcripts.
  - Download all transcribed files as text files or a zip when there are multiple results.

- **AI transformation**
  - Run AI instructions on each transcript separately or on one combined text.
  - Save and reuse common instructions such as summaries, meeting notes, and polished rewrites.
  - AI output supports Markdown, including tables.
  - Copy or download all AI output after processing.

- **Responsive interface**
  - Dark, compact UI optimized for desktop and mobile.
  - Provider icons, subtle background pattern, touch-friendly mobile layout, and clean action icons.

## Privacy Model

There is no custom backend server for your files.

- Files are selected, converted, split, recorded, and cached in the browser.
- API keys are stored in the browser's local storage.
- Transcription and AI transformation calls are sent directly from the browser to the selected provider, Groq or OpenAI, using your API key.
- Nothing is sent to a separate application server owned by this project.

## Getting Started

If you only want to use the hosted app, open [transcribe.lukhausen.de](https://transcribe.lukhausen.de).

### Prerequisites

- [Node.js](https://nodejs.org/) 18 or later recommended
- npm

### Installation

```bash
git clone https://github.com/Lukhausen/ai-video-audio-transcriber/
cd ai-video-audio-transcriber
npm install
```

### Running Locally

```bash
npm run dev
```

Open the Vite URL shown in the terminal. By default this is usually [http://localhost:5173](http://localhost:5173).

API keys are entered in the app UI and saved locally in the browser.

### Building for Production

```bash
npm run build
```

The upload-ready production build is written to `dist/`.

To preview the production build locally:

```bash
npm run preview
```

## Scripts

- `npm run dev` - start the Vite development server
- `npm run build` - type-check and build the production app
- `npm run preview` - preview the production build
- `npm run lint` - run ESLint
- `npm run knip` - run unused-file analysis

## Technologies

- React and TypeScript
- Vite
- Ant Design
- FFmpeg WASM via `@ffmpeg/ffmpeg`
- Groq SDK
- OpenAI SDK
- MediaRecorder API
- IndexedDB and local storage
- React Markdown with GitHub-flavored Markdown support

## Project Structure

- `src/App.tsx` - main app shell, provider settings, upload flow, recent transcripts, and page layout
- `src/hooks/useTranscriptionQueue.ts` - multi-file queue, FFmpeg conversion, splitting, transcription, pause/resume, and retry flow
- `src/components/PersistentAudioRecorder.tsx` - browser recording, waveform, draft recording recovery, and recording controls
- `src/components/FileJobTable.tsx` and `src/components/FileJobRow.tsx` - pending/transcribed file list and transcript actions
- `src/components/BatchLLMPanel.tsx` - AI transformation controls, saved instructions, combined/per-file modes, copy/download AI output
- `src/components/TranscriptSummary.tsx` and `src/utils/transcriptPreview.ts` - reusable transcript preview and expansion behavior
- `src/modelOptions.ts` - available transcription and text AI model choices
- `public/icons/` and `public/patterns/` - provider icons and subtle background assets

## Acknowledgements

- [FFmpeg WASM](https://github.com/ffmpegwasm/ffmpeg.wasm)
- [Groq](https://groq.com)
- [OpenAI](https://openai.com)
- [Vite](https://vitejs.dev/)
- [Hero Patterns](https://heropatterns.com/)

## Contact

Created by [Lukas Marschhausen](https://lukhausen.de).
