import { useState, useEffect, useRef, useCallback } from 'react';
import { getModels, setModel, type ModelInfo } from '../lib/api';
import './ModelPicker.css';

// ── provider display config ──────────────────────────────────────────────────
const PROVIDER_LABELS: Record<string, string> = {
  'kimi-coding': 'KIMI',
  'google':      'GOOGLE AI',
  'openrouter':  'OPENROUTER',
};

// Tag → accent color token
const TAG_COLOR: Record<string, string> = {
  'coding':       '#22d3ee',
  'fast':         '#10b981',
  'cheap':        '#10b981',
  'powerful':     '#a78bfa',
  'balanced':     '#38bdf8',
  'reasoning':    '#f59e0b',
  'long-context': '#a78bfa',
  'open':         '#38bdf8',
};

// Shorten the label to fit the chip (models with a path prefix like
// "anthropic/claude-..." become just the last segment)
function chipLabel(m: ModelInfo): string {
  const short = m.label.replace(/\s*\(OR\)/i, '').trim();
  // Collapse very long labels to "Brand Model" max two words
  const words = short.split(' ');
  return words.length <= 3 ? short : words.slice(0, 3).join(' ');
}

interface Props {
  className?: string;
}

export default function ModelPicker({ className = '' }: Props) {
  const [open, setOpen]         = useState(false);
  const [models, setModels]     = useState<ModelInfo[]>([]);
  const [current, setCurrent]   = useState('');
  const [saving, setSaving]     = useState(false);
  const [flash, setFlash]       = useState<'ok' | 'err' | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await getModels();
      setModels(r.models);
      setCurrent(r.current_model);
    } catch {
      // silent — bridge may be restarting
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSelect = useCallback(async (m: ModelInfo) => {
    if (m.id === current || saving) return;
    setOpen(false);
    setSaving(true);
    setError(null);
    try {
      await setModel(m.id, m.provider, m.base_url);
      setCurrent(m.id);
      setModels(prev => prev.map(x => ({ ...x, current: x.id === m.id })));
      setFlash('ok');
      setTimeout(() => setFlash(null), 1600);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.slice(0, 120));
      setFlash('err');
      setTimeout(() => { setFlash(null); setError(null); }, 3000);
    } finally {
      setSaving(false);
    }
  }, [current, saving]);

  const activeModel = models.find(m => m.id === current);
  const label = activeModel ? chipLabel(activeModel) : (current || '—');

  // Group models by provider in catalog order (preserves logical grouping)
  const groups = Object.entries(PROVIDER_LABELS).map(([pid, plabel]) => ({
    id: pid, label: plabel,
    items: models.filter(m => m.provider === pid),
  })).filter(g => g.items.length > 0);

  return (
    <div className={`model-picker ${className} ${open ? 'is-open' : ''}`} ref={wrapRef}>
      <button
        className={`mp-chip ${saving ? 'is-saving' : ''} ${flash ? `is-${flash}` : ''}`}
        onClick={() => setOpen(o => !o)}
        title={error ?? `Active model: ${current}`}
      >
        <span className="mp-icon">◈</span>
        <span className="mp-label">{label}</span>
        <span className="mp-caret">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="mp-dropdown">
          <div className="mp-header">LLM MODEL</div>

          {groups.map(group => (
            <div key={group.id} className="mp-group">
              <div className="mp-group-label">{group.label}</div>
              {group.items.map(m => (
                <button
                  key={m.id}
                  className={`mp-row ${m.current ? 'is-active' : ''} ${!m.enabled ? 'is-disabled' : ''}`}
                  onClick={() => m.enabled && handleSelect(m)}
                  disabled={!m.enabled || saving}
                  title={!m.enabled ? `Requires ${m.key_env} to be configured` : m.id}
                >
                  <span className={`mp-dot ${m.current ? 'lit' : ''}`} />
                  <span className="mp-name">{m.label}</span>
                  <span className="mp-ctx">{m.ctx_k >= 1000 ? `${(m.ctx_k / 1000).toFixed(0)}M` : `${m.ctx_k}k`}</span>
                  <span className="mp-tags">
                    {m.tags.slice(0, 2).map(t => (
                      <span key={t} className="mp-tag" style={{ color: TAG_COLOR[t] ?? '#9ca3af' }}>{t}</span>
                    ))}
                  </span>
                  {!m.enabled && <span className="mp-lock">🔑</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
