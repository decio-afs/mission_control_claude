// Design Lab — home for the four showcase modules, now wired to live data.
//
// History: these tabs (Intel Deck, Workflow Builder, Archives, Broadcast
// Uplink) started as static design ports. They now render real bridge data —
// creator intel (Apify pipeline), the Hermes kanban, the Sentinel digest
// archive, and the channel/gateway matrix — behind internal sub-tabs. The
// legacy routes redirect to /design-lab?tab=<id>, so deep links and the
// command palette still land here.
import { useSearchParams } from 'react-router-dom';
import IntelligenceDeck from './IntelligenceDeck';
import WorkflowBuilder from './WorkflowBuilder';
import Archives from './Archives';
import BroadcastUplink from './BroadcastUplink';

const TABS = [
  { id: 'intel',     label: 'Intel Deck',       Comp: IntelligenceDeck },
  { id: 'builder',   label: 'Workflow Builder', Comp: WorkflowBuilder },
  { id: 'archives',  label: 'Archives',         Comp: Archives },
  { id: 'broadcast', label: 'Broadcast Uplink', Comp: BroadcastUplink },
] as const;

export default function DesignLab() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const active = TABS.find((t) => t.id === requested)?.id ?? TABS[0].id;
  const ActiveComp = (TABS.find((t) => t.id === active) ?? TABS[0]).Comp;

  return (
    <div className="h-full flex flex-col">
      {/* Sub-tab bar */}
      <div className="shrink-0 flex items-center gap-1 px-2 h-[34px] border-b border-white/10 bg-[#050505] overflow-x-auto">
        <span className="font-mono text-[10px] tracking-[0.2em] uppercase font-bold text-[#545454] mr-2 shrink-0">
          DESIGN LAB
        </span>
        {TABS.map((t) => {
          const is = t.id === active;
          return (
            <button
              key={t.id}
              onClick={() => setParams({ tab: t.id }, { replace: true })}
              className={`shrink-0 px-2.5 py-1 text-[10px] font-mono tracking-[0.12em] uppercase border transition-colors ${
                is
                  ? 'border-[#f64e6e] text-[#f64e6e] bg-[#f64e6e]/5'
                  : 'border-white/10 text-[#b8b8b8] hover:border-white/30 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          );
        })}
        <span className="ml-auto shrink-0 font-mono text-[10px] tracking-[0.15em] text-emerald-400/70 border border-emerald-400/30 px-1.5 py-0.5">
          INTEL · LIVE
        </span>
      </div>

      {/* Active module */}
      <div className="flex-1 min-h-0 relative">
        <ActiveComp />
      </div>
    </div>
  );
}
