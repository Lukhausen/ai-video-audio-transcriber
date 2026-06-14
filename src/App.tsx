// App.tsx — Multi-file transcription with parallel processing
import React, { useState, useRef, useEffect, useMemo } from "react";

// Ant Design components and icons
import { ConfigProvider, theme, Upload, Switch } from "antd";
import { FileAddOutlined, GithubOutlined } from "@ant-design/icons";
import { LuClipboardList, LuSettings2 } from "react-icons/lu";
import type { UploadProps } from "antd/es/upload";

// Toast notifications
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

// Hooks & Components
import { useFFmpegPool } from "./hooks/useFFmpegPool";
import { useTranscriptionQueue } from "./hooks/useTranscriptionQueue";
import StickyProgress from "./components/StickyProgress";
import FileJobTable from "./components/FileJobTable";
import PersistentAudioRecorder from "./components/PersistentAudioRecorder";
import BatchLLMPanel from "./components/BatchLLMPanel";
import RecentTranscriptRow from "./components/RecentTranscriptRow";
import {
  getStoredModel,
  GROQ_AUDIO_MODELS,
  GROQ_CHAT_MODELS,
  OPENAI_AUDIO_MODELS,
  OPENAI_CHAT_MODELS,
} from "./modelOptions";

import type { LogMessage, ApiConfig, FileJob } from "./types";

const RECENT_TRANSCRIPTS_KEY = "recentTranscriptions";
const RECENT_TRANSCRIPTS_LIMIT = 3;
const SAMPLE_RATE_OPTIONS = [
  { value: 8000, label: "8 kHz" },
  { value: 16000, label: "16 kHz" },
  { value: 22050, label: "22.05 kHz" },
  { value: 44100, label: "44.1 kHz" },
  { value: 48000, label: "48 kHz" },
] as const;

type RecentTranscription = {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  transcript: string;
  cachedAt: number;
};

