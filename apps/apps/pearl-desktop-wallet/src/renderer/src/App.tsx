import {HashRouter as Router, Routes, Route, useLocation} from 'react-router-dom';
import WelcomePage from './pages/WelcomePage';
import ImportAccount from './pages/ImportAccount';
import CreateWallet from './pages/create-wallet/CreateWallet';
import WalletDashboard from './pages/WalletDashboard';
import ActivityPage from './pages/ActivityPage';
import SendTransaction from './pages/send-transaction/SendTransaction';
import ReceiveTransaction from './pages/ReceiveTransaction';
import AppLockScreen from './pages/app-lock/AppLockScreen';
import AppLockSetup from './pages/app-lock/AppLockSetup';
import ChangePassword from './pages/ChangePassword';
import HardwareWallet from './pages/HardwareWallet';
import AppShell from './components/app-shell/AppShell';
import {useNavigate} from 'react-router-dom';
import {SyncWallet} from './SyncWallet';
import {MajorUpgradeBanner} from './components/MajorUpgradeBanner';
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

          {/* Everything behind the lock shares the shell (account switcher,
              network selector, lock) */}
          <Route element={<AppShell />}>
            <Route path="/wallet" element={<WalletDashboard />} />
            <Route path="/send" element={<SendTransaction />} />
            <Route path="/receive" element={<ReceiveTransaction />} />
            <Route path="/hardware-wallet" element={<HardwareWallet />} />
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
    </Router>
  );
}

export default App;
