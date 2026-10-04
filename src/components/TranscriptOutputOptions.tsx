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
  return (
    <div className="transcript-output-options" aria-label="Transcript output">
      <label className="transcript-output-option" title={hasTimes ? 'Show or hide saved timestamps instantly' : 'Timestamps are not available in these transcripts'}>
        <Switch size="small" checked={options.timestamps && hasTimes} disabled={!hasTimes}
          onChange={timestamps => onChange({ ...options, timestamps })} aria-label="Show timestamps" />
        <span>Timestamps</span>
      </label>
      <label className="transcript-output-option" title={hasSpeakers ? 'Show or hide saved speaker labels instantly. Labels restart for each audio part.' : 'Speaker labels are not available in these transcripts'}>
        <Switch size="small" checked={options.speakers && hasSpeakers} disabled={!hasSpeakers}
          onChange={speakers => onChange({ ...options, speakers })} aria-label="Show speakers" />
        <span>Speakers</span>
      </label>
    </div>
  );
}
