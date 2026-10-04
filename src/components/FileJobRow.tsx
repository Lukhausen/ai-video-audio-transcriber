// Individual file job row with expand/collapse for transcript
import React, { useState } from 'react';
import { FaCopy, FaFileDownload } from 'react-icons/fa';
import { BiSolidTrashAlt } from 'react-icons/bi';
import { PiArrowClockwiseBold } from 'react-icons/pi';
import { LuFileAudio, LuFileVideo } from 'react-icons/lu';
import { RiCheckboxCircleLine, RiCloseCircleLine } from 'react-icons/ri';
import { TbChevronDown, TbChevronRight, TbFileTextAi } from 'react-icons/tb';
import { LoadingOutlined } from '@ant-design/icons';
import TranscriptSummary from './TranscriptSummary';
import type { FileJob, TranscriptOutputOptions } from '../types';
import { formatTranscript } from '../transcripts/output';
import { hasHiddenTranscriptPreview } from '../utils/transcriptPreview';

interface FileJobRowProps {
  job: FileJob;
  outputOptions: TranscriptOutputOptions;
  onRemove: (id: string) => void;
  onStart: (id: string) => void;
  onRetry: (id: string) => void;
  onCopy: (text: string) => void;
  onDownload: (text: string, fileName: string) => void;
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  ready: { label: 'Ready', color: '#9a9a9a' },
  queued: { label: 'Waiting', color: '#888' },
  converting: { label: 'Preparing audio', color: '#bbb' },
  splitting: { label: 'Creating chunks', color: '#bbb' },
  transcribing: { label: 'Transcribing', color: '#ccc' },
  stitching: { label: 'Finishing transcript', color: '#ccc' },
  done: { label: 'Transcribed', color: 'var(--color-text-tertiary)' },
  error: { label: 'Error', color: 'var(--color-error)' },
};

const FileJobRow: React.FC<FileJobRowProps> = ({
  job,
  outputOptions,
  onRemove,
  onStart,
  onRetry,
  onCopy,
  onDownload,
}) => {
  const [expanded, setExpanded] = useState(false);
  const transcript = formatTranscript(job, outputOptions);
  const statusCfg = STATUS_CONFIG[job.status] || STATUS_CONFIG.queued;
  const isActive = ['converting', 'splitting', 'transcribing', 'stitching'].includes(job.status);
  const canRemove = job.status === 'ready' || job.status === 'queued' || job.status === 'done' || job.status === 'error';
  const isVideo = job.mimeType.startsWith('video/');
  const hasTranscript = Boolean(job.transcript?.trim());
  const showTranscriptSummary = job.status === 'done' && hasTranscript;
  const canExpandTranscript = showTranscriptSummary && hasHiddenTranscriptPreview(transcript);
  const isTranscriptExpanded = canExpandTranscript && expanded;
  const actionLayoutClass = hasTranscript ? 'job-row-actions-grid' : 'job-row-actions-compact';
  const toggleTranscript = () => {
    if (canExpandTranscript) setExpanded(e => !e);
  };

  return (
    <div className={`job-row ${showTranscriptSummary ? 'job-row-transcript-first' : ''} ${isTranscriptExpanded ? 'job-row-expanded' : ''}`}>
      {/* Main row */}
      <div className={`job-row-main ${canExpandTranscript ? 'is-expandable' : ''}`} onClick={toggleTranscript}>
        {/* File icon + name */}
        <div className={`job-row-file ${showTranscriptSummary ? 'job-row-file-transcript-summary' : ''}`}>
          {showTranscriptSummary ? (
            <TranscriptSummary
              fileName={job.fileName}
              mimeType={job.mimeType}
              transcript={transcript}
              expanded={isTranscriptExpanded}
            />
          ) : (
            <>
              <span className="job-row-icon">
                {isVideo ? <LuFileVideo /> : <LuFileAudio />}
              </span>
              <span className="job-row-file-text">
                <span className="job-row-file-heading">
                  <span className="job-row-name" title={job.fileName}>{job.fileName}</span>
                </span>
              </span>
            </>
          )}
        </div>

        {/* Progress bar */}
        {!showTranscriptSummary && (
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
        )}

        {/* Status */}
        <div className="job-row-status">
          <span className="status-pill" style={{ color: statusCfg.color }}>
            {isActive && <LoadingOutlined />}
            {job.status === 'done' && <RiCheckboxCircleLine className="status-icon-success" />}
            {job.status === 'error' && <RiCloseCircleLine />}
            {statusCfg.label}
          </span>
        </div>

        {/* Actions */}
        <div className={`job-row-actions ${actionLayoutClass}`} onClick={e => e.stopPropagation()}>
          {(job.status === 'ready' || job.status === 'queued') && (
            <button
              className="transcript-icon action-transcribe"
              onClick={() => onStart(job.id)}
              title="Transcribe only this file"
              aria-label={`Transcribe only ${job.fileName}`}
            >
              <TbFileTextAi />
              <span className="icon-button-label">Transcribe</span>
            </button>
          )}
          {job.transcript && (
            <>
              <button
                className="transcript-icon action-copy"
                onClick={() => onCopy(transcript)}
                title="Copy transcript"
                aria-label={`Copy transcript for ${job.fileName}`}
              >
                <FaCopy />
              </button>
              <button
                className="transcript-icon action-download"
                onClick={() => {
                  const baseName = job.fileName.replace(/\.[^.]+$/, '');
                  onDownload(transcript, `${baseName}-transcript.txt`);
                }}
                title="Download transcript"
                aria-label={`Download transcript for ${job.fileName}`}
              >
                <FaFileDownload />
              </button>
            </>
          )}
          {job.status === 'error' && (
            <button
              className={`transcript-icon action-retry${job.transcript ? ' action-retry-with-transcript' : ''}`}
              onClick={() => onRetry(job.id)}
              title="Retry this file"
              aria-label={`Retry transcription for ${job.fileName}`}
            >
              <PiArrowClockwiseBold />
            </button>
          )}
          {canRemove && (
            <button
              className={`transcript-icon transcript-icon-danger action-delete${job.status === 'error' && job.transcript ? ' action-delete-after-retry' : ''}`}
              onClick={() => onRemove(job.id)}
              title="Remove file"
              aria-label={`Remove ${job.fileName} from the list`}
            >
              <BiSolidTrashAlt />
            </button>
          )}
          {canExpandTranscript && (
            <button
              className="transcript-icon expand-toggle action-expand"
              onClick={toggleTranscript}
              title={isTranscriptExpanded ? "Show less transcript" : "Show full transcript"}
              aria-label={`${isTranscriptExpanded ? 'Show less transcript for' : 'Show full transcript for'} ${job.fileName}`}
            >
              {isTranscriptExpanded ? <TbChevronDown /> : <TbChevronRight />}
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

    </div>
  );
};

export default React.memo(FileJobRow);
