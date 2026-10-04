import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import { BiSolidTrashAlt } from 'react-icons/bi';
import { TbFileTextAi, TbPlayerPauseFilled, TbPlayerPlayFilled, TbPlayerStopFilled } from 'react-icons/tb';
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

type WindowWithWebkitAudioContext = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
  const [showRecoveredNotice, setShowRecoveredNotice] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const activeRecordingRef = useRef<CachedRecording | null>(null);
  const startedAtRef = useRef(0);
  const timerRef = useRef<number | undefined>();
  const animationFrameRef = useRef<number | undefined>();
  const previewUrl = useMemo(() => (
    draftRecording?.blob ? URL.createObjectURL(draftRecording.blob) : ''
  ), [draftRecording]);

  const refreshRecordings = async (highlightRecovered = false) => {
    const draft = await getDraftRecording();
    setDraftRecording(draft);
    if (highlightRecovered && draft) {
      setShowRecoveredNotice(true);
    }
  };

  useEffect(() => {
    refreshRecordings(true).catch(() => undefined);

    return () => {
      window.clearInterval(timerRef.current);
      window.cancelAnimationFrame(animationFrameRef.current || 0);
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

  const startWaveform = (analyser: AnalyserNode) => {
    const canvas = waveformCanvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    const buffer = new Uint8Array(analyser.fftSize);

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(rect.width * scale));
      const height = Math.max(1, Math.round(rect.height * scale));

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      analyser.getByteTimeDomainData(buffer);
      context.clearRect(0, 0, width, height);
      context.strokeStyle = 'rgba(94, 170, 40, 0.95)';
      context.lineWidth = Math.max(2, scale * 1.8);
      context.beginPath();

      const sliceWidth = width / buffer.length;
      const centerY = height / 2;
      const amplitude = height * 1.25;
      for (let i = 0; i < buffer.length; i += 1) {
        const x = i * sliceWidth;
        const normalized = (buffer[i] - 128) / 128;
        const y = Math.min(height - scale, Math.max(scale, centerY + normalized * amplitude));
        if (i === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      }

      context.stroke();
      animationFrameRef.current = window.requestAnimationFrame(draw);
    };

    window.cancelAnimationFrame(animationFrameRef.current || 0);
    draw();
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
      const AudioContextCtor = window.AudioContext || (window as WindowWithWebkitAudioContext).webkitAudioContext;
      if (!AudioContextCtor) {
        throw new Error('Audio processing is not supported in this browser.');
      }
      const audioContext = new AudioContextCtor();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      const highPass = audioContext.createBiquadFilter();
      const compressor = audioContext.createDynamicsCompressor();
      const destination = audioContext.createMediaStreamDestination();

      analyser.fftSize = 512;
      highPass.type = 'highpass';
      highPass.frequency.value = 80;
      compressor.threshold.value = -32;
      compressor.knee.value = 24;
      compressor.ratio.value = 8;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;

      source.connect(analyser);
      source.connect(highPass);
      highPass.connect(compressor);
      compressor.connect(destination);

      const recorder = new MediaRecorder(destination.stream, mimeType ? { mimeType } : undefined);

      streamRef.current = stream;
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
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
        } catch (err: unknown) {
          onLog(`Could not save recording: ${getErrorMessage(err)}`, 'error');
        } finally {
          setIsRecording(false);
          setElapsedMs(0);
          activeRecordingRef.current = null;
          chunksRef.current = [];
          streamRef.current?.getTracks().forEach(track => track.stop());
          streamRef.current = null;
          audioContextRef.current?.close();
          audioContextRef.current = null;
          analyserRef.current = null;
          window.cancelAnimationFrame(animationFrameRef.current || 0);
          window.clearInterval(timerRef.current);
        }
      };

      recorder.start(1000);
      setElapsedMs(0);
      setIsRecording(true);
      startWaveform(analyser);
      timerRef.current = window.setInterval(() => {
        setElapsedMs(Date.now() - startedAtRef.current);
      }, 250);
    } catch (err: unknown) {
      window.cancelAnimationFrame(animationFrameRef.current || 0);
      analyserRef.current = null;
      audioContextRef.current?.close();
      audioContextRef.current = null;
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      onLog(`Could not start recording: ${getErrorMessage(err)}`, 'error');
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

    setShowRecoveredNotice(false);

    if (isPreviewPlaying) {
      audio.pause();
      return;
    }

    try {
      await audio.play();
    } catch (err: unknown) {
      onLog(`Could not play recovered recording: ${getErrorMessage(err)}`, 'error');
    }
  };

  const loadRecording = (recording: CachedRecording, shouldTranscribeNow = false) => {
    stopPreview();
    setShowRecoveredNotice(false);
    onRecordingReady(fileFromRecording(recording), shouldTranscribeNow);
    setDraftRecording(undefined);
    onLog(`Loaded recording "${recording.fileName}".`, 'info');
  };

  const deleteRecording = async (id: string) => {
    stopPreview();
    setShowRecoveredNotice(false);
    await deleteCachedRecording(id);
    await refreshRecordings();
  };

  return (
    <div className={`persistent-recorder ${!isRecording && draftRecording ? 'has-recovered-recording' : ''}`}>
      <button
        className={`voice-recorder-control ${isRecording ? 'is-recording' : ''}`}
        onClick={isRecording ? stopRecording : startRecording}
        disabled={isLoading}
        type="button"
        aria-label={isRecording ? 'Stop recording and add audio to the file list' : 'Record audio'}
      >
        <span className="voice-recorder-action">
          {isRecording ? <TbPlayerStopFilled /> : isLoading ? <LoadingOutlined /> : <AudioOutlined />}
        </span>
        <span className="voice-recorder-copy">
          <span className="voice-recorder-title">
            {isRecording ? 'Stop recording' : 'Record audio'}
          </span>
          <span className="voice-recorder-meta">
            {isRecording ? 'Recording now' : 'Saved locally'}
          </span>
        </span>
        <span className="voice-recorder-monitor" aria-hidden="true">
          <span className="persistent-recorder-time">{formatRecordingTime(elapsedMs)}</span>
          <canvas
            ref={waveformCanvasRef}
            className={`mic-waveform ${isRecording ? 'is-active' : ''}`}
          />
        </span>
      </button>

      {!isRecording && draftRecording && (
        <div
          className={`recovered-recorder-card ${showRecoveredNotice ? 'recovered-recorder-card-attention' : ''}`}
          role={showRecoveredNotice ? 'status' : undefined}
          aria-live={showRecoveredNotice ? 'polite' : undefined}
          aria-label={`Recording recovered, ${formatRecordingTime(draftRecording.durationMs)} long. Play it, transcribe it now, or delete it.`}
        >
          <span className="recovered-recorder-title">
            {showRecoveredNotice && <span className="recovered-recording-pulse" aria-hidden="true" />}
            Recording recovered
            <span className="persistent-recorder-time">{formatRecordingTime(draftRecording.durationMs)}</span>
          </span>
          <div className="recovered-recorder-actions">
            <audio
              ref={previewAudioRef}
              src={previewUrl}
              onPlay={() => setIsPreviewPlaying(true)}
              onPause={() => setIsPreviewPlaying(false)}
              onEnded={() => setIsPreviewPlaying(false)}
            />
            <button
              type="button"
              className="transcript-icon"
              onClick={togglePreview}
              title={isPreviewPlaying ? "Pause recovered audio" : "Play recovered audio"}
              aria-label={isPreviewPlaying ? "Pause recovered audio" : "Play recovered audio"}
            >
              {isPreviewPlaying ? <TbPlayerPauseFilled /> : <TbPlayerPlayFilled />}
            </button>
            <button
              type="button"
              className="transcript-icon recovered-recorder-transcribe"
              onClick={() => loadRecording(draftRecording, true)}
              title="Transcribe recovered recording now"
              aria-label="Transcribe recovered recording now"
            >
              <TbFileTextAi />
            </button>
            <button type="button" className="transcript-icon transcript-icon-danger" onClick={() => deleteRecording(draftRecording.id)} title="Delete recovered recording">
              <BiSolidTrashAlt />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PersistentAudioRecorder;
