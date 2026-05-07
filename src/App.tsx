// App.tsx — Multi-file transcription with parallel processing
import React, { useState, useRef, useEffect, useMemo } from "react";

// Ant Design components and icons
import { ConfigProvider, theme, Upload, Switch } from "antd";
import { FileAddOutlined, GithubOutlined, ProfileOutlined, SettingOutlined } from "@ant-design/icons";
import type { UploadProps } from "antd/es/upload";

// Toast notifications
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

// Hooks & Components
import { useFFmpegPool } from "./hooks/useFFmpegPool";
import { useTranscriptionQueue } from "./hooks/useTranscriptionQueue";
import StickyProgress from "./components/StickyProgress";
import FileJobTable from "./components/FileJobTable";
import FileJobRow from "./components/FileJobRow";
import PersistentAudioRecorder from "./components/PersistentAudioRecorder";
import BatchLLMPanel from "./components/BatchLLMPanel";
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

const PLACEHOLDER_TRANSCRIPT_JOB: FileJob = {
  id: "placeholder-transcript",
  fileName: "meeting-recording.mp3",
  fileSize: 24.8 * 1024 * 1024,
  mimeType: "audio/mp3",
  status: "done",
  progress: 100,
  transcript: "This is where the first lines of a completed transcript appear, so you can quickly check that the file transcribed correctly.",
  addedAt: 0,
};

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

  const updateRecentTranscript = (id: string, transcript: string) => {
    updateRecentTranscriptions(items =>
      items.map(item => item.id === id ? { ...item, transcript } : item)
    );
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
        <h2 className="header-title">Audio/Video Transcription</h2>
        <p className="header-subtitle">
          Convert audio or video to text, then summarize or transform transcripts with an LLM using your own API key.
        </p>

        {/* API Provider & Basic Config */}
        <div className="control-panel">
          <div className="panel-heading">
            <h3>Setup</h3>
            <button className="settings-toggle" onClick={() => setShowAdvanced(!showAdvanced)}>
              <SettingOutlined />
              <span>{showAdvanced ? "Hide advanced settings" : "Advanced settings"}</span>
            </button>
          </div>
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
              <p className="api-key-message">Groq API key saved. Change it in advanced settings.</p>
            )
          ) : !openaiKey ? (
            <div className="control-row">
              <label>OpenAI API Key:</label>
              <input className="input-standard" type="text" value={openaiKey} onChange={handleOpenaiKeyChange} placeholder="Enter OpenAI API key" />
            </div>
          ) : (
            <p className="api-key-message">OpenAI API key saved. Change it in advanced settings.</p>
          )}
        </div>

        {/* Advanced Panel */}
        {showAdvanced && (
          <div className="advanced-panel">
            <div className="settings-group">
              <div className="settings-separator"><span>Automation</span></div>
              <div className="control-row">
                <label>Auto-transcribe recordings:</label>
                <Switch checked={autoTranscribe} onChange={(checked: boolean) => {
                  setAutoTranscribe(checked);
                  localStorage.setItem("autoTranscribe", checked.toString());
                  appendLog(`Auto-transcribe ${checked ? 'enabled' : 'disabled'}.`, "info");
                }} />
              </div>
              <div className="control-row">
                <label>Auto-copy single transcript:</label>
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
                  <label>Audio model:</label>
                  <select className="input-standard" value={groqModel} onChange={handleGroqModelChange}>
                    {GROQ_AUDIO_MODELS.map(model => (
                      <option key={model.value} value={model.value}>{model.label}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="control-row">
                  <label>Audio model:</label>
                  <select className="input-standard" value={openaiModel} onChange={handleOpenaiModelChange}>
                    {OPENAI_AUDIO_MODELS.map(model => (
                      <option key={model.value} value={model.value}>{model.label}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="control-row">
                <label>Sample rate:</label>
                <select className="input-standard" value={sampleRate} onChange={handleSampleRateChange}>
                  <option value="8000">8 kHz</option>
                  <option value="16000">16 kHz</option>
                  <option value="22050">22.05 kHz</option>
                  <option value="44100">44.1 kHz</option>
                  <option value="48000">48 kHz</option>
                </select>
              </div>
              <div className="control-row">
                <label>Segment size (MB):</label>
                <input className="input-standard" type="number" value={maxFileSizeMB} onChange={handleMaxFileSizeChange} min="1" />
              </div>

              <div className="settings-separator"><span>AI</span></div>
              <div className="control-row">
                <label>AI model:</label>
                {selectedApi === "openai" ? (
                  <select className="input-standard" value={openAiChatModel} onChange={handleOpenAiChatModelChange}>
                    {OPENAI_CHAT_MODELS.map(model => (
                      <option key={model.value} value={model.value}>{model.label}</option>
                    ))}
                  </select>
                ) : (
                  <select className="input-standard" value={groqChatModel} onChange={handleGroqChatModelChange}>
                    {GROQ_CHAT_MODELS.map(model => (
                      <option key={model.value} value={model.value}>{model.label}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          </div>
        )}

        {/* File Upload + Voice Recorder */}
        <div className="control-panel">
          <div className="panel-heading">
            <h3>Add media</h3>
          </div>
          <div className="control-row">
            <Upload.Dragger {...uploadProps} style={{ width: "100%" }}>
              <p className="ant-upload-drag-icon"><FileAddOutlined /></p>
              <p className="ant-upload-text">Drop files here, or click to choose</p>
              <p className="ant-upload-hint">
                Audio and video files stay in this browser.
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
            onUpdateTranscript={queue.updateTranscript}
            onClearCompleted={queue.clearCompleted}
            onCopy={handleCopy}
            onDownload={handleDownload}
          />
        ) : recentJobs.length > 0 ? (
          <div className="job-table job-table-recent">
            <div className="job-table-actions">
              <div className="job-table-stats">
                <span>Recent transcripts</span>
              </div>
            </div>
            <div className="job-table-rows">
              {recentJobs.map(job => (
                <FileJobRow
                  key={job.id}
                  job={job}
                  onStart={() => undefined}
                  onRemove={removeRecentTranscription}
                  onRetry={() => undefined}
                  onUpdateTranscript={updateRecentTranscript}
                  onCopy={handleCopy}
                  onDownload={handleDownload}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="job-table job-table-empty">
            <FileJobRow
              job={PLACEHOLDER_TRANSCRIPT_JOB}
              onStart={() => undefined}
              onRemove={() => undefined}
              onRetry={() => undefined}
              onUpdateTranscript={() => undefined}
              onCopy={() => undefined}
              onDownload={() => undefined}
            />
          </div>
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
            <ProfileOutlined />
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
