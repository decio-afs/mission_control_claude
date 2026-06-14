// Small unobtrusive marker for modules that render design/demo data rather than
// live Mc data. Keeps the showcase tabs honest about their data source.
export default function DemoBadge({ label = 'DEMO DATA' }: { label?: string }) {
  return (
    <span className="absolute bottom-2 right-3 z-50 font-mono text-[10px] tracking-[0.15em] text-amber-400/70 border border-amber-400/30 bg-[#050505]/80 px-1.5 py-0.5 pointer-events-none">
      {label}
    </span>
  );
}
