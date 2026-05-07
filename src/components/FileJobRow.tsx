// Individual file job row with expand/collapse for transcript
import React, { useState } from 'react';
import { FaCopy, FaFileDownload } from 'react-icons/fa';
import {
  LoadingOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  FileTextOutlined,
  ReloadOutlined,
  DownOutlined,
  RightOutlined,
  CustomerServiceOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import type { FileJob } from '../types';

interface FileJobRowProps {
  job: FileJob;
  onRemove: (id: string) => void;
  onStart: (id: string) => void;
  onRetry: (id: string) => void;
  onUpdateTranscript: (id: string, text: string) => void;
  onCopy: (text: string) => void;
  onDownload: (text: string, fileName: string) => void;
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  queued: { label: 'Queued', color: '#888' },
  converting: { label: 'Converting', color: '#bbb' },
  splitting: { label: 'Splitting', color: '#bbb' },
  transcribing: { label: 'Transcribing', color: '#ccc' },
  stitching: { label: 'Stitching', color: '#ccc' },
  done: { label: 'Done', color: 'var(--color-accent)' },
  error: { label: 'Error', color: 'var(--color-error)' },
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function countWords(text?: string): number {
  return text?.trim().split(/\s+/).filter(Boolean).length || 0;
}

const FileJobRow: React.FC<FileJobRowProps> = ({
  job,
  onRemove,
  onStart,
  onRetry,
  onUpdateTranscript,
  onCopy,
  onDownload,
}) => {
  const [expanded, setExpanded] = useState(false);
  const statusCfg = STATUS_CONFIG[job.status] || STATUS_CONFIG.queued;
  const isActive = ['converting', 'splitting', 'transcribing', 'stitching'].includes(job.status);
  const canRemove = job.status === 'queued' || job.status === 'done' || job.status === 'error';
  const isVideo = job.mimeType.startsWith('video/');
  const transcriptPreview = job.transcript?.trim();
  const wordCount = countWords(job.transcript);

  return (
    <div className={`job-row ${expanded ? 'job-row-expanded' : ''}`}>
      {/* Main row */}
      <div className="job-row-main" onClick={() => job.transcript && setExpanded(e => !e)}>
        {/* File icon + name */}
        <div className="job-row-file">
          <span className="job-row-icon">
            {isVideo ? <VideoCameraOutlined /> : <CustomerServiceOutlined />}
          </span>
          <span className="job-row-file-text">
            <span className="job-row-file-heading">
              <span className="job-row-name" title={job.fileName}>{job.fileName}</span>
              <span className="job-row-size">{formatSize(job.fileSize)}</span>
              {wordCount > 0 && (
                <span className="job-row-size">{wordCount.toLocaleString()} words</span>
              )}
            </span>
            {transcriptPreview && (
              <span className="job-row-preview" title={transcriptPreview}>
                {transcriptPreview}
              </span>
            )}
          </span>
        </div>

        {/* Progress bar */}
        <div className="job-row-progress-container">
          <div className="job-row-progress-bar">
            <div
              className={`job-row-progress-fill ${job.status === 'error' ? 'progress-error' : ''}`}
              style={{
                width: `${job.progress}%`,
                backgroundColor: statusCfg.color,
              }}
            />
          </div>
          {job.status === 'transcribing' && job.segmentCount && (
            <span className="job-row-segment-count">
              {job.segmentsTranscribed || 0}/{job.segmentCount}
            </span>
          )}
        </div>

        {/* Status */}
        <div className="job-row-status">
          <span className="status-pill" style={{ color: statusCfg.color }}>
            {isActive && <LoadingOutlined />}
            {job.status === 'done' && <CheckCircleOutlined />}
            {job.status === 'error' && <CloseCircleOutlined />}
            {statusCfg.label}
          </span>
        </div>

        {/* Actions */}
        <div className="job-row-actions" onClick={e => e.stopPropagation()}>
          {job.status === 'queued' && (
            <button
              className="transcript-icon"
              onClick={() => onStart(job.id)}
              title="Transcribe this file"
              aria-label={`Transcribe ${job.fileName}`}
            >
              <FileTextOutlined />
            </button>
          )}
          {job.transcript && (
            <>
              <button
                className="transcript-icon"
                onClick={() => onCopy(job.transcript!)}
                title="Copy this transcript to clipboard"
                aria-label={`Copy transcript for ${job.fileName}`}
              >
                <FaCopy />
              </button>
              <button
                className="transcript-icon"
                onClick={() => {
                  const baseName = job.fileName.replace(/\.[^.]+$/, '');
                  onDownload(job.transcript!, `${baseName}-transcript.txt`);
                }}
                title="Download this transcript as a text file"
                aria-label={`Download transcript for ${job.fileName}`}
              >
                <FaFileDownload />
              </button>
            </>
          )}
          {job.status === 'error' && (
            <button
              className="transcript-icon"
              onClick={() => onRetry(job.id)}
              title="Retry transcription for this file"
              aria-label={`Retry transcription for ${job.fileName}`}
            >
              <ReloadOutlined />
            </button>
          )}
          {canRemove && (
            <button
              className="transcript-icon transcript-icon-danger"
              onClick={() => onRemove(job.id)}
              title="Remove this file from the list"
              aria-label={`Remove ${job.fileName} from the list`}
            >
              <DeleteOutlined />
            </button>
          )}
          {job.transcript && (
            <button
              className="transcript-icon expand-toggle"
              onClick={() => setExpanded(e => !e)}
              title={expanded ? "Hide full transcript editor" : "Show full transcript editor"}
              aria-label={`${expanded ? 'Hide' : 'Show'} full transcript editor for ${job.fileName}`}
            >
              {expanded ? <DownOutlined /> : <RightOutlined />}
            </button>
          )}
        </div>
      </div>

      {/* Error message */}
      {job.status === 'error' && job.error && (
        <div className="job-row-error">
          {job.error}
        </div>
      )}

      {/* Expanded transcript */}
      {expanded && job.transcript && (
        <div className="job-row-transcript">
          <textarea
            className="transcript-output transcript-editable"
            value={job.transcript}
            onChange={(e) => onUpdateTranscript(job.id, e.target.value)}
          />
        </div>
      )}
    </div>
  );
};

export default React.memo(FileJobRow);
