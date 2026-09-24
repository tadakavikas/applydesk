(function (root) {
  function loadProfile() {
    try {
      const packet = JSON.parse(sessionStorage.getItem('ad-apply-packet') || 'null');
      if (packet && (packet.answers || packet.apply_email)) {
        return Object.assign({}, packet.answers || {}, {
          full_name: (packet.answers && packet.answers.full_name) || '',
          cover: packet.cover,
          resume_text: packet.resume_text,
          resume_filename: packet.resume_filename,
          apply_email: packet.apply_email,
          eeo_gender: packet.answers && packet.answers.eeo_gender,
          eeo_veteran: packet.answers && packet.answers.eeo_veteran,
          eeo_disability: packet.answers && packet.answers.eeo_disability,
          eeo_race: packet.answers && packet.answers.eeo_race
        });
      }
    } catch (e) {}
    try { return JSON.parse(localStorage.getItem('ad-copilot-profile') || 'null'); } catch (e) { return null; }
  }

  function mount(getProfile) {
    if (document.getElementById('ad-fill-root')) return;
    if (window !== window.top && !(root.ApplyDeskFill && root.ApplyDeskFill.looksLikeApplication(document, location.href))) return;
    const host = document.createElement('div');
    host.id = 'ad-fill-root';
    const ats = root.ApplyDeskFill ? root.ApplyDeskFill.detectAts(location.href) : 'Career portal';
    host.innerHTML = `<div class="ad-card">
      <div class="ad-kicker">ApplyDesk Autofill</div>
      <b>Fill this ${ats} application</b>
      <small>Log in yourself if the board asks. Then hit Autofill. ApplyDesk types your profile. You submit.</small>
      <button type="button" id="ad-fill-btn">Autofill</button>
    </div>`;
    (document.body || document.documentElement).appendChild(host);
    host.querySelector('#ad-fill-btn').addEventListener('click', async () => {
      const btn = host.querySelector('#ad-fill-btn');
      btn.disabled = true;
      btn.textContent = 'Filling…';
      let profile = typeof getProfile === 'function' ? await getProfile() : loadProfile();
      if (!profile) profile = loadProfile();
      if (!profile) {
        btn.disabled = false;
        btn.textContent = 'Open ApplyDesk Profile first';
        return;
      }
      const result = root.ApplyDeskFill.fill(profile, window);
      btn.disabled = false;
      btn.textContent = result.filled ? `Filled ${result.filled} fields · you submit` : 'No matching fields · try scrolling the form';
    });
  }

  root.ApplyDeskWidget = { mount, loadProfile };
})(typeof window !== 'undefined' ? window : self);
