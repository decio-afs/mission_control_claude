/* eslint-disable react-refresh/only-export-components -- this is a hook module
   (returns a `modals` node), not a component file; fast-refresh isolation N/A. */
// useAgentCrud — agent create / edit / delete / spawn-on-task, as a hook.
//
// Encapsulates all the modal state + Mc store calls so any view can offer
// agent management without re-implementing forms. Returns trigger functions
// plus a `modals` node to drop into the tree. (Folded out of the old Agent Hub
// / Registry when agent CRUD moved into Agent Network's detail panel.)
import { useState } from 'react';
import { useGhostStore, type GhostNode } from '../stores/useGhostStore';
import { useTaskStore } from '../stores/useTaskStore';
import { Label } from './cyberpunk/ui';

const SKILLS = ['coding', 'writing', 'research', 'scraping', 'social', 'video', 'design', 'analytics', 'seo', 'email'];

/** Mc profile names are lowercase alphanumeric — mirror the CLI rule live. */
const normName = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');

export interface AgentCrud {
  openCreate: () => void;
  openEdit: (n: GhostNode) => void;
  openDelete: (n: GhostNode) => void;
  openSpawn: (n: GhostNode) => void;
  modals: React.ReactNode;
}

export function useAgentCrud(): AgentCrud {
  const { createAgent, updateAgent, deleteAgent, spawnAgentOnTask } = useGhostStore();
  const crudError = useGhostStore((s) => s.error);
  const tasks = useTaskStore((s) => s.tasks);

  const [createOpen, setCreateOpen] = useState(false);
  const [editNode, setEditNode] = useState<GhostNode | null>(null);
  const [deleteNode, setDeleteNode] = useState<GhostNode | null>(null);
  const [spawnNode, setSpawnNode] = useState<GhostNode | null>(null);

  const [formName, setFormName] = useState('');
  const [formRole, setFormRole] = useState('runner');
  const [formSkills, setFormSkills] = useState<string[]>([]);
  const [formTaskId, setFormTaskId] = useState('');

  const resetForm = () => {
    setFormName(''); setFormRole('runner'); setFormSkills([]); setFormTaskId('');
  };

  const openCreate = () => { resetForm(); setCreateOpen(true); };
  const openEdit = (n: GhostNode) => {
    setEditNode(n);
    setFormName(normName(n.name));
    setFormRole(n.type === 'core' ? 'core' : n.type);
    setFormSkills([]);
    setFormTaskId('');
  };
  const openDelete = (n: GhostNode) => setDeleteNode(n);
  const openSpawn = (n: GhostNode) => { setSpawnNode(n); setFormTaskId(''); };

  const handleCreate = async () => {
    if (!formName.trim()) return;
    const ok = await createAgent({ name: formName.trim(), role: formRole, skills: formSkills });
    if (ok) setCreateOpen(false);
  };
  const handleUpdate = async () => {
    if (!editNode) return;
    const ok = await updateAgent(editNode.id, { name: formName.trim() || editNode.name, role: formRole, skills: formSkills });
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
  const toggleSkill = (skill: string) =>
    setFormSkills((prev) => (prev.includes(skill) ? prev.filter((s) => s !== skill) : [...prev, skill]));

  const modals = (
    <>
      {createOpen && (
        <Modal title="CREATE AGENT" onClose={() => setCreateOpen(false)}>
          <AgentForm name={formName} setName={setFormName} role={formRole} setRole={setFormRole}
            skills={formSkills} toggleSkill={toggleSkill} />
          <div className="flex gap-2 mt-3">
            <button onClick={handleCreate} className="flex-1 text-[10px] font-mono border border-[#f64e6e]/40 bg-[#f64e6e]/10 text-[#f64e6e] py-1.5 hover:bg-[#f64e6e]/20">CREATE</button>
            <button onClick={() => setCreateOpen(false)} className="flex-1 text-[10px] font-mono border border-white/10 text-[#b8b8b8] py-1.5 hover:border-white/30">CANCEL</button>
          </div>
          {crudError && <div className="mt-2 text-[10px] font-mono text-red-400 break-words">▸ {crudError}</div>}
        </Modal>
      )}

      {editNode && (
        <Modal title={`EDIT AGENT · ${editNode.name}`} onClose={() => setEditNode(null)}>
          <AgentForm name={formName} setName={setFormName} role={formRole} setRole={setFormRole}
            skills={formSkills} toggleSkill={toggleSkill} />
          <div className="flex gap-2 mt-3">
            <button onClick={handleUpdate} className="flex-1 text-[10px] font-mono border border-sky-400/40 bg-sky-400/10 text-sky-400 py-1.5 hover:bg-sky-400/20">SAVE</button>
            <button onClick={() => setEditNode(null)} className="flex-1 text-[10px] font-mono border border-white/10 text-[#b8b8b8] py-1.5 hover:border-white/30">CANCEL</button>
          </div>
          {crudError && <div className="mt-2 text-[10px] font-mono text-red-400 break-words">▸ {crudError}</div>}
        </Modal>
      )}

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

      {spawnNode && (
        <Modal title={`SPAWN · ${spawnNode.name}`} onClose={() => setSpawnNode(null)}>
          <div className="text-[10px] font-mono text-[#545454] mb-2">SELECT TASK</div>
          <select value={formTaskId} onChange={(e) => setFormTaskId(e.target.value)}
            className="w-full bg-[#080808] border border-white/10 px-2 py-1.5 text-[11px] text-white focus:border-[#f64e6e] outline-none">
            <option value="">— choose task —</option>
            {tasks.map((t) => <option key={t.id} value={t.id}>{t.name} [{t.status.toUpperCase()}]</option>)}
          </select>
          <div className="flex gap-2 mt-3">
            <button onClick={handleSpawn} disabled={!formTaskId} className="flex-1 text-[10px] font-mono border border-emerald-400/40 bg-emerald-400/10 text-emerald-400 py-1.5 hover:bg-emerald-400/20 disabled:opacity-30">SPAWN</button>
            <button onClick={() => setSpawnNode(null)} className="flex-1 text-[10px] font-mono border border-white/10 text-[#b8b8b8] py-1.5 hover:border-white/30">CANCEL</button>
          </div>
        </Modal>
      )}
    </>
  );

  return { openCreate, openEdit, openDelete, openSpawn, modals };
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[5000] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#0A0A0A] border border-white/10 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="px-3 h-[26px] flex items-center justify-between border-b border-white/10 bg-[#080808]">
          <Label className="text-[#b8b8b8]">{title}</Label>
          <button onClick={onClose} className="text-[#545454] hover:text-white text-[11px]">✕</button>
        </div>
        <div className="p-3">{children}</div>
      </div>
    </div>
  );
}

