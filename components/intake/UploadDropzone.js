'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

// Drag a fax PDF/image here (or pick one). It's uploaded, read, and you
// land on its review screen.
export default function UploadDropzone({ engineLabel }) {
  const router = useRouter();
  const input = useRef(null);
  const [state, setState] = useState({ busy: false, error: null, over: false });

  async function upload(file) {
    if (!file) return;
    setState({ busy: true, error: null, over: false });
    const body = new FormData();
    body.append('file', file);
    try {
      const res = await fetch('/inbox/upload', { method: 'POST', body });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Upload failed.');
      router.push(`/inbox/${json.id}`);
      router.refresh();
    } catch (err) {
      setState({ busy: false, error: err.message, over: false });
    }
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!state.over) setState((s) => ({ ...s, over: true }));
      }}
      onDragLeave={() => setState((s) => ({ ...s, over: false }))}
      onDrop={(e) => {
        e.preventDefault();
        upload(e.dataTransfer.files?.[0]);
      }}
      className={
        'border-2 border-dashed rounded-2xl px-5 py-6 text-center transition-colors ' +
        (state.over ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--border)] bg-[var(--surface)]')
      }
    >
      <input
        ref={input}
        type="file"
        accept="application/pdf,image/tiff,image/png,image/jpeg"
        className="hidden"
        onChange={(e) => upload(e.target.files?.[0])}
      />
      {state.busy ? (
        <div className="text-[13.5px] font-display font-bold text-[var(--accent)]">Uploading and reading the document…</div>
      ) : (
        <>
          <div className="font-display font-extrabold text-[14px]">Drop a fax here, or</div>
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="mt-2 bg-[var(--accent-strong)] text-white font-display font-bold text-[12.5px] px-4 py-2 rounded-[10px]"
          >
            Choose a file
          </button>
          <div className="text-[11.5px] text-[var(--muted)] mt-2">PDF, TIFF, PNG or JPEG, up to 20 MB · read by {engineLabel}</div>
        </>
      )}
      {state.error && <div className="text-[12.5px] text-[var(--danger)] mt-2">{state.error}</div>}
    </div>
  );
}
