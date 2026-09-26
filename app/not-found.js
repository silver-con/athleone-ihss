import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-6">
      <div className="max-w-[420px] text-center">
        <div className="font-display font-extrabold text-[20px]">Page not found</div>
        <p className="text-[13.5px] text-[var(--muted)] mt-2">That address doesn&rsquo;t exist, or you don&rsquo;t have access to it.</p>
        <Link href="/" className="inline-block mt-5 bg-[var(--accent-strong)] text-white font-display font-bold text-[13px] px-4 py-2.5 rounded-xl">
          Go to Athleone
        </Link>
      </div>
    </div>
  );
}
