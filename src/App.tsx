// App.tsx
import React, { useState, useRef, useEffect } from "react";
import { FFmpeg, FFFSType } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";
import Groq from "groq-sdk";
import OpenAI from "openai";

// Ant Design components and icons
import { Steps, ConfigProvider, theme, Upload, Tag, Switch, Button } from "antd";
import { LoadingOutlined, CheckCircleOutlined, FileAddOutlined, GithubOutlined, CloseCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import { FaCopy, FaFileDownload } from "react-icons/fa";
import type { UploadProps } from "antd/es/upload";

// Toast notifications
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

// **Import the AudioRecorder component from react-audio-voice-recorder**
import { AudioRecorder } from "react-audio-voice-recorder";

import { usePromptGallery } from './hooks/usePromptGallery';
import CollapsibleLLMOutput, { CollapsibleLLMOutputRef } from "./components/CollapsibleLLMOutput";

interface SegmentInfo {
  filename: string;
  size: number;
  url?: string;  // Add URL for audio playback
}

interface LogMessage {
  text: string;
  type: "info" | "error";
  html?: boolean;  // Add this flag
}

// Define a type for step status
type StepStatus = "idle" | "loading" | "success" | "error";

// Define the step name type
type StepName = "setup" | "convert" | "split" | "transcribe" | "summarize";

// Define the step index mapping
const stepIndexMap: Record<StepName, number> = {
  setup: 0,
  convert: 1,
  split: 2,
  transcribe: 3,
  summarize: 4
};

// Define the intermediate data type
interface IntermediateData {
  convertedMp3?: Uint8Array;
  segments?: SegmentInfo[];
  transcripts?: string[];
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
  
  // Store the status of each step
  const [stepStatus, setStepStatus] = useState<Record<StepName, StepStatus>>({
    setup: "idle",
    convert: "idle",
    split: "idle",
    transcribe: "idle",
    summarize: "idle"
  });

  // Store intermediate data for resuming steps
  const [intermediateData, setIntermediateData] = useState<IntermediateData>({});

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

  // Add the hook, which returns a combined (merged) prompt gallery.
  const { prompts, addCustomPrompt, removeCustomPrompt, updatePromptUsage } = usePromptGallery();

  // Add a state for tracking segment URLs
  const [segmentUrls, setSegmentUrls] = useState<string[]>([]);

  // Add the new state near other state declarations
  const [sampleRate, setSampleRate] = useState<number>(
    parseInt(localStorage.getItem("sampleRate") || "16000", 10)
  );

  // Add this to the state declarations section
  const [autoTranscribe, setAutoTranscribe] = useState<boolean>(
    localStorage.getItem("autoTranscribe") === "true" || false
  );

  // Add state for auto-copy to clipboard
  const [autoCopyToClipboard, setAutoCopyToClipboard] = useState<boolean>(
    localStorage.getItem("autoCopyToClipboard") === "true" || false
  );

  // Add a new state to track if the file is from recording
  const [isFromRecording, setIsFromRecording] = useState<boolean>(false);

  // Add ref for the CollapsibleLLMOutput component
  const llmOutputRef = useRef<CollapsibleLLMOutputRef>(null);

  // -----------------------------------------------------------------
  // HELPER: Append log message
  // -----------------------------------------------------------------
  const appendLog = (msg: string, type: "info" | "error" = "info") => {
    const timeStamp = new Date().toLocaleTimeString();
    if (type === "error") {
      toast.error(msg);
    }
    setLogMessages((prev) => [...prev, { 
      text: `[${timeStamp}] ${msg}`, 
      type,
      html: true  // Add this flag to indicate HTML content
    }]);
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
  // LOAD FFMPEG (Step 0) as a separate function
  // -----------------------------------------------------------------
  const loadFFmpeg = async () => {
    updateStepStatus("setup", "loading");
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
      
      // Update step status and move to next step
      updateStepStatus("setup", "success", true);
      return true;
    } catch (err) {
      appendLog("Error loading ffmpeg-core: " + err, "error");
      updateStepStatus("setup", "error");
      return false;
    }
  };

  // Auto-scroll the log container when new messages are added
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logMessages]);

  // -----------------------------------------------------------------
  // GENERIC UI HANDLERS for API settings
  // -----------------------------------------------------------------
  const handleApiSettingChange = <T extends string | number>(
    value: T,
    setter: React.Dispatch<React.SetStateAction<T>>,
    localStorageKey: string,
    logMessage: string
  ) => {
    setter(value);
    localStorage.setItem(localStorageKey, value.toString());
    appendLog(logMessage, "info");
  };

  // -----------------------------------------------------------------
  // UI HANDLERS for API provider, keys, models, etc.
  // -----------------------------------------------------------------
  const handleApiProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const provider = e.target.value as "groq" | "openai";
    handleApiSettingChange(provider, setSelectedApi, "selectedApi", `Switched API provider to ${provider}`);
  };

  const handleGroqKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const key = e.target.value;
    handleApiSettingChange(key, setGroqKey, "groqKey", "Updated Groq API key.");
  };

  const handleOpenaiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const key = e.target.value;
    handleApiSettingChange(key, setOpenaiKey, "openaiKey", "Updated OpenAI API key.");
  };

  const handleGroqModelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const model = e.target.value;
    handleApiSettingChange(model, setGroqModel, "groqModel", `Updated Groq model to "${model}".`);
  };

  const handleOpenaiModelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const model = e.target.value;
    handleApiSettingChange(model, setOpenaiModel, "openaiModel", `Updated OpenAI model to "${model}".`);
  };

  const handleMaxFileSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newSize = parseFloat(e.target.value);
    if (!isNaN(newSize) && newSize > 0) {
      handleApiSettingChange(newSize, setMaxFileSizeMB, "maxFileSizeMB", `Max file size updated to ${newSize} MB`);
    }
  };

  const handleOpenAiChatModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const chosenModel = e.target.value;
    handleApiSettingChange(chosenModel, setOpenAiChatModel, "openAiChatModel", `Set OpenAI Chat Model to "${chosenModel}".`);
  };

  const handleGroqChatModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const chosenModel = e.target.value;
    handleApiSettingChange(chosenModel, setGroqChatModel, "groqChatModel", `Set Groq Chat Model to "${chosenModel}".`);
  };

  // Add the handler for sample rate changes
  const handleSampleRateChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const rate = parseInt(e.target.value, 10);
    handleApiSettingChange(rate, setSampleRate, "sampleRate", `Audio sample rate updated to ${rate} Hz`);
  };

  // -----------------------------------------------------------------
  // HANDLER FOR THE VOICE RECORDER
  // -----------------------------------------------------------------
  const handleRecordingComplete = (blob: Blob) => {
    const now = new Date();
    const day = now.getDate().toString().padStart(2, "0");
    const month = (now.getMonth() + 1).toString().padStart(2, "0");
    const year = now.getFullYear().toString();
    const hours = now.getHours().toString().padStart(2, "0");
    const minutes = now.getMinutes().toString().padStart(2, "0");
    const seconds = now.getSeconds().toString().padStart(2, "0");

    const fileName = `Recording_${year}-${month}-${day}_${hours}-${minutes}-${seconds}.mp3`;
    const recordedFile = new File([blob], fileName, { type: blob.type });
    setIsFromRecording(true); // Set the flag for recording
    setInputFile(recordedFile);
    appendLog(`Voice recording saved as file: ${fileName}`, "info");
  };

  // -----------------------------------------------------------------
  // useEffect HOOK TO TRIGGER AUTO-TRANSCRIBE
  // -----------------------------------------------------------------
  useEffect(() => {
    if (autoTranscribe && inputFile && isFromRecording) {
      appendLog("inputFile state updated - starting transcription...", "info");
      transcribeFile();
    }
  }, [autoTranscribe, inputFile, isFromRecording]);

  // -----------------------------------------------------------------
  // Transcription Functions
  // -----------------------------------------------------------------
  const transcribeFile = async () => {
    if (!inputFile) {
      console.error("No file selected");
      return;
    }

    if (!loaded) {
      appendLog("FFmpeg not yet loaded. Please wait...", "error");
      return;
    }

    // Enhanced check: Verify if any step beyond setup has progressed or if there's any previous transcription data
    const hasExistingTranscription = transcriptionResult !== "" || 
                                    Object.keys(intermediateData).length > 0 || 
                                    segmentUrls.length > 0;
                                    
    const hasActiveSteps = stepStatus.convert !== "idle" || 
                          stepStatus.split !== "idle" || 
                          stepStatus.transcribe !== "idle" || 
                          stepStatus.summarize !== "idle";
                                    
    // If any step has progressed beyond setup or there's existing transcription data
    if (hasExistingTranscription || hasActiveSteps || pipelineStep > 1) {
      appendLog("Detected previous transcription activity. Cleaning up before starting new transcription...", "info");
      // Clean up existing resources before starting a new transcription
      await performLightCleanup();
      
      // Clear segment URLs and reset necessary state variables
      setSegmentUrls([]);
      setTranscriptionResult("");
      setIntermediateData({});
      setChatCompletionResult(""); // Also clear any LLM results
    }

    // Reset status
    setStepStatus({
      setup: "success",
      convert: "loading", // Changed from "running" to "loading" to be consistent with other steps
      split: "idle",
      transcribe: "idle",
      summarize: "idle"
    });
    
    // Start the conversion step
    try {
      setTranscribing(true);
      await runConversionStep();
    } catch (err) {
      appendLog("Error starting transcription: " + err, "error");
      setTranscribing(false);
    }
  };

  // -----------------------------------------------------------------
  // CONVERSION Step (extract/convert to MP3)
  // -----------------------------------------------------------------
  const runConversionStep = async () => {
    if (!inputFile) {
      appendLog("No file selected!", "error");
      return false;
    }
    if (!loaded) {
      appendLog("FFmpeg not yet loaded. Please load FFmpeg first.", "error");
      return false;
    }

    updateStepStatus("convert", "loading");
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
        ffmpegCmd = [
          "-i", inputPath,
          "-ar", sampleRate.toString(),  // Use the sample rate from state
          "-ac", "1",      // Set to mono (1 channel)
          "-map", "0:a",   // Extract audio
          "-c:a", "libmp3lame", // Use MP3 codec
          outputFileName
        ];
        appendLog(`Detected video file – extracting audio track with ${sampleRate}Hz mono settings.`, "info");
      } else {
        ffmpegCmd = [
          "-i", inputPath,
          "-ar", sampleRate.toString(),  // Use the sample rate from state
          "-ac", "1",      // Set to mono (1 channel)
          "-c:a", "libmp3lame", // Use MP3 codec
          outputFileName
        ];
        appendLog(`Detected audio file – converting to ${sampleRate}Hz mono MP3.`, "info");
      }

      await ffmpeg.exec(ffmpegCmd);
      appendLog("Conversion complete. Reading output.mp3 from memory FS...", "info");

      let mp3Data: Uint8Array = (await ffmpeg.readFile(outputFileName)) as unknown as Uint8Array;
      appendLog(`output.mp3 size: ${mp3Data.byteLength} bytes.`, "info");

      // Store the MP3 data in intermediate state for potential retry
      setIntermediateData(prev => ({ ...prev, convertedMp3: mp3Data }));

      // Update step status and move to the next step
      updateStepStatus("convert", "success", true);
      
      // Automatically start the split step
      return await runSplittingStep(mp3Data);
    } catch (err) {
      appendLog("Error during conversion step: " + err, "error");
      updateStepStatus("convert", "error");
      
      // Attempt to clean up
      try {
        await ffmpeg.unmount(mountDir);
      } catch (unmountErr) {
        appendLog("Error unmounting directory: " + unmountErr, "error");
      }
      
      return false;
    }
  };

  // -----------------------------------------------------------------
  // SPLITTING Step
  // -----------------------------------------------------------------
  const runSplittingStep = async (mp3Data: Uint8Array) => {
    updateStepStatus("split", "loading");
    appendLog("Checking if splitting is needed (Step 2)...", "info");
    
    const ffmpeg = ffmpegRef.current;
    const MAX_BYTES = maxFileSizeMB * 1024 * 1024;
    let finalSegments: SegmentInfo[] = [];
    let newSegmentUrls: string[] = [];

    try {
      if (mp3Data.byteLength > MAX_BYTES) {
        appendLog("File is too large, splitting it now...", "info");
        finalSegments = await recursiveSplitBySize("output.mp3");
        
        // Create blob URLs for each segment
        for (const segment of finalSegments) {
          const segmentData = await ffmpeg.readFile(segment.filename) as Uint8Array;
          const blob = new Blob([segmentData.buffer], { type: 'audio/mp3' });
          const url = URL.createObjectURL(blob);
          newSegmentUrls.push(url);
          segment.url = url;
        }
        
        // Add segment links to log
        appendLog("Created audio segments:", "info");
        finalSegments.forEach((segment, index) => {
          appendLog(
            `Segment ${index + 1} (${(segment.size / 1024 / 1024).toFixed(2)} MB): ` +
            `<a href="${segment.url}" target="_blank" class="segment-link">🔊 Listen</a>`, 
            "info"
          );
        });
      } else {
        // Create blob URL for single file
        const blob = new Blob([mp3Data.buffer], { type: 'audio/mp3' });
        const url = URL.createObjectURL(blob);
        newSegmentUrls.push(url);
        finalSegments.push({ 
          filename: "output.mp3", 
          size: mp3Data.byteLength,
          url: url 
        });
        appendLog(
          `Single audio file (${(mp3Data.byteLength / 1024 / 1024).toFixed(2)} MB): ` +
          `<a href="${url}" target="_blank" class="segment-link">🔊 Listen</a>`, 
          "info"
        );
      }

      // Update segment URLs state
      setSegmentUrls(newSegmentUrls);
      
      // Store segments for potential retry
      setIntermediateData(prev => ({ ...prev, segments: finalSegments }));
      
      // Update step status and move to the next step
      updateStepStatus("split", "success", true);
      
      // Automatically start transcription
      return await runTranscriptionStep(finalSegments);
    } catch (err) {
      appendLog("Error during splitting step: " + err, "error");
      updateStepStatus("split", "error");
      return false;
    }
  };

  // -----------------------------------------------------------------
  // TRANSCRIPTION Step
  // Note: The API provider (Groq or OpenAI) can be switched at any time,
  // even during the transcription process. Each segment will use the
  // current API provider selection at the time it is processed.
  // -----------------------------------------------------------------
  const runTranscriptionStep = async (segments: SegmentInfo[]) => {
    updateStepStatus("transcribe", "loading");
    appendLog("Starting transcription (Step 3)...", "info");
    appendLog(`Currently using ${selectedApi} for transcription. You can switch the provider at any time during transcription.`, "info");
    appendLog(`Each segment will use whichever provider is selected at the moment it's processed.`, "info");

    try {
      const transcripts: string[] = [];
      const concurrencyLimit = 10;
      
      for (let i = 0; i < segments.length; i += concurrencyLimit) {
        const batch = segments.slice(i, i + concurrencyLimit);
        // Here we display the current API provider before processing each batch
        appendLog(`Processing batch ${Math.floor(i/concurrencyLimit) + 1}/${Math.ceil(segments.length/concurrencyLimit)} with ${selectedApi}`, "info");
        const batchResults = await Promise.all(
          batch.map((seg) => transcribeSegment(seg.filename))
        );
        transcripts.push(...batchResults);

        // Wait 60 seconds before processing the next batch if needed.
        if (i + concurrencyLimit < segments.length) {
          appendLog("Waiting 60 seconds before next batch...", "info");
          appendLog(`You can switch between Groq and OpenAI now if desired for the next batch.`, "info");
          await new Promise((resolve) => setTimeout(resolve, 60000));
        }
      }
      
      // Store transcripts for potential retry/debugging
      setIntermediateData(prev => ({ ...prev, transcripts }));
      
      const masterTranscript = improvedStitchTranscriptions(transcripts, appendLog);
      setTranscriptionResult(masterTranscript);
      appendLog("All segments transcribed and stitched.", "info");

      // Update step status and move to the next step
      updateStepStatus("transcribe", "success", true);
      
      // --- STEP 4: Move to Summarize (or next steps) ---
      setPipelineStep(4);

      // NEW: Auto-copy to clipboard if enabled
      if (autoCopyToClipboard && masterTranscript) {
        handleCopyTranscription(masterTranscript);
        appendLog("Transcription auto-copied to clipboard.", "info");
      }
      
      // Run cleanup only when transcription succeeds
      appendLog("Starting automatic cleanup after successful transcription...", "info");
      const cleanupSuccess = await performAutoCleanup();
      if (cleanupSuccess) {
        appendLog("Automatic cleanup completed successfully after transcription.", "info");
      } else {
        appendLog("Automatic cleanup encountered some issues. You may need to perform manual cleanup later.", "error");
      }
      
      // Reset transcribing state to enable the button again
      setTranscribing(false);
      
      return true;
    } catch (err) {
      appendLog("Error during transcription step: " + err, "error");
      updateStepStatus("transcribe", "error");
      // Make sure to reset transcribing state on error too
      setTranscribing(false);
      return false;
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
  // Note: This function uses the current selectedApi value at the time of
  // execution, so users can switch API providers at any point before or
  // during the transcription process
  // -----------------------------------------------------------------
  const transcribeSegment = async (filename: string): Promise<string> => {
    // Capture the current API provider at the exact moment this function is called
    // This ensures that each segment uses the API provider selected when it's processed
    const apiToUse = selectedApi;
    
    appendLog(`Transcribing segment "${filename}" using ${apiToUse}...`, "info");
    
    // Uses the captured API provider value
    if (apiToUse === "groq" && !groqKey) {
      appendLog("ERROR: No Groq API key specified.", "error");
      return "";
    }
    if (apiToUse === "openai" && !openaiKey) {
      appendLog("ERROR: No OpenAI API key specified.", "error");
      return "";
    }

    const ffmpeg = ffmpegRef.current;
    const segData = (await ffmpeg.readFile(filename)) as Uint8Array;
    const blob = new Blob([segData.buffer], { type: "audio/mp3" });
    const audioFile = new File([blob], filename, { type: "audio/mp3" });

    if (apiToUse === "groq") {
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
  // Generic Copy and Download Functions
  // -----------------------------------------------------------------
  const copyTextToClipboard = (text: string, successMessage: string = "Copied to clipboard!") => {
    if (!text) return;
    
    // Trim whitespace from beginning and end of text
    const trimmedText = text.trim();
    
    navigator.clipboard.writeText(trimmedText).then(
      () => {
        appendLog(successMessage, "info");
        toast.success("Copied to clipboard!", {
          autoClose: 3000,
          style: { backgroundColor: "#fff", color: "#000" }
        });
      },
      (err) => {
        appendLog(`Error copying text: ${err}`, "error");
      }
    );
  };

  const downloadTextAsFile = (text: string, fileName: string, successMessage: string = "Downloaded successfully!") => {
    if (!text) return;
    
    // Trim whitespace from beginning and end of text
    const trimmedText = text.trim();
    
    const blob = new Blob([trimmedText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    appendLog(successMessage, "info");
    toast.success("Download initiated!", { 
      autoClose: 3000, 
      style: { backgroundColor: "#fff", color: "#000" } 
    });
  };

  // -----------------------------------------------------------------
  // Copy, Download, Clear Transcription - Refactored to use generic functions
  // -----------------------------------------------------------------
  const handleCopyTranscription = (textToCopy?: string | React.MouseEvent) => {
    // If it's a MouseEvent, ignore it and use transcriptionResult
    const text = typeof textToCopy === 'string' ? textToCopy : transcriptionResult;
    copyTextToClipboard(text, "Transcription copied to clipboard.");
  };

  const handleDownloadTranscription = () => {
    if (!transcriptionResult) return;
    
    // Determine the base name from the input file (if available)
    let baseName = "transcription";
    if (inputFile) {
      const nameParts = inputFile.name.split(".");
      if (nameParts.length > 1) {
        // Remove the extension
        baseName = nameParts.slice(0, -1).join(".");
      } else {
        baseName = inputFile.name;
      }
    }
    
    downloadTextAsFile(transcriptionResult, `${baseName}-transcript.txt`, "Transcription downloaded as TXT.");
  };

  // Updated handler for copying LLM Output
  const handleCopyLLMOutput = () => {
    // Get filtered content (excludes collapsed thinking sections)
    const filteredContent = llmOutputRef.current?.getFilteredContent() || chatCompletionResult;
    copyTextToClipboard(filteredContent, "LLM Output copied to clipboard.");
  };

  // Updated handler for downloading LLM Output
  const handleDownloadLLMOutput = () => {
    if (!chatCompletionResult) return;
    
    // Get filtered content (excludes collapsed thinking sections)
    const filteredContent = llmOutputRef.current?.getFilteredContent() || chatCompletionResult;
    
    // Determine the base name from the original input file (if available)
    let baseName = "llm-output";
    if (inputFile) {
      const nameParts = inputFile.name.split(".");
      if (nameParts.length > 1) {
        baseName = nameParts.slice(0, -1).join(".");
      } else {
        baseName = inputFile.name;
      }
    }
    
    downloadTextAsFile(filteredContent, `${baseName}-llm output.txt`, "LLM Output downloaded as TXT.");
  };

  // -----------------------------------------------------------------
  // LLM: Summarize (Step 4)
  // -----------------------------------------------------------------
  const handleSendToLLM = async () => {
    if (!transcriptionResult) {
      appendLog("No transcription found to send to the model.", "error");
      return;
    }

    // Add current prompt to gallery if it's not empty.
    // Since addCustomPrompt prepends the new item,
    // the newest prompt will appear on top in the merged list.
    if (systemPrompt.trim()) {
      addCustomPrompt(systemPrompt);
    }

    setPipelineStep(4);
    setIsGeneratingChat(true);
    setChatCompletionResult("");
    updateStepStatus("summarize", "loading");

    if (selectedApi === "openai") {
      if (!openaiKey) {
        appendLog("ERROR: OpenAI key not set. Please provide a valid key.", "error");
        updateStepStatus("summarize", "error");
        setIsGeneratingChat(false);
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
        updateStepStatus("summarize", "success");
      } catch (err: any) {
        appendLog("Error calling OpenAI Chat: " + (err.message || String(err)), "error");
        updateStepStatus("summarize", "error");
      } finally {
        setIsGeneratingChat(false);
      }
    } else {
      // GROQ
      if (!groqKey) {
        appendLog("ERROR: Groq key not set. Please provide a valid key.", "error");
        updateStepStatus("summarize", "error");
        setIsGeneratingChat(false);
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
        setStepStatus(prev => ({ ...prev, summarize: "success" }));
      } catch (err: any) {
        appendLog("Error calling Groq Chat: " + (err.message || String(err)), "error");
        setStepStatus(prev => ({ ...prev, summarize: "error" }));
      } finally {
        setIsGeneratingChat(false);
      }
    }
  };

  // -----------------------------------------------------------------
  // Step icons helper for the Steps component
  // -----------------------------------------------------------------
  const getStepIcon = (stepIndex: number) => {
    const stepName = Object.keys(stepIndexMap).find(
      (key) => stepIndexMap[key as StepName] === stepIndex
    ) as StepName;
    
    // First check if this step has an error
    if (stepStatus[stepName] === "error") {
      return <CloseCircleOutlined style={{ color: "#ff4d4f" }} />;
    }
    
    // Then check if it's the current step
    if (pipelineStep === stepIndex) {
      if (stepStatus[stepName] === "loading") {
        return <LoadingOutlined />;
      }
    }
    
    // If the step is completed successfully
    if (stepStatus[stepName] === "success" || stepIndex < pipelineStep) {
      return <CheckCircleOutlined style={{ color: "#52c41a" }} />;
    }
    
    return null;
  };

  // -----------------------------------------------------------------
  // Function to retry a specific step
  // -----------------------------------------------------------------
  const retryStep = async (step: StepName) => {
    // Reset the status for the current step and all subsequent steps
    const newStatus = { ...stepStatus };
    const keys = Object.keys(stepIndexMap) as StepName[];
    
    // Find all steps after the current one
    keys.forEach((key) => {
      if (stepIndexMap[key] >= stepIndexMap[step]) {
        newStatus[key] = "idle";
      }
    });
    
    setStepStatus(newStatus);
    
    // Set the pipeline step to the retry step
    setPipelineStep(stepIndexMap[step]);
    
    // Start the process from the specified step
    switch (step) {
      case "setup":
        // For setup (FFmpeg loading), we need to reload FFmpeg
        await loadFFmpeg();
        break;
      case "convert":
        // Start from conversion
        await runConversionStep();
        break;
      case "split":
        // Start from splitting (requires conversion to be done)
        if (intermediateData.convertedMp3) {
          await runSplittingStep(intermediateData.convertedMp3);
        } else {
          appendLog("Cannot resume splitting: no converted MP3 data available.", "error");
          updateStepStatus("split", "error");
        }
        break;
      case "transcribe":
        // Start from transcription (requires segments to be available)
        if (intermediateData.segments && intermediateData.segments.length > 0) {
          await runTranscriptionStep(intermediateData.segments);
        } else {
          appendLog("Cannot resume transcription: no segments available.", "error");
          updateStepStatus("transcribe", "error");
        }
        break;
      case "summarize":
        // Re-run LLM processing if transcription result is available
        if (transcriptionResult) {
          handleSendToLLM();
        } else {
          appendLog("Cannot start summarization: no transcription available.", "error");
          updateStepStatus("summarize", "error");
        }
        break;
    }
  };

  // -----------------------------------------------------------------
  // Ant Design Upload (Dragger) configuration
  // -----------------------------------------------------------------
  // In your Upload.Dragger configuration:
  const uploadProps: UploadProps = {
    name: "file",
    multiple: false,
    accept: "audio/*,video/*",
    beforeUpload: (file: File) => {
      setIsFromRecording(false); // Reset the flag for uploads
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
      setIsFromRecording(false); // Reset the flag when removing file
      return true;
    },
  };

  // Add cleanup effect at component level
  useEffect(() => {
    return () => {
      // Cleanup URLs when component unmounts
      segmentUrls.forEach(url => {
        URL.revokeObjectURL(url);
      });
    };
  }, [segmentUrls]);

  // -----------------------------------------------------------------
  // Load FFmpeg on component mount
  // -----------------------------------------------------------------
  useEffect(() => {
    loadFFmpeg();
  }, []);

  // -----------------------------------------------------------------
  // Base Cleanup Function - Reused by other cleanup functions
  // -----------------------------------------------------------------
  const performBaseCleanup = async (
    ffmpeg: FFmpeg,
    options: {
      unmountFS?: boolean;
      removeFiles?: boolean;
      terminateFFmpeg?: boolean;
      createNewInstance?: boolean;
      logPrefix?: string;
    } = {}
  ): Promise<{ success: boolean; newFFmpeg?: FFmpeg }> => {
    const {
      unmountFS = true,
      removeFiles = true,
      terminateFFmpeg = true,
      createNewInstance = true,
      logPrefix = "Cleanup"
    } = options;
    
    let success = true;
    const mountDir = "/mounted";
    
    // Step 1: Unmount the file system
    if (unmountFS) {
      try {
        appendLog(`${logPrefix}: Unmounting file system...`, "info");
        try {
          await ffmpeg.unmount(mountDir);
          appendLog(`✓ Unmounted WORKERFS at /mounted.`, "info");
        } catch (unmountErr) {
          // Ignore error if nothing is mounted
          appendLog("No file system was mounted or already unmounted.", "info");
        }
      } catch (err) {
        appendLog(`Error unmounting file system: ${err}`, "error");
        success = false;
      }
    }

    // Step 2: Delete temporary files
    if (removeFiles) {
      try {
        appendLog(`${logPrefix}: Removing temporary files...`, "info");
        try {
          ffmpeg.deleteFile("output.mp3");
          appendLog("✓ Temporary files removed.", "info");
        } catch (unlinkErr) {
          // Ignore error if file doesn't exist
          appendLog("No temporary files to remove.", "info");
        }
      } catch (err) {
        appendLog(`Error removing temporary files: ${err}`, "error");
        success = false;
      }
    }

    // Step 3: Terminate FFmpeg instance
    if (terminateFFmpeg) {
      try {
        appendLog(`${logPrefix}: Terminating FFmpeg instance...`, "info");
        ffmpeg.terminate();
        appendLog("✓ FFmpeg instance terminated.", "info");
      } catch (termErr) {
        appendLog(`Error terminating FFmpeg: ${termErr}`, "error");
        success = false;
      }
    }

    // Step 4: Create a fresh FFmpeg instance
    let newFFmpeg: FFmpeg | undefined;
    if (createNewInstance) {
      try {
        appendLog(`${logPrefix}: Creating fresh FFmpeg instance...`, "info");
        newFFmpeg = await createNewFFmpeg();
        appendLog("✓ New FFmpeg instance is ready for use.", "info");
      } catch (newInstErr) {
        appendLog(`Error creating new FFmpeg instance: ${newInstErr}`, "error");
        success = false;
      }
    }
    
    return { success, newFFmpeg };
  };

  // -----------------------------------------------------------------
  // Automatic Cleanup Function - For successful transcription
  // -----------------------------------------------------------------
  const performAutoCleanup = async (): Promise<boolean> => {
    appendLog("Starting automatic cleanup after successful transcription...", "info");
    
    try {
      const ffmpeg = ffmpegRef.current;
      
      // Perform base cleanup with all options enabled
      const { success: cleanupSuccess, newFFmpeg } = await performBaseCleanup(ffmpeg, {
        logPrefix: "Auto-cleanup"
      });
      
      if (newFFmpeg) {
        ffmpegRef.current = newFFmpeg;
        setLoaded(true);
      }
      
      // Additional step: Reset progress display
      let finalSuccess = cleanupSuccess;
      try {
        appendLog("Auto-cleanup step 5/5: Resetting progress display...", "info");
        
        // Keep pipeline step at 4 (Summarize) since transcription was successful
        // But reset step statuses for new transcription
        setStepStatus({
          setup: "success", // FFmpeg is loaded
          convert: "idle",
          split: "idle",
          transcribe: "idle",
          summarize: "idle"
        });
        
        appendLog("✓ Progress display reset successfully.", "info");
      } catch (resetErr) {
        appendLog("✗ Error resetting progress display: " + resetErr, "error");
        finalSuccess = false;
      }
      
      if (finalSuccess) {
        appendLog("Automatic cleanup process completed successfully! ✓", "info");
      } else {
        appendLog("Automatic cleanup process completed with some errors. Check log for details.", "error");
      }
      
      return finalSuccess;
    } catch (err) {
      appendLog("Unexpected error during automatic cleanup: " + err, "error");
      return false;
    }
  };

  // -----------------------------------------------------------------
  // Manual Cleanup Function - With full application reset
  // -----------------------------------------------------------------
  const performCleanup = async () => {
    appendLog("Starting manual cleanup process...", "info");
    
    try {
      const ffmpeg = ffmpegRef.current;
      
      // Perform base cleanup with all options enabled
      const { success: cleanupSuccess, newFFmpeg } = await performBaseCleanup(ffmpeg, {
        logPrefix: "Cleanup"
      });
      
      if (newFFmpeg) {
        ffmpegRef.current = newFFmpeg;
        setLoaded(true);
      }
      
      // Additional step: Reset application state
      let finalSuccess = cleanupSuccess;
      try {
        appendLog("Cleanup step 5/5: Resetting application state...", "info");
        
        // Reset all state variables
        setTranscriptionResult("");
        setTranscribing(false);
        setPipelineStep(1); // Set to step 1 (after FFmpeg load)
        setIntermediateData({}); // Clear intermediate data
        setChatCompletionResult(""); // Clear LLM results
        setIsGeneratingChat(false);
        
        // Reset step statuses
        setStepStatus({
          setup: "success", // FFmpeg is loaded
          convert: "idle",
          split: "idle",
          transcribe: "idle",
          summarize: "idle"
        });
        
        // Clear segment URLs
        segmentUrls.forEach(url => {
          URL.revokeObjectURL(url);
        });
        setSegmentUrls([]);
        
        // Keep the input file instead of clearing it
        // setInputFile(null);
        setIsFromRecording(false);
        
        appendLog("✓ Application state reset successfully.", "info");
      } catch (resetErr) {
        appendLog("✗ Error resetting application state: " + resetErr, "error");
        finalSuccess = false;
      }
      
      if (finalSuccess) {
        appendLog("Manual cleanup process completed successfully! Application reset. ✓", "info");
        toast.success("Cleanup completed and application reset");
      } else {
        appendLog("Manual cleanup process completed with some errors. Check log for details.", "error");
        toast.warning("Cleanup completed with some issues");
      }
      
      return finalSuccess;
    } catch (err) {
      appendLog("Unexpected error during manual cleanup: " + err, "error");
      toast.error("Cleanup failed");
      return false;
    }
  };

  // -----------------------------------------------------------------
  // Light Cleanup Function - For cleaning before starting new transcription
  // -----------------------------------------------------------------
  const performLightCleanup = async (): Promise<boolean> => {
    appendLog("Starting light cleanup of previous transcription resources...", "info");
    
    try {
      const ffmpeg = ffmpegRef.current;
      
      // Perform base cleanup with all options enabled
      const { success: cleanupSuccess, newFFmpeg } = await performBaseCleanup(ffmpeg, {
        logPrefix: "Light cleanup"
      });
      
      if (newFFmpeg) {
        ffmpegRef.current = newFFmpeg;
        setLoaded(true);
      }
      
      // Additional step: Reset progress display
      let finalSuccess = cleanupSuccess;
      try {
        appendLog("Light cleanup: Resetting progress display...", "info");
        // Reset pipeline step to setup completed (ready for conversion)
        setPipelineStep(1);
        
        // Reset step statuses
        setStepStatus({
          setup: "success", // FFmpeg is loaded
          convert: "idle",
          split: "idle",
          transcribe: "idle",
          summarize: "idle"
        });
        
        appendLog("✓ Progress display reset successfully.", "info");
      } catch (resetErr) {
        appendLog("Error resetting progress display: " + resetErr, "error");
        finalSuccess = false;
      }
      
      if (finalSuccess) {
        appendLog("Light cleanup completed successfully!", "info");
      } else {
        appendLog("Light cleanup completed with some issues, but we'll continue.", "error");
      }
      
      return finalSuccess;
    } catch (err) {
      appendLog("Unexpected error during light cleanup: " + err, "error");
      return false;
    }
  };

  // -----------------------------------------------------------------
  // Helper function to check if any step is in loading state
  // -----------------------------------------------------------------
  const isAnyStepLoading = (): boolean => {
    return Object.values(stepStatus).some(status => status === "loading");
  };

  // -----------------------------------------------------------------
  // UTILITY: Update step status and pipeline step
  // -----------------------------------------------------------------
  const updateStepStatus = (step: StepName, status: StepStatus, moveToNextStep: boolean = false) => {
    setStepStatus(prev => ({ ...prev, [step]: status }));
    
    // If success and moveToNextStep is true, move to the next pipeline step
    if (status === "success" && moveToNextStep) {
      const currentStepIndex = stepIndexMap[step];
      // Find the next step name by index
      const nextStepIndex = currentStepIndex + 1;
      const maxStepIndex = Math.max(...Object.values(stepIndexMap));
      
      // Only proceed if we're not already at the last step
      if (nextStepIndex <= maxStepIndex) {
        setPipelineStep(nextStepIndex);
      }
    }
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
          colorLink: '#6bc42b',
        },
      }}
    >
      <div className="app-container">
        {/* Page Title */}
        <h2 className="header-title">AI Audio/Video Transcription & Summaries</h2>
        <p style={{ margin: "1rem 0", fontSize: "1rem", color: "#ccc" }}>
          Easily convert audio or video files to text, then use an LLM to summarize or otherwise transform the resulting transcript.
          Everything runs locally and uses your own API key.
        </p>

        {/* API Provider & Basic Config */}
        <div className="control-panel">
          <div className="control-row">
            <label>API Provider:</label>
            <select
              className="input-standard"
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
                  className="input-standard blur"
                  type="text"
                  value={groqKey}
                  onChange={handleGroqKeyChange}
                  placeholder="Enter Groq API key"
                />
              </div>
            ) : (
              <p className="api-key-message">
                Groq API Key is set. Update in Advanced Options if needed.
              </p>
            )
          ) : !openaiKey ? (
            <div className="control-row">
              <label>OpenAI API Key:</label>
              <input
                className="input-standard blur"
                type="text"
                value={openaiKey}
                onChange={handleOpenaiKeyChange}
                placeholder="Enter OpenAI API key"
              />
            </div>
          ) : (
            <p className="api-key-message">
              OpenAI API Key is set. Update in Advanced Options if needed.
            </p>
          )}

          <button
            className="btn-standard"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            {showAdvanced ? "Hide Advanced Options" : "Show Advanced Options"}
          </button>
        </div>

        {/* Advanced Panel */}
        {showAdvanced && (
          <div className="advanced-panel">
            {/* Automation Settings First */}
            <div className="settings-group">
              <div className="settings-separator">
                <span>Automation Settings</span>
              </div>
              
              <div className="control-row">
                <label>Transcribe Immediately After Recording:</label>
                <Switch
                  checked={autoTranscribe}
                  onChange={(checked: boolean) => {
                    setAutoTranscribe(checked);
                    localStorage.setItem("autoTranscribe", checked.toString());
                    appendLog(`Auto-transcribe ${checked ? 'enabled' : 'disabled'}.`, "info");
                  }}
                />
              </div>
              <div className="control-row">
                <label>Copy Transcription to Clipboard Automatically:</label>
                <Switch
                  checked={autoCopyToClipboard}
                  onChange={(checked: boolean) => {
                    setAutoCopyToClipboard(checked);
                    localStorage.setItem("autoCopyToClipboard", checked.toString());
                    appendLog(`Auto-copy to clipboard ${checked ? 'enabled' : 'disabled'}.`, "info");
                  }}
                />
              </div>
            </div>

            {/* API Settings Second */}
            <div className="settings-group">
              <div className="settings-separator">
                <span>API Settings</span>
              </div>
              
              {selectedApi === "groq" && groqKey && (
                <div className="control-row">
                  <label>Groq API Key (masked):</label>
                  <input
                    className="input-standard"
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
                    className="input-standard"
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
                    className="input-standard"
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
                    className="input-standard"
                    type="text"
                    value={openaiModel}
                    onChange={handleOpenaiModelChange}
                    placeholder="e.g. whisper-1"
                  />
                </div>
              )}
              <div className="control-row">
                <label>Sample Rate:</label>
                <select
                  className="input-standard"
                  value={sampleRate}
                  onChange={handleSampleRateChange}
                >
                  <option value="8000">8 kHz</option>
                  <option value="16000">16 kHz</option>
                  <option value="22050">22.05 kHz</option>
                  <option value="44100">44.1 kHz</option>
                  <option value="48000">48 kHz</option>
                </select>
              </div>
              <div className="control-row">
                <label>Max File Size (MB):</label>
                <input
                  className="input-standard"
                  type="number"
                  value={maxFileSizeMB}
                  onChange={handleMaxFileSizeChange}
                  min="1"
                />
              </div>
            </div>
          </div>
        )}

        {/* File Selection & Transcribe */}
        <div className="control-panel">
          {/* File Selection */}
          <div className="control-row">
            <Upload.Dragger
              {...uploadProps}
              fileList={
                inputFile
                  ? [
                    {
                      uid: "-1",
                      name: inputFile.name,
                      status: "done",
                      url: URL.createObjectURL(inputFile),
                    },
                  ]
                  : []
              }
              style={{ width: "100%" }}
            >
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

          {/* Voice Recorder Integration */}
          <div className="control-row" style={{flexDirection: "column" }}>
          <p style={{ marginBottom: "0.5rem" }}>Or Record Your Audio</p>

            <AudioRecorder
              onRecordingComplete={handleRecordingComplete}
              audioTrackConstraints={{
              }}
              downloadOnSavePress={false}
              showVisualizer={true}
              downloadFileExtension="mp3"
            />
          </div>

          <button
            className="btn-standard"
            onClick={transcribeFile}
            disabled={transcribing || pipelineStep < 1 || isAnyStepLoading()}
          >
            {transcribing || isAnyStepLoading() ? "Processing..." : "Transcribe File"}
          </button>
        </div>

        {/* Show Transcription */}
        {transcriptionResult && (
          <div className="transcript-section">
            <div className="transcript-header">
              <h3>Transcription</h3>
              <div>
                <button className="transcript-icon" onClick={() => handleCopyTranscription()}>
                  <FaCopy />
                </button>
                <button className="transcript-icon" onClick={handleDownloadTranscription}>
                  <FaFileDownload />
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
          <div className="llm-panel">
            <div className="llm-panel-header">
              <div className="llm-panel-title">
                <h3>LLM Post-Processing</h3>
              </div>
              <div className="llm-panel-controls">
                <div className="model-selector">
                  <label>Model:</label>
                  {selectedApi === "openai" ? (
                    <select
                      className="input-standard"
                      value={openAiChatModel}
                      onChange={handleOpenAiChatModelChange}
                    >
                      <option value="chatgpt-4o-latest">chatgpt-4o-latest</option>
                      <option value="gpt-4o-mini">gpt-4o-mini</option>
                      <option value="o3-mini">o3-mini</option>
                      <option value="o1">o1</option>
                    </select>
                  ) : (
                    <select
                      className="input-standard"
                      value={groqChatModel}
                      onChange={handleGroqChatModelChange}
                    >
                      <option value="llama-3.3-70b-versatile">llama-3.3-70b-versatile</option>
                      <option value="deepseek-r1-distill-llama-70b">deepseek-r1-distill-llama-70b</option>
                    </select>
                  )}
                </div>
              </div>
            </div>

            {/* NEW: Prompt Gallery Section */}
            <div className="prompt-gallery-section">
              <label className="section-label">Prompt Gallery</label>
              <div className="prompt-gallery">
                {prompts.map((prompt, idx) => (
                  <Tag
                    key={idx}
                    closable={prompt.custom}
                    onClose={prompt.custom ? () => removeCustomPrompt(idx) : undefined}
                    onClick={() => {
                      setSystemPrompt(prompt.text);
                      // Update usage timestamp for custom prompts only (does not trigger resorting).
                      updatePromptUsage(idx);
                      appendLog("Applied prompt to System Prompt.", "info");
                    }}
                    className="prompt-tag"
                  >
                    <span>{prompt.text}</span>
                  </Tag>
                ))}
              </div>
            </div>

            {/* Existing System Prompt input */}
            <div className="system-prompt-section">
              <label className="section-label">System Prompt</label>
              <textarea
                className="system-prompt-input"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="Enter system instructions for the LLM..."
              />
              <button
                className="btn-standard"
                onClick={handleSendToLLM}
                disabled={isGeneratingChat}
              >
                {isGeneratingChat ? (
                  <>
                    <LoadingOutlined /> Processing...
                  </>
                ) : (
                  `Process with ${selectedApi}`
                )}
              </button>
            </div>
          </div>
        )}

        {/* LLM Output */}
        {chatCompletionResult && (
          <div className="transcript-section" style={{ marginTop: "1rem" }}>
            <div className="transcript-header">
              <h3>LLM Output</h3>
              <div>
                <button 
                  className="transcript-icon" 
                  onClick={handleCopyLLMOutput}
                  title="Copy LLM output (collapsed thinking sections will be excluded)"
                >
                  <FaCopy />
                </button>
                <button 
                  className="transcript-icon" 
                  onClick={handleDownloadLLMOutput}
                  title="Download LLM output (collapsed thinking sections will be excluded)"
                >
                  <FaFileDownload />
                </button>
              </div>
            </div>
            <div className="transcript-output">
              <CollapsibleLLMOutput ref={llmOutputRef} content={chatCompletionResult} />
            </div>
          </div>
        )}

        {/* Steps */}
        <div style={{ marginTop: "2rem", marginBottom: "1rem", textAlign: "left" }}>
          <Steps current={pipelineStep} labelPlacement="vertical">
            <Steps.Step 
              title="Setup" 
              status={stepStatus.setup === "error" ? "error" : undefined} 
              icon={stepStatus.setup === "error" 
                ? <CloseCircleOutlined style={{ color: "#ff4d4f" }} /> 
                : getStepIcon(0)
              } 
              description={stepStatus.setup === "error" && (
                <Button 
                  type="primary" 
                  danger 
                  size="small" 
                  icon={<ReloadOutlined />} 
                  onClick={() => retryStep("setup")}
                >
                  Retry
                </Button>
              )}
            />
            <Steps.Step 
              title="Convert" 
              status={stepStatus.convert === "error" ? "error" : undefined} 
              icon={stepStatus.convert === "error" 
                ? <CloseCircleOutlined style={{ color: "#ff4d4f" }} /> 
                : getStepIcon(1)
              } 
              description={stepStatus.convert === "error" && (
                <Button 
                  type="primary" 
                  danger 
                  size="small" 
                  icon={<ReloadOutlined />} 
                  onClick={() => retryStep("convert")}
                >
                  Retry
                </Button>
              )}
            />
            <Steps.Step 
              title="Split" 
              status={stepStatus.split === "error" ? "error" : undefined} 
              icon={stepStatus.split === "error" 
                ? <CloseCircleOutlined style={{ color: "#ff4d4f" }} /> 
                : getStepIcon(2)
              } 
              description={stepStatus.split === "error" && (
                <Button 
                  type="primary" 
                  danger 
                  size="small" 
                  icon={<ReloadOutlined />} 
                  onClick={() => retryStep("split")}
                >
                  Retry
                </Button>
              )}
            />
            <Steps.Step 
              title="Transcribe" 
              status={stepStatus.transcribe === "error" ? "error" : undefined} 
              icon={stepStatus.transcribe === "error" 
                ? <CloseCircleOutlined style={{ color: "#ff4d4f" }} /> 
                : getStepIcon(3)
              } 
              description={stepStatus.transcribe === "error" && (
                <Button 
                  type="primary" 
                  danger 
                  size="small" 
                  icon={<ReloadOutlined />} 
                  onClick={() => retryStep("transcribe")}
                >
                  Retry
                </Button>
              )}
            />
            <Steps.Step 
              title="Summarize" 
              status={stepStatus.summarize === "error" ? "error" : undefined} 
              icon={stepStatus.summarize === "error" 
                ? <CloseCircleOutlined style={{ color: "#ff4d4f" }} /> 
                : getStepIcon(4)
              } 
              description={stepStatus.summarize === "error" && (
                <Button 
                  type="primary" 
                  danger 
                  size="small" 
                  icon={<ReloadOutlined />} 
                  onClick={() => retryStep("summarize")}
                >
                  Retry
                </Button>
              )}
            />
          </Steps>
        </div>

        {/* Log Console Toggle */}
        <div style={{ textAlign: "right", marginBottom: "1rem" }}>
          {stepStatus.transcribe === "error" && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", marginBottom: "1rem" }}>
              <p style={{ color: "#ff4d4f", marginBottom: "0.5rem", fontSize: "0.9rem" }}>
                Transcription failed
              </p>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                <button
                  className="btn-standard"
                  onClick={performCleanup}
                  style={{ backgroundColor: "#ff4d4f" }}
                  title="Cleans FFmpeg resources and resets the application"
                >
                  Reset Application
                </button>
              </div>
            </div>
          )}
          <button
            className="btn-standard"
            onClick={() => setShowLogConsole((prev) => !prev)}
          >
            {showLogConsole ? "Hide Log Console" : "Show Log Console"}
          </button>
        </div>

        {/* Log Console */}
        {showLogConsole && (
          <div className="log-section">
            <h3>Log Console</h3>
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
                  <div 
                    key={idx} 
                    className={className}
                    {...(logMsg.html 
                      ? { dangerouslySetInnerHTML: { __html: logMsg.text } }
                      : { children: logMsg.text }
                    )}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>
      <ToastContainer autoClose={10000} />
       {/* Modern, Slick Footer */}
       <footer>
       <a
            href="https://github.com/Lukhausen/ai-video-audio-transcriber/" // Replace with your actual repo link
            target="_blank"
            rel="noopener noreferrer"
          >
            <GithubOutlined /> view on GitHub
          </a>
          <a
            href="https://lukhausen.de"
            target="_blank"
            rel="noopener noreferrer"
          >
            by Lukas Marschhausen
          </a>

      </footer>
    </ConfigProvider>
  );
};

export default App;
