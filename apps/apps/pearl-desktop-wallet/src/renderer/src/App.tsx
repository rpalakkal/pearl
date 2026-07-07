import {HashRouter as Router, Routes, Route, Navigate, useLocation} from 'react-router-dom';
import WelcomePage from './pages/WelcomePage';
import ImportAccount from './pages/ImportAccount';
import CreateWallet from './pages/create-wallet/CreateWallet';
import ActivityPage from './pages/ActivityPage';
import UnifiedDashboard from './pages/unified/UnifiedDashboard';
import UnifiedSend from './pages/unified/UnifiedSend';
import UnifiedReceive from './pages/unified/UnifiedReceive';
import AccountDetailsPage from './pages/unified/AccountDetailsPage';
import AppLockScreen from './pages/app-lock/AppLockScreen';
import AppLockSetup from './pages/app-lock/AppLockSetup';
import ChangePassword from './pages/ChangePassword';
import ConnectHardware from './pages/onboarding/ConnectHardware';
import AppShell from './components/app-shell/AppShell';
import {useNavigate} from 'react-router-dom';
import {SyncWallet} from './SyncWallet';
import {MajorUpgradeBanner} from './components/MajorUpgradeBanner';
import {Toaster} from '@/components/ui/toaster';
import './App.css';

function AppContent() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div className="relative flex h-screen w-full flex-col overflow-hidden bg-gradient-to-br from-gray-50 to-gray-100 font-sans text-gray-900 antialiased">
      <MajorUpgradeBanner />
      <div className={`min-h-0 flex-1`}>
        <Routes>
          {/* Outside the app lock shell: boot, lock screens, onboarding */}
          <Route path="/" element={<WelcomePage />} />
          <Route path="/unlock" element={<AppLockScreen />} />
          <Route path="/setup" element={<AppLockSetup />} />
          <Route path="/import-account" element={<ImportAccount />} />
          <Route path="/onboarding/create" element={<CreateWallet />} />
          <Route path="/onboarding/connect-hardware" element={<ConnectHardware />} />

          {/* Everything behind the lock shares the shell (account switcher,
              network selector, lock) */}
          <Route element={<AppShell />}>
            <Route path="/wallet" element={<UnifiedDashboard />} />
            <Route path="/send" element={<UnifiedSend />} />
            <Route path="/receive" element={<UnifiedReceive />} />
            <Route path="/account" element={<AccountDetailsPage />} />
            {/* Dissolved into the unified pages; keep old links working. */}
            <Route path="/hardware-wallet" element={<Navigate to="/wallet" replace />} />
            <Route path="/change-password" element={<ChangePassword />} />
            <Route path="/activity" element={<ActivityPage onBack={() => navigate('/wallet')} />} />
          </Route>

          <Route
            path="*"
            element={
              <div style={{color: 'red', padding: '20px'}}>
                Route not found: {location.pathname}
              </div>
            }
          />
        </Routes>
      </div>
    </div>
  );
}

function App() {
  return (
    <Router>
      <SyncWallet />
      <AppContent />
      <Toaster />
    </Router>
  );
}

export default App;
