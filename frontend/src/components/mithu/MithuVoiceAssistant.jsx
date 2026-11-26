import React, { useCallback, useEffect, useRef, useState } from "react";
import { AudioLines, Mic, MicOff, PhoneOff, X, Volume2 } from "lucide-react";
import api from "@/lib/api";

const VOICE_PROTOCOL = "mithu.voice.v1";
const OUTPUT_RATE = 24000;

function encodeBase64(bytes) {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return window.btoa(binary);
}

function downsampleToPcm16(input, inputRate, outputRate) {
  if (!input?.length) return new Int16Array(0);
  const ratio = inputRate / outputRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Int16Array(outputLength);

  for (let i = 0; i < outputLength; i += 1) {
    const position = i * ratio;
    const left = Math.floor(position);
    const right = Math.min(left + 1, input.length - 1);
    const fraction = position - left;
    const sample = input[left] * (1 - fraction) + input[right] * fraction;
    const clipped = Math.max(-1, Math.min(1, sample));
    output[i] = clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff;
  }
  return output;
}

function pcmBase64ToFloat32(base64) {
  const binary = window.atob(base64);
  const length = binary.length - (binary.length % 2);
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) bytes[i] = binary.charCodeAt(i);

  const pcm = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i += 1) float32[i] = pcm[i] / 32768;
  return float32;
}

