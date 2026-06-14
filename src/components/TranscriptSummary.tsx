import React from 'react';
import { LuFileAudio, LuFileVideo } from 'react-icons/lu';
import { buildTranscriptPreview } from '../utils/transcriptPreview';

interface TranscriptSummaryProps {
  fileName: string;
  mimeType: string;
  transcript?: string;
  expanded?: boolean;
}

const TranscriptSummary: React.FC<TranscriptSummaryProps> = ({
  fileName,
  mimeType,
  transcript,
  expanded = false,
}) => {
  const preview = buildTranscriptPreview(transcript);
  const isVideo = mimeType.startsWith('video/');
  const fullText = transcript?.trim() || preview.text;

  return (
    <div className={`transcript-summary-content ${expanded ? 'transcript-summary-content-expanded' : ''}`}>
      <div className="transcript-summary-file" title={fileName}>
        <span className="transcript-summary-file-icon">
          {isVideo ? <LuFileVideo /> : <LuFileAudio />}
        </span>
        <span className="transcript-summary-file-name">{fileName}</span>
        {!expanded && preview.remainingLabel && (
          <span className="transcript-summary-length">{preview.remainingLabel}</span>
        )}
      </div>
      <p className={`transcript-summary-text ${expanded ? 'is-expanded' : ''}`} title={preview.title}>
        {expanded ? fullText : preview.text}
      </p>
    </div>
  );
};

export default React.memo(TranscriptSummary);
