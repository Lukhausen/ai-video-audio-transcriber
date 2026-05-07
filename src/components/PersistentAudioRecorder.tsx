import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioOutlined,
  DeleteOutlined,
  FileTextOutlined,
  LoadingOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  StopOutlined,
} from '@ant-design/icons';
import {
  CachedRecording,
  deleteCachedRecording,
  deleteDraftRecording,
  getDraftRecording,
  saveCachedRecording,
} from '../utils/recordingCache';

interface PersistentAudioRecorderProps {
  completedRecordingFileNames: string[];
  onRecordingReady: (file: File, shouldTranscribeNow?: boolean) => void;
  onLog: (msg: string, type?: 'info' | 'error') => void;
}

function formatRecordingTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function createRecordingName(createdAt = Date.now(), extension = 'webm'): string {
  const date = new Date(createdAt);
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0'),
  ].join('-');

  return `Recording_${stamp}.${extension}`;
}

function getRecordingMimeType(): string {
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
  if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4';
  return '';
}

function fileFromRecording(recording: CachedRecording): File {
  return new File([recording.blob], recording.fileName, {
    type: recording.mimeType || recording.blob.type || 'audio/webm',
    lastModified: recording.createdAt,
  });
}

const PersistentAudioRecorder: React.FC<PersistentAudioRecorderProps> = ({
  completedRecordingFileNames,
  onRecordingReady,
  onLog,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [draftRecording, setDraftRecording] = useState<CachedRecording | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const activeRecordingRef = useRef<CachedRecording | null>(null);
  const startedAtRef = useRef(0);
  const timerRef = useRef<number | undefined>();
  const previewUrl = useMemo(() => (
    draftRecording?.blob ? URL.createObjectURL(draftRecording.blob) : ''
  ), [draftRecording]);

  const refreshRecordings = async () => {
    const draft = await getDraftRecording();
    setDraftRecording(draft);
  };

  useEffect(() => {
    refreshRecordings().catch(() => undefined);

    return () => {
      window.clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach(track => track.stop());
      audioContextRef.current?.close();
    };
  }, []);

  useEffect(() => {
    setIsPreviewPlaying(false);

    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    if (completedRecordingFileNames.length === 0) return;

    getDraftRecording()
      .then(draft => {
        if (!draft || !completedRecordingFileNames.includes(draft.fileName)) return;
        return deleteCachedRecording(draft.id).then(() => setDraftRecording(undefined));
      })
      .catch(() => undefined);
  }, [completedRecordingFileNames]);

  const persistActiveRecording = async (status: CachedRecording['status'] = 'draft') => {
    const active = activeRecordingRef.current;
    if (!active || chunksRef.current.length === 0) return;

    const blob = new Blob(chunksRef.current, { type: active.mimeType });
    const durationMs = Date.now() - startedAtRef.current;
    const record: CachedRecording = { ...active, blob, durationMs, status };

    activeRecordingRef.current = record;
    await saveCachedRecording(record);
    await refreshRecordings();
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      onLog('Recording is not supported in this browser.', 'error');
      return;
    }

    setIsLoading(true);

    try {
      await deleteDraftRecording();
      setDraftRecording(undefined);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      const mimeType = getRecordingMimeType();
      const createdAt = Date.now();
      const fileName = createRecordingName(createdAt, mimeType.includes('mp4') ? 'm4a' : 'webm');
      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioContextCtor();
      const source = audioContext.createMediaStreamSource(stream);
      const highPass = audioContext.createBiquadFilter();
      const compressor = audioContext.createDynamicsCompressor();
      const destination = audioContext.createMediaStreamDestination();

      highPass.type = 'highpass';
      highPass.frequency.value = 80;
      compressor.threshold.value = -32;
      compressor.knee.value = 24;
      compressor.ratio.value = 8;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;

      source.connect(highPass);
      highPass.connect(compressor);
      compressor.connect(destination);

      const recorder = new MediaRecorder(destination.stream, mimeType ? { mimeType } : undefined);

      streamRef.current = stream;
      audioContextRef.current = audioContext;
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      startedAtRef.current = createdAt;
      activeRecordingRef.current = {
        id: `recording-${createdAt}`,
        fileName,
        mimeType: mimeType || 'audio/webm',
        blob: new Blob([], { type: mimeType || 'audio/webm' }),
        createdAt,
        durationMs: 0,
        status: 'draft',
      };

      recorder.ondataavailable = event => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
          if (recorder.state === 'recording') {
            persistActiveRecording('draft').catch(() => onLog('Could not cache the latest recording chunk.', 'error'));
          }
        }
      };

      recorder.onstop = async () => {
        try {
          await persistActiveRecording('draft');
          const saved = activeRecordingRef.current;
          if (saved?.blob.size) {
            onRecordingReady(fileFromRecording({ ...saved, status: 'draft' }));
            setDraftRecording(undefined);
            onLog(`Saved recording "${saved.fileName}".`, 'info');
          }
        } catch (err: any) {
          onLog(`Could not save recording: ${err.message}`, 'error');
        } finally {
          setIsRecording(false);
          setElapsedMs(0);
          activeRecordingRef.current = null;
          chunksRef.current = [];
          streamRef.current?.getTracks().forEach(track => track.stop());
          streamRef.current = null;
          audioContextRef.current?.close();
          audioContextRef.current = null;
          window.clearInterval(timerRef.current);
        }
      };

      recorder.start(1000);
      setElapsedMs(0);
      setIsRecording(true);
      timerRef.current = window.setInterval(() => {
        setElapsedMs(Date.now() - startedAtRef.current);
      }, 250);
    } catch (err: any) {
      onLog(`Could not start recording: ${err.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.requestData();
    mediaRecorderRef.current?.stop();
  };

  const stopPreview = () => {
    previewAudioRef.current?.pause();
    if (previewAudioRef.current) {
      previewAudioRef.current.currentTime = 0;
    }
    setIsPreviewPlaying(false);
  };

  const togglePreview = async () => {
    const audio = previewAudioRef.current;
    if (!audio) return;

    if (isPreviewPlaying) {
      audio.pause();
      return;
    }

    try {
      await audio.play();
    } catch (err: any) {
      onLog(`Could not play recovered recording: ${err.message}`, 'error');
    }
  };

  const loadRecording = (recording: CachedRecording, shouldTranscribeNow = false) => {
    stopPreview();
    onRecordingReady(fileFromRecording(recording), shouldTranscribeNow);
    setDraftRecording(undefined);
    onLog(`Loaded recording "${recording.fileName}".`, 'info');
  };

  const deleteRecording = async (id: string) => {
    stopPreview();
    await deleteCachedRecording(id);
    await refreshRecordings();
  };

  return (
    <div className="persistent-recorder">
      <div className="persistent-recorder-controls">
        {isRecording ? (
          <button className="btn-standard" onClick={stopRecording}>
            <StopOutlined /> Stop recording
          </button>
        ) : (
          <button className="btn-standard" onClick={startRecording} disabled={isLoading}>
            {isLoading ? <LoadingOutlined /> : <AudioOutlined />}
            Record audio
          </button>
        )}
        <span className="persistent-recorder-time">{formatRecordingTime(elapsedMs)}</span>
      </div>

      {!isRecording && draftRecording && (
        <div className="recent-recordings">
          <div className="recent-recording recent-recording-draft">
            <span>
              Recovered recording
              <small>{formatRecordingTime(draftRecording.durationMs)}</small>
            </span>
            <div>
              <audio
                ref={previewAudioRef}
                src={previewUrl}
                onPlay={() => setIsPreviewPlaying(true)}
                onPause={() => setIsPreviewPlaying(false)}
                onEnded={() => setIsPreviewPlaying(false)}
              />
              <button
                className="transcript-icon"
                onClick={togglePreview}
                title={isPreviewPlaying ? "Pause recovered recording preview" : "Play recovered recording preview"}
                aria-label={isPreviewPlaying ? "Pause recovered recording preview" : "Play recovered recording preview"}
              >
                {isPreviewPlaying ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
              </button>
              <button
                className="transcript-icon recent-recording-add"
                onClick={() => loadRecording(draftRecording, true)}
                title="Transcribe recovered recording"
                aria-label="Transcribe recovered recording"
              >
                <FileTextOutlined />
              </button>
              <button className="transcript-icon transcript-icon-danger" onClick={() => deleteRecording(draftRecording.id)} title="Delete recovered recording">
                <DeleteOutlined />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PersistentAudioRecorder;
