import { useState, useRef, useEffect } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL, fetchFile } from "@ffmpeg/util";
import Groq from "groq-sdk";

function App() {
  // State für FFmpeg-Status, ausgewählte Datei (Audio/Video), Transkription und API-Key
  const [loaded, setLoaded] = useState(false);
  const [inputFile, setInputFile] = useState<File | null>(null);
  const [transcriptionResult, setTranscriptionResult] = useState("");
  const [apiKey, setApiKey] = useState<string>(
    localStorage.getItem("groqApiKey") || ""
  );
  const [transcribing, setTranscribing] = useState(false);

  const ffmpegRef = useRef(new FFmpeg());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const messageRef = useRef<HTMLParagraphElement | null>(null);

  // Beim Starten der App: Falls ein API-Key in localStorage gespeichert ist, wird dieser gesetzt.
  useEffect(() => {
    const storedKey = localStorage.getItem("groqApiKey");
    if (storedKey) {
      setApiKey(storedKey);
    }
  }, []);

  // API-Key im localStorage speichern, wenn er geändert wird.
  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const key = e.target.value;
    setApiKey(key);
    localStorage.setItem("groqApiKey", key);
  };

  const load = async () => {
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm";
    const ffmpeg = ffmpegRef.current;
    ffmpeg.on("log", ({ message }) => {
      if (messageRef.current) messageRef.current.innerHTML = message;
    });

    // Nur wasmURL wird benötigt – coreURL und workerURL entfallen.
    await ffmpeg.load({
      wasmURL: await toBlobURL(
        `${baseURL}/ffmpeg-core.wasm`,
        "application/wasm"
      ),
    });
    setLoaded(true);
  };

  const convertToMp3 = async () => {
    if (!inputFile) {
      alert("Please select an audio or video file first!");
      return;
    }
    const ffmpeg = ffmpegRef.current;
    const inputFileName = inputFile.name;
    const outputFileName = "output.mp3";

    // Schreibe die ausgewählte Datei in das virtuelle Dateisystem von ffmpeg.
    await ffmpeg.writeFile(inputFileName, await fetchFile(inputFile));

    // Wähle den ffmpeg-Befehl basierend auf dem Dateityp:
    // - Bei Video-Inputs: extrahiere den Audiotrack (Optionen: -q:a 0 und -map a)
    // - Bei Audio-Inputs: führe eine einfache Konvertierung durch.
    let ffmpegCommand: string[] = [];
    if (inputFile.type.startsWith("video/")) {
      ffmpegCommand = [
        "-i",
        inputFileName,
        "-q:a",
        "0",
        "-map",
        "a",
        outputFileName,
      ];
    } else if (inputFile.type.startsWith("audio/")) {
      // Hier wird die Eingabedatei in MP3 konvertiert.
      ffmpegCommand = ["-i", inputFileName, outputFileName];
    } else {
      alert("Unsupported file type!");
      return;
    }

    // Führe den ffmpeg-Befehl aus.
    await ffmpeg.exec(ffmpegCommand);

    // Lese die Ausgabedatei (MP3) aus dem virtuellen Dateisystem.
    const fileData = await ffmpeg.readFile(outputFileName);
    const data = new Uint8Array(fileData as ArrayBuffer);

    // Erstelle einen Blob für den MP3-Inhalt und weise ihn dem Audio-Element zu.
    const audioBlob = new Blob([data.buffer], { type: "audio/mp3" });
    if (audioRef.current) {
      audioRef.current.src = URL.createObjectURL(audioBlob);
    }

    // Starte die Transkription des Audios.
    transcribeAudio(audioBlob);
  };

  const transcribeAudio = async (audioBlob: Blob) => {
    if (!apiKey) {
      alert("Please provide your Groq API key!");
      return;
    }
    setTranscribing(true);
    setTranscriptionResult(""); // Vorherige Ergebnisse zurücksetzen

    try {
      // Erstelle eine File-Instanz aus dem Blob, um sie an den Groq API-Client zu übergeben.
      const audioFile = new File([audioBlob], "output.mp3", {
        type: "audio/mp3",
      });
      // Initialisiere Groq mit dem API-Key (Option dangerouslyAllowBrowser aktiviert, um Browser-Umgebungen zu erlauben)
      const groq = new Groq({ apiKey, dangerouslyAllowBrowser: true });
      // Sende die Audiodatei an den Whisper-Service zur Transkription.
      const transcription = await groq.audio.transcriptions.create({
        file: audioFile,
        model: "whisper-large-v3",
        response_format: "verbose_json",
      });
      // Setze das Transkriptionsergebnis (abhängig von der API-Antwort).
      setTranscriptionResult(
        (transcription as any).text ||
          "No transcription text found in the response."
      );
    } catch (error: any) {
      console.error("Transcription error:", error);
      setTranscriptionResult("An error occurred during transcription.");
    } finally {
      setTranscribing(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      setInputFile(e.target.files[0]);
    }
  };

  return loaded ? (
    <div style={{ maxWidth: 600, margin: "2rem auto", textAlign: "center" }}>
      <h2>Convert to MP3 & Transcribe via Groq Whisper</h2>

      {/* Eingabefeld für den Groq API-Key */}
      <div style={{ marginBottom: "1rem" }}>
        <label>
          Groq API Key:{" "}
          <input
            type="text"
            value={apiKey}
            onChange={handleApiKeyChange}
            style={{ width: "60%" }}
          />
        </label>
      </div>

      <div>
        <h3>Select an Audio or Video File</h3>
        <input
          type="file"
          accept="audio/*,video/*"
          onChange={handleFileChange}
        />
      </div>

      <br />

      <audio ref={audioRef} controls>
        Your browser does not support the audio element.
      </audio>
      <br />

      <button onClick={convertToMp3} disabled={transcribing}>
        {transcribing ? "Transcribing..." : "Convert & Transcribe"}
      </button>
      <p ref={messageRef}></p>

      {/* Anzeige der Transkription */}
      {transcriptionResult && (
        <div style={{ marginTop: "1rem", textAlign: "left" }}>
          <h3>Transcription Result:</h3>
          <pre style={{ background: "#f4f4f4", padding: "1rem" }}>
            {transcriptionResult}
          </pre>
        </div>
      )}
    </div>
  ) : (
    <div style={{ textAlign: "center", marginTop: "2rem" }}>
      <button onClick={load}>Load ffmpeg-core</button>
    </div>
  );
}

export default App;
