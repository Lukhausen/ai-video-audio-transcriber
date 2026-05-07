// Batch LLM panel — supports per-file and combined LLM processing
import React, { useState } from 'react';
import { LoadingOutlined } from '@ant-design/icons';
import { FaCopy, FaFileDownload } from 'react-icons/fa';
import Groq from 'groq-sdk';
import OpenAI from 'openai';
import { Tag } from 'antd';
import CollapsibleLLMOutput, { CollapsibleLLMOutputRef } from './CollapsibleLLMOutput';
import { usePromptGallery } from '../hooks/usePromptGallery';
import type { FileJob, ApiConfig } from '../types';

interface BatchLLMPanelProps {
  jobs: FileJob[];
  apiConfig: ApiConfig;
  selectedApi: 'groq' | 'openai';
  groqKey: string;
  openaiKey: string;
  openAiChatModel: string;
  groqChatModel: string;
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

    // Save custom prompt
    if (systemPrompt.trim()) {
      addCustomPrompt(systemPrompt);
    }

    setIsGenerating(true);

    try {
      if (mode === 'per-file') {
        for (const job of completedJobs) {
          onLog(`[LLM] Processing "${job.fileName}"...`, 'info');
          try {
            const result = await callLLM(job.transcript!);
            onSetLLMResult(job.id, result);
            onLog(`[LLM] ✓ "${job.fileName}" done.`, 'info');
          } catch (err: any) {
            onLog(`[LLM] Error on "${job.fileName}": ${err.message}`, 'error');
          }
        }
      } else {
        // Combined mode
        const combined = completedJobs
          .map(j => `=== ${j.fileName} ===\n\n${j.transcript}`)
          .join('\n\n---\n\n');
        onLog('[LLM] Processing combined transcript...', 'info');
        const result = await callLLM(combined);
        setCombinedResult(result);
        onLog('[LLM] ✓ Combined processing done.', 'info');
      }
    } catch (err: any) {
      onLog(`[LLM] Error: ${err.message}`, 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  if (completedJobs.length === 0) return null;

  return (
    <div className="llm-panel">
      <div className="llm-panel-header">
        <div className="llm-panel-title">
          <h3>LLM Post-Processing</h3>
        </div>
        <div className="llm-panel-controls">
          <div className="model-selector">
            <label>Mode:</label>
            <select
              className="input-standard"
              value={mode}
              onChange={e => setMode(e.target.value as 'per-file' | 'combined')}
            >
              <option value="per-file">Per-file ({completedJobs.length} files)</option>
              <option value="combined">Combined</option>
            </select>
          </div>
        </div>
      </div>

      {/* Prompt Gallery */}
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
                updatePromptUsage(idx);
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
        <label className="section-label">System Prompt</label>
        <textarea
          className="system-prompt-input"
          value={systemPrompt}
          onChange={e => setSystemPrompt(e.target.value)}
          placeholder="Enter system instructions for the LLM..."
        />
        <button
          className="btn-standard"
          onClick={handleProcess}
          disabled={isGenerating}
        >
          {isGenerating ? (
            <><LoadingOutlined /> Processing...</>
          ) : (
            `Process with ${selectedApi} (${mode === 'per-file' ? `${completedJobs.length} files` : 'combined'})`
          )}
        </button>
      </div>

      {/* Per-file LLM results */}
      {mode === 'per-file' && completedJobs.some(j => j.llmResult) && (
        <div style={{ marginTop: '1rem' }}>
          {completedJobs.filter(j => j.llmResult).map(job => (
            <div key={job.id} className="transcript-section" style={{ marginTop: '1rem' }}>
              <div className="transcript-header">
                <h3>LLM Output — {job.fileName}</h3>
                <div>
                  <button className="transcript-icon" onClick={() => onCopy(job.llmResult!)} title="Copy">
                    <FaCopy />
                  </button>
                  <button
                    className="transcript-icon"
                    onClick={() => {
                      const baseName = job.fileName.replace(/\.[^.]+$/, '');
                      onDownload(job.llmResult!, `${baseName}-llm-output.txt`);
                    }}
                    title="Download"
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
            <h3>LLM Output — Combined</h3>
            <div>
              <button
                className="transcript-icon"
                onClick={() => {
                  const filtered = llmOutputRef.current?.getFilteredContent() || combinedResult;
                  onCopy(filtered);
                }}
                title="Copy"
              >
                <FaCopy />
              </button>
              <button
                className="transcript-icon"
                onClick={() => {
                  const filtered = llmOutputRef.current?.getFilteredContent() || combinedResult;
                  onDownload(filtered, 'combined-llm-output.txt');
                }}
                title="Download"
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
