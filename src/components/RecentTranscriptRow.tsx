import React, { useState } from 'react';
import { FaCopy, FaFileDownload } from 'react-icons/fa';
import { BiSolidTrashAlt } from 'react-icons/bi';
import { TbChevronDown, TbChevronRight } from 'react-icons/tb';
import TranscriptSummary from './TranscriptSummary';
import type { FileJob, TranscriptOutputOptions as OutputOptions } from '../types';
import { formatTranscript } from '../transcripts/output';
import { hasHiddenTranscriptPreview } from '../utils/transcriptPreview';

interface RecentTranscriptRowProps {
  job: FileJob;
  outputOptions: OutputOptions;
  onRemove: (id: string) => void;
  onCopy: (text: string) => void;
  onDownload: (text: string, fileName: string) => void;
}

const RecentTranscriptRow: React.FC<RecentTranscriptRowProps> = ({
  job,
  outputOptions,
  onRemove,
  onCopy,
  onDownload,
}) => {
  const [expanded, setExpanded] = useState(false);
  const transcript = formatTranscript(job, outputOptions);
  const canExpandTranscript = Boolean(job.transcriptCues?.length) || hasHiddenTranscriptPreview(job.transcript);
  const isTranscriptExpanded = canExpandTranscript && expanded;
  const toggleTranscript = () => {
    if (canExpandTranscript) setExpanded(e => !e);
  };

  return (
    <div className={`recent-transcript-row ${isTranscriptExpanded ? 'recent-transcript-row-expanded' : ''}`}>
      <div className={`recent-transcript-main ${canExpandTranscript ? 'is-expandable' : ''}`} onClick={toggleTranscript}>
        <TranscriptSummary
          fileName={job.fileName}
          mimeType={job.mimeType}
          transcript={transcript}
          expanded={isTranscriptExpanded}
        />

        <div className="recent-transcript-actions" onClick={e => e.stopPropagation()}>
          {job.transcript && (
            <>
              <button
                className="transcript-icon action-copy"
                onClick={() => onCopy(transcript)}
                title="Copy transcript"
                aria-label={`Copy transcript from ${job.fileName}`}
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
                aria-label={`Download transcript from ${job.fileName}`}
              >
                <FaFileDownload />
              </button>
            </>
          )}
          <button
            className="transcript-icon transcript-icon-danger action-delete"
            onClick={() => onRemove(job.id)}
            title="Remove transcript"
            aria-label={`Remove transcript from ${job.fileName}`}
          >
            <BiSolidTrashAlt />
          </button>
          {canExpandTranscript && (
            <button
              className="transcript-icon expand-toggle action-expand"
              onClick={toggleTranscript}
              title={isTranscriptExpanded ? 'Show less transcript' : 'Show full transcript'}
              aria-label={`${isTranscriptExpanded ? 'Show less transcript for' : 'Show full transcript from'} ${job.fileName}`}
            >
              {isTranscriptExpanded ? <TbChevronDown /> : <TbChevronRight />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default React.memo(RecentTranscriptRow);
