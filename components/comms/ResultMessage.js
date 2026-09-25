export default function ResultMessage({ state }) {
  if (!state?.text) return null;
  const color = state.tone === 'good' ? 'var(--success)' : state.tone === 'warn' ? 'oklch(45% 0.1 75)' : 'var(--danger)';
  return (
    <p className="text-[12.5px] font-display font-medium mt-2.5 max-w-[560px]" style={{ color }}>
      {state.text}
    </p>
  );
}
