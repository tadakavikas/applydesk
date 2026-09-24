(function () {
  const SKIP = /mail\.google|accounts\.google|docs\.google|paypal|chase\.com|bankofamerica|copilot\.html|portal-v2|portal\.html/i;
  if (SKIP.test(location.href)) {
    if (/copilot\.html/.test(location.pathname)) syncFromDesk();
    return;
  }

  function syncFromDesk() {
    try {
      const raw = localStorage.getItem('ad-copilot-profile');
      if (raw && typeof chrome !== 'undefined' && chrome.storage) chrome.storage.local.set({ profile: JSON.parse(raw) });
    } catch (e) {}
    window.addEventListener('message', (ev) => {
      if (ev.data && ev.data.type === 'APPLYDESK_PROFILE' && ev.data.profile && chrome.storage) {
        chrome.storage.local.set({ profile: ev.data.profile });
      }
    });
  }

  function getProfile() {
    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.storage) {
        resolve(window.ApplyDeskWidget.loadProfile());
        return;
      }
      chrome.storage.local.get(['profile'], (res) => {
        resolve((res && res.profile) || window.ApplyDeskWidget.loadProfile());
      });
    });
  }

  function boot() {
    if (!window.ApplyDeskFill || !window.ApplyDeskFill.looksLikeApplication(document, location.href)) return;
    window.ApplyDeskWidget.mount(getProfile);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  setTimeout(boot, 1500);
})();