function loadRecentTranscriptions(): RecentTranscription[] {
  try {
    const stored = localStorage.getItem(RECENT_TRANSCRIPTS_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.slice(0, RECENT_TRANSCRIPTS_LIMIT) : [];
  } catch {
    return [];
  }
}

function saveRecentTranscriptions(items: RecentTranscription[]) {
  localStorage.setItem(RECENT_TRANSCRIPTS_KEY, JSON.stringify(items.slice(0, RECENT_TRANSCRIPTS_LIMIT)));
}

const App: React.FC = () => {
  // -----------------------------------------------------------------
  // GLOBAL SETTINGS STATE (persisted in localStorage)
  // -----------------------------------------------------------------
  const [selectedApi, setSelectedApi] = useState<"groq" | "openai">(
    (localStorage.getItem("selectedApi") as "groq" | "openai") || "groq"
  );
  const [groqKey, setGroqKey] = useState(localStorage.getItem("groqKey") || "");
  const [openaiKey, setOpenaiKey] = useState(localStorage.getItem("openaiKey") || "");
  const [groqModel, setGroqModel] = useState(getStoredModel("groqModel", GROQ_AUDIO_MODELS));
  const [openaiModel, setOpenaiModel] = useState(getStoredModel("openaiModel", OPENAI_AUDIO_MODELS));
  const [maxFileSizeMB, setMaxFileSizeMB] = useState(25);
  const [sampleRate, setSampleRate] = useState(
    parseInt(localStorage.getItem("sampleRate") || "16000", 10)
  );
  const [openAiChatModel, setOpenAiChatModel] = useState(
    getStoredModel("openAiChatModel", OPENAI_CHAT_MODELS)
  );
  const [groqChatModel, setGroqChatModel] = useState(
    getStoredModel("groqChatModel", GROQ_CHAT_MODELS)
  );

  // Automation settings
  const [autoTranscribe, setAutoTranscribe] = useState(
    localStorage.getItem("autoTranscribe") === "true"
  );
  const [autoCopyToClipboard, setAutoCopyToClipboard] = useState(
    localStorage.getItem("autoCopyToClipboard") !== "false"
  );

  // UI toggles
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showLogConsole, setShowLogConsole] = useState(false);

  // Log state
  const [logMessages, setLogMessages] = useState<LogMessage[]>([]);
  const logContainerRef = useRef<HTMLDivElement | null>(null);
  const [recentTranscriptions, setRecentTranscriptions] = useState<RecentTranscription[]>(loadRecentTranscriptions);

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

  const handleApiProviderChange = (provider: "groq" | "openai") => {
    handleApiSettingChange(provider, setSelectedApi, "selectedApi", `Switched API to ${provider}`);
  };
  const handleGroqKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleApiSettingChange(e.target.value, setGroqKey, "groqKey", "Updated Groq API key.");
  };
  const handleOpenaiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleApiSettingChange(e.target.value, setOpenaiKey, "openaiKey", "Updated OpenAI API key.");
  };
  const handleGroqModelChange = (model: string) => {
    handleApiSettingChange(model, setGroqModel, "groqModel", `Updated Groq model to "${model}".`);
  };
  const handleOpenaiModelChange = (model: string) => {
    handleApiSettingChange(model, setOpenaiModel, "openaiModel", `Updated OpenAI model to "${model}".`);
  };
  const handleMaxFileSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const n = parseFloat(e.target.value);
    if (!isNaN(n) && n > 0) handleApiSettingChange(n, setMaxFileSizeMB, "maxFileSizeMB", `Max file size: ${n} MB`);
  };
  const handleSampleRateChange = (rate: number) => {
    handleApiSettingChange(rate, setSampleRate, "sampleRate", `Sample rate: ${rate} Hz`);
  };
  const handleOpenAiChatModelValueChange = (model: string) => {
    handleApiSettingChange(model, setOpenAiChatModel, "openAiChatModel", `OpenAI Chat Model: "${model}".`);
  };
  const handleGroqChatModelValueChange = (model: string) => {
    handleApiSettingChange(model, setGroqChatModel, "groqChatModel", `Groq Chat Model: "${model}".`);
  };

  // -----------------------------------------------------------------
  // VOICE RECORDER
  // -----------------------------------------------------------------
  const handleRecordingComplete = (file: File, shouldTranscribeNow = false) => {
    queue.addFiles([file]);

    if (shouldTranscribeNow || autoTranscribe) {
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

  const currentSampleRateIndex = SAMPLE_RATE_OPTIONS.findIndex(option => option.value === sampleRate);
  const selectedSampleRateIndex = currentSampleRateIndex >= 0 ? currentSampleRateIndex : 1;

  const renderModelChoice = (
    options: { value: string; label: string }[],
    value: string,
    onChange: (model: string) => void,
    ariaLabel: string
  ) => (
    <div className="segmented-control model-choice-control" role="radiogroup" aria-label={ariaLabel}>
      {options.map(model => (
        <button
          key={model.value}
          type="button"
          className={value === model.value ? "is-active" : ""}
          onClick={() => onChange(model.value)}
          aria-pressed={value === model.value}
        >
          {model.label}
        </button>
      ))}
    </div>
  );

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
    toast.success("Download started.", { autoClose: 3000, style: { backgroundColor: "#fff", color: "#000" } });
  };

  const updateRecentTranscriptions = (updater: (items: RecentTranscription[]) => RecentTranscription[]) => {
    setRecentTranscriptions(prev => {
      const next = updater(prev).slice(0, RECENT_TRANSCRIPTS_LIMIT);
      saveRecentTranscriptions(next);
      return next;
    });
  };

  const removeRecentTranscription = (id: string) => {
    updateRecentTranscriptions(items => items.filter(item => item.id !== id));
  };

  // -----------------------------------------------------------------
  // CACHE completed transcripts
  // -----------------------------------------------------------------
  useEffect(() => {
    const completedJobs = queue.jobs.filter(j => j.status === 'done' && j.transcript);
    if (completedJobs.length === 0) return;

    updateRecentTranscriptions(current => {
      const byId = new Map(current.map(item => [item.id, item]));

      for (const job of completedJobs) {
        byId.set(job.id, {
          id: job.id,
          fileName: job.fileName,
          fileSize: job.fileSize,
          mimeType: job.mimeType,
          transcript: job.transcript!,
          cachedAt: byId.get(job.id)?.cachedAt || Date.now(),
        });
      }

      return Array.from(byId.values())
        .sort((a, b) => b.cachedAt - a.cachedAt)
        .slice(0, RECENT_TRANSCRIPTS_LIMIT);
    });
  }, [queue.jobs]);

  const recentJobs = useMemo<FileJob[]>(() => (
    recentTranscriptions.map(item => ({
      id: item.id,
      fileName: item.fileName,
      fileSize: item.fileSize,
      mimeType: item.mimeType,
      status: 'done',
      progress: 100,
      transcript: item.transcript,
      addedAt: item.cachedAt,
    }))
  ), [recentTranscriptions]);

  // -----------------------------------------------------------------
  // AUTO-COPY on completion
  // -----------------------------------------------------------------
  const prevCompletedRef = useRef(0);
  useEffect(() => {
    const isSingleFileQueue = queue.jobs.length === 1;

    if (autoCopyToClipboard && isSingleFileQueue && queue.completedCount > prevCompletedRef.current) {
      // Find the newly completed job(s)
      const completedJobs = queue.jobs.filter(j => j.status === 'done' && j.transcript);
      if (completedJobs.length > 0) {
        const lastCompleted = completedJobs[completedJobs.length - 1];
        handleCopy(lastCompleted.transcript!);
        appendLog(`Auto-copied "${lastCompleted.fileName}" transcript.`, "info");
      }
    }
    prevCompletedRef.current = queue.completedCount;
  }, [queue.completedCount, queue.jobs, autoCopyToClipboard]);

  // Currently processing file name (for sticky progress)
  const currentProcessingFile = useMemo(() => {
    const active = queue.jobs.find(j =>
      ['converting', 'splitting', 'transcribing', 'stitching'].includes(j.status)
    );
    return active?.fileName;
  }, [queue.jobs]);

  const completedRecordingFileNames = useMemo(() => (
    queue.jobs
      .filter(j => j.status === 'done' && j.transcript && j.fileName.startsWith('Recording_'))
      .map(j => j.fileName)
  ), [queue.jobs]);

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
        <h2 className="header-title">AI Audio/Video Transcription</h2>
        <p className="header-subtitle">
          Turn audio or video into text, then summarize or rewrite the transcript with AI using your own API key.
        </p>

        {/* API Provider & Basic Config */}
        <div className={`control-panel setup-panel ${showAdvanced ? "setup-panel-open" : ""}`}>
          <div className="setup-field-row setup-provider-row">
            <span className="setup-field-label">API provider:</span>
            <div className="setup-field-control setup-provider-actions">
              <div className="segmented-control provider-control" role="radiogroup" aria-label="API provider">
                <button
                  type="button"
                  className={selectedApi === "groq" ? "is-active" : ""}
                  onClick={() => handleApiProviderChange("groq")}
                  aria-pressed={selectedApi === "groq"}
                  aria-label="Use Groq as API provider"
                >
                  <img className="provider-logo provider-logo-groq" src="/icons/groq.svg" alt="" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={selectedApi === "openai" ? "is-active" : ""}
                  onClick={() => handleApiProviderChange("openai")}
                  aria-pressed={selectedApi === "openai"}
                  aria-label="Use OpenAI as API provider"
                >
                  <img className="provider-logo provider-logo-openai" src="/icons/openai.svg" alt="" aria-hidden="true" />
                </button>
              </div>
              <button type="button" className="settings-toggle setup-settings-toggle" onClick={() => setShowAdvanced(!showAdvanced)}>
                <LuSettings2 />
                <span>{showAdvanced ? "Hide advanced" : "Advanced"}</span>
              </button>
            </div>
          </div>

          {selectedApi === "groq" ? (
            !groqKey ? (
              <div className="setup-field-row">
                <label className="setup-field-label">Groq API key:</label>
                <div className="setup-field-control">
                  <input className="input-standard" type="text" value={groqKey} onChange={handleGroqKeyChange} placeholder="Paste your Groq API key" />
                </div>
              </div>
            ) : (
              <p className="api-key-message setup-field-message">
                {showAdvanced ? "Groq API key saved." : "Groq API key saved. Change it in advanced settings."}
              </p>
            )
          ) : !openaiKey ? (
            <div className="setup-field-row">
              <label className="setup-field-label">OpenAI API key:</label>
              <div className="setup-field-control">
                <input className="input-standard" type="text" value={openaiKey} onChange={handleOpenaiKeyChange} placeholder="Paste your OpenAI API key" />
              </div>
            </div>
          ) : (
            <p className="api-key-message setup-field-message">
              {showAdvanced ? "OpenAI API key saved." : "OpenAI API key saved. Change it in advanced settings."}
            </p>
          )}
        </div>

        {/* Advanced Panel */}
        {showAdvanced && (
          <div className="advanced-panel setup-advanced-panel">
            <div className="settings-group">
              <div className="settings-separator"><span>Automation</span></div>
              <div className="control-row">
                <label>Auto-transcribe new recordings:</label>
                <Switch checked={autoTranscribe} onChange={(checked: boolean) => {
                  setAutoTranscribe(checked);
                  localStorage.setItem("autoTranscribe", checked.toString());
                  appendLog(`Auto-transcribe ${checked ? 'enabled' : 'disabled'}.`, "info");
                }} />
              </div>
              <div className="control-row">
                <label>Auto-copy one-file transcript:</label>
                <Switch checked={autoCopyToClipboard} onChange={(checked: boolean) => {
                  setAutoCopyToClipboard(checked);
                  localStorage.setItem("autoCopyToClipboard", checked.toString());
                  appendLog(`Auto-copy ${checked ? 'enabled' : 'disabled'}.`, "info");
                }} />
              </div>
            </div>

            <div className="settings-group">
              <div className="settings-separator"><span>Transcription</span></div>
              {selectedApi === "groq" && groqKey && (
                <div className="control-row">
                  <label>Groq API key:</label>
                  <input className="input-standard" type="password" value={groqKey} onChange={handleGroqKeyChange} />
                </div>
              )}
              {selectedApi === "openai" && openaiKey && (
                <div className="control-row">
                  <label>OpenAI API key:</label>
                  <input className="input-standard" type="password" value={openaiKey} onChange={handleOpenaiKeyChange} />
                </div>
              )}
              {selectedApi === "groq" ? (
                <div className="control-row">
                  <label>Transcription model:</label>
                  {renderModelChoice(GROQ_AUDIO_MODELS, groqModel, handleGroqModelChange, "Groq transcription model")}
                </div>
              ) : (
                <div className="control-row">
                  <label>Transcription model:</label>
                  {renderModelChoice(OPENAI_AUDIO_MODELS, openaiModel, handleOpenaiModelChange, "OpenAI transcription model")}
                </div>
              )}
              <div className="control-row">
                <label>Conversion sample rate:</label>
                <div className="sample-rate-control">
                  <input
                    className="sample-rate-slider"
                    type="range"
                    min="0"
                    max={SAMPLE_RATE_OPTIONS.length - 1}
                    step="1"
                    value={selectedSampleRateIndex}
                    onChange={e => handleSampleRateChange(SAMPLE_RATE_OPTIONS[Number(e.target.value)].value)}
                    aria-label="Conversion sample rate"
                    aria-valuetext={SAMPLE_RATE_OPTIONS[selectedSampleRateIndex].label}
                  />
                  <div className="sample-rate-stops">
                    {SAMPLE_RATE_OPTIONS.map((option, index) => (
                      <button
                        key={option.value}
                        type="button"
                        className={index === selectedSampleRateIndex ? "is-active" : ""}
                        onClick={() => handleSampleRateChange(option.value)}
                        aria-pressed={index === selectedSampleRateIndex}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="control-row">
                <label>Chunk size (MB):</label>
                <input className="input-standard" type="number" value={maxFileSizeMB} onChange={handleMaxFileSizeChange} min="1" />
              </div>
            </div>
          </div>
        )}

        {/* File Upload + Voice Recorder */}
        <div className="control-panel add-media-panel">
          <div className="control-row">
            <Upload.Dragger {...uploadProps} style={{ width: "100%" }}>
              <p className="ant-upload-drag-icon"><FileAddOutlined /></p>
              <p className="ant-upload-text">Drop audios or videos here, or click to choose</p>
              <p className="ant-upload-hint">
                Files are never uploaded anywhere. Everything is processed locally in this browser.
              </p>
            </Upload.Dragger>
          </div>

          <div className="control-row" style={{ flexDirection: "column" }}>
            <PersistentAudioRecorder
              completedRecordingFileNames={completedRecordingFileNames}
              onRecordingReady={handleRecordingComplete}
              onLog={appendLog}
            />
          </div>
        </div>
        {/* Job Table */}
        {queue.jobs.length > 0 ? (
          <FileJobTable
            jobs={queue.jobs}
            globalStatus={queue.globalStatus}
            isTranscriptionReady={ffmpegPool.isReady}
            onStartAll={queue.startAll}
            onPause={queue.pause}
            onResume={queue.resume}
            onStartJob={queue.startJob}
            onRemoveJob={queue.removeJob}
            onRetryJob={queue.retryJob}
            onClearCompleted={queue.clearCompleted}
            onCopy={handleCopy}
            onDownload={handleDownload}
          />
        ) : recentJobs.length > 0 ? (
          <div className="job-table job-table-recent">
            <div className="job-table-actions">
              <div className="job-table-stats">
                <span>Last transcript from this browser</span>
              </div>
            </div>
            <div className="job-table-rows">
              {recentJobs.map(job => (
                <RecentTranscriptRow
                  key={job.id}
                  job={job}
                  onRemove={removeRecentTranscription}
                  onCopy={handleCopy}
                  onDownload={handleDownload}
                />
              ))}
            </div>
          </div>
        ) : null}

        {/* Batch LLM Panel */}
        <BatchLLMPanel
          jobs={queue.jobs}
          selectedApi={selectedApi}
          groqKey={groqKey}
          openaiKey={openaiKey}
          openAiChatModel={openAiChatModel}
          groqChatModel={groqChatModel}
          onOpenAiChatModelChange={handleOpenAiChatModelValueChange}
          onGroqChatModelChange={handleGroqChatModelValueChange}
          onLog={appendLog}
          onSetLLMResult={queue.setLLMResult}
          onCopy={handleCopy}
          onDownload={handleDownload}
        />

        {/* Log Console Toggle */}
        <div className="utility-toggle-row">
          <button className="settings-toggle" onClick={() => setShowLogConsole(prev => !prev)}>
            <LuClipboardList />
            <span>{showLogConsole ? "Hide processing log" : "Processing log"}</span>
          </button>
        </div>

        {/* Log Console */}
        {showLogConsole && (
          <div className="log-section">
            <h3>Processing log</h3>
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
