// Shared types for multi-file transcription pipeline

export interface SegmentInfo {
  filename: string;
  size: number;
  url?: string;
}

export type FileJobStatus =
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
  llmResult?: string;
  error?: string;
  addedAt: number;
}

export interface ApiConfig {
  selectedApi: 'groq' | 'openai';
  groqKey: string;
  openaiKey: string;
  groqModel: string;
  openaiModel: string;
  maxFileSizeMB: number;
  sampleRate: number;
}

export interface LogMessage {
  text: string;
  type: 'info' | 'error';
  html?: boolean;
}
