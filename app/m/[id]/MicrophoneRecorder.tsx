"use client";
import { useEffect, useRef, useState } from "react";
import { createRecording, appendRecordingChunk, completeRecording, listRecordings, restoreRecording, type SavedRecording } from "@/lib/recording/storage";

export default function MicrophoneRecorder({ meetingId, disabled, onUpload }: { meetingId: string; disabled: boolean; onUpload: (file: File) => Promise<void> }) {
  const recorder = useRef<MediaRecorder | null>(null), stream = useRef<MediaStream | null>(null), mounted = useRef(true);
  const [recording, setRecording] = useState(false), [starting, setStarting] = useState(false), [seconds, setSeconds] = useState(0);
  const [file, setFile] = useState<File | null>(null), [url, setUrl] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedRecording[]>([]), [savedBytes, setSavedBytes] = useState(0), [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    mounted.current = true;
    void listRecordings(meetingId).then(setSaved).catch(e => setError(`저장된 녹음을 읽지 못했습니다: ${e.message}`));
    const estimate = () => { void navigator.storage?.estimate().then(s => { if (mounted.current) setRemaining(s.quota != null && s.usage != null ? s.quota - s.usage : null); }); };
    estimate(); const timer = setInterval(estimate, 10_000);
    return () => { mounted.current = false; clearInterval(timer); if (recorder.current?.state === "recording") recorder.current.stop(); stream.current?.getTracks().forEach(t => t.stop()); };
  }, [meetingId]);
  useEffect(() => {
    if (!recording) return;
    const started = Date.now(), timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 500);
    return () => clearInterval(timer);
  }, [recording]);
  useEffect(() => {
    if (!file) { setUrl(null); return; }
    const value = URL.createObjectURL(file); setUrl(value); return () => URL.revokeObjectURL(value);
  }, [file]);
  async function recover(s: SavedRecording) {
    try { setFile(await restoreRecording(s)); setError(null); }
    catch (e) { setError(`녹음 복구 실패: ${(e as Error).message}`); }
  }
  async function start() {
    setStarting(true); setError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("이 브라우저에서는 마이크 녹음을 지원하지 않습니다. HTTPS 또는 localhost에서 사용하세요.");
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) { media.getTracks().forEach(t => t.stop()); return; }
      stream.current = media;
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find(x => MediaRecorder.isTypeSupported(x));
      const rec = new MediaRecorder(media, mime ? { mimeType: mime } : undefined);
      let session = await createRecording(meetingId, rec.mimeType || "audio/webm"), queue = Promise.resolve(), failed = false;
      if (!mounted.current) { media.getTracks().forEach(t => t.stop()); return; }
      rec.ondataavailable = e => {
        if (!e.data.size || failed) return;
        queue = queue.then(async () => {
          if (failed) return;
          session = await appendRecordingChunk(session, e.data);
          if (mounted.current) setSavedBytes(session.bytes);
        }).catch((e: Error) => {
          failed = true;
          if (rec.state === "recording") rec.stop();
          media.getTracks().forEach(t => t.stop());
          if (mounted.current) setError(`저장 실패로 녹음을 중지했습니다. 마지막 저장 조각까지 복구할 수 있습니다: ${e.message}`);
        });
      };
      rec.onerror = () => { failed = true; if (rec.state === "recording") rec.stop(); media.getTracks().forEach(t => t.stop()); if (mounted.current) setError("녹음 오류. 마지막 저장 조각까지 복구하세요."); };
      rec.onstop = () => {
        media.getTracks().forEach(t => t.stop());
        void queue.then(async () => {
          if (!failed) session = await completeRecording(session);
          if (!mounted.current) return;
          setRecording(false); setSaved(await listRecordings(meetingId));
          if (session.bytes) setFile(await restoreRecording(session));
          else setError("녹음된 오디오가 없습니다.");
        }).catch((e: Error) => { if (mounted.current) { setRecording(false); setError(e.message); } });
      };
      recorder.current = rec; rec.start(1000); setFile(null); setSeconds(0); setSavedBytes(0); setRecording(true);
    } catch (e) {
      stream.current?.getTracks().forEach(t => t.stop());
      setError((e as Error).name === "NotAllowedError" ? "마이크 권한이 거부되었습니다. 브라우저 설정에서 허용한 뒤 다시 시도하세요." : (e as Error).message);
    } finally { if (mounted.current) setStarting(false); }
  }
  return <div style={{ marginTop: 12 }} data-testid="microphone-recorder">
    {recording ? <button onClick={() => recorder.current?.stop()}>녹음 중지 · {seconds}초</button>
      : <button disabled={disabled || starting} onClick={() => void start()}>{starting ? "마이크 연결 중…" : "마이크 녹음 시작"}</button>}
    <p>1초 간격으로 이 브라우저에 저장합니다. 새로고침 후 마지막 저장 조각까지 복구할 수 있습니다. 브라우저 저장소 삭제 시 사라지므로 녹음 후 다운로드하세요.</p>
    {recording && <p data-testid="recording-saved">저장 완료 {savedBytes.toLocaleString()}바이트</p>}
    <p>저장소 잔여 추정: {remaining == null ? "확인 불가" : `${Math.floor(remaining / 1024 / 1024)}MB`}</p>
    {seconds >= 3600 && <p role="alert">60분을 넘었습니다. 저장소 여유를 확인하고 가능한 시점에 녹음을 저장·다운로드하세요.</p>}
    {remaining != null && remaining < 50 * 1024 * 1024 && <p role="alert">저장소 여유가 50MB 미만입니다.</p>}
    {error && <p role="alert">{error}</p>}
    {!recording && saved.map(s => <button key={s.id} disabled={starting} onClick={() => void recover(s)}>저장된 녹음 복구 · {new Date(s.startedAt).toLocaleString()} · {s.bytes.toLocaleString()}바이트{s.complete ? "" : " · 중단됨"}</button>)}
    {file && url && <div><audio controls src={url} aria-label="녹음 미리 듣기" />
      <button disabled={disabled || recording || starting} onClick={() => void onUpload(file)}>녹음 전사하기</button>
      <a href={url} download={file.name}>녹음 다운로드</a>
    </div>}
  </div>;
}
