# AI Audio/Video Transcription & Summaries

## Demo: [transcribe.lukhausen.de](https://transcribe.lukhausen.de)

This is a locally running web application that converts any video or audio file—whether small or very large (up to 10GB)—into text using your own API keys for OpenAI or Groq Whisper. It automatically splits large files into manageable segments for processing, supports in-browser voice recording, and lets you summarize transcripts using large language models. All processing happens locally in your browser; no files are ever uploaded online.

## Features

- **Local Processing:**  
  - All conversion, splitting, transcription, and summarization occur in your browser using your own API keys.

- **Large File Support**  
  - Automatically splits large files into smaller segments (tested with files up to 10GB).

- **Any Input Format:**  
  Accepts a wide range of video and audio formats, including:
  - **Videos:** `.mp4`, `.mkv`, `.mov`, `.avi`, `.wmv`,...
  - **Audios:** `.mp3`, `.wav`, `.aac`, `.ogg`, `.flac`,...

- **Voice Recording:**  
  - Record audio directly in the browser.

- **Transcription & Summarization:**  
  - Transcribe segments via OpenAI or Groq Whisper using your provided API key.
  - Summarize the transcript with large language models.

## Getting Started

If you only want to use it, you can use it here: [transcribe.lukhausen.de](https://transcribe.lukhausen.de)


### Prerequisites

- [Node.js](https://nodejs.org/) (v14 or later)
- npm or yarn package manager

### Installation

1. **Clone the Repository**

   ```bash
   git clone https://github.com/your-repo-link
   cd your-repo-directory
   ```

2. **Install Dependencies**

   ```bash
   npm install
   # or
   yarn install
   ```

3. **Configure API Keys**

   Provide your own API keys for transcription and summarization:
   
   - **Groq Whisper:** Enter your Groq API key.
   - **OpenAI:** Enter your OpenAI API key.

   API keys are entered through the application interface and stored locally.

### Running the Application

Start the development server:

```bash
npm run dev
# or
yarn dev
```

Open your browser and navigate to the provided URL (typically `http://localhost:3000`).

### Building for Production

To create a production build, run:

```bash
npm run build
# or
yarn build
```

To preview the production build locally:

```bash
npm run preview
# or
yarn preview
```

## Technologies Used

- **React & TypeScript**
- **Vite**
- **FFmpeg (via @ffmpeg/ffmpeg)**
- **Groq SDK & OpenAI SDK**
- **react-audio-voice-recorder**

## Project Structure

- **App.tsx:**  
  - Handles file upload, voice recording, media conversion, file splitting, transcription, and summarization.

- Additional configuration and utility files support the Vite + React + TypeScript setup.

## License

This project is licensed under the [MIT License](LICENSE).

## Acknowledgements

- [FFmpeg](https://github.com/ffmpegwasm/ffmpeg.wasm)
- [Groq Whisper](https://www.groq.com)
- [OpenAI](https://openai.com)
- [Vite](https://vitejs.dev/)

## Contact

Created by [Lukas Marschhausen](https://lukhausen.de).  
Feel free to open an issue or contact me with any questions or suggestions.
