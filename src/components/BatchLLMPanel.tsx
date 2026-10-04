// Batch LLM panel — supports per-file and combined LLM processing
import React, { useState } from 'react';
import { LoadingOutlined } from '@ant-design/icons';
import { FaCopy, FaFileDownload } from 'react-icons/fa';
import { TbFileTextAi } from 'react-icons/tb';
import { LuSettings2 } from 'react-icons/lu';
import Groq from 'groq-sdk';
import OpenAI from 'openai';
import { transformGoogleTranscript } from '../providers/google';
import CollapsibleLLMOutput, { CollapsibleLLMOutputRef } from './CollapsibleLLMOutput';
import { usePromptGallery } from '../hooks/usePromptGallery';
import { GOOGLE_CHAT_MODELS, GROQ_CHAT_MODELS, OPENAI_CHAT_MODELS, type ModelOption } from '../modelOptions';
import type { ApiProvider, FileJob } from '../types';

interface BatchLLMPanelProps {
  jobs: FileJob[];
  selectedApi: ApiProvider;
  groqKey: string;
  openaiKey: string;
  googleKey: string;
  googleChatModel: string;
  onGoogleChatModelChange: (model: string) => void;
  openAiChatModel: string;
  groqChatModel: string;
  onOpenAiChatModelChange: (model: string) => void;
  onGroqChatModelChange: (model: string) => void;
  onLog: (msg: string, type: 'info' | 'error') => void;
  onSetLLMResult: (id: string, result: string) => void;
  onCopy: (text: string) => void;
  onDownload: (text: string, fileName: string) => void;
}

