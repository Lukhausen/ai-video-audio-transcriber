import { Switch } from 'antd';
import type { FileJob, TranscriptOutputOptions as OutputOptions } from '../types';
import { hasTimestamp } from '../transcripts/output';

interface Props {
  jobs: FileJob[];
  options: OutputOptions;
  onChange: (options: OutputOptions) => void;
}

export default function TranscriptOutputOptions({ jobs, options, onChange }: Props) {
  const cues = jobs.flatMap(job => job.transcriptCues || []);
  const hasTimes = cues.some(hasTimestamp);
  const hasSpeakers = cues.some(cue => cue.speaker);
  if (!hasTimes && !hasSpeakers) return null;
  return (
    <div className="transcript-output-options" aria-label="Transcript output">
      {hasTimes && (
        <label className="transcript-output-option" title="Show or hide saved timestamps instantly">
          <Switch size="small" checked={options.timestamps}
            onChange={timestamps => onChange({ ...options, timestamps })} aria-label="Show timestamps" />
          <span>Timestamps</span>
        </label>
      )}
      {hasSpeakers && (
        <label className="transcript-output-option" title="Show or hide saved speaker labels instantly. Labels restart for each audio part.">
          <Switch size="small" checked={options.speakers}
            onChange={speakers => onChange({ ...options, speakers })} aria-label="Show speakers" />
          <span>Speakers</span>
        </label>
      )}
    </div>
  );
}
