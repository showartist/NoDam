/**
 * ffmpeg·ffprobe 얇은 래퍼. 조각 녹음을 16kHz 모노 WAV 로 맞추고, 긴 녹음을 조각으로 나눈다.
 * 시스템에 ffmpeg 가 있어야 한다(macOS: brew install ffmpeg). 없으면 AUDIO_TOOL_MISSING 을 던진다.
 */
import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

export class AudioToolError extends Error {
  constructor(
    readonly code: "AUDIO_TOOL_MISSING" | "AUDIO_DECODE_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "AudioToolError";
  }
}

function run(bin: string, args: string[], timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new AudioToolError("AUDIO_TOOL_MISSING", `${bin} 가 설치되어 있지 않습니다.`));
        } else reject(new AudioToolError("AUDIO_DECODE_FAILED", `${bin} 실패: ${stderr?.toString().slice(-400) || err.message}`));
        return;
      }
      resolve(stdout.toString());
    });
  });
}

export async function probeDurationMs(file: string): Promise<number> {
  const out = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
  let sec = Number(out.trim());
  // MediaRecorder 중간 저장 WebM은 duration 헤더 없이도 재생 가능하다. 실제 패킷 끝을 확인한다.
  if (!Number.isFinite(sec) || sec <= 0) {
    const packets = await run("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "packet=pts_time,duration_time", "-of", "csv=p=0", file]);
    sec = 0;
    for (const line of packets.split("\n")) {
      const [pts, duration] = line.split(",").map(Number);
      if (Number.isFinite(pts)) sec = Math.max(sec, pts + (Number.isFinite(duration) ? duration : 0));
    }
  }
  if (!Number.isFinite(sec) || sec <= 0) throw new AudioToolError("AUDIO_DECODE_FAILED", `길이를 읽지 못했습니다: ${file}`);
  return Math.round(sec * 1000);
}

/** 16kHz 모노 WAV 로 변환(STT·화자 임베딩 공통 입력). */
export async function toWav16k(input: string, output: string): Promise<string> {
  mkdirSync(path.dirname(output), { recursive: true });
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", input, "-ac", "1", "-ar", "16000", "-sample_fmt", "s16", output]);
  return output;
}

/** 압축본(STT 업로드용). 16kHz 모노 opus 는 10분에 약 2~3MB. */
export async function toOpus(input: string, output: string, timeoutMs = 120_000): Promise<string> {
  mkdirSync(path.dirname(output), { recursive: true });
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", input, "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "24k", output], timeoutMs);
  return output;
}

export type Chunk = { file: string; offsetMs: number; durationMs: number; index: number };

/**
 * 긴 녹음을 chunkMs 조각으로 나눈다. 조각 경계에서 말이 잘리지 않게 overlapMs 만큼 겹친다
 * (겹친 구간의 단어는 이어 붙일 때 한쪽만 남긴다).
 */
export async function splitAudio(input: string, outDir: string, chunkMs: number, overlapMs = 3000): Promise<Chunk[]> {
  if (!Number.isFinite(chunkMs) || chunkMs < 1000 || !Number.isFinite(overlapMs) || overlapMs < 0 || overlapMs >= chunkMs) {
    throw new AudioToolError("AUDIO_DECODE_FAILED", "분할 길이는 1초 이상, 겹침은 0 이상이고 분할 길이보다 짧아야 합니다.");
  }
  mkdirSync(outDir, { recursive: true });
  const total = await probeDurationMs(input);
  const chunks: Chunk[] = [];
  for (let start = 0, i = 0; start < total; start += chunkMs, i++) {
    const s = Math.max(0, start - (i > 0 ? overlapMs : 0));
    const dur = Math.min(total - s, chunkMs + (i > 0 ? overlapMs : 0));
    if (dur < 500) break;
    const file = path.join(outDir, `chunk_${String(i).padStart(3, "0")}.wav`);
    await run("ffmpeg", ["-y", "-loglevel", "error", "-ss", (s / 1000).toFixed(3), "-t", (dur / 1000).toFixed(3), "-i", input, "-ac", "1", "-ar", "16000", "-sample_fmt", "s16", file]);
    chunks.push({ file, offsetMs: s, durationMs: dur, index: i });
  }
  return chunks;
}

/** 배치 작업은 필요한 조각만 디스크로 추출한다. */
export async function extractAudioChunk(input: string, output: string, offsetMs: number, durationMs: number, timeoutMs: number): Promise<void> {
  await run("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(offsetMs / 1000), "-t", String(durationMs / 1000), "-i", input, "-ac", "1", "-ar", "16000", output], timeoutMs);
}
