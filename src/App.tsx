import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import GhostNetwork from './pages/GhostNetwork';
import WarRoom from './pages/WarRoom';
import OperationsCenter from './pages/OperationsCenter';
import ContentFactory from './pages/ContentFactory';
import BriefingTerminal from './pages/BriefingTerminal';
import ChatTerminal from './pages/ChatTerminal';
import LeadTracker from './pages/LeadTracker';
import Arsenal from './pages/Arsenal';
import Uplink from './pages/Uplink';
import Systems from './pages/Systems';
import DesignLab from './pages/DesignLab';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/network" replace />} />
          {/* Live Hermes-backed modules */}
          <Route path="network" element={<GhostNetwork />} />
          <Route path="war-room" element={<WarRoom />} />
          <Route path="operations" element={<OperationsCenter />} />
          <Route path="leads" element={<LeadTracker />} />
          <Route path="factory" element={<ContentFactory />} />
          <Route path="briefing" element={<BriefingTerminal />} />
          <Route path="chat" element={<ChatTerminal />} />
          {/* Full Hermes capability surface */}
          <Route path="arsenal" element={<Arsenal />} />
          <Route path="uplink" element={<Uplink />} />
          <Route path="systems" element={<Systems />} />
          {/* Design showcase modules (static demo data), consolidated under one tab */}
          <Route path="design-lab" element={<DesignLab />} />
          {/* Legacy redirects */}
          <Route path="intelligence" element={<Navigate to="/design-lab?tab=intel" replace />} />
          <Route path="builder" element={<Navigate to="/design-lab?tab=builder" replace />} />
          <Route path="archives" element={<Navigate to="/design-lab?tab=archives" replace />} />
          <Route path="broadcast" element={<Navigate to="/design-lab?tab=broadcast" replace />} />
          <Route path="signal-intelligence" element={<Navigate to="/war-room" replace />} />
          {/* Hermes Command was a redundant mashup of the other live tabs, and
              Agent Hub's CRUD was folded into Ghost Network (agent detail panel
              + Orbital roster). All three redirect to the Ghost Network dashboard. */}
          <Route path="command" element={<Navigate to="/network" replace />} />
          <Route path="cyberpunk" element={<Navigate to="/network" replace />} />
          <Route path="agent-hub" element={<Navigate to="/network" replace />} />
          <Route path="*" element={<Navigate to="/network" replace />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;
