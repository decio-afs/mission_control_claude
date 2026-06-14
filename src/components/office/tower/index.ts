// CLAUDE Agent Tower — typed facade over the vanilla canvas engine.
//
// The engine (ported near-verbatim from Agents_GUI) is a set of side-effect
// modules that assemble themselves on window.HG, exactly like the original
// <script> tags did. Import order below mirrors the original index.html and
// matters. Everything React needs goes through the typed helpers here.
import './config';
import './skins';
import './sprites';
import './props';
import './floors';
import './pathfind';
import './elevator';
import './agents';
import './orchestrator';
import './ui';
import './main';

export interface TowerCastEntry {
  id: string; name: string; role: string;
  skin: string; hair: string; top: string; topLt: string;
  pants: string; boots: string; accent: string; trim: string; acc: string;
}

export interface TowerStatusRow {
  id: string;
  status: 'idle' | 'working' | 'error' | 'done';
  task?: string;
}

export interface TowerWardrobe {
  skin: string; hair: string; top: string; topLt: string;
  pants: string; boots: string; accent: string; trim: string; acc: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const HG = () => (window as any).HG;

export const towerWardrobe = (): TowerWardrobe[] => HG().WARDROBE;

// `sig` is the roster signature: the engine keeps the existing world (every
// agent's position and activity) across mounts as long as it is unchanged, so
// switching tabs and returning never resets the simulation.
export function bootTower(rootEl: HTMLElement, cast: TowerCastEntry[], sign: string, sig: string): void {
  HG().setCast(cast);
  HG().setSign(sign);
  HG().boot(rootEl, sig);
}

export function destroyTower(): void {
  HG().destroy();
}

export function applyTowerStatus(rows: TowerStatusRow[]): void {
  HG().Agents.applyStatus(rows);
}

export function towerSelectById(id: string | null): void {
  HG().UI.selectById(id);
}

export function setTowerOnSelect(cb: ((id: string | null) => void) | null): void {
  HG().UI.onSelect = cb;
}

export function setTowerConn(state: 'live' | 'error' | 'mock'): void {
  HG().UI.setConn(state);
}

// Mark the orchestrator orb active (talking to it / voice link open / engaged)
// so it renders with the lively look even when no agents are working.
export function setTowerActive(active: boolean): void {
  HG().Orchestrator.setActive(active);
}
