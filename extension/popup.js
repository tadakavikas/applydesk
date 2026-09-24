chrome.storage.local.get(['profile'], (res) => {
  const el = document.getElementById('st');
  const p = res && res.profile;
  el.textContent = p && (p.email || p.full_name)
    ? 'Profile ready: ' + (p.full_name || '') + ' · ' + (p.apply_email || p.email || '')
    : 'Open copilot.html, save Profile, then return here.';
});
