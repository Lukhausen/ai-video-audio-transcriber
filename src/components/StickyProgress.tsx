// Sticky progress bar shown during batch processing
import React from 'react';
import { LoadingOutlined } from '@ant-design/icons';
import { RiCheckboxCircleLine } from 'react-icons/ri';
import { TbPlayerPauseFilled } from 'react-icons/tb';

interface StickyProgressProps {
  completedCount: number;
  totalCount: number;
  globalStatus: 'idle' | 'processing' | 'paused';
  currentFileName?: string;
}

const StickyProgress: React.FC<StickyProgressProps> = ({
  completedCount,
  totalCount,
  globalStatus,
  currentFileName,
}) => {
  if (totalCount === 0 || globalStatus === 'idle') return null;

  const pct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const allDone = completedCount === totalCount;

  return (
    <div className="sticky-progress">
      <div className="sticky-progress-bar">
        <div
          className={`sticky-progress-fill ${allDone ? 'sticky-progress-fill-success' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="sticky-progress-info">
        <span className="sticky-progress-status">
          {allDone ? (
            <><RiCheckboxCircleLine style={{ color: 'var(--color-accent)' }} /> All transcripts ready</>
          ) : globalStatus === 'paused' ? (
            <><TbPlayerPauseFilled style={{ color: '#faad14' }} /> Transcription paused</>
          ) : (
            <><LoadingOutlined /> Transcribing files...</>
          )}
        </span>
        <span className="sticky-progress-count">
          {completedCount}/{totalCount} complete
          {currentFileName && !allDone && (
            <span className="sticky-progress-current"> · {currentFileName}</span>
          )}
        </span>
      </div>
    </div>
  );
};

export default React.memo(StickyProgress);
