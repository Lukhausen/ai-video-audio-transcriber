// Batch LLM panel — supports per-file and combined LLM processing
import React, { useState } from 'react';
import { LoadingOutlined } from '@ant-design/icons';
import { FaCopy, FaFileDownload } from 'react-icons/fa';
import Groq from 'groq-sdk';
import OpenAI from 'openai';
import { Tag } from 'antd';
import CollapsibleLLMOutput, { CollapsibleLLMOutputRef } from './CollapsibleLLMOutput';
import { usePromptGallery } from '../hooks/usePromptGallery';
import { GROQ_CHAT_MODELS, OPENAI_CHAT_MODELS } from '../modelOptions';
import type { FileJob, ApiConfig } from '../types';

interface BatchLLMPanelProps {
  jobs: FileJob[];
  apiConfig: ApiConfig;
  selectedApi: 'groq' | 'openai';
  groqKey: string;
  openaiKey: string;
  openAiChatModel: string;
  groqChatModel: string;
  onOpenAiChatModelChange: (model: string) => void;
  onGroqChatModelChange: (model: string) => void;
  onLog: (msg: string, type: 'info' | 'error') => void;
  onSetLLMResult: (id: string, result: string) => void;
  onCopy: (text: string) => void;
  onDownload: (text: string, fileName: string) => void;
}

const BatchLLMPanel: React.FC<BatchLLMPanelProps> = ({
  jobs,
  selectedApi,
  groqKey,
  openaiKey,
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

  const [systemPrompt, setSystemPrompt] = useState('');
  const [mode, setMode] = useState<'per-file' | 'combined'>('per-file');
  const [isGenerating, setIsGenerating] = useState(false);
  const [combinedResult, setCombinedResult] = useState('');
  const llmOutputRef = React.useRef<CollapsibleLLMOutputRef>(null);

  const { prompts, addCustomPrompt, removeCustomPrompt, updatePromptUsage } = usePromptGallery();

  const callLLM = async (transcript: string): Promise<string> => {
    if (selectedApi === 'openai') {
      if (!openaiKey) throw new Error('No OpenAI API key set.');
      const client = new OpenAI({ apiKey: openaiKey, dangerouslyAllowBrowser: true });
      const response = await client.chat.completions.create({
        model: openAiChatModel,
        messages: [
          { role: 'system', content: systemPrompt || 'You are a helpful assistant.' },
          { role: 'user', content: transcript },
        ],
        temperature: 1,
      });
      return response.choices?.[0]?.message?.content || '';
    } else {
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
    }
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
          } catch (err: any) {
            onLog(`[AI] Error on "${job.fileName}": ${err.message}`, 'error');
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
    } catch (err: any) {
      onLog(`[AI] Error: ${err.message}`, 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  if (completedJobs.length === 0) return null;

  return (
    <div className="llm-panel">
      <div className="llm-panel-header">
        <div className="llm-panel-title">
          <h3>AI actions</h3>
        </div>
        <div className="llm-panel-controls">
          <div className="model-selector">
            <label>AI model:</label>
            {selectedApi === 'openai' ? (
              <select
                className="input-standard"
                value={openAiChatModel}
                onChange={e => onOpenAiChatModelChange(e.target.value)}
              >
                {OPENAI_CHAT_MODELS.map(model => (
                  <option key={model.value} value={model.value}>{model.label}</option>
                ))}
              </select>
            ) : (
              <select
                className="input-standard"
                value={groqChatModel}
                onChange={e => onGroqChatModelChange(e.target.value)}
              >
                {GROQ_CHAT_MODELS.map(model => (
                  <option key={model.value} value={model.value}>{model.label}</option>
                ))}
              </select>
            )}
          </div>
          <div className="model-selector">
            <label>Apply to:</label>
            <select
              className="input-standard"
              value={mode}
              onChange={e => setMode(e.target.value as 'per-file' | 'combined')}
            >
              <option value="per-file">Each transcript ({completedJobs.length})</option>
              <option value="combined">Combined transcript</option>
            </select>
          </div>
        </div>
      </div>

      {/* Prompt Gallery */}
      <div className="prompt-gallery-section">
        <label className="section-label">Saved instructions</label>
        <div className="prompt-gallery">
          {prompts.map(prompt => (
            <Tag
              key={prompt.text}
              closable={prompt.custom}
              onClose={prompt.custom ? event => {
                event.preventDefault();
                event.stopPropagation();
                removeCustomPrompt(prompt.text);
              } : undefined}
              onClick={() => {
                setSystemPrompt(prompt.text);
                updatePromptUsage(prompt.text);
              }}
              className="prompt-tag"
            >
              <span>{prompt.text}</span>
            </Tag>
          ))}
        </div>
      </div>

      {/* System Prompt */}
      <div className="system-prompt-section">
        <label className="section-label">Instruction</label>
        <textarea
          className="system-prompt-input"
          value={systemPrompt}
          onChange={e => setSystemPrompt(e.target.value)}
          placeholder="Summarize into bullet points and list action items."
        />
        <button
          className="btn-standard"
          onClick={handleProcess}
          disabled={isGenerating}
        >
          {isGenerating ? (
            <><LoadingOutlined /> Running AI...</>
          ) : (
            mode === 'per-file'
              ? `Run AI on ${completedJobs.length} transcript${completedJobs.length === 1 ? '' : 's'}`
              : 'Run AI on combined transcript'
          )}
        </button>
      </div>

      {/* Per-file LLM results */}
      {mode === 'per-file' && completedJobs.some(j => j.llmResult) && (
        <div style={{ marginTop: '1rem' }}>
          {completedJobs.filter(j => j.llmResult).map(job => (
            <div key={job.id} className="transcript-section" style={{ marginTop: '1rem' }}>
              <div className="transcript-header">
                <h3>AI result - {job.fileName}</h3>
                <div>
                  <button className="transcript-icon" onClick={() => onCopy(job.llmResult!)} title="Copy AI result to clipboard" aria-label={`Copy AI result for ${job.fileName}`}>
                    <FaCopy />
                  </button>
                  <button
                    className="transcript-icon"
                    onClick={() => {
                      const baseName = job.fileName.replace(/\.[^.]+$/, '');
                      onDownload(job.llmResult!, `${baseName}-llm-output.txt`);
                    }}
                    title="Download AI result as a text file"
                    aria-label={`Download AI result for ${job.fileName}`}
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
            <h3>AI result - combined transcripts</h3>
            <div>
              <button
                className="transcript-icon"
                onClick={() => {
                  const filtered = llmOutputRef.current?.getFilteredContent() || combinedResult;
                  onCopy(filtered);
                }}
                title="Copy combined AI result to clipboard"
                aria-label="Copy combined AI result to clipboard"
              >
                <FaCopy />
              </button>
              <button
                className="transcript-icon"
                onClick={() => {
                  const filtered = llmOutputRef.current?.getFilteredContent() || combinedResult;
                  onDownload(filtered, 'combined-llm-output.txt');
                }}
                title="Download combined AI result as a text file"
                aria-label="Download combined AI result as a text file"
              >
                <FaFileDownload />
              </button>
            </div>
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
