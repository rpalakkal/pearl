import {useEffect} from 'react';
import {useLocation, useNavigate} from 'react-router-dom';

// Redirects to the app-lock screens when the vault is not unlocked. Pages
// behind the lock mount this; direct deep links and renderer reloads are
// funneled through /setup or /unlock. The vault key lives in main-process
// memory, so a reload while unlocked passes straight through.
export function useAppLockGuard() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;

    window.appBridge.appLock
      .getStatus()
      .then(status => {
        if (cancelled) {
          return;
        }
        if (status === 'uninitialized') {
          navigate(`/setup?next=${encodeURIComponent(location.pathname)}`, {replace: true});
        } else if (status === 'locked') {
          navigate('/unlock', {replace: true});
        }
      })
      .catch(error => {
        console.error('Failed to read app lock status:', error);
      });

    return () => {
      cancelled = true;
    };
    // Run once per mount: the guard is a routing decision, not a subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