const DEFAULT_INSTRUCTION = 'Summarize this transcript with the key points, decisions, and action items.';

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const BatchLLMPanel: React.FC<BatchLLMPanelProps> = ({
  jobs,
  selectedApi,
  groqKey,
  openaiKey,
  googleKey,
  googleChatModel,
  onGoogleChatModelChange,
  openAiChatModel,
  groqChatModel,
  onOpenAiChatModelChange,
  onGroqChatModelChange,
  onLog,
  onSetLLMResult,
  onCopy,
  onDownload,
}) => {
  const completedJobs = jobs.filter(j => j.status === 'done' && j.transcript);
  const aiResultJobs = completedJobs.filter(j => j.llmResult);

  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_INSTRUCTION);
  const [mode, setMode] = useState<'per-file' | 'combined'>('per-file');
  const [isGenerating, setIsGenerating] = useState(false);
  const [combinedResult, setCombinedResult] = useState('');
  const [showOptions, setShowOptions] = useState(false);
  const llmOutputRef = React.useRef<CollapsibleLLMOutputRef>(null);

  const { prompts, addCustomPrompt, removeCustomPrompt, updatePromptUsage } = usePromptGallery();

  const callLLM = async (transcript: string): Promise<string> => {
    if (selectedApi === 'google') {
      return transformGoogleTranscript(googleKey, googleChatModel, transcript, systemPrompt);
    }
    if (selectedApi === 'openai') {
      if (!openaiKey) throw new Error('No OpenAI API key set.');
      const client = new OpenAI({ apiKey: openaiKey, dangerouslyAllowBrowser: true });
      const response = await client.chat.completions.create({
        model: openAiChatModel,
        messages: [
          { role: 'system', content: systemPrompt || 'You are a helpful assistant.' },
          { role: 'user', content: transcript },
        ],
      });
      return response.choices?.[0]?.message?.content || '';
    }

    if (!groqKey) throw new Error('No Groq API key set.');
    const client = new Groq({ apiKey: groqKey, dangerouslyAllowBrowser: true });
    const response = await client.chat.completions.create({
      model: groqChatModel,
      messages: [
        { role: 'system', content: systemPrompt || 'You are a helpful assistant.' },
        { role: 'user', content: transcript },
      ],
      temperature: 1,
      max_completion_tokens: 15140,
      top_p: 1,
      stop: null,
      stream: false,
    });
    return response.choices?.[0]?.message?.content || '';
  };

  const handleProcess = async () => {
    if (completedJobs.length === 0) return;

    const instruction = systemPrompt.trim();
    if (instruction) {
      addCustomPrompt(instruction);
      updatePromptUsage(instruction);
    }

    setIsGenerating(true);

    try {
      if (mode === 'per-file') {
        for (const job of completedJobs) {
          onLog(`[AI] Processing "${job.fileName}"...`, 'info');
          try {
            const result = await callLLM(job.transcript!);
            onSetLLMResult(job.id, result);
            onLog(`[AI] "${job.fileName}" done.`, 'info');
          } catch (err: unknown) {
            onLog(`[AI] Error on "${job.fileName}": ${getErrorMessage(err)}`, 'error');
          }
        }
      } else {
        // Combined mode
        const combined = completedJobs
          .map(j => `=== ${j.fileName} ===\n\n${j.transcript}`)
          .join('\n\n---\n\n');
        onLog('[AI] Processing combined transcript...', 'info');
        const result = await callLLM(combined);
        setCombinedResult(result);
        onLog('[AI] Combined processing done.', 'info');
      }
    } catch (err: unknown) {
      onLog(`[AI] Error: ${getErrorMessage(err)}`, 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const getAllAiOutput = () => {
    if (mode === 'combined') {
      return (llmOutputRef.current?.getFilteredContent() || combinedResult).trim();
    }

    return aiResultJobs
      .map(job => `=== ${job.fileName} ===\n\n${job.llmResult}`)
      .join('\n\n---\n\n')
      .trim();
  };

  const handleCopyAllAiOutput = () => {
    const output = getAllAiOutput();
    if (output) onCopy(output);
  };

  const handleDownloadAllAiOutput = () => {
    const output = getAllAiOutput();
    if (!output) return;

    const date = new Date().toISOString().slice(0, 10);
    onDownload(output, mode === 'combined' ? 'combined-ai-output.txt' : `ai-outputs-${date}.txt`);
  };

  const hasVisibleAiOutput = mode === 'combined' ? Boolean(combinedResult) : aiResultJobs.length > 0;
  const chatModelOptions: ModelOption[] = {
    openai: OPENAI_CHAT_MODELS, groq: GROQ_CHAT_MODELS, google: GOOGLE_CHAT_MODELS,
  }[selectedApi];
  const chatModelValue = { openai: openAiChatModel, groq: groqChatModel, google: googleChatModel }[selectedApi];
  const handleChatModelChange = {
    openai: onOpenAiChatModelChange, groq: onGroqChatModelChange, google: onGoogleChatModelChange,
  }[selectedApi];

  if (completedJobs.length === 0) return null;

  return (
    <div className="llm-panel">
      <div className="llm-panel-header">
        <div className="llm-panel-title">
          <h3>Transform transcripts</h3>
        </div>
        <button
          type="button"
          className="settings-toggle llm-options-toggle"
          onClick={() => setShowOptions(visible => !visible)}
          aria-expanded={showOptions}
        >
          <LuSettings2 />
          <span>{showOptions ? 'Hide options' : 'Options'}</span>
        </button>
      </div>

      {showOptions && (
        <div className="llm-panel-controls llm-options-panel" aria-label="Transform options">
          <div className="llm-option">
            <span className="llm-option-label">Model</span>
            <div className="segmented-control model-choice-control model-choice-control-panel" role="radiogroup" aria-label="Text AI model">
              {chatModelOptions.map(model => (
                <button
                  key={model.value}
                  type="button"
                  className={chatModelValue === model.value ? 'is-active' : ''}
                  onClick={() => handleChatModelChange(model.value)}
                  aria-pressed={chatModelValue === model.value}
                >
                  {model.label}
                </button>
              ))}
            </div>
          </div>
          <div className="llm-option">
            <span className="llm-option-label">Input</span>
            <div className="segmented-control segmented-control-compact" role="radiogroup" aria-label="Use transcript as">
              <button
                type="button"
                className={mode === 'per-file' ? 'is-active' : ''}
                onClick={() => setMode('per-file')}
                aria-pressed={mode === 'per-file'}
              >
                Separate files ({completedJobs.length})
              </button>
              <button
                type="button"
                className={mode === 'combined' ? 'is-active' : ''}
                onClick={() => setMode('combined')}
                aria-pressed={mode === 'combined'}
              >
                One combined text
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="llm-compose">
        <div className="prompt-gallery" aria-label="Saved instructions">
          {prompts.map(prompt => (
            <div
              key={prompt.text}
              className={`prompt-chip ${systemPrompt.trim() === prompt.text ? 'is-active' : ''}`}
            >
              <button
                type="button"
                className="prompt-chip-button"
                onClick={() => {
                  setSystemPrompt(prompt.text);
                  updatePromptUsage(prompt.text);
                }}
              >
                {prompt.text}
              </button>
              {prompt.custom && (
                <button
                  type="button"
                  className="prompt-chip-remove"
                  onClick={() => removeCustomPrompt(prompt.text)}
                  aria-label={`Remove saved instruction: ${prompt.text}`}
                >
                  x
                </button>
              )}
            </div>
          ))}
        </div>

        <textarea
          className="system-prompt-input"
          value={systemPrompt}
          onChange={e => setSystemPrompt(e.target.value)}
          aria-label="Instruction for the AI"
          placeholder="Tell the AI what to do with the transcript."
        />
        <button
          className="btn-standard btn-primary-action llm-run-button"
          onClick={handleProcess}
          disabled={isGenerating}
        >
          {isGenerating ? (
            <><LoadingOutlined /> Transforming transcripts...</>
          ) : (
            <>
              <TbFileTextAi />
              {mode === 'per-file'
                ? `Transform ${completedJobs.length} transcript${completedJobs.length === 1 ? '' : 's'} separately`
                : 'Transform combined transcript'}
            </>
          )}
        </button>
      </div>

      {hasVisibleAiOutput && (
        <div className="ai-output-actions">
          <div className="ai-output-actions-label">
            <span>AI output</span>
            <small>
              {mode === 'combined'
                ? 'Combined result'
                : `${aiResultJobs.length} result${aiResultJobs.length === 1 ? '' : 's'}`}
            </small>
          </div>
          <div className="ai-output-actions-buttons">
            <button className="btn-standard" onClick={handleCopyAllAiOutput}>
              <FaCopy /> Copy all AI output
            </button>
            <button className="btn-standard" onClick={handleDownloadAllAiOutput}>
              <FaFileDownload /> Download all AI output
            </button>
          </div>
        </div>
      )}

      {/* Per-file LLM results */}
      {mode === 'per-file' && aiResultJobs.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          {aiResultJobs.map(job => (
            <div key={job.id} className="transcript-section" style={{ marginTop: '1rem' }}>
              <div className="transcript-header">
                <h3>AI output for {job.fileName}</h3>
                <div>
                  <button className="transcript-icon" onClick={() => onCopy(job.llmResult!)} title="Copy AI output" aria-label={`Copy AI output for ${job.fileName}`}>
                    <FaCopy />
                  </button>
                  <button
                    className="transcript-icon"
                    onClick={() => {
                      const baseName = job.fileName.replace(/\.[^.]+$/, '');
                      onDownload(job.llmResult!, `${baseName}-llm-output.txt`);
                    }}
                    title="Download AI output"
                    aria-label={`Download AI output for ${job.fileName}`}
                  >
                    <FaFileDownload />
                  </button>
                </div>
              </div>
              <div className="transcript-output">
                <CollapsibleLLMOutput content={job.llmResult!} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Combined LLM result */}
      {mode === 'combined' && combinedResult && (
        <div className="transcript-section" style={{ marginTop: '1rem' }}>
          <div className="transcript-header">
            <h3>AI output for combined transcript</h3>
          </div>
          <div className="transcript-output">
            <CollapsibleLLMOutput ref={llmOutputRef} content={combinedResult} />
          </div>
        </div>
      )}
    </div>
  );
};

export default React.memo(BatchLLMPanel);
