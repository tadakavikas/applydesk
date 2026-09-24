(function (root) {
  function splitName(full) {
    const parts = String(full || '').trim().split(/\s+/);
    return { first: parts[0] || '', last: parts.slice(1).join(' ') || '' };
  }

  function normalize(s) {
    return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function setNative(el, value) {
    if (!el || value == null || value === '') return false;
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.classList.add('ad-filled');
    return true;
  }

  function clickYesNo(el, wantYes) {
    const wrap = el.closest('.field, fieldset, [data-automation-id], .application-question, li') || el.parentElement;
    if (!wrap) return false;
    const nodes = [...wrap.querySelectorAll('input[type=radio], input[type=checkbox], button, [role=radio], option')];
    const target = wantYes
      ? nodes.find(n => /^(yes|true|y)$/i.test((n.value || n.textContent || '').trim()) || /yes/i.test(n.getAttribute('aria-label') || ''))
      : nodes.find(n => /^(no|false|n)$/i.test((n.value || n.textContent || '').trim()) || /\bno\b/i.test(n.getAttribute('aria-label') || ''));
    if (target) {
      target.click();
      return true;
    }
    if (el.tagName === 'SELECT') {
      const opt = [...el.options].find(o => wantYes ? /^yes/i.test(o.text) : /^no/i.test(o.text));
      if (opt) { el.value = opt.value; el.dispatchEvent(new Event('change', { bubbles: true })); return true; }
    }
    return false;
  }

  function docsFrom(win) {
    const out = [];
    try { out.push(win.document); } catch (e) { return out; }
    [...win.document.querySelectorAll('iframe')].forEach((frame) => {
      try { out.push(...docsFrom(frame.contentWindow)); } catch (e) {}
    });
    return out;
  }

  function labelFor(el) {
    const bits = [];
    if (el.id) {
      try {
        const by = el.ownerDocument.querySelector('label[for="'+el.id.replace(/"/g,'')+'"]');
        if (by) bits.push(by.innerText);
      } catch (e) {}
    }
    const field = el.closest('.field, .form-group, fieldset, [data-automation-id], .application-question, li');
    if (field) bits.push(field.innerText.slice(0, 280));
    const wrap = el.closest('label');
    if (wrap) bits.push(wrap.innerText);
    bits.push(el.getAttribute('aria-label'), el.placeholder, el.name, el.id);
    return bits.filter(Boolean).join(' ');
  }

  function rules(profile) {
    const names = splitName(profile.full_name);
    const email = profile.apply_email || profile.email || '';
    return [
      { test: /first name|given name|firstname|legal first/, value: names.first },
      { test: /last name|surname|family name|lastname|legal last/, value: names.last },
      { test: /full name|^name$|applicant name|legal name/, value: profile.full_name, skipIf: /first|last|user|company|school/ },
      { test: /e-?mail/, value: email },
      { test: /phone|mobile|telephone|cell/, value: profile.phone },
      { test: /linkedin/, value: profile.linkedin },
      { test: /\bcity\b|current city|city, state/, value: profile.location },
      { test: /street|address line|home address|^address/, value: profile.address },
      { test: /zip|postal/, value: '' },
      { test: /cover letter|coverletter/, value: profile.cover },
      { test: /education|school|university|degree/, value: profile.education },
      { test: /employer|employment|current company|work experience/, value: profile.employment },
      { test: /work preference|remote|hybrid|onsite|on-site/, value: profile.work_preference },
      { test: /start date|earliest start|available to start|availability/, value: profile.start_date },
      { test: /how did you hear|hear about this/, value: profile.heard_from || 'ApplyDesk' },
      { test: /gender|sex assigned/, value: (profile.eeo_json && profile.eeo_json.gender) || profile.eeo_gender },
      { test: /veteran/, value: (profile.eeo_json && profile.eeo_json.veteran) || profile.eeo_veteran },
      { test: /disability/, value: (profile.eeo_json && profile.eeo_json.disability) || profile.eeo_disability },
      { test: /race|ethnicity|hispanic/, value: (profile.eeo_json && profile.eeo_json.race) || profile.eeo_race },
      { test: /authorized to work|legally authorized|work authorization|eligible to work|right to work/, yesNo: profile.work_authorized },
      { test: /sponsorship|require visa|immigration sponsorship|need a visa|future require/, yesNo: profile.visa_sponsorship },
      { test: /willing to relocate|relocat/, yesNo: profile.relocate }
    ];
  }

  function fillFile(el, profile) {
    if (!el || el.type !== 'file') return false;
    try {
      const text = profile.resume_text || '';
      if (!text) return false;
      const file = new File([text], profile.resume_filename || 'Resume.txt', { type: 'text/plain' });
      const dt = new DataTransfer();
      dt.items.add(file);
      el.files = dt.files;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } catch (e) {
      return false;
    }
  }

  function fillDocument(doc, profile) {
    let n = 0;
    const list = rules(profile);
    const fields = [...doc.querySelectorAll('input, textarea, select')];
    fields.forEach((el) => {
      if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button' || el.disabled) return;
      if (el.type === 'file') {
        if (fillFile(el, profile)) n += 1;
        return;
      }
      const label = normalize(labelFor(el));
      if (!label) return;
      for (const rule of list) {
        if (!rule.test.test(label)) continue;
        if (rule.skipIf && rule.skipIf.test(label) && !/full name|applicant name/.test(label)) continue;
        if (rule.yesNo) {
          if (clickYesNo(el, /^y/i.test(rule.yesNo))) n += 1;
        } else if (rule.value) {
          if (el.type === 'radio' || el.type === 'checkbox') {
            if (clickYesNo(el, /^y/i.test(rule.value))) n += 1;
          } else if (setNative(el, rule.value)) n += 1;
        }
        break;
      }
    });
    return n;
  }

  function detectAts(href) {
    const h = String(href || '').toLowerCase();
    if (/greenhouse/.test(h)) return 'Greenhouse';
    if (/lever\.co/.test(h)) return 'Lever';
    if (/ashby/.test(h)) return 'Ashby';
    if (/myworkdayjobs|workday/.test(h)) return 'Workday';
    if (/taleo/.test(h)) return 'Taleo';
    if (/icims/.test(h)) return 'iCIMS';
    if (/smartrecruiters/.test(h)) return 'SmartRecruiters';
    if (/workable/.test(h)) return 'Workable';
    if (/jobvite/.test(h)) return 'Jobvite';
    if (/bamboohr/.test(h)) return 'BambooHR';
    if (/successfactors/.test(h)) return 'SuccessFactors';
    if (/oraclecloud/.test(h)) return 'Oracle';
    if (/phenom/.test(h)) return 'Phenom';
    if (/rippling/.test(h)) return 'Rippling';
    if (/recruitee/.test(h)) return 'Recruitee';
    if (/applytojob|jobboard|careers|jobs\./.test(h)) return 'Career portal';
    return 'Career portal';
  }

  function looksLikeApplication(doc, href) {
    const host = String(href || (doc.location && doc.location.href) || '');
    if (/greenhouse|lever\.co|ashby|myworkdayjobs|taleo|icims|smartrecruiters|workable|jobvite|bamboohr|successfactors|phenom|rippling|recruitee/.test(host)) return true;
    const text = normalize(doc.body ? doc.body.innerText.slice(0, 8000) : '');
    const hits = ['email', 'resume', 'first name', 'cover letter', 'submit application', 'authorized to work', 'apply for this'].filter(k => text.includes(k));
    return hits.length >= 2 && !!doc.querySelector('form, input[type=email], textarea');
  }

  function fill(profile, win) {
    const w = win || (typeof window !== 'undefined' ? window : null);
    if (!w || !profile) return { filled: 0, ats: 'Career portal' };
    const ats = detectAts(w.location && w.location.href);
    let filled = 0;
    docsFrom(w).forEach((doc) => { filled += fillDocument(doc, profile); });
    return { filled, ats };
  }

  root.ApplyDeskFill = { fill, looksLikeApplication, detectAts, splitName };
})(typeof window !== 'undefined' ? window : self);
