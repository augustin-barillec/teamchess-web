import { useState, useEffect, useRef } from 'react';
import { registerSW } from 'virtual:pwa-register';

function ReloadPrompt() {
  const [offlineReady, setOfflineReady] = useState(false);
  const [needRefresh, setNeedRefresh] = useState(false);

  // Store the update function returned by registerSW
  const updateServiceWorker = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    // registerSW returns a function to trigger the update
    const updateSW = registerSW({
      onRegistered(r) {
        console.log(`SW Registered: ${r}`);
      },
      onRegisterError(error) {
        console.error('SW registration error', error);
      },
      onOfflineReady() {
        console.log('App ready to work offline');
        setOfflineReady(true);
      },
      onNeedRefresh() {
        console.log('New content available, update required');
        setNeedRefresh(true);
      },
    });

    updateServiceWorker.current = updateSW;
  }, []);

  const close = () => {
    setOfflineReady(false);
    setNeedRefresh(false);
  };

  const handleReload = () => {
    // This calls the update function returned by registerSW,
    // passing true to force the new SW to take control and reload the page.
    if (updateServiceWorker.current) {
      updateServiceWorker.current(true);
    }
  };

  if (offlineReady) {
    return (
      <div className="pwa-toast">
        <div className="pwa-toast-message">App ready to work offline.</div>
        <button type="button" onClick={() => setOfflineReady(false)}>
          Close
        </button>
      </div>
    );
  }

  if (needRefresh) {
    return (
      <div className="pwa-toast">
        <div className="pwa-toast-message">New version available!</div>
        <button type="button" onClick={handleReload}>
          Reload
        </button>
        <button type="button" className="cancel" onClick={close}>
          Close
        </button>
      </div>
    );
  }

  return null;
}

export default ReloadPrompt;
