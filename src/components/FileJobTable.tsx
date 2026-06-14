// File job table — container for all file job rows with batch actions
import React, { useCallback, useEffect, useState } from 'react';
import JSZip from 'jszip';
import { FaFileDownload } from 'react-icons/fa';
import { BiSolidTrashAlt } from 'react-icons/bi';
import { TbChevronDown, TbChevronRight, TbFileTextAi, TbPlayerPauseFilled, TbPlayerPlayFilled } from 'react-icons/tb';
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
  onClearCompleted,
  onCopy,
  onDownload,
}) => {
  const completedJobs = jobs.filter(j => j.status === 'done');
  const pendingJobs = jobs.filter(j => j.status !== 'done');
  const hasPending = jobs.some(j => j.status === 'ready' || j.status === 'queued');
  const hasCompleted = completedJobs.length > 0;
  const isProcessing = globalStatus === 'processing';
  const isPaused = globalStatus === 'paused';
  const hasPendingActions = hasPending || isProcessing || isPaused;
  const [showCompleted, setShowCompleted] = useState(pendingJobs.length === 0);

  useEffect(() => {
    setShowCompleted(pendingJobs.length === 0);
  }, [pendingJobs.length]);

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

  const renderRows = (rows: FileJob[]) => rows.map(job => (
    <FileJobRow
      key={job.id}
      job={job}
      onStart={onStartJob}
      onRemove={onRemoveJob}
      onRetry={onRetryJob}
      onCopy={onCopy}
      onDownload={onDownload}
    />
  ));

  const renderPendingActions = () => (
    <div className="job-table-section-actions">
      {hasPending && !isProcessing && (
        <button className="btn-standard btn-primary-action" onClick={onStartAll} disabled={!isTranscriptionReady}>
          <TbFileTextAi />
          {isTranscriptionReady
            ? 'Transcribe all pending files'
            : 'Loading audio tools...'}
        </button>
      )}
      {isProcessing && (
        <button className="btn-standard" onClick={onPause}>
          <TbPlayerPauseFilled /> Pause after current step
        </button>
      )}
      {isPaused && (
        <button className="btn-standard" onClick={onResume}>
          <TbPlayerPlayFilled /> Resume transcription
        </button>
      )}
    </div>
  );

  const renderCompletedActions = () => (
    <div className="job-table-section-actions job-table-section-actions-inline">
      <button className="btn-standard btn-inline-action" onClick={handleDownloadAll}>
        <FaFileDownload /> Download transcripts
      </button>
      <button className="btn-standard btn-inline-action" onClick={onClearCompleted}>
        <BiSolidTrashAlt /> Clear transcribed files
      </button>
    </div>
  );

  return (
    <div className="job-table">
      {/* Job rows */}
      <div className="job-table-rows">
        {pendingJobs.length > 0 && (
          <section className="job-table-section job-table-section-pending" aria-label="Pending files">
            <div className="job-table-section-heading job-table-section-heading-with-actions">
              <span className="job-table-section-title">
                <span>Pending files</span>
                <small>{pendingJobs.length}</small>
              </span>
              {hasPendingActions && renderPendingActions()}
            </div>
            {renderRows(pendingJobs)}
          </section>
        )}

        {hasCompleted && (
          <section className="job-table-section job-table-section-completed" aria-label="Transcribed files">
            <div className="job-table-section-heading job-table-section-heading-with-actions">
              {pendingJobs.length > 0 ? (
                <button
                  className="job-table-section-toggle"
                  type="button"
                  onClick={() => setShowCompleted(prev => !prev)}
                  aria-expanded={showCompleted}
                >
                  {showCompleted ? <TbChevronDown /> : <TbChevronRight />}
                  <span>Transcribed files</span>
                  <small>{completedJobs.length}</small>
                </button>
              ) : (
                <span className="job-table-section-title">
                  <span>Transcribed files</span>
                  <small>{completedJobs.length}</small>
                </span>
              )}
              {renderCompletedActions()}
            </div>
            {showCompleted && renderRows(completedJobs)}
          </section>
        )}
      </div>
    </div>
  );
};

export default React.memo(FileJobTable);
