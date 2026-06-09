import { useState, useEffect, useMemo } from 'react';
import { useGhostStore, type GhostNode } from '../stores/useGhostStore';
import { useTaskStore } from '../stores/useTaskStore';
import { Panel, Pill, Label } from '../components/cyberpunk/ui';

const SQUAD_META: Record<string, { color: string; label: string }> = {
  CORE: { color: '#f64e6e', label: 'CORE' },
  SEC: { color: '#ef4444', label: 'SECURITY' },
  INTEL: { color: '#a855f7', label: 'INTEL' },
  INFRA: { color: '#10b981', label: 'INFRA' },
  CONT: { color: '#f59e0b', label: 'CONTENT' },
  DEV: { color: '#38bdf8', label: 'DEV' },
};

const MODELS = ['cyan', 'purple', 'green', 'kate', 'director', 'hermes'];
const SKILLS = ['coding', 'writing', 'research', 'scraping', 'social', 'video', 'design', 'analytics', 'seo', 'email'];

function statusTone(status?: string): 'good' | 'warn' | 'neutral' | 'bad' {
  if (status === 'active' || status === 'online') return 'good';
  if (status === 'idle') return 'warn';
  if (status === 'offline') return 'bad';
  return 'neutral';
}

export default function AgentHub() {
  const {
    nodes, isLoading, error, lastSync, agentActivity,
    fetchTopology, createAgent, updateAgent, deleteAgent, spawnAgentOnTask,
  } = useGhostStore();

  const { tasks, fetchTasks } = useTaskStore();

  const [tab, setTab] = useState<'registry' | 'activity'>('registry');
  const [filter, setFilter] = useState('');
  const [sortKey, setSortKey] = useState<'name' | 'squad' | 'status'>('name');

  // Modals
  const [createOpen, setCreateOpen] = useState(false);
  const [editNode, setEditNode] = useState<GhostNode | null>(null);
  const [deleteNode, setDeleteNode] = useState<GhostNode | null>(null);
  const [spawnNode, setSpawnNode] = useState<GhostNode | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formRole, setFormRole] = useState('runner');
  const [formSkills, setFormSkills] = useState<string[]>([]);
  const [formModel, setFormModel] = useState('cyan');
  const [formTaskId, setFormTaskId] = useState('');

  useEffect(() => {
    fetchTopology();
    fetchTasks();
  }, [fetchTopology, fetchTasks]);

  const filtered = useMemo(() => {
    let list = nodes.filter((n) => n.type !== 'squad');
    if (filter.trim()) {
      const q = filter.toLowerCase();
      list = list.filter((n) => n.name.toLowerCase().includes(q) || (n.squad || '').toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name);
      if (sortKey === 'squad') return (a.squad || '').localeCompare(b.squad || '');
      if (sortKey === 'status') return (a.status || '').localeCompare(b.status || '');
      return 0;
    });
    return list;
  }, [nodes, filter, sortKey]);

  const resetForm = () => {
    setFormName('');
    setFormRole('runner');
    setFormSkills([]);
    setFormModel('cyan');
    setFormTaskId('');
  };

  const openCreate = () => { resetForm(); setCreateOpen(true); };
  const openEdit = (n: GhostNode) => {
    setEditNode(n);
    setFormName(n.name);
    setFormRole(n.type === 'core' ? 'core' : n.type);
    setFormSkills([]);
    setFormModel(n.model || 'cyan');
    setFormTaskId('');
  };
  const openDelete = (n: GhostNode) => { setDeleteNode(n); };
  const openSpawn = (n: GhostNode) => { setSpawnNode(n); setFormTaskId(''); };

  const handleCreate = async () => {
    if (!formName.trim()) return;
    const ok = await createAgent({
      name: formName.trim(),
      role: formRole,
      skills: formSkills,
      model: formModel,
    });
    if (ok) setCreateOpen(false);
  };

  const handleUpdate = async () => {
    if (!editNode) return;
    const ok = await updateAgent(editNode.id, {
      name: formName.trim() || editNode.name,
      role: formRole,
      skills: formSkills,
      model: formModel,
    });
    if (ok) setEditNode(null);
  };

  const handleDelete = async () => {
    if (!deleteNode) return;
    const ok = await deleteAgent(deleteNode.id);
    if (ok) setDeleteNode(null);
  };

  const handleSpawn = async () => {
    if (!spawnNode || !formTaskId) return;
    const ok = await spawnAgentOnTask(spawnNode.id, formTaskId);
    if (ok) setSpawnNode(null);
  };

  const toggleSkill = (skill: string) => {
    setFormSkills((prev) => prev.includes(skill) ? prev.filter((s) => s !== skill) : [...prev, skill]);
  };

  return (
    <div className="h-full flex flex-col gap-2 p-2 overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold tracking-[0.2em] uppercase text-white">Agent Hub</h1>
          <div className="flex gap-1 text-[10px] font-mono">
            <button onClick={() => setTab('registry')} className={`px-2 py-1 border ${tab === 'registry' ? 'border-[#f64e6e] text-[#f64e6e]' : 'border-white/10 text-[#b8b8b8] hover:border-white/30'}`}>REGISTRY</button>
            <button onClick={() => setTab('activity')} className={`px-2 py-1 border ${tab === 'activity' ? 'border-[#f64e6e] text-[#f64e6e]' : 'border-white/10 text-[#b8b8b8] hover:border-white/30'}`}>ACTIVITY</button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {lastSync && <span className="text-[9px] font-mono text-[#545454]">SYNC {lastSync.toLocaleTimeString()}</span>}
          <button onClick={openCreate} className="text-[10px] font-mono border border-[#f64e6e]/40 bg-[#f64e6e]/10 text-[#f64e6e] px-3 py-1 hover:bg-[#f64e6e]/20">+ CREATE AGENT</button>
        </div>
      </div>

      {error && (
        <div className="px-2 py-1 border border-red-400/40 bg-[#050505]/80 text-red-400 font-mono text-[10px]">
          ⚠ {error}
        </div>
      )}

      {tab === 'registry' ? (
        <Panel label={`LEGION REGISTRY · ${filtered.length} agents`} bodyClass="flex flex-col gap-2 overflow-auto">
          <div className="flex items-center gap-2 shrink-0">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter agents..."
              className="bg-[#080808] border border-white/10 px-2 py-1 text-[11px] text-white placeholder:text-[#545454] focus:border-[#f64e6e] outline-none flex-1"
            />
            <div className="flex gap-1 text-[9px] font-mono">
              {(['name', 'squad', 'status'] as const).map((k) => (
                <button key={k} onClick={() => setSortKey(k)} className={`px-2 py-1 border ${sortKey === k ? 'border-[#f64e6e] text-[#f64e6e]' : 'border-white/10 text-[#b8b8b8] hover:border-white/30'}`}>
                  {k.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1 overflow-auto">
            {filtered.map((n) => {
              const sq = SQUAD_META[n.squad || 'CORE'] || SQUAD_META.CORE;
              return (
                <div key={n.id} className="flex items-center justify-between px-3 py-2 border border-white/[0.06] bg-[#080808] hover:border-white/15 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-2 h-2 shrink-0" style={{ background: sq.color, boxShadow: `0 0 6px ${sq.color}` }} />
                    <div className="min-w-0">
                      <div className="text-[12px] text-white font-bold truncate">{n.name}</div>
                      <div className="text-[9px] font-mono text-[#545454]">{n.type.toUpperCase()} · {sq.label}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-[10px] font-mono text-[#b8b8b8]">
                      <span className="text-[#545454]">RUN</span> {n.tasks_running ?? 0} <span className="text-[#545454]">Q</span> {n.queue_depth ?? 0}
                    </div>
                    <Pill tone={statusTone(n.status)}>{(n.status || 'UNKNOWN').toUpperCase()}</Pill>
                    <div className="flex gap-1">
                      <button onClick={() => openSpawn(n)} className="text-[9px] font-mono border border-white/10 px-2 py-1 hover:border-emerald-400 hover:text-emerald-400">SPAWN</button>
                      <button onClick={() => openEdit(n)} className="text-[9px] font-mono border border-white/10 px-2 py-1 hover:border-sky-400 hover:text-sky-400">EDIT</button>
                      <button onClick={() => openDelete(n)} className="text-[9px] font-mono border border-white/10 px-2 py-1 hover:border-red-400 hover:text-red-400">DEL</button>
                    </div>
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div className="text-[10px] font-mono text-[#545454] p-4 text-center">
                {isLoading ? 'Loading agents…' : 'No agents match filter.'}
              </div>
            )}
          </div>
        </Panel>
      ) : (
        <Panel label="AGENT ACTIVITY LOG" bodyClass="overflow-auto">
          <div className="flex flex-col gap-1">
            {agentActivity.map((a) => (
              <div key={a.id} className="flex items-center gap-3 px-2 py-1.5 border-b border-white/[0.04] text-[10px] font-mono">
                <span className="text-[#363636] shrink-0">{a.timestamp.toLocaleTimeString()}</span>
                <span className="text-[#b8b8b8] shrink-0 w-16 truncate">{a.agentName}</span>
                <Pill tone={a.action === 'deleted' ? 'bad' : a.action === 'spawned' ? 'warn' : 'info'}>{a.action.toUpperCase()}</Pill>
                <span className="text-[#545454] truncate">{a.detail}</span>
              </div>
            ))}
            {agentActivity.length === 0 && (
              <div className="text-[10px] font-mono text-[#545454] p-4 text-center">No activity recorded yet.</div>
            )}
          </div>
        </Panel>
      )}

      {/* Create Modal */}
      {createOpen && (
        <Modal title="CREATE AGENT" onClose={() => setCreateOpen(false)}>
          <AgentForm
            name={formName} setName={setFormName}
            role={formRole} setRole={setFormRole}
            skills={formSkills} toggleSkill={toggleSkill}
            model={formModel} setModel={setFormModel}
          />
          <div className="flex gap-2 mt-3">
            <button onClick={handleCreate} className="flex-1 text-[10px] font-mono border border-[#f64e6e]/40 bg-[#f64e6e]/10 text-[#f64e6e] py-1.5 hover:bg-[#f64e6e]/20">CREATE</button>
            <button onClick={() => setCreateOpen(false)} className="flex-1 text-[10px] font-mono border border-white/10 text-[#b8b8b8] py-1.5 hover:border-white/30">CANCEL</button>
          </div>
        </Modal>
      )}

      {/* Edit Modal */}
      {editNode && (
        <Modal title={`EDIT AGENT · ${editNode.name}`} onClose={() => setEditNode(null)}>
          <AgentForm
            name={formName} setName={setFormName}
            role={formRole} setRole={setFormRole}
            skills={formSkills} toggleSkill={toggleSkill}
            model={formModel} setModel={setFormModel}
          />
          <div className="flex gap-2 mt-3">
            <button onClick={handleUpdate} className="flex-1 text-[10px] font-mono border border-sky-400/40 bg-sky-400/10 text-sky-400 py-1.5 hover:bg-sky-400/20">SAVE</button>
            <button onClick={() => setEditNode(null)} className="flex-1 text-[10px] font-mono border border-white/10 text-[#b8b8b8] py-1.5 hover:border-white/30">CANCEL</button>
          </div>
        </Modal>
      )}

      {/* Delete Modal */}
      {deleteNode && (
        <Modal title="CONFIRM DELETION" onClose={() => setDeleteNode(null)}>
          <div className="text-[11px] text-[#b8b8b8] font-mono">
            Delete agent <span className="text-white font-bold">{deleteNode.name}</span>? This cannot be undone.
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={handleDelete} className="flex-1 text-[10px] font-mono border border-red-400/40 bg-red-400/10 text-red-400 py-1.5 hover:bg-red-400/20">DELETE</button>
            <button onClick={() => setDeleteNode(null)} className="flex-1 text-[10px] font-mono border border-white/10 text-[#b8b8b8] py-1.5 hover:border-white/30">CANCEL</button>
          </div>
        </Modal>
      )}

      {/* Spawn Modal */}
      {spawnNode && (
        <Modal title={`SPAWN · ${spawnNode.name}`} onClose={() => setSpawnNode(null)}>
          <div className="text-[10px] font-mono text-[#545454] mb-2">SELECT TASK</div>
          <select
            value={formTaskId}
            onChange={(e) => setFormTaskId(e.target.value)}
            className="w-full bg-[#080808] border border-white/10 px-2 py-1.5 text-[11px] text-white focus:border-[#f64e6e] outline-none"
          >
            <option value="">— choose task —</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>{t.name} [{t.status.toUpperCase()}]</option>
            ))}
          </select>
          <div className="flex gap-2 mt-3">
            <button onClick={handleSpawn} disabled={!formTaskId} className="flex-1 text-[10px] font-mono border border-emerald-400/40 bg-emerald-400/10 text-emerald-400 py-1.5 hover:bg-emerald-400/20 disabled:opacity-30">SPAWN</button>
            <button onClick={() => setSpawnNode(null)} className="flex-1 text-[10px] font-mono border border-white/10 text-[#b8b8b8] py-1.5 hover:border-white/30">CANCEL</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[5000] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#0A0A0A] border border-white/10 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="px-3 h-[26px] flex items-center justify-between border-b border-white/10 bg-[#080808]">
          <Label className="text-[#b8b8b8]">{title}</Label>
          <button onClick={onClose} className="text-[#545454] hover:text-white text-[11px]">✕</button>
        </div>
        <div className="p-3">
          {children}
        </div>
      </div>
    </div>
  );
}

function AgentForm({
  name, setName,
  role, setRole,
  skills, toggleSkill,
  model, setModel,
}: {
  name: string; setName: (v: string) => void;
  role: string; setRole: (v: string) => void;
  skills: string[]; toggleSkill: (s: string) => void;
  model: string; setModel: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Agent name..."
        className="bg-[#080808] border border-white/10 px-2 py-1.5 text-[11px] text-white placeholder:text-[#545454] focus:border-[#f64e6e] outline-none" />
      <select value={role} onChange={(e) => setRole(e.target.value)}
        className="bg-[#080808] border border-white/10 px-2 py-1.5 text-[11px] text-white focus:border-[#f64e6e] outline-none">
        <option value="runner">runner</option>
        <option value="fixer">fixer</option>
        <option value="core">core</option>
      </select>
      <div className="text-[10px] font-mono text-[#545454] mb-0.5">MODEL</div>
      <div className="flex flex-wrap gap-1">
        {MODELS.map((m) => (
          <button key={m} onClick={() => setModel(m)}
            className={`text-[9px] font-mono px-2 py-1 border ${model === m ? 'border-[#f64e6e] text-[#f64e6e]' : 'border-white/10 text-[#b8b8b8] hover:border-white/30'}`}>
            {m.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="text-[10px] font-mono text-[#545454] mb-0.5">SKILLS</div>
      <div className="flex flex-wrap gap-1">
        {SKILLS.map((s) => (
          <button key={s} onClick={() => toggleSkill(s)}
            className={`text-[9px] font-mono px-2 py-1 border ${skills.includes(s) ? 'border-emerald-400 text-emerald-400' : 'border-white/10 text-[#b8b8b8] hover:border-white/30'}`}>
            {s.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
}
