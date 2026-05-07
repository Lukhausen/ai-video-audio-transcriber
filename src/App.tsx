// App.tsx — Multi-file transcription with parallel processing
import React, { useState, useRef, useEffect, useMemo } from "react";

// Ant Design components and icons
import { ConfigProvider, theme, Upload, Switch } from "antd";
import { FileAddOutlined, GithubOutlined } from "@ant-design/icons";
import type { UploadProps } from "antd/es/upload";

// Toast notifications
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

// Voice recorder
import { AudioRecorder } from "react-audio-voice-recorder";

// Hooks & Components
import { useFFmpegPool } from "./hooks/useFFmpegPool";
import { useTranscriptionQueue } from "./hooks/useTranscriptionQueue";
import StickyProgress from "./components/StickyProgress";
import FileJobTable from "./components/FileJobTable";
import BatchLLMPanel from "./components/BatchLLMPanel";

import type { LogMessage, ApiConfig } from "./types";

const App: React.FC = () => {
  // -----------------------------------------------------------------
  // GLOBAL SETTINGS STATE (persisted in localStorage)
  // -----------------------------------------------------------------
  const [selectedApi, setSelectedApi] = useState<"groq" | "openai">(
    (localStorage.getItem("selectedApi") as "groq" | "openai") || "groq"
  );
  const [groqKey, setGroqKey] = useState(localStorage.getItem("groqKey") || "");
  const [openaiKey, setOpenaiKey] = useState(localStorage.getItem("openaiKey") || "");
  const [groqModel, setGroqModel] = useState(localStorage.getItem("groqModel") || "whisper-large-v3");
  const [openaiModel, setOpenaiModel] = useState(localStorage.getItem("openaiModel") || "whisper-1");
  const [maxFileSizeMB, setMaxFileSizeMB] = useState(25);
  const [sampleRate, setSampleRate] = useState(
    parseInt(localStorage.getItem("sampleRate") || "16000", 10)
  );
  const [openAiChatModel, setOpenAiChatModel] = useState(
    localStorage.getItem("openAiChatModel") || "chatgpt-4o-latest"
  );
  const [groqChatModel, setGroqChatModel] = useState(
    localStorage.getItem("groqChatModel") || "llama-3.3-70b-versatile"
  );

  // Automation settings
  const [autoTranscribe, setAutoTranscribe] = useState(
    localStorage.getItem("autoTranscribe") === "true"
  );
  const [autoCopyToClipboard, setAutoCopyToClipboard] = useState(
    localStorage.getItem("autoCopyToClipboard") === "true"
  );

  // UI toggles
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showLogConsole, setShowLogConsole] = useState(false);

  // Log state
  const [logMessages, setLogMessages] = useState<LogMessage[]>([]);
  const logContainerRef = useRef<HTMLDivElement | null>(null);

  // -----------------------------------------------------------------
  // API CONFIG REF (read by processing hooks without stale closures)
  // -----------------------------------------------------------------
  const apiConfigRef = useRef<ApiConfig>({
    selectedApi, groqKey, openaiKey, groqModel, openaiModel, maxFileSizeMB, sampleRate,
  });
  useEffect(() => {
    apiConfigRef.current = {
      selectedApi, groqKey, openaiKey, groqModel, openaiModel, maxFileSizeMB, sampleRate,
    };
  }, [selectedApi, groqKey, openaiKey, groqModel, openaiModel, maxFileSizeMB, sampleRate]);

  // -----------------------------------------------------------------
  // LOGGING
  // -----------------------------------------------------------------
  const appendLog = (msg: string, type: "info" | "error" = "info") => {
    const timeStamp = new Date().toLocaleTimeString();
    if (type === "error") {
      toast.error(msg);
    }
    setLogMessages(prev => [...prev, { text: `[${timeStamp}] ${msg}`, type, html: true }]);
  };

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logMessages]);

  // -----------------------------------------------------------------
  // FFMPEG POOL + TRANSCRIPTION QUEUE
  // -----------------------------------------------------------------
  const ffmpegPool = useFFmpegPool(2, appendLog);
  const queue = useTranscriptionQueue({
    ffmpegPool,
    apiConfigRef: apiConfigRef as React.RefObject<ApiConfig>,
    onLog: appendLog,
  });

  // -----------------------------------------------------------------
  // SETTINGS HANDLERS
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

  const handleApiProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    handleApiSettingChange(e.target.value as "groq" | "openai", setSelectedApi, "selectedApi", `Switched API to ${e.target.value}`);
  };
  const handleGroqKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleApiSettingChange(e.target.value, setGroqKey, "groqKey", "Updated Groq API key.");
  };
  const handleOpenaiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleApiSettingChange(e.target.value, setOpenaiKey, "openaiKey", "Updated OpenAI API key.");
  };
  const handleGroqModelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleApiSettingChange(e.target.value, setGroqModel, "groqModel", `Updated Groq model to "${e.target.value}".`);
  };
  const handleOpenaiModelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleApiSettingChange(e.target.value, setOpenaiModel, "openaiModel", `Updated OpenAI model to "${e.target.value}".`);
  };
  const handleMaxFileSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const n = parseFloat(e.target.value);
    if (!isNaN(n) && n > 0) handleApiSettingChange(n, setMaxFileSizeMB, "maxFileSizeMB", `Max file size: ${n} MB`);
  };
  const handleSampleRateChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    handleApiSettingChange(parseInt(e.target.value, 10), setSampleRate, "sampleRate", `Sample rate: ${e.target.value} Hz`);
  };
  const handleOpenAiChatModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    handleApiSettingChange(e.target.value, setOpenAiChatModel, "openAiChatModel", `OpenAI Chat Model: "${e.target.value}".`);
  };
  const handleGroqChatModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    handleApiSettingChange(e.target.value, setGroqChatModel, "groqChatModel", `Groq Chat Model: "${e.target.value}".`);
  };

  // -----------------------------------------------------------------
  // VOICE RECORDER
  // -----------------------------------------------------------------
  const handleRecordingComplete = (blob: Blob) => {
    const now = new Date();
    const ts = [
      now.getFullYear(), '-',
      String(now.getMonth() + 1).padStart(2, '0'), '-',
      String(now.getDate()).padStart(2, '0'), '_',
      String(now.getHours()).padStart(2, '0'), '-',
      String(now.getMinutes()).padStart(2, '0'), '-',
      String(now.getSeconds()).padStart(2, '0'),
    ].join('');
    const fileName = `Recording_${ts}.mp3`;
    const file = new File([blob], fileName, { type: blob.type });
    queue.addFiles([file]);

    if (autoTranscribe) {
      // Start immediately after adding
      setTimeout(() => queue.startAll(), 100);
    }
  };

  // -----------------------------------------------------------------
  // UPLOAD CONFIG (multi-file)
  // -----------------------------------------------------------------
  const uploadProps: UploadProps = {
    name: "file",
    multiple: true,
    accept: "audio/*,video/*",
    beforeUpload: (_file: File, fileList: File[]) => {
      // On the first file of a batch, add all files at once
      if (fileList[0] === _file) {
        queue.addFiles(fileList as File[]);
      }
      return false; // Prevent automatic upload
    },
    onDrop(e) {
      appendLog(`Dropped ${e.dataTransfer.files.length} file(s).`, "info");
    },
    showUploadList: false, // We have our own job table
  };

  // -----------------------------------------------------------------
  // COPY / DOWNLOAD UTILITIES
  // -----------------------------------------------------------------
  const handleCopy = (text: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text.trim()).then(
      () => {
        toast.success("Copied to clipboard!", { autoClose: 3000, style: { backgroundColor: "#fff", color: "#000" } });
      },
      (err) => appendLog(`Error copying: ${err}`, "error")
    );
  };

  const handleDownload = (text: string, fileName: string) => {
    if (!text) return;
    const blob = new Blob([text.trim()], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success("Download initiated!", { autoClose: 3000, style: { backgroundColor: "#fff", color: "#000" } });
  };

  // -----------------------------------------------------------------
  // AUTO-COPY on completion
  // -----------------------------------------------------------------
  const prevCompletedRef = useRef(0);
  useEffect(() => {
    if (autoCopyToClipboard && queue.completedCount > prevCompletedRef.current) {
      // Find the newly completed job(s)
      const completedJobs = queue.jobs.filter(j => j.status === 'done' && j.transcript);
      if (completedJobs.length > 0) {
        const lastCompleted = completedJobs[completedJobs.length - 1];
        handleCopy(lastCompleted.transcript!);
        appendLog(`Auto-copied "${lastCompleted.fileName}" transcript.`, "info");
      }
    }
    prevCompletedRef.current = queue.completedCount;
  }, [queue.completedCount, autoCopyToClipboard]);

  // Currently processing file name (for sticky progress)
  const currentProcessingFile = useMemo(() => {
    const active = queue.jobs.find(j =>
      ['converting', 'splitting', 'transcribing', 'stitching'].includes(j.status)
    );
    return active?.fileName;
  }, [queue.jobs]);

  // -----------------------------------------------------------------
  // RENDER
  // -----------------------------------------------------------------
  return (
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: { colorPrimary: "#5eaa28", colorLink: "#5eaa28" },
      }}
    >
      {/* Sticky Progress */}
      <StickyProgress
        completedCount={queue.completedCount}
        totalCount={queue.totalCount}
        globalStatus={queue.globalStatus}
        currentFileName={currentProcessingFile}
      />

      <div className="app-container">
        {/* Header */}
        <h2 className="header-title">AI Audio/Video Transcription & Summaries</h2>
        <p style={{ margin: "1rem 0", fontSize: "1rem", color: "#ccc" }}>
          Easily convert audio or video files to text, then use an LLM to summarize or otherwise transform the resulting transcript.
          Everything runs locally and uses your own API key. Drop multiple files for batch processing.
        </p>

        {/* API Provider & Basic Config */}
        <div className="control-panel">
          <div className="control-row">
            <label>API Provider:</label>
            <select className="input-standard" value={selectedApi} onChange={handleApiProviderChange}>
              <option value="groq">Groq</option>
              <option value="openai">OpenAI</option>
            </select>
          </div>

          {selectedApi === "groq" ? (
            !groqKey ? (
              <div className="control-row">
                <label>Groq API Key:</label>
                <input className="input-standard" type="text" value={groqKey} onChange={handleGroqKeyChange} placeholder="Enter Groq API key" />
              </div>
            ) : (
              <p className="api-key-message">Groq API Key is set. Update in Advanced Options if needed.</p>
            )
          ) : !openaiKey ? (
            <div className="control-row">
              <label>OpenAI API Key:</label>
              <input className="input-standard" type="text" value={openaiKey} onChange={handleOpenaiKeyChange} placeholder="Enter OpenAI API key" />
            </div>
          ) : (
            <p className="api-key-message">OpenAI API Key is set. Update in Advanced Options if needed.</p>
          )}

          <button className="btn-standard" onClick={() => setShowAdvanced(!showAdvanced)}>
            {showAdvanced ? "Hide Advanced Options" : "Show Advanced Options"}
          </button>
        </div>

        {/* Advanced Panel */}
        {showAdvanced && (
          <div className="advanced-panel">
            <div className="settings-group">
              <div className="settings-separator"><span>Automation Settings</span></div>
              <div className="control-row">
                <label>Transcribe Immediately After Recording:</label>
                <Switch checked={autoTranscribe} onChange={(checked: boolean) => {
                  setAutoTranscribe(checked);
                  localStorage.setItem("autoTranscribe", checked.toString());
                  appendLog(`Auto-transcribe ${checked ? 'enabled' : 'disabled'}.`, "info");
                }} />
              </div>
              <div className="control-row">
                <label>Copy Transcription to Clipboard Automatically:</label>
                <Switch checked={autoCopyToClipboard} onChange={(checked: boolean) => {
                  setAutoCopyToClipboard(checked);
                  localStorage.setItem("autoCopyToClipboard", checked.toString());
                  appendLog(`Auto-copy ${checked ? 'enabled' : 'disabled'}.`, "info");
                }} />
              </div>
            </div>

            <div className="settings-group">
              <div className="settings-separator"><span>API Settings</span></div>
              {selectedApi === "groq" && groqKey && (
                <div className="control-row">
                  <label>Groq API Key (masked):</label>
                  <input className="input-standard" type="password" value={groqKey} onChange={handleGroqKeyChange} />
                </div>
              )}
              {selectedApi === "openai" && openaiKey && (
                <div className="control-row">
                  <label>OpenAI API Key (masked):</label>
                  <input className="input-standard" type="password" value={openaiKey} onChange={handleOpenaiKeyChange} />
                </div>
              )}
              {selectedApi === "groq" ? (
                <div className="control-row">
                  <label>Groq Model (Audio):</label>
                  <input className="input-standard" type="text" value={groqModel} onChange={handleGroqModelChange} placeholder="e.g. whisper-large-v3" />
                </div>
              ) : (
                <div className="control-row">
                  <label>OpenAI Model (Audio):</label>
                  <input className="input-standard" type="text" value={openaiModel} onChange={handleOpenaiModelChange} placeholder="e.g. whisper-1" />
                </div>
              )}
              <div className="control-row">
                <label>Sample Rate:</label>
                <select className="input-standard" value={sampleRate} onChange={handleSampleRateChange}>
                  <option value="8000">8 kHz</option>
                  <option value="16000">16 kHz</option>
                  <option value="22050">22.05 kHz</option>
                  <option value="44100">44.1 kHz</option>
                  <option value="48000">48 kHz</option>
                </select>
              </div>
              <div className="control-row">
                <label>Max File Size (MB):</label>
                <input className="input-standard" type="number" value={maxFileSizeMB} onChange={handleMaxFileSizeChange} min="1" />
              </div>

              <div className="settings-separator"><span>Chat Model Settings</span></div>
              <div className="control-row">
                <label>Chat Model:</label>
                {selectedApi === "openai" ? (
                  <select className="input-standard" value={openAiChatModel} onChange={handleOpenAiChatModelChange}>
                    <option value="chatgpt-4o-latest">chatgpt-4o-latest</option>
                    <option value="gpt-4o-mini">gpt-4o-mini</option>
                    <option value="o3-mini">o3-mini</option>
                    <option value="o1">o1</option>
                  </select>
                ) : (
                  <select className="input-standard" value={groqChatModel} onChange={handleGroqChatModelChange}>
                    <option value="llama-3.3-70b-versatile">llama-3.3-70b-versatile</option>
                    <option value="deepseek-r1-distill-llama-70b">deepseek-r1-distill-llama-70b</option>
                  </select>
                )}
              </div>
            </div>
          </div>
        )}

        {/* File Upload + Voice Recorder */}
        <div className="control-panel">
          <div className="control-row">
            <Upload.Dragger {...uploadProps} style={{ width: "100%" }}>
              <p className="ant-upload-drag-icon"><FileAddOutlined /></p>
              <p className="ant-upload-text">Click or drag files to this area to select</p>
              <p className="ant-upload-hint">
                Supports audio and video files. Drop multiple files for batch processing.<br />
                Files are not uploaded to any server.
              </p>
            </Upload.Dragger>
          </div>

          <div className="control-row" style={{ flexDirection: "column" }}>
            <p style={{ marginBottom: "0.5rem" }}>Or Record Your Audio</p>
            <AudioRecorder
              onRecordingComplete={handleRecordingComplete}
              audioTrackConstraints={{}}
              downloadOnSavePress={false}
              showVisualizer={true}
              downloadFileExtension="mp3"
            />
          </div>

          {/* Quick Transcribe All button when files are queued */}
          {queue.jobs.some(j => j.status === 'queued') && queue.globalStatus !== 'processing' && (
            <button
              className="btn-standard btn-standard-full"
              onClick={queue.startAll}
              disabled={!ffmpegPool.isReady}
            >
              {ffmpegPool.isReady ? `Transcribe ${queue.jobs.filter(j => j.status === 'queued').length} File(s)` : 'Loading FFmpeg...'}
            </button>
          )}
        </div>

        {/* Job Table */}
        {queue.jobs.length > 0 && (
          <FileJobTable
            jobs={queue.jobs}
            globalStatus={queue.globalStatus}
            onStartAll={queue.startAll}
            onPause={queue.pause}
            onResume={queue.resume}
            onRemoveJob={queue.removeJob}
            onRetryJob={queue.retryJob}
            onUpdateTranscript={queue.updateTranscript}
            onClearCompleted={queue.clearCompleted}
            onCopy={handleCopy}
            onDownload={handleDownload}
          />
        )}

        {/* Batch LLM Panel */}
        <BatchLLMPanel
          jobs={queue.jobs}
          apiConfig={apiConfigRef.current!}
          selectedApi={selectedApi}
          groqKey={groqKey}
          openaiKey={openaiKey}
          openAiChatModel={openAiChatModel}
          groqChatModel={groqChatModel}
          onLog={appendLog}
          onSetLLMResult={queue.setLLMResult}
          onCopy={handleCopy}
          onDownload={handleDownload}
        />

        {/* Log Console Toggle */}
        <div style={{ textAlign: "right", marginTop: "2rem", marginBottom: "1rem" }}>
          <button className="btn-standard" onClick={() => setShowLogConsole(prev => !prev)}>
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
                if (logMsg.type === "error") className += " log-line-error";
                else className += isLast ? " log-line-current" : " log-line-old";
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

      {/* Footer */}
      <footer>
        <a href="https://github.com/Lukhausen/ai-video-audio-transcriber/" target="_blank" rel="noopener noreferrer">
          <GithubOutlined /> view on GitHub
        </a>
        <a href="https://lukhausen.de" target="_blank" rel="noopener noreferrer">
          by Lukas Marschhausen
        </a>
      </footer>
    </ConfigProvider>
  );
};

export default App;
