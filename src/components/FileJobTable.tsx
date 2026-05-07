// File job table — container for all file job rows with batch actions
import React, { useCallback } from 'react';
import JSZip from 'jszip';
import { FaFileDownload } from 'react-icons/fa';
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  ClearOutlined,
} from '@ant-design/icons';
import FileJobRow from './FileJobRow';
import type { FileJob } from '../types';

interface FileJobTableProps {
  jobs: FileJob[];
  globalStatus: 'idle' | 'processing' | 'paused';
  isTranscriptionReady: boolean;
  onStartAll: () => void;
  onPause: () => void;
  onResume: () => void;
  onStartJob: (id: string) => void;
  onRemoveJob: (id: string) => void;
  onRetryJob: (id: string) => void;
  onUpdateTranscript: (id: string, text: string) => void;
  onClearCompleted: () => void;
  onCopy: (text: string) => void;
  onDownload: (text: string, fileName: string) => void;
}

const FileJobTable: React.FC<FileJobTableProps> = ({
  jobs,
  globalStatus,
  isTranscriptionReady,
  onStartAll,
  onPause,
  onResume,
  onStartJob,
  onRemoveJob,
  onRetryJob,
  onUpdateTranscript,
  onClearCompleted,
  onCopy,
  onDownload,
}) => {
  const completedJobs = jobs.filter(j => j.status === 'done');
  const hasQueued = jobs.some(j => j.status === 'queued');
  const hasCompleted = completedJobs.length > 0;
  const isProcessing = globalStatus === 'processing';
  const isPaused = globalStatus === 'paused';

  const handleDownloadAll = useCallback(async () => {
    if (completedJobs.length === 0) return;

    if (completedJobs.length === 1) {
      // Single file — just download directly
      const job = completedJobs[0];
      const baseName = job.fileName.replace(/\.[^.]+$/, '');
      onDownload(job.transcript!, `${baseName}-transcript.txt`);
      return;
    }

    // Multiple files — create zip
    const zip = new JSZip();
    for (const job of completedJobs) {
      const baseName = job.fileName.replace(/\.[^.]+$/, '');
      zip.file(`${baseName}-transcript.txt`, job.transcript || '');
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `transcripts-${new Date().toISOString().slice(0, 10)}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [completedJobs, onDownload]);

  return (
    <div className="job-table">
      {/* Batch action bar */}
      <div className="job-table-actions">
        <div className="job-table-stats">
          <span>{completedJobs.length} of {jobs.length} files transcribed</span>
        </div>
        <div className="job-table-buttons">
          {hasQueued && !isProcessing && (
            <button className="btn-standard" onClick={onStartAll} disabled={!isTranscriptionReady}>
              <PlayCircleOutlined />
              {isTranscriptionReady
                ? 'Transcribe'
                : 'Preparing...'}
            </button>
          )}
          {isProcessing && (
            <button className="btn-standard" onClick={onPause}>
              <PauseCircleOutlined /> Pause
            </button>
          )}
          {isPaused && (
            <button className="btn-standard" onClick={onResume}>
              <PlayCircleOutlined /> Resume
            </button>
          )}
          {hasCompleted && (
            <>
              <button className="btn-standard" onClick={handleDownloadAll}>
                <FaFileDownload /> Download
              </button>
              <button className="btn-standard btn-danger" onClick={onClearCompleted}>
                <ClearOutlined /> Clear done
              </button>
            </>
          )}
        </div>
      </div>

      {/* Job rows */}
      <div className="job-table-rows">
        {jobs.map(job => (
          <FileJobRow
            key={job.id}
            job={job}
            onStart={onStartJob}
            onRemove={onRemoveJob}
            onRetry={onRetryJob}
            onUpdateTranscript={onUpdateTranscript}
            onCopy={onCopy}
            onDownload={onDownload}
          />
        ))}
      </div>
    </div>
  );
};

export default React.memo(FileJobTable);