function AgentForm({
  name, setName, role, setRole, skills, toggleSkill,
}: {
  name: string; setName: (v: string) => void;
  role: string; setRole: (v: string) => void;
  skills: string[]; toggleSkill: (s: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <input value={name} onChange={(e) => setName(normName(e.target.value))} placeholder="Agent name (lowercase, a-z 0-9)..."
        className="bg-[#080808] border border-white/10 px-2 py-1.5 text-[11px] text-white placeholder:text-[#545454] focus:border-[#f64e6e] outline-none" />
      <select value={role} onChange={(e) => setRole(e.target.value)}
        className="bg-[#080808] border border-white/10 px-2 py-1.5 text-[11px] text-white focus:border-[#f64e6e] outline-none">
        <option value="runner">runner</option>
        <option value="fixer">fixer</option>
        <option value="core">core</option>
      </select>
      <div className="text-[10px] font-mono text-[#545454] mb-0.5">SKILLS <span className="text-[#363636]">— becomes the routing description</span></div>
      <div className="flex flex-wrap gap-1">
        {SKILLS.map((s) => (
          <button key={s} onClick={() => toggleSkill(s)}
            className={`text-[10px] font-mono px-2 py-1 border ${skills.includes(s) ? 'border-emerald-400 text-emerald-400' : 'border-white/10 text-[#b8b8b8] hover:border-white/30'}`}>
            {s.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
}
