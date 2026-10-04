// Shared types for multi-file transcription pipeline

export interface SegmentInfo {
  filename: string;
  size: number;
  url?: string;
}

export type FileJobStatus =
  | 'ready'
  | 'queued'
  | 'converting'
  | 'splitting'
  | 'transcribing'
  | 'stitching'
  | 'done'
  | 'error';

export interface FileJob {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  status: FileJobStatus;
  progress: number;           // 0–100 within current step
  segmentCount?: number;
  segmentsTranscribed?: number;
  transcript?: string;
  transcriptCues?: TranscriptCue[];
  llmResult?: string;
  error?: string;
  addedAt: number;
}

export interface TranscriptCue {
  text: string;
  start?: number;
  end?: number;
  speaker?: string;
}

export interface TranscriptionResult {
  text: string;
  cues?: TranscriptCue[];
}

export interface TranscriptOutputOptions {
  timestamps: boolean;
  speakers: boolean;
}

export interface AudioChunk {
  data: Uint8Array;
  offset: number;
  keepStart: number;
  keepEnd: number;
}

export type ApiProvider = 'groq' | 'openai' | 'google';

export interface ApiConfig {
  selectedApi: ApiProvider;
  groqKey: string;
  openaiKey: string;
  googleKey: string;
  groqModel: string;
  openaiModel: string;
  googleModel: string;
  maxFileSizeMB: number;
  sampleRate: number;
}

export interface LogMessage {
  text: string;
  type: 'info' | 'error';
  html?: boolean;
}
