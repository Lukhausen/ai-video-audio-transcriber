import { useState, useRef, useEffect } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL, fetchFile } from "@ffmpeg/util";
import Groq from "groq-sdk";
import OpenAI from "openai";

interface SegmentInfo {
  filename: string;
  size: number;
}

interface LogMessage {
  text: string;
  type: "info" | "error";
}

function App() {
  const [loaded, setLoaded] = useState(false);
  const [inputFile, setInputFile] = useState<File | null>(null);
  const [transcriptionResult, setTranscriptionResult] = useState("");
  const [transcribing, setTranscribing] = useState(false);

  // Either "groq" or "openai"
  const [selectedApi, setSelectedApi] = useState<"groq" | "openai">("groq");

  // Keys and models for audio transcription
  const [groqKey, setGroqKey] = useState<string>(
    localStorage.getItem("groqKey") || ""
  );
  const [openaiKey, setOpenaiKey] = useState<string>(
    localStorage.getItem("openaiKey") || ""
  );
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

  // --------------------------------------------------
  // NEW: Fields for Chat LLM (both Groq and OpenAI)
  // --------------------------------------------------
  const [systemPrompt, setSystemPrompt] = useState<string>("");
  const [chatCompletionResult, setChatCompletionResult] = useState<string>("");
  const [isGeneratingChat, setIsGeneratingChat] = useState<boolean>(false);

  // Dropdown model for OpenAI Chat
  const [openAiChatModel, setOpenAiChatModel] = useState<string>(
    localStorage.getItem("openAiChatModel") || "chatgpt-4o-latest"
  );

  // Dropdown model for Groq Chat
  const [groqChatModel, setGroqChatModel] = useState<string>(
    localStorage.getItem("groqChatModel") || "llama-3.3-70b-versatile"
  );

  // ---------------------------
  //  Load FFmpeg on mount
  // ---------------------------
  useEffect(() => {
    const loadFFmpeg = async () => {
      appendLog("Loading ffmpeg-core automatically...", "info");
      const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm";
      const ffmpeg = ffmpegRef.current;
      ffmpeg.on("log", ({ message }) => {
        if (messageRef.current) messageRef.current.innerHTML = message;
        appendLog(`FFmpeg: ${message}`, "info");
      });
      try {
        await ffmpeg.load({
          wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
        });
        setLoaded(true);
        appendLog("ffmpeg-core loaded successfully.", "info");
      } catch (err) {
        appendLog("Error loading ffmpeg-core: " + err, "error");
      }
    };
    loadFFmpeg();
  }, []);

  // Auto-scroll the log
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logMessages]);

  // Helper: Append log
  const appendLog = (msg: string, type: "info" | "error" = "info") => {
    const timeStamp = new Date().toLocaleTimeString();
    setLogMessages((prev) => [...prev, { text: `[${timeStamp}] ${msg}`, type }]);
  };

  // Handlers for API key, model, etc.
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      setInputFile(e.target.files[0]);
      appendLog(`Selected file: ${e.target.files[0].name}`, "info");
    }
  };

  const handleApiProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const provider = e.target.value as "groq" | "openai";
    setSelectedApi(provider);
    appendLog(`Switched API provider to ${provider}`, "info");
  };

  // Dropdown for LLM Chat - OpenAI
  const handleOpenAiChatModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const chosenModel = e.target.value;
    setOpenAiChatModel(chosenModel);
    localStorage.setItem("openAiChatModel", chosenModel);
    appendLog(`Set OpenAI Chat Model to "${chosenModel}".`, "info");
  };

  // Dropdown for LLM Chat - Groq
  const handleGroqChatModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const chosenModel = e.target.value;
    setGroqChatModel(chosenModel);
    localStorage.setItem("groqChatModel", chosenModel);
    appendLog(`Set Groq Chat Model to "${chosenModel}".`, "info");
  };

  // -------------------------
  // Convert + Split + Transcribe
  // -------------------------
  const convertToMp3 = async () => {
    if (!inputFile) {
      alert("No file selected!");
      return;
    }
    if (!loaded) {
      alert("FFmpeg not yet loaded. Please wait...");
      return;
    }
    setTranscribing(true);
    setTranscriptionResult("");
    appendLog("Starting conversion to MP3...", "info");

    const ffmpeg = ffmpegRef.current;
    const inputFileName = inputFile.name;
    const outputFileName = "output.mp3";

    appendLog(`Writing ${inputFileName} to virtual FS...`, "info");
    await ffmpeg.writeFile(inputFileName, await fetchFile(inputFile));

    let ffmpegCmd: string[];
    if (inputFile.type.startsWith("video/")) {
      ffmpegCmd = ["-i", inputFileName, "-q:a", "0", "-map", "a", outputFileName];
      appendLog("Detected video file – extracting audio track.", "info");
    } else {
      ffmpegCmd = ["-i", inputFileName, outputFileName];
      appendLog("Detected audio file – converting to MP3.", "info");
    }

    try {
      await ffmpeg.exec(ffmpegCmd);
      appendLog("Conversion complete. Reading output.mp3...", "info");
    } catch (err) {
      appendLog("Error during conversion: " + err, "error");
      setTranscribing(false);
      return;
    }

    const mp3Data = (await ffmpeg.readFile(outputFileName)) as Uint8Array;
    const mp3Size = mp3Data.byteLength;
    appendLog(`output.mp3 size: ${mp3Size} bytes.`, "info");

    const MAX_BYTES = maxFileSizeMB * 1024 * 1024;
    let finalSegments: SegmentInfo[] = [];

    if (mp3Size > MAX_BYTES) {
      appendLog("Resulting file is greater than maximum allowed size.", "info");
      appendLog("Splitting file by size...", "info");
      finalSegments = await recursiveSplitBySize(outputFileName);
    } else {
      appendLog("No splitting needed.", "info");
      finalSegments.push({ filename: outputFileName, size: mp3Size });
    }

    appendLog("Starting transcription of segments...", "info");

    // Process in batches of up to 10 concurrently
    const transcripts: string[] = [];
    const concurrencyLimit = 10;
    for (let i = 0; i < finalSegments.length; i += concurrencyLimit) {
      const batch = finalSegments.slice(i, i + concurrencyLimit);
      appendLog(
        `Processing batch ${Math.floor(i / concurrencyLimit) + 1} of ${Math.ceil(
          finalSegments.length / concurrencyLimit
        )}...`,
        "info"
      );
      try {
        const batchResults = await Promise.all(
          batch.map((seg) => transcribeSegment(seg.filename))
        );
        transcripts.push(...batchResults);
      } catch (err: any) {
        appendLog(
          `Error during batch transcription: ${err.message || err}`,
          "error"
        );
      }
      // If there are more segments, wait 60s before the next batch
      if (i + concurrencyLimit < finalSegments.length) {
        appendLog("Waiting 60 seconds before next batch...", "info");
        await new Promise((resolve) => setTimeout(resolve, 60000));
      }
    }

    const masterTranscript = improvedStitchTranscriptions(transcripts, appendLog);
    setTranscriptionResult(masterTranscript);
    appendLog("All segments transcribed and stitched.", "info");

    setTranscribing(false);
  };

  // Recursive Split
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
    appendLog(
      `Duration for "${filename}": ${totalDuration.toFixed(2)} s.`,
      "info"
    );

    const halfTime = totalDuration / 2;
    const leftEnd = Math.min(halfTime + 3, totalDuration);
    const rightStart = Math.max(halfTime - 3, 0);
    const leftFilename = `${filename}_left_${halfTime.toFixed(2)}.mp3`;
    const rightFilename = `${filename}_right_${halfTime.toFixed(2)}.mp3`;

    appendLog(
      `Splitting "${filename}" at ${halfTime.toFixed(2)} s. ` +
        `Left: 0–${leftEnd.toFixed(2)}, Right: ${rightStart.toFixed(2)}–${totalDuration.toFixed(2)}`,
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

  // Transcribe Segment
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
      // GROQ-based transcription
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
      // OpenAI-based transcription
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

  // Stitch Transcriptions
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
          dp[i][j] =
            1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
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
      const score = similarityScore(
        prevOverlap.toLowerCase(),
        currOverlap.toLowerCase()
      );
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
          `Overlap detected (score ${score.toFixed(
            2
          )} >= ${threshold}). Removing ${overlapCount} overlapping words from segment ${
            i + 1
          }.`,
          "info"
        );
      }
      stitched = stitched + " " + currAdjusted;
    }
    return stitched.trim();
  };

  // --------------------------------
  // Copy Transcription
  // --------------------------------
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

  // --------------------------------------
  // Unified function: Send to LLM (Groq or OpenAI)
  // --------------------------------------
  const handleSendToLLM = async () => {
    if (!transcriptionResult) {
      appendLog("No transcription found to send to the model.", "error");
      return;
    }

    if (selectedApi === "openai") {
      // OpenAI chat
      if (!openaiKey) {
        appendLog("ERROR: OpenAI key not set. Please provide a valid key.", "error");
        return;
      }
      setIsGeneratingChat(true);
      setChatCompletionResult("");
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
          max_tokens: 1500,
        });
        const output = response.choices?.[0]?.message?.content || "";
        setChatCompletionResult(output);
        appendLog("Received response from OpenAI Chat.", "info");
      } catch (err: any) {
        appendLog("Error calling OpenAI Chat: " + (err.message || String(err)), "error");
      } finally {
        setIsGeneratingChat(false);
      }
    } else {
      // Groq chat
      if (!groqKey) {
        appendLog("ERROR: Groq key not set. Please provide a valid key.", "error");
        return;
      }
      setIsGeneratingChat(true);
      setChatCompletionResult("");
      appendLog("Sending System Prompt + Transcript to Groq Chat...", "info");

      try {
        const groqClient = new Groq({
          apiKey: groqKey,
          dangerouslyAllowBrowser: true,
        });

        // We'll request the entire response in one chunk (stream = false)
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

        // If not streaming, we get the entire completion in `response.choices`
        const output = response.choices?.[0]?.message?.content || "";
        setChatCompletionResult(output);
        appendLog("Received response from Groq Chat.", "info");
      } catch (err: any) {
        appendLog("Error calling Groq Chat: " + (err.message || String(err)), "error");
      } finally {
        setIsGeneratingChat(false);
      }
    }
  };

  // --------------------------------
  // RENDER
  // --------------------------------
  return (
    <div className="app-container">
      <h2 className="header-title">Speech-to-Text: Recursive Split &amp; Stitch</h2>

      {/* Control Panel for Transcription Settings */}
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
          <>
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
          </>
        ) : (
          <>
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
          </>
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
        <div className="control-row">
          <label>Select a File:</label>
          <input
            className="file-input"
            type="file"
            accept="audio/*,video/*"
            onChange={handleFileChange}
          />
        </div>
        <button
          className="btn-action"
          onClick={convertToMp3}
          disabled={transcribing}
        >
          {transcribing ? "Processing..." : "Convert, Split & Transcribe"}
        </button>
      </div>

      {/* Show Transcription Result if available */}
      {transcriptionResult && (
        <div className="transcript-section">
          <div className="transcript-header">
            <h3>Full Transcription</h3>
            <button className="btn-copy" onClick={handleCopyTranscription}>
              Copy
            </button>
          </div>
          <textarea
            className="transcript-output transcript-editable"
            value={transcriptionResult}
            onChange={(e) => setTranscriptionResult(e.target.value)}
          />
        </div>
      )}

      {/* 
        Show LLM Post-Processing Panel 
        Only if we have a transcription
      */}
      {transcriptionResult && (
        <div className="control-panel" style={{ marginTop: "1rem" }}>
          <h3 style={{ textAlign: "left", marginBottom: "0.5rem" }}>
            LLM Post-Processing
          </h3>

          {selectedApi === "openai" ? (
            <>
              {/* OpenAI Chat model dropdown */}
              <div className="control-row" style={{ alignItems: "flex-start" }}>
                <label>LLM Model (Chat):</label>
                <select
                  className="control-input"
                  value={openAiChatModel}
                  onChange={handleOpenAiChatModelChange}
                >
                  <option value="chatgpt-4o-latest">chatgpt-4o-latest</option>
                  <option value="gpt-4o-mini">gpt-4o-mini</option>
                  <option value="o3-mini">o3-mini</option>
                  <option value="o1">o1</option>
                </select>
              </div>
            </>
          ) : (
            <>
              {/* Groq Chat model dropdown */}
              <div className="control-row" style={{ alignItems: "flex-start" }}>
                <label>LLM Model (Chat):</label>
                <select
                  className="control-input"
                  value={groqChatModel}
                  onChange={handleGroqChatModelChange}
                >
                  <option value="llama-3.3-70b-versatile">
                    llama-3.3-70b-versatile
                  </option>
                  <option value="deepseek-r1-distill-llama-70b">
                    deepseek-r1-distill-llama-70b
                  </option>
                </select>
              </div>
            </>
          )}

          {/* System Prompt */}
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

      {/* Unified Log */}
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
    </div>
  );
}

export default App;
