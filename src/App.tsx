import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Cyberpunk from './pages/Cyberpunk';
import GhostNetwork from './pages/GhostNetwork';
import AgentHub from './pages/AgentHub';
import WarRoom from './pages/WarRoom';
import OperationsCenter from './pages/OperationsCenter';
import ContentFactory from './pages/ContentFactory';
import BriefingTerminal from './pages/BriefingTerminal';
import ChatTerminal from './pages/ChatTerminal';
import LeadTracker from './pages/LeadTracker';
import DesignLab from './pages/DesignLab';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/command" replace />} />
          {/* Live Hermes-backed modules */}
          <Route path="command" element={<Cyberpunk />} />
          <Route path="network" element={<GhostNetwork />} />
          <Route path="agent-hub" element={<AgentHub />} />
          <Route path="war-room" element={<WarRoom />} />
          <Route path="operations" element={<OperationsCenter />} />
          <Route path="leads" element={<LeadTracker />} />
          <Route path="factory" element={<ContentFactory />} />
          <Route path="briefing" element={<BriefingTerminal />} />
          <Route path="chat" element={<ChatTerminal />} />
          {/* Design showcase modules (static demo data), consolidated under one tab */}
          <Route path="design-lab" element={<DesignLab />} />
          {/* Legacy redirects */}
          <Route path="intelligence" element={<Navigate to="/design-lab?tab=intel" replace />} />
          <Route path="builder" element={<Navigate to="/design-lab?tab=builder" replace />} />
          <Route path="archives" element={<Navigate to="/design-lab?tab=archives" replace />} />
          <Route path="broadcast" element={<Navigate to="/design-lab?tab=broadcast" replace />} />
          <Route path="signal-intelligence" element={<Navigate to="/war-room" replace />} />
          <Route path="cyberpunk" element={<Navigate to="/command" replace />} />
          <Route path="*" element={<Navigate to="/command" replace />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;
