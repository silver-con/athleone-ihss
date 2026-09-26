'use client';

// Last-resort error screen when the root layout itself fails. Must render
// its own <html>/<body>; kept dependency-free.
export default function GlobalError({ error, reset }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', margin: 0, background: '#faf8f4' }}>
        <div style={{ textAlign: 'center', maxWidth: 420, padding: 24 }}>
          <h1 style={{ fontSize: 20 }}>Athleone is having trouble</h1>
          <p style={{ color: '#6b665f', fontSize: 14 }}>Please try again in a moment.</p>
          {error?.digest && <p style={{ fontFamily: 'monospace', fontSize: 12, color: '#6b665f' }}>{error.digest}</p>}
          <button type="button" onClick={() => reset()} style={{ marginTop: 12, padding: '10px 18px', borderRadius: 10, border: 0, background: '#23776d', color: '#fff', fontWeight: 700 }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