export default function MithuVoiceAssistant({ user }) {
  const enabled = process.env.REACT_APP_MITHU_VOICE_ENABLED === "true";
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [captions, setCaptions] = useState([]);
  const [muted, setMuted] = useState(false);

  const socketRef = useRef(null);
  const audioContextRef = useRef(null);
  const streamRef = useRef(null);
  const sourceRef = useRef(null);
  const processorRef = useRef(null);
  const silentGainRef = useRef(null);
  const playbackSourcesRef = useRef(new Set());
  const playbackCursorRef = useRef(0);
  const captureStartedRef = useRef(false);
  const mutedRef = useRef(false);
  const intentionalCloseRef = useRef(false);
  const activeCaptionIdsRef = useRef({ user: null, mithu: null });

  const appendCaption = useCallback((speaker, delta) => {
    if (!delta) return;
    let id = activeCaptionIdsRef.current[speaker];
    if (!id) {
      id = `${speaker}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      activeCaptionIdsRef.current[speaker] = id;
      setCaptions((current) => [...current, { id, speaker, text: delta }].slice(-30));
      return;
    }
    setCaptions((current) =>
      current.map((item) => item.id === id ? { ...item, text: item.text + delta } : item)
    );
  }, []);

  const finishCaption = useCallback((speaker) => {
    activeCaptionIdsRef.current[speaker] = null;
  }, []);

  const stopLocalAudio = useCallback(async () => {
    captureStartedRef.current = false;
    if (processorRef.current) {
      processorRef.current.onaudioprocess = null;
      try { processorRef.current.disconnect(); } catch {}
      processorRef.current = null;
    }
    if (sourceRef.current) {
      try { sourceRef.current.disconnect(); } catch {}
      sourceRef.current = null;
    }
    if (silentGainRef.current) {
      try { silentGainRef.current.disconnect(); } catch {}
      silentGainRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    for (const node of playbackSourcesRef.current) {
      try { node.stop(); } catch {}
      try { node.disconnect(); } catch {}
    }
    playbackSourcesRef.current.clear();
    playbackCursorRef.current = 0;

    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== "closed") {
      try { await context.close(); } catch {}
    }
  }, []);

  const playAudio = useCallback((base64) => {
    const context = audioContextRef.current;
    if (!context || context.state === "closed") return;
    const samples = pcmBase64ToFloat32(base64);
    if (!samples.length) return;

    const buffer = context.createBuffer(1, samples.length, OUTPUT_RATE);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);

    const startAt = Math.max(context.currentTime + 0.015, playbackCursorRef.current);
    playbackCursorRef.current = startAt + buffer.duration;
    playbackSourcesRef.current.add(source);
    source.onended = () => {
      playbackSourcesRef.current.delete(source);
      try { source.disconnect(); } catch {}
    };
    source.start(startAt);
    setStatus("speaking");
  }, []);

  const startCapture = useCallback(async () => {
    if (captureStartedRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone access is not supported in this browser.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    streamRef.current = stream;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Web Audio is not supported in this browser.");

    const context = new AudioContextClass({ sampleRate: OUTPUT_RATE });
    audioContextRef.current = context;
    await context.resume();

    const source = context.createMediaStreamSource(stream);
    sourceRef.current = source;

    // ScriptProcessor is used as a compatibility fallback for browsers that do not
    // expose a bundled AudioWorklet processor. Audio remains in-memory only.
    const processor = context.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    const silentGain = context.createGain();
    silentGain.gain.value = 0;
    silentGainRef.current = silentGain;

    processor.onaudioprocess = (event) => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN || mutedRef.current) return;
      const samples = downsampleToPcm16(
        event.inputBuffer.getChannelData(0),
        event.inputBuffer.sampleRate,
        OUTPUT_RATE
      );
      if (!samples.length) return;
      socket.send(JSON.stringify({
        type: "session.input_audio.append",
        audio: encodeBase64(new Uint8Array(samples.buffer)),
      }));
    };

    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(context.destination);
    captureStartedRef.current = true;
    setStatus("listening");
  }, [muted]);

  const stopVoice = useCallback(async () => {
    intentionalCloseRef.current = true;
    const socket = socketRef.current;
    socketRef.current = null;

    if (socket && socket.readyState < WebSocket.CLOSING) {
      try { socket.close(1000, "User ended Mithu voice session"); } catch {}
    }
    await stopLocalAudio();
    mutedRef.current = false;
    setMuted(false);
    activeCaptionIdsRef.current = { user: null, mithu: null };
    setStatus("idle");
  }, [stopLocalAudio]);

  const startVoice = useCallback(async () => {
    if (status === "connecting" || status === "listening" || status === "speaking") return;
    setError("");
    setCaptions([]);
    setStatus("connecting");
    intentionalCloseRef.current = false;

    try {
      if (!window.isSecureContext && window.location.hostname !== "localhost") {
        throw new Error("Microphone access requires HTTPS. Open EduConnect Pro using its secure URL.");
      }

      const { data } = await api.post("/mithu/voice-ticket");
      if (!data?.identity_assertion || !data?.websocket_url) {
        throw new Error("The voice session ticket was incomplete.");
      }

      const socket = new WebSocket(data.websocket_url, [
        VOICE_PROTOCOL,
        `identity.${data.identity_assertion}`,
      ]);
      socketRef.current = socket;

      socket.onopen = () => setStatus("connecting");
      socket.onmessage = async (message) => {
        let event;
        try { event = JSON.parse(message.data); } catch { return; }

        if (event.type === "mithu.ready") {
          try {
            await startCapture();
          } catch (captureError) {
            const message = captureError?.message || "Microphone could not be started.";
            await stopVoice();
            setError(message);
            setStatus("error");
          }
          return;
        }

        if (event.type === "mithu.error") {
          setError(event.message || "Mithu voice encountered an error.");
          setStatus("error");
          return;
        }

        if (event.type === "session.input_transcript.delta") {
          appendCaption("user", event.delta);
        } else if (event.type === "session.input_transcript.completed" || event.type === "session.input_transcript.done") {
          if (event.transcript) {
            // Replace a partial transcript with the final recognized wording.
            const id = activeCaptionIdsRef.current.user;
            if (id) {
              setCaptions((current) => current.map((item) =>
                item.id === id ? { ...item, text: event.transcript } : item
              ));
            } else {
              appendCaption("user", event.transcript);
            }
          }
          finishCaption("user");
        } else if (event.type === "session.output_transcript.delta" || event.type === "session.output_audio_transcript.delta") {
          appendCaption("mithu", event.delta);
        } else if (event.type === "session.output_transcript.done" || event.type === "session.output_transcript.completed" || event.type === "session.output_audio_transcript.done") {
          finishCaption("mithu");
          setStatus("listening");
        } else if (event.type === "session.output_audio.delta") {
          playAudio(event.delta);
        } else if (event.type === "session.output_audio.clear") {
          for (const node of playbackSourcesRef.current) {
            try { node.stop(); } catch {}
          }
          playbackSourcesRef.current.clear();
          playbackCursorRef.current = 0;
          setStatus("listening");
        } else if (event.type === "session.started") {
          setStatus("listening");
        } else if (event.type === "error" || event.type === "session.error") {
          const detail = event.error?.message || event.message;
          setError(detail || "Mithu voice session failed.");
          setStatus("error");
        }
      };

      socket.onerror = () => {
        if (!intentionalCloseRef.current) {
          setError("The voice connection failed. Check the service URL and try again.");
          setStatus("error");
        }
      };
      socket.onclose = () => {
        if (!intentionalCloseRef.current) {
          void stopLocalAudio();
          setStatus((current) => current === "error" ? current : "idle");
        }
      };
    } catch (startError) {
      setError(startError?.response?.data?.detail || startError?.message || "Mithu could not start.");
      setStatus("error");
      await stopLocalAudio();
    }
  }, [appendCaption, finishCaption, playAudio, startCapture, status, stopLocalAudio, stopVoice]);

  const toggleMute = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const next = !muted;
    socket.send(JSON.stringify({ type: next ? "session.input_audio.mute" : "session.input_audio.unmute" }));
    mutedRef.current = next;
    setMuted(next);
  }, [muted]);

  useEffect(() => () => {
    intentionalCloseRef.current = true;
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket && socket.readyState < WebSocket.CLOSING) {
      try { socket.close(1000, "Mithu widget unmounted"); } catch {}
    }
    void stopLocalAudio();
  }, [stopLocalAudio]);

  if (!enabled || !user || user === false || user.scope === "platform") return null;

  const active = ["connecting", "listening", "speaking"].includes(status);
  const statusLabel = status === "connecting"
    ? "Connecting securely…"
    : status === "speaking"
      ? "Mithu is speaking"
      : status === "listening"
        ? (muted ? "Microphone muted" : "Listening to you")
        : status === "error" ? "Connection issue" : "Ready when you are";

  return (
    <>
      {open && (
        <section
          className="fixed bottom-[calc(6.5rem+env(safe-area-inset-bottom))] right-3 z-[95] flex max-h-[min(70vh,620px)] w-[min(92vw,390px)] flex-col overflow-hidden rounded-[28px] border border-border bg-background shadow-2xl"
          aria-label="Mithu voice assistant"
        >
          <header className="flex items-center justify-between gap-3 border-b border-border bg-gradient-to-r from-violet-600/10 via-fuchsia-500/10 to-amber-500/10 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-fuchsia-500 text-white shadow-md">
                <AudioLines size={21} />
              </div>
              <div className="min-w-0">
                <p className="font-semibold leading-tight">Mithu Voice AI</p>
                <p className="text-xs text-muted-foreground">മലയാളം · Manglish · English</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => { if (active) void stopVoice(); setOpen(false); }}
              className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
              aria-label="Close Mithu voice panel"
            >
              <X size={18} />
            </button>
          </header>

          <div className="flex items-center gap-2 px-4 py-3 text-sm">
            <span className={`h-2.5 w-2.5 rounded-full ${active ? "bg-emerald-500 animate-pulse" : status === "error" ? "bg-red-500" : "bg-muted-foreground/40"}`} />
            <span className="font-medium">{statusLabel}</span>
            <span className="ml-auto text-[11px] text-muted-foreground">Live voice</span>
          </div>

          <div className="min-h-[170px] flex-1 space-y-3 overflow-y-auto px-4 pb-3" aria-live="polite">
            {captions.length === 0 && (
              <div className="flex min-h-[150px] flex-col items-center justify-center text-center text-muted-foreground">
                <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-300">
                  <Volume2 size={28} />
                </div>
                <p className="text-sm font-medium text-foreground">സംസാരിച്ച് തുടങ്ങാം!</p>
                <p className="mt-1 max-w-[250px] text-xs">Tap the microphone and talk to Mithu naturally.</p>
              </div>
            )}
            {captions.map((caption) => (
              <div key={caption.id} className={`flex ${caption.speaker === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${caption.speaker === "user" ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-muted text-foreground"}`}>
                  <p className="mb-1 text-[10px] font-semibold opacity-70">{caption.speaker === "user" ? "You" : "മിത്തു"}</p>
                  <p className="whitespace-pre-wrap break-words">{caption.text}</p>
                </div>
              </div>
            ))}
          </div>

          {error && (
            <div className="mx-4 mb-2 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-600 dark:text-red-300" role="alert">
              {error}
            </div>
          )}

          <footer className="flex items-center justify-center gap-4 border-t border-border bg-muted/30 px-4 py-4">
            {active ? (
              <>
                <button
                  type="button"
                  onClick={toggleMute}
                  className={`flex h-11 w-11 items-center justify-center rounded-full border ${muted ? "border-amber-500/50 bg-amber-500/10 text-amber-600" : "border-border bg-background text-foreground"}`}
                  aria-label={muted ? "Unmute microphone" : "Mute microphone"}
                >
                  {muted ? <MicOff size={19} /> : <Mic size={19} />}
                </button>
                <button
                  type="button"
                  onClick={stopVoice}
                  className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700"
                  aria-label="End voice conversation"
                >
                  <PhoneOff size={22} />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={startVoice}
                disabled={status === "connecting"}
                className="flex items-center gap-2 rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-600/20 transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
              >
                <Mic size={18} />
                {status === "connecting" ? "Connecting…" : status === "error" ? "Try again" : "Start talking"}
              </button>
            )}
          </footer>
          <p className="px-4 pb-3 text-center text-[10px] text-muted-foreground">
            Audio streams to OpenAI Live; this widget does not save recordings.
          </p>
        </section>
      )}

      <button
        type="button"
        onClick={() => { if (open && active) void stopVoice(); setOpen((value) => !value); }}
        className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-4 z-[94] flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-violet-600 via-fuchsia-600 to-orange-500 text-white shadow-xl shadow-violet-900/20 ring-4 ring-background transition hover:scale-105"
        aria-label={open ? "Close Mithu voice assistant" : "Open Mithu voice assistant"}
        title="Talk to Mithu"
      >
        {open ? <X size={23} /> : <Mic size={23} />}
        {!active && !open && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-background px-1 text-[9px] font-bold text-violet-700 shadow">
            AI
          </span>
        )}
      </button>
    </>
  );
}
