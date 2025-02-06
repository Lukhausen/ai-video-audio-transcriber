// App.tsx
import React, { useState, useRef, useEffect } from "react";
import { FFmpeg, FFFSType } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";
import Groq from "groq-sdk";
import OpenAI from "openai";

// Ant Design components and icons
import { Steps, ConfigProvider, theme, Upload } from "antd";
import { LoadingOutlined, CheckCircleOutlined, FileAddOutlined } from "@ant-design/icons";
import type { UploadProps } from "antd/es/upload";

import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

interface SegmentInfo {
  filename: string;
  size: number;
}

interface LogMessage {
  text: string;
  type: "info" | "error";
}

const App: React.FC = () => {
  // -----------------------------------------------------------------
  // STATE
  // -----------------------------------------------------------------
  const [loaded, setLoaded] = useState(false); // FFmpeg loaded?
  const [inputFile, setInputFile] = useState<File | null>(null);
  const [transcriptionResult, setTranscriptionResult] = useState("");
  const [transcribing, setTranscribing] = useState(false);

  // We have 5 steps total (0..4):
  // 0 = Load FFmpeg, 1 = Convert, 2 = Split, 3 = Transcribe, 4 = Summarize
  const [pipelineStep, setPipelineStep] = useState<number>(0);

  // Either "groq" or "openai"
  const [selectedApi, setSelectedApi] = useState<"groq" | "openai">(
    (localStorage.getItem("selectedApi") as "groq" | "openai") || "groq"
  );

  // Keys, models, etc.
  const [groqKey, setGroqKey] = useState<string>(localStorage.getItem("groqKey") || "");
  const [openaiKey, setOpenaiKey] = useState<string>(localStorage.getItem("openaiKey") || "");
  const [groqModel, setGroqModel] = useState<string>(
    localStorage.getItem("groqModel") || "whisper-large-v3"
  );
  const [openaiModel, setOpenaiModel] = useState<string>(
    localStorage.getItem("openaiModel") || "whisper-1"
  );
  const [maxFileSizeMB, setMaxFileSizeMB] = useState<number>(25);

  // Logs + FFmpeg
  const [logMessages, setLogMessages] = useState<LogMessage[]>([]);
  const ffmpegRef = useRef(new FFmpeg());
  const messageRef = useRef<HTMLParagraphElement | null>(null);
  const logContainerRef = useRef<HTMLDivElement | null>(null);

  // LLM fields
  const [systemPrompt, setSystemPrompt] = useState<string>("");
  const [chatCompletionResult, setChatCompletionResult] = useState<string>("");
  const [isGeneratingChat, setIsGeneratingChat] = useState<boolean>(false);

  // Model selections for chat
  const [openAiChatModel, setOpenAiChatModel] = useState<string>(
    localStorage.getItem("openAiChatModel") || "chatgpt-4o-latest"
  );
  const [groqChatModel, setGroqChatModel] = useState<string>(
    localStorage.getItem("groqChatModel") || "llama-3.3-70b-versatile"
  );

  // Advanced panel toggle
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Log console toggle
  const [showLogConsole, setShowLogConsole] = useState(false);

  // -----------------------------------------------------------------
  // HELPER: Append log message
  // -----------------------------------------------------------------
  const appendLog = (msg: string, type: "info" | "error" = "info") => {
    const timeStamp = new Date().toLocaleTimeString();
    if (type === "error") {
      toast.error(msg);
    }
    setLogMessages((prev) => [...prev, { text: `[${timeStamp}] ${msg}`, type }]);
  };

  // -----------------------------------------------------------------
  // HELPER: Create and load a new FFmpeg instance
  // -----------------------------------------------------------------
  const createNewFFmpeg = async (): Promise<FFmpeg> => {
    const newFFmpeg = new FFmpeg();
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm";
    newFFmpeg.on("log", ({ message }) => {
      if (messageRef.current) messageRef.current.innerHTML = message;
      appendLog(`FFmpeg: ${message}`, "info");
    });
    await newFFmpeg.load({
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
    });
    appendLog("New FFmpeg instance loaded.", "info");
    return newFFmpeg;
  };

  // -----------------------------------------------------------------
  // LOAD FFMPEG (Step 0)
  // -----------------------------------------------------------------
  useEffect(() => {
    const loadFFmpeg = async () => {
      appendLog("Loading ffmpeg-core (Step 0) ...", "info");
      try {
        const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm";
        const ffmpeg = ffmpegRef.current;
        ffmpeg.on("log", ({ message }) => {
          if (messageRef.current) messageRef.current.innerHTML = message;
          appendLog(`FFmpeg: ${message}`, "info");
        });
        await ffmpeg.load({
          wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
        });
        setLoaded(true);
        appendLog("FFmpeg loaded successfully.", "info");
        // Move from Step 0 => Step 1 (Now user can proceed to Convert)
        setPipelineStep(1);
      } catch (err) {
        appendLog("Error loading ffmpeg-core: " + err, "error");
      }
    };
    loadFFmpeg();
  }, []);

  // Auto-scroll the log container when new messages are added
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logMessages]);

  // -----------------------------------------------------------------
  // UI HANDLERS for API provider, keys, models, etc.
  // -----------------------------------------------------------------
  const handleApiProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const provider = e.target.value as "groq" | "openai";
    setSelectedApi(provider);
    localStorage.setItem("selectedApi", provider);
    appendLog(`Switched API provider to ${provider}`, "info");
  };

  const handleGroqKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const key = e.target.value;
    setGroqKey(key);
    localStorage.setItem("groqKey", key);
    appendLog("Updated Groq API key.", "info");
  };

  const handleOpenaiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const key = e.target.value;
    setOpenaiKey(key);
    localStorage.setItem("openaiKey", key);
    appendLog("Updated OpenAI API key.", "info");
  };

  const handleGroqModelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const model = e.target.value;
    setGroqModel(model);
    localStorage.setItem("groqModel", model);
    appendLog(`Updated Groq model to "${model}".`, "info");
  };

  const handleOpenaiModelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const model = e.target.value;
    setOpenaiModel(model);
    localStorage.setItem("openaiModel", model);
    appendLog(`Updated OpenAI model to "${model}".`, "info");
  };

  const handleMaxFileSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newSize = parseFloat(e.target.value);
    if (!isNaN(newSize) && newSize > 0) {
      setMaxFileSizeMB(newSize);
      appendLog(`Max file size updated to ${newSize} MB`, "info");
    }
  };

  const handleOpenAiChatModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const chosenModel = e.target.value;
    setOpenAiChatModel(chosenModel);
    localStorage.setItem("openAiChatModel", chosenModel);
    appendLog(`Set OpenAI Chat Model to "${chosenModel}".`, "info");
  };

  const handleGroqChatModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const chosenModel = e.target.value;
    setGroqChatModel(chosenModel);
    localStorage.setItem("groqChatModel", chosenModel);
    appendLog(`Set Groq Chat Model to "${chosenModel}".`, "info");
  };

  // -----------------------------------------------------------------
  // PIPELINE: Convert (1) → Split (2) → Transcribe (3)
  // -----------------------------------------------------------------
  const transcribeFile = async () => {
    if (!inputFile) {
      toast.error("No file selected!");
      return;
    }
    if (!loaded) {
      toast.error("FFmpeg not yet loaded. Please wait...");
      return;
    }

    setTranscribing(true);
    setTranscriptionResult("");
    setPipelineStep(1);
    appendLog("Starting conversion to MP3 (Step 1)...", "info");

    // Use the current FFmpeg instance from our ref.
    const ffmpeg = ffmpegRef.current;
    const mountDir = "/mounted";

    try {
      // --- MOUNT ---
      await ffmpeg.createDir(mountDir);
      await ffmpeg.mount("WORKERFS" as FFFSType, { files: [inputFile] }, mountDir);
      appendLog(`Mounted file at ${mountDir}/${inputFile.name}`, "info");

      // --- CONVERSION ---
      const inputPath = `${mountDir}/${inputFile.name}`;
      const outputFileName = "output.mp3";
      let ffmpegCmd: string[];

      if (inputFile.type.startsWith("video/")) {
        ffmpegCmd = ["-i", inputPath, "-q:a", "0", "-map", "a", outputFileName];
        appendLog("Detected video file – extracting audio track.", "info");
      } else {
        ffmpegCmd = ["-i", inputPath, outputFileName];
        appendLog("Detected audio file – converting to MP3.", "info");
      }

      await ffmpeg.exec(ffmpegCmd);
      appendLog("Conversion complete. Reading output.mp3 from memory FS...", "info");

      let mp3Data: Uint8Array = (await ffmpeg.readFile(outputFileName)) as unknown as Uint8Array;
      appendLog(`output.mp3 size: ${mp3Data.byteLength} bytes.`, "info");

      // --- SPLITTING (if needed) ---
      setPipelineStep(2);
      appendLog("Checking if splitting is needed (Step 2)...", "info");
      const MAX_BYTES = maxFileSizeMB * 1024 * 1024;
      let finalSegments: SegmentInfo[] = [];
      if (mp3Data.byteLength > MAX_BYTES) {
        appendLog("File is too large, splitting it now...", "info");
        finalSegments = await recursiveSplitBySize(outputFileName);
      } else {
        finalSegments.push({ filename: outputFileName, size: mp3Data.byteLength });
      }

      // --- TRANSCRIPTION ---
      setPipelineStep(3);
      appendLog("Starting transcription (Step 3)...", "info");

      const transcripts: string[] = [];
      const concurrencyLimit = 10;
      for (let i = 0; i < finalSegments.length; i += concurrencyLimit) {
        const batch = finalSegments.slice(i, i + concurrencyLimit);
        const batchResults = await Promise.all(
          batch.map((seg) => transcribeSegment(seg.filename))
        );
        transcripts.push(...batchResults);

        // Wait 60 seconds before processing the next batch if needed.
        if (i + concurrencyLimit < finalSegments.length) {
          appendLog("Waiting 60 seconds before next batch...", "info");
          await new Promise((resolve) => setTimeout(resolve, 60000));
        }
      }
      const masterTranscript = improvedStitchTranscriptions(transcripts, appendLog);
      setTranscriptionResult(masterTranscript);
      appendLog("All segments transcribed and stitched.", "info");

      // --- STEP 4: Summarize (or next steps) ---
      setPipelineStep(4);
    } catch (err) {
      appendLog("Error during transcription pipeline: " + err, "error");
    } finally {
      // --- CLEANUP SECTION ---
      try {
        await ffmpeg.unmount(mountDir);
        appendLog("Unmounted WORKERFS at /mounted.", "info");
      } catch (unmountErr) {
        appendLog("Error unmounting WORKERFS: " + unmountErr, "error");
      }

      try {
        // Unlink temporary files. Add any additional temporary file names as needed.
        ffmpeg.deleteFile("output.mp3");
      } catch (unlinkErr) {
        appendLog("Error deleting files: " + unlinkErr, "error");
      }

      try {
        ffmpeg.terminate();
        appendLog("FFmpeg instance terminated. All worker data cleared.", "info");
      } catch (termErr) {
        appendLog("Error terminating FFmpeg: " + termErr, "error");
      }

      try {
        // Create a fresh instance and update the ref.
        ffmpegRef.current = await createNewFFmpeg();
        setLoaded(true);
        appendLog("New FFmpeg instance is ready for use.", "info");
      } catch (newInstErr) {
        appendLog("Error creating new FFmpeg instance: " + newInstErr, "error");
      }

      setTranscribing(false);
    }
  };

  // -----------------------------------------------------------------
  // Recursive splitting by size (if needed)
  // -----------------------------------------------------------------
  const recursiveSplitBySize = async (filename: string): Promise<SegmentInfo[]> => {
    const ffmpeg = ffmpegRef.current;
    const fileData = (await ffmpeg.readFile(filename)) as Uint8Array;
    const size = fileData.byteLength;
    const MAX_BYTES = maxFileSizeMB * 1024 * 1024;
    if (size <= MAX_BYTES) {
      appendLog(`File "${filename}" is below limit: ${size} bytes.`, "info");
      return [{ filename, size }];
    }
    appendLog(
      `File "${filename}" is too big (${size} bytes). Splitting in half with overlap...`,
      "info"
    );

    let tempOut = "";
    const tempLogHandler = ({ message }: { message: string }) => {
      tempOut += message + "\n";
    };
    ffmpeg.on("log", tempLogHandler);
    await ffmpeg.exec(["-i", filename, "-f", "null", "-"]);
    ffmpeg.off("log", tempLogHandler);

    const durationMatch = tempOut.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (!durationMatch) {
      appendLog(`ERROR: Could not determine duration for ${filename}.`, "error");
      return [{ filename, size }];
    }
    const hh = parseInt(durationMatch[1], 10);
    const mm = parseInt(durationMatch[2], 10);
    const ss = parseFloat(durationMatch[3]);
    const totalDuration = hh * 3600 + mm * 60 + ss;
    appendLog(`Duration for "${filename}": ${totalDuration.toFixed(2)} s.`, "info");

    const halfTime = totalDuration / 2;
    const leftEnd = Math.min(halfTime + 3, totalDuration);
    const rightStart = Math.max(halfTime - 3, 0);
    const leftFilename = `${filename}_left_${halfTime.toFixed(2)}.mp3`;
    const rightFilename = `${filename}_right_${halfTime.toFixed(2)}.mp3`;

    appendLog(
      `Splitting "${filename}" at ${halfTime.toFixed(2)} s. 
       Left: 0–${leftEnd.toFixed(2)}, 
       Right: ${rightStart.toFixed(2)}–${totalDuration.toFixed(2)}`,
      "info"
    );

    await ffmpeg.exec([
      "-i",
      filename,
      "-ss",
      "0",
      "-to",
      leftEnd.toString(),
      "-c",
      "copy",
      leftFilename,
    ]);
    await ffmpeg.exec([
      "-i",
      filename,
      "-ss",
      rightStart.toString(),
      "-to",
      totalDuration.toString(),
      "-c",
      "copy",
      rightFilename,
    ]);

    const leftSegments = await recursiveSplitBySize(leftFilename);
    const rightSegments = await recursiveSplitBySize(rightFilename);
    return [...leftSegments, ...rightSegments];
  };

  // -----------------------------------------------------------------
  // Transcribe a single segment
  // -----------------------------------------------------------------
  const transcribeSegment = async (filename: string): Promise<string> => {
    appendLog(`Transcribing segment "${filename}"...`, "info");
    if (selectedApi === "groq" && !groqKey) {
      appendLog("ERROR: No Groq API key specified.", "error");
      return "";
    }
    if (selectedApi === "openai" && !openaiKey) {
      appendLog("ERROR: No OpenAI API key specified.", "error");
      return "";
    }

    const ffmpeg = ffmpegRef.current;
    const segData = (await ffmpeg.readFile(filename)) as Uint8Array;
    const blob = new Blob([segData.buffer], { type: "audio/mp3" });
    const audioFile = new File([blob], filename, { type: "audio/mp3" });

    if (selectedApi === "groq") {
      try {
        const groqClient = new Groq({
          apiKey: groqKey,
          dangerouslyAllowBrowser: true,
        });
        const resp = await groqClient.audio.transcriptions.create({
          file: audioFile,
          model: groqModel,
          response_format: "verbose_json",
        });
        appendLog(`Transcription received for "${filename}" (Groq).`, "info");
        return resp?.text || "";
      } catch (err: any) {
        appendLog(
          `Error transcribing "${filename}" with Groq: ${err.message || err}`,
          "error"
        );
        throw err;
      }
    } else {
      try {
        const openaiClient = new OpenAI({
          apiKey: openaiKey,
          dangerouslyAllowBrowser: true,
        });
        const resp = await openaiClient.audio.transcriptions.create({
          file: audioFile,
          model: openaiModel,
          response_format: "verbose_json",
        });
        appendLog(`Transcription received for "${filename}" (OpenAI).`, "info");
        return resp?.text || "";
      } catch (err: any) {
        appendLog(
          `Error transcribing "${filename}" with OpenAI: ${err.message || err}`,
          "error"
        );
        throw err;
      }
    }
  };

  // -----------------------------------------------------------------
  // Stitch multiple transcripts
  // -----------------------------------------------------------------
  const levenshteinDistance = (a: string, b: string): number => {
    const m = a.length;
    const n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () =>
      Array(n + 1).fill(0)
    );
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (a[i - 1] === b[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
      }
    }
    return dp[m][n];
  };

  const similarityScore = (a: string, b: string): number => {
    const distance = levenshteinDistance(a, b);
    const maxLen = Math.max(a.length, b.length);
    return maxLen === 0 ? 1 : 1 - distance / maxLen;
  };

  const findBestOverlap = (
    prevWords: string[],
    currWords: string[],
    minOverlap: number = 5,
    maxOverlap: number = 20
  ): { overlapCount: number; score: number } => {
    let bestOverlap = 0;
    let bestScore = 0;
    for (let candidate = minOverlap; candidate <= maxOverlap; candidate++) {
      if (candidate > prevWords.length || candidate > currWords.length) break;
      const prevOverlap = prevWords.slice(-candidate).join(" ");
      const currOverlap = currWords.slice(0, candidate).join(" ");
      const score = similarityScore(prevOverlap.toLowerCase(), currOverlap.toLowerCase());
      if (score > bestScore) {
        bestScore = score;
        bestOverlap = candidate;
      }
    }
    return { overlapCount: bestOverlap, score: bestScore };
  };

  const improvedStitchTranscriptions = (
    transcripts: string[],
    appendLog: (msg: string, type?: "info" | "error") => void
  ): string => {
    if (transcripts.length === 0) return "";
    let stitched = transcripts[0].trim();
    for (let i = 1; i < transcripts.length; i++) {
      const prevWords = stitched.split(/\s+/);
      const currWords = transcripts[i].split(/\s+/);
      const prevWindow = prevWords.slice(-10);
      const { overlapCount, score } = findBestOverlap(prevWindow, currWords, 5, 20);
      appendLog(
        `Between segment ${i} and ${i + 1}: best overlap = ${overlapCount}, score = ${score.toFixed(
          2
        )}`,
        "info"
      );
      let currAdjusted = transcripts[i];
      const threshold = 0.8;
      if (score >= threshold && overlapCount > 0) {
        currAdjusted = currWords.slice(overlapCount).join(" ");
        appendLog(
          `Overlap detected (score ${score.toFixed(2)} >= ${threshold}). Removing ${overlapCount} overlapping words from segment ${i + 1}.`,
          "info"
        );
      }
      stitched = stitched + " " + currAdjusted;
    }
    return stitched.trim();
  };

  // -----------------------------------------------------------------
  // Copy, Download, Clear Transcription
  // -----------------------------------------------------------------
  const handleCopyTranscription = () => {
    if (!transcriptionResult) return;
    navigator.clipboard.writeText(transcriptionResult).then(
      () => {
        appendLog("Transcription copied to clipboard.", "info");
      },
      (err) => {
        appendLog("Error copying transcription: " + err, "error");
      }
    );
  };

  const handleDownloadTranscription = () => {
    if (!transcriptionResult) return;
    const blob = new Blob([transcriptionResult], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "transcription.txt";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    appendLog("Transcription downloaded as TXT.", "info");
  };

  const handleClearTranscription = () => {
    setTranscriptionResult("");
    setChatCompletionResult("");
    appendLog("Cleared transcription and LLM output.", "info");
  };

  // -----------------------------------------------------------------
  // LLM: Summarize (Step 4)
  // -----------------------------------------------------------------
  const handleSendToLLM = async () => {
    if (!transcriptionResult) {
      appendLog("No transcription found to send to the model.", "error");
      return;
    }

    setPipelineStep(4);
    setIsGeneratingChat(true);
    setChatCompletionResult("");

    if (selectedApi === "openai") {
      if (!openaiKey) {
        appendLog("ERROR: OpenAI key not set. Please provide a valid key.", "error");
        return;
      }
      appendLog("Sending System Prompt + Transcript to OpenAI Chat...", "info");
      try {
        const openaiClient = new OpenAI({
          apiKey: openaiKey,
          dangerouslyAllowBrowser: true,
        });
        const response = await openaiClient.chat.completions.create({
          model: openAiChatModel,
          messages: [
            {
              role: "system",
              content: systemPrompt || "You are a helpful assistant.",
            },
            {
              role: "user",
              content: transcriptionResult,
            },
          ],
          temperature: 1,
        });
        const output = response.choices?.[0]?.message?.content || "";
        setChatCompletionResult(output);
        appendLog("Received response from OpenAI Chat (Step 4).", "info");
      } catch (err: any) {
        appendLog("Error calling OpenAI Chat: " + (err.message || String(err)), "error");
      } finally {
        setIsGeneratingChat(false);
      }
    } else {
      // GROQ
      if (!groqKey) {
        appendLog("ERROR: Groq key not set. Please provide a valid key.", "error");
        return;
      }
      appendLog("Sending System Prompt + Transcript to Groq Chat...", "info");
      try {
        const groqClient = new Groq({
          apiKey: groqKey,
          dangerouslyAllowBrowser: true,
        });
        const response = await groqClient.chat.completions.create({
          model: groqChatModel,
          messages: [
            {
              role: "system",
              content: systemPrompt || "You are a helpful assistant.",
            },
            {
              role: "user",
              content: transcriptionResult,
            },
          ],
          temperature: 1,
          max_completion_tokens: 15140,
          top_p: 1,
          stop: null,
          stream: false,
        });
        const output = response.choices?.[0]?.message?.content || "";
        setChatCompletionResult(output);
        appendLog("Received response from Groq Chat (Step 4).", "info");
      } catch (err: any) {
        appendLog("Error calling Groq Chat: " + (err.message || String(err)), "error");
      } finally {
        setIsGeneratingChat(false);
      }
    }
  };

  // -----------------------------------------------------------------
  // Step icons helper for the Steps component
  // -----------------------------------------------------------------
  const getStepIcon = (stepIndex: number) => {
    if (!loaded && stepIndex === 0) {
      return <LoadingOutlined />;
    }
    if (pipelineStep === stepIndex) {
      if (stepIndex < 4 && transcribing) {
        return <LoadingOutlined />;
      }
      if (stepIndex === 4 && isGeneratingChat) {
        return <LoadingOutlined />;
      }
    }
    if (stepIndex < pipelineStep) {
      return <CheckCircleOutlined style={{ color: "#52c41a" }} />;
    }
    return null;
  };

  // -----------------------------------------------------------------
  // Ant Design Upload (Dragger) configuration
  // -----------------------------------------------------------------
  const uploadProps: UploadProps = {
    name: "file",
    multiple: false,
    accept: "audio/*,video/*",
    beforeUpload: (file: File) => {
      setInputFile(file);
      appendLog(`Selected file: ${file.name}`, "info");
      return false; // Prevent automatic upload.
    },
    onDrop(e) {
      appendLog(`Dropped ${e.dataTransfer.files.length} file(s).`, "info");
    },
    showUploadList: {
      showRemoveIcon: true,
    },
    onRemove: () => {
      setInputFile(null);
      return true;
    },
  };

  // -----------------------------------------------------------------
  // RENDER
  // -----------------------------------------------------------------
  return (
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: "#6bc42b",
        },
      }}
    >
      <div className="app-container">
        {/* Page Title */}
        <h2 className="header-title">Audio/Video Transcription & Summaries</h2>
        <p style={{ margin: "1rem 0", fontSize: "1rem", color: "#ccc" }}>
          Easily convert audio or video files to text, then use an LLM to summarize or otherwise transform the resulting transcript.
          Everything runs locally and uses your own API key.
        </p>

        {/* API Provider & Basic Config */}
        <div className="control-panel">
          <div className="control-row">
            <label>API Provider:</label>
            <select
              className="control-input"
              value={selectedApi}
              onChange={handleApiProviderChange}
            >
              <option value="groq">Groq</option>
              <option value="openai">OpenAI</option>
            </select>
          </div>

          {selectedApi === "groq" ? (
            !groqKey ? (
              <div className="control-row">
                <label>Groq API Key:</label>
                <input
                  className="control-input blur"
                  type="text"
                  value={groqKey}
                  onChange={handleGroqKeyChange}
                  placeholder="Enter Groq API key"
                />
              </div>
            ) : (
              <p style={{ textAlign: "left", color: "#ccc" }}>
                <strong>Groq API Key is set.</strong> Update in Advanced Options if needed.
              </p>
            )
          ) : !openaiKey ? (
            <div className="control-row">
              <label>OpenAI API Key:</label>
              <input
                className="control-input blur"
                type="text"
                value={openaiKey}
                onChange={handleOpenaiKeyChange}
                placeholder="Enter OpenAI API key"
              />
            </div>
          ) : (
            <p style={{ textAlign: "left", color: "#ccc" }}>
              <strong>OpenAI API Key is set.</strong> Update in Advanced Options if needed.
            </p>
          )}

          <button className="btn-action toggle-btn" onClick={() => setShowAdvanced(!showAdvanced)}>
            {showAdvanced ? "Hide Advanced Options" : "Show Advanced Options"}
          </button>
        </div>

        {/* Advanced Panel */}
        {showAdvanced && (
          <div className="advanced-panel">
            {selectedApi === "groq" && groqKey && (
              <div className="control-row">
                <label>Groq API Key (masked):</label>
                <input
                  className="control-input"
                  type="password"
                  value={groqKey}
                  onChange={handleGroqKeyChange}
                />
              </div>
            )}
            {selectedApi === "openai" && openaiKey && (
              <div className="control-row">
                <label>OpenAI API Key (masked):</label>
                <input
                  className="control-input"
                  type="password"
                  value={openaiKey}
                  onChange={handleOpenaiKeyChange}
                />
              </div>
            )}
            {selectedApi === "groq" ? (
              <div className="control-row">
                <label>Groq Model (Audio):</label>
                <input
                  className="control-input"
                  type="text"
                  value={groqModel}
                  onChange={handleGroqModelChange}
                  placeholder="e.g. whisper-large-v3"
                />
              </div>
            ) : (
              <div className="control-row">
                <label>OpenAI Model (Audio):</label>
                <input
                  className="control-input"
                  type="text"
                  value={openaiModel}
                  onChange={handleOpenaiModelChange}
                  placeholder="e.g. whisper-1"
                />
              </div>
            )}
            <div className="control-row">
              <label>Max File Size (MB):</label>
              <input
                className="control-input"
                type="number"
                value={maxFileSizeMB}
                onChange={handleMaxFileSizeChange}
                min="1"
              />
            </div>
          </div>
        )}

        {/* File Selection & Transcribe */}
        <div className="control-panel">
          <div className="control-row">
            <Upload.Dragger {...uploadProps} maxCount={1} style={{ width: "100%" }}>
              <p className="ant-upload-drag-icon">
                <FileAddOutlined />
              </p>
              <p className="ant-upload-text">Click or drag file to this area to select</p>
              <p className="ant-upload-hint">
                Supports audio and video files. <br />
                Files are not Uploaded to any Server.
              </p>
            </Upload.Dragger>
          </div>
          <button className="btn-action" onClick={transcribeFile} disabled={transcribing || pipelineStep < 1}>
            {transcribing ? "Processing..." : "Transcribe File"}
          </button>
        </div>

        {/* Show Transcription */}
        {transcriptionResult && (
          <div className="transcript-section">
            <div className="transcript-header">
              <h3>Full Transcription</h3>
              <div>
                <button className="btn-copy" onClick={handleCopyTranscription}>
                  Copy
                </button>
                <button className="btn-copy" onClick={handleDownloadTranscription}>
                  Download .txt
                </button>
                <button className="btn-copy" onClick={handleClearTranscription}>
                  Clear
                </button>
              </div>
            </div>
            <textarea
              className="transcript-output transcript-editable"
              value={transcriptionResult}
              onChange={(e) => setTranscriptionResult(e.target.value)}
            />
          </div>
        )}

        {/* LLM Post-Processing Panel */}
        {transcriptionResult && (
          <div className="control-panel" style={{ marginTop: "1rem" }}>
            <h3 style={{ textAlign: "left", marginBottom: "0.5rem" }}>LLM Post-Processing</h3>
            {selectedApi === "openai" ? (
              <div className="control-row" style={{ alignItems: "flex-start" }}>
                <label>LLM Model (Chat):</label>
                <select className="control-input" value={openAiChatModel} onChange={handleOpenAiChatModelChange}>
                  <option value="chatgpt-4o-latest">chatgpt-4o-latest</option>
                  <option value="gpt-4o-mini">gpt-4o-mini</option>
                  <option value="o3-mini">o3-mini</option>
                  <option value="o1">o1</option>
                </select>
              </div>
            ) : (
              <div className="control-row" style={{ alignItems: "flex-start" }}>
                <label>LLM Model (Chat):</label>
                <select className="control-input" value={groqChatModel} onChange={handleGroqChatModelChange}>
                  <option value="llama-3.3-70b-versatile">llama-3.3-70b-versatile</option>
                  <option value="deepseek-r1-distill-llama-70b">deepseek-r1-distill-llama-70b</option>
                </select>
              </div>
            )}
            <div className="control-row" style={{ alignItems: "flex-start" }}>
              <label style={{ marginTop: "0.5rem" }}>System Prompt:</label>
              <textarea
                className="control-input"
                style={{ minHeight: "80px" }}
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="Enter system instructions for the LLM..."
              />
            </div>
            <button
              className="btn-action"
              style={{ alignSelf: "flex-start", marginTop: "0.5rem" }}
              onClick={handleSendToLLM}
              disabled={isGeneratingChat}
            >
              {isGeneratingChat ? "Loading..." : `Send to ${selectedApi} Chat`}
            </button>
          </div>
        )}

        {/* LLM Output */}
        {chatCompletionResult && (
          <div className="transcript-section" style={{ marginTop: "1rem" }}>
            <div className="transcript-header">
              <h3>LLM Output</h3>
            </div>
            <pre className="transcript-output">{chatCompletionResult}</pre>
          </div>
        )}

        {/* Steps */}
        <div style={{ marginTop: "2rem", marginBottom: "1rem", textAlign: "left" }}>
          <Steps current={pipelineStep} labelPlacement="vertical">
            <Steps.Step title="Setup" icon={getStepIcon(0)} />
            <Steps.Step title="Convert" icon={getStepIcon(1)} />
            <Steps.Step title="Split" icon={getStepIcon(2)} />
            <Steps.Step title="Transcribe" icon={getStepIcon(3)} />
            <Steps.Step title="Summarize" icon={getStepIcon(4)} />
          </Steps>
        </div>

        {/* Log Console Toggle */}
        <div style={{ textAlign: "right", marginBottom: "1rem" }}>
          <button className="btn-action" onClick={() => setShowLogConsole((prev) => !prev)}>
            {showLogConsole ? "Hide Log Console" : "Show Log Console"}
          </button>
        </div>

        {/* Log Console */}
        {showLogConsole && (
          <div className="log-section">
            <h3>Unified Log Console</h3>
            <div className="log-container" ref={logContainerRef}>
              {logMessages.map((logMsg, idx) => {
                const isLast = idx === logMessages.length - 1;
                let className = "log-line";
                if (logMsg.type === "error") {
                  className += " log-line-error";
                } else {
                  className += isLast ? " log-line-current" : " log-line-old";
                }
                return (
                  <div key={idx} className={className}>
                    {logMsg.text}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      <ToastContainer autoClose={10000} />
    </ConfigProvider>
  );
};

export default App;
