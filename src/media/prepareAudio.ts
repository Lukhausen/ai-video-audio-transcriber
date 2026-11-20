import type { FFmpeg, FFFSType, LogEvent } from '@ffmpeg/ffmpeg';
import type { ApiConfig, AudioChunk } from '../types';

const MEDIA_EXTENSIONS = [
  '.mp4', '.mkv', '.mov', '.avi', '.wmv', '.webm', '.flv',
  '.mp3', '.wav', '.aac', '.ogg', '.flac', '.m4a', '.wma', '.opus', '.caf', '.aif', '.aiff', '.aifc', '.ac3',
];
export const MEDIA_ACCEPT = ['audio/*', 'video/*', ...MEDIA_EXTENSIONS].join(',');
export const MAX_INPUT_BYTES = 2 * 1024 ** 3;

export function isSupportedMedia(file: File): boolean {
  return /^(audio|video)\//.test(file.type) || MEDIA_EXTENSIONS.includes('.' + file.name.split('.').pop()?.toLowerCase());
}

async function runFFmpeg(encoder: FFmpeg, args: string[]) {
  const messages: string[] = [];
  const collect = ({ message }: LogEvent) => messages.push(message);
  encoder.on('log', collect);
  try {
    const status = await encoder.exec(args);
    return { status, log: messages.join('\n') };
  } finally {
    encoder.off('log', collect);
  }
}

async function removeTempFile(encoder: FFmpeg, path: string) {
  try { await encoder.deleteFile(path); } catch { /* No output was created. */ }
}

async function audioDuration(encoder: FFmpeg, filename: string, output: string): Promise<number> {
  try {
    const status = await encoder.ffprobe(['-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', '-o', output, filename]);
    // This WASM build leaves the -1 return sentinel on successful probes.
    if (status === 0 || status === -1) {
      const duration = Number(await encoder.readFile(output, 'utf8').catch(() => ''));
      if (Number.isFinite(duration) && duration > 0) return duration;
    }
    throw new Error('Could not determine audio duration for safe splitting.');
  } finally {
    await removeTempFile(encoder, output);
  }
}

export async function convertAudio(
  encoder: FFmpeg, file: File, id: string, sampleRate: number, onTrackChange: (track: number) => void,
): Promise<Uint8Array> {
  const mount = '/input_' + id;
  const output = 'converted_' + id + '.mp3';
  await encoder.createDir(mount);
  try {
    await encoder.mount('WORKERFS' as FFFSType, { blobs: [{ name: 'source', data: file }] }, mount);
    let tracks = 1;
    for (let track = 0; track < tracks; track++) {
      const { status, log } = await runFFmpeg(encoder, [
        '-xerror', '-err_detect', 'explode', '-i', mount + '/source',
        '-map', '0:a:' + track, '-vn', '-af', 'aformat=channel_layouts=mono,volumedetect',
        '-ar', String(sampleRate), '-abort_on', 'empty_output', '-c:a', 'libmp3lame', output,
      ]);
      const inputLog = log.split('Stream mapping:')[0];
      const found = inputLog.match(/^\s*Stream #0:\d+[^:\r\n]*(?:\([^)]*\))?: Audio:/gm)?.length ?? 0;
      if (found) tracks = found;
      if (/stream map .*matches no streams/i.test(log)) throw new Error('This file has no audio track.');
      if (/(?:packet corrupt|filesize and duration do not match|partial file|invalid frame size|error while decoding|input buffer exhausted|truncated packet)/i.test(log)) {
        throw new Error('This file appears truncated or damaged. Try a complete copy before transcribing.');
      }
      if (status !== 0) throw new Error('This file could not be read. It may be damaged or use an unsupported audio format.');

      // volumedetect measures 16-bit PCM, where -91 dB represents digital silence.
      const peak = log.match(/max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/i);
      if (!peak || Number(peak[1]) > -90) {
        if (track) onTrackChange(track + 1);
        return await encoder.readFile(output) as Uint8Array;
      }
      await removeTempFile(encoder, output);
    }
    throw new Error('The audio tracks are silent. Check the original recording.');
  } finally {
    await removeTempFile(encoder, output);
    try { await encoder.unmount(mount); } catch { /* The input was never mounted. */ }
    try { await encoder.deleteDir(mount); } catch { /* The worker is unavailable. */ }
  }
}

export async function splitAudio(encoder: FFmpeg, data: Uint8Array, id: string, config: ApiConfig): Promise<AudioChunk[]> {
  const fileLimit = config.selectedApi === 'google' ? MAX_INPUT_BYTES : 24_900_000;
  const maxBytes = Math.min(config.maxFileSizeMB * 1024 ** 2, fileLimit);
  const maxDuration = config.selectedApi === 'google' ? 1790 : Infinity;
  const overlap = config.selectedApi === 'openai' && config.openaiModel === 'gpt-4o-transcribe-diarize' ? 0 : 3;
  if (data.byteLength <= maxBytes && maxDuration === Infinity) return [{ data, offset: 0, keepStart: 0, keepEnd: Infinity }];

  const root = 'split_' + id + '.mp3';
  const temporaryFiles = new Set([root]);
  try {
    await encoder.writeFile(root, data);
    const split = async (filename: string, offset: number, keepStart: number, keepEnd: number): Promise<AudioChunk[]> => {
      const bytes = await encoder.readFile(filename) as Uint8Array;
      if (bytes.byteLength <= maxBytes && maxDuration === Infinity) return [{ data: bytes, offset, keepStart, keepEnd }];

      const duration = await audioDuration(encoder, filename, 'duration_' + id + '.txt');
      if (bytes.byteLength <= maxBytes && duration <= maxDuration) return [{ data: bytes, offset, keepStart, keepEnd }];
      if (duration <= Math.max(0.2, overlap * 2 + 0.1)) throw new Error('Audio cannot fit the selected chunk size. Increase it in Advanced settings.');

      const half = duration / 2;
      const left = filename + '_L.mp3';
      const right = filename + '_R.mp3';
      temporaryFiles.add(left);
      temporaryFiles.add(right);
      const leftStatus = await encoder.exec(['-i', filename, '-to', String(half + overlap), '-c', 'copy', left]);
      const rightStatus = await encoder.exec(['-i', filename, '-ss', String(half - overlap), '-to', String(duration), '-c', 'copy', right]);
      if (leftStatus || rightStatus) throw new Error('The audio tools could not split this file.');
      await removeTempFile(encoder, filename);
      const boundary = offset + half;
      return [
        ...await split(left, offset, keepStart, Math.min(keepEnd, boundary)),
        ...await split(right, boundary - overlap, Math.max(keepStart, boundary), keepEnd),
      ];
    };
    return await split(root, 0, 0, Infinity);
  } finally {
    for (const name of temporaryFiles) await removeTempFile(encoder, name);
  }
}
