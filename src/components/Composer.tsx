"use client";

import { useEffect, useRef, useState } from "react";
import { uploadMedia } from "@/lib/storage";
import type { Message, MessageKind } from "@/lib/types";

interface Props {
  coupleId: string;
  onSend: (p: {
    kind: MessageKind;
    body?: string | null;
    media_path?: string | null;
    reply_to?: string | null;
  }) => Promise<void> | void;
  onTyping: () => void;
  replyingTo: Message | null;
  editing: Message | null;
  meId: string;
  partnerName: string;
  onCancelReply: () => void;
  onCancelEdit: () => void;
  onSubmitEdit: (newBody: string) => Promise<void> | void;
}

function snippet(m: Message): string {
  switch (m.kind) {
    case "image":
      return "📷 Photo";
    case "audio":
      return "🎙 Voice message";
    case "file":
      return "📎 " + (m.body || "File");
    default:
      return m.body || "";
  }
}

export default function Composer({
  coupleId,
  onSend,
  onTyping,
  replyingTo,
  editing,
  meId,
  partnerName,
  onCancelReply,
  onCancelEdit,
  onSubmitEdit,
}: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // When entering edit mode, prefill the box with the existing text.
  useEffect(() => {
    if (editing) setText(editing.body ?? "");
  }, [editing]);

  async function submitText(e?: React.FormEvent) {
    e?.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setText("");
    if (editing) {
      await onSubmitEdit(body);
      return;
    }
    await onSend({ kind: "text", body, reply_to: replyingTo?.id ?? null });
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const path = await uploadMedia(coupleId, file, file.name);
      const isImage = file.type.startsWith("image/");
      await onSend({
        kind: isImage ? "image" : "file",
        body: isImage ? null : file.name,
        media_path: path,
      });
    } catch (err) {
      alert("Upload failed: " + (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        setBusy(true);
        try {
          const path = await uploadMedia(coupleId, blob, "voice.webm");
          await onSend({ kind: "audio", media_path: path });
        } catch (err) {
          alert("Upload failed: " + (err as Error).message);
        } finally {
          setBusy(false);
        }
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      alert("Microphone access denied.");
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }

  const context = editing
    ? { label: "Editing message", text: editing.body ?? "", cancel: onCancelEdit }
    : replyingTo
      ? {
          label:
            "Replying to " +
            (replyingTo.sender_id === meId ? "yourself" : partnerName),
          text: snippet(replyingTo),
          cancel: onCancelReply,
        }
      : null;

  return (
    <div className="border-t border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
      {context && (
        <div className="flex items-center gap-2 px-4 pt-2">
          <div className="min-w-0 flex-1 border-l-2 border-fuchsia-400 pl-2">
            <p className="text-xs font-semibold text-fuchsia-500">{context.label}</p>
            <p className="line-clamp-1 text-xs text-neutral-500">{context.text}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              context.cancel();
              if (editing) setText("");
            }}
            aria-label="Cancel"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            ✕
          </button>
        </div>
      )}
    <form
      onSubmit={submitText}
      className="flex items-end gap-2 px-3 py-2.5"
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*,.pdf,.doc,.docx,.txt"
        hidden
        onChange={handleFile}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={busy || recording}
        aria-label="Attach"
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-neutral-500 transition hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-800"
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
      </button>

      <div className="flex flex-1 items-end rounded-3xl bg-neutral-100 px-1 dark:bg-neutral-800">
        <textarea
          value={text}
          rows={1}
          placeholder={recording ? "Recording… tap stop to send" : "Message…"}
          disabled={recording}
          onChange={(e) => {
            setText(e.target.value);
            onTyping();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) submitText(e);
          }}
          className="max-h-32 flex-1 resize-none bg-transparent px-3 py-2.5 text-[15px] text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100 dark:placeholder:text-neutral-500"
        />
      </div>

      {text.trim() ? (
        <button
          type="submit"
          disabled={busy}
          aria-label="Send"
          className="grid h-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-fuchsia-500 to-violet-500 px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          Send
        </button>
      ) : (
        <button
          type="button"
          onClick={recording ? stopRecording : startRecording}
          disabled={busy}
          aria-label={recording ? "Stop recording" : "Record voice"}
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-full transition disabled:opacity-50 ${
            recording
              ? "animate-pulse bg-red-600 text-white"
              : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          }`}
        >
          {recording ? (
            <span className="h-3.5 w-3.5 rounded-sm bg-white" />
          ) : (
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
            </svg>
          )}
        </button>
      )}
    </form>
    </div>
  );
}
