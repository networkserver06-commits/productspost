(() => {
  'use strict';

  const rootPath = window.location.pathname.replace(/^\/+|\/+$/g, '');
  const isPublicUserSite = !!rootPath && !rootPath.startsWith('api') && rootPath !== 'app-upgrade.js';
  const userState = { user: null, wallet: null, mode: 'signin', post: null, pendingUsername: '', postingCostMinor: null, postingCostCurrency: 'KES', postReceipt: null };
  const upgrade = {};
  let pendingUserPostImage = '';
  let upgradeBuildVersion = '';

  function setConnectionBanner(online = true) {
    const banner = document.getElementById('connectionBanner');
    const text = document.getElementById('connectionBannerText');
    const retry = document.getElementById('connectionRetryButton');
    const update = document.getElementById('connectionUpdateButton');
    if (!banner) return;
    if (online) { if (banner.classList.contains('update')) return; banner.classList.remove('open'); return; }
    banner.classList.remove('update');
    if (text) text.textContent = 'No internet connection. Lee Tech will reconnect automatically when you are back online.';
    if (retry) retry.hidden = false;
    if (update) update.hidden = true;
    banner.classList.add('open');
  }
  function showAppUpdate() {
    const banner = document.getElementById('connectionBanner');
    const text = document.getElementById('connectionBannerText');
    const retry = document.getElementById('connectionRetryButton');
    const update = document.getElementById('connectionUpdateButton');
    if (!banner || !navigator.onLine) return;
    if (text) text.textContent = 'A new Lee Tech update is ready. Refresh now to see the latest improvements.';
    if (retry) retry.hidden = true;
    if (update) update.hidden = false;
    banner.classList.add('update', 'open');
  }
  async function checkForAppUpdate() {
    if (!navigator.onLine) return;
    try {
      const response = await fetch('/api/version?ts=' + Date.now(), { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) return;
      const data = await response.json();
      const version = String(data.version || '');
      if (!version) return;
      if (!upgradeBuildVersion) { upgradeBuildVersion = version; return; }
      if (version !== upgradeBuildVersion) showAppUpdate();
    } catch { /* Connection state handles temporary failures. */ }
  }
  function installSharedConnectionRecovery() {
    if (!window.setConnectionBanner) {
      window.setConnectionBanner = setConnectionBanner;
      window.showUpdateAvailable = showAppUpdate;
      window.checkForAppUpdate = checkForAppUpdate;
      window.addEventListener('offline', () => setConnectionBanner(false));
      window.addEventListener('online', () => { setConnectionBanner(true); window.refreshPublicSite?.(); checkForAppUpdate(); });
      document.getElementById('connectionRetryButton')?.addEventListener('click', () => { if (!navigator.onLine) return setConnectionBanner(false); setConnectionBanner(true); window.refreshPublicSite?.(); checkForAppUpdate(); });
      document.getElementById('connectionUpdateButton')?.addEventListener('click', () => window.location.reload());
    }
    if (!navigator.onLine) setConnectionBanner(false);
  }

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  }
  function money(minor = 0, currency = 'KES') {
    return new Intl.NumberFormat('en-KE', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(minor || 0) / 100);
  }
  async function request(url, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const response = await fetch(url, { ...options, headers, credentials: 'include', cache: options.cache || 'no-store' });
    const data = response.status === 204 ? null : await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(data?.error || 'Something went wrong'); if (data && typeof data === 'object') Object.assign(error, data); throw error; }
    return data;
  }
  function notify(message, type = 'info') {
    if (typeof window.toast === 'function') window.toast(message, type);
    else window.alert(message);
  }
  function passwordField({ name = 'password', label = 'Password', autocomplete = 'new-password', hint = '', confirm = false } = {}) {
    const inputName = confirm ? 'confirmPassword' : name;
    const inputLabel = confirm ? 'Confirm password' : label;
    return `<label class="upgrade-field password-field"><span>${inputLabel}</span><div class="password-control"><input type="password" name="${inputName}" autocomplete="${autocomplete}" minlength="12" required><button class="password-toggle" type="button" data-password-toggle aria-label="Show ${inputLabel.toLowerCase()}" aria-pressed="false"><span class="password-toggle-icon">◉</span><span class="password-toggle-label">Show</span></button></div>${hint && !confirm ? `<span class="upgrade-muted">${hint}</span>` : ''}</label>`;
  }
  function bindPasswordToggles(scope = document) {
    scope.querySelectorAll('[data-password-toggle]').forEach(toggle => {
      if (toggle.dataset.bound) return;
      toggle.dataset.bound = 'true';
      toggle.addEventListener('click', () => {
        const input = toggle.parentElement?.querySelector('input');
        if (!input) return;
        const visible = input.type === 'text';
        input.type = visible ? 'password' : 'text';
        toggle.setAttribute('aria-pressed', String(!visible));
        toggle.setAttribute('aria-label', `${visible ? 'Show' : 'Hide'} ${input.name === 'confirmPassword' ? 'confirm password' : 'password'}`);
        const label = toggle.querySelector('.password-toggle-label');
        if (label) label.textContent = visible ? 'Show' : 'Hide';
        const icon = toggle.querySelector('.password-toggle-icon');
        if (icon) icon.textContent = visible ? '◉' : '◌';
      });
    });
  }
  function addStyles() {
    const nonceNode = document.querySelector('style[nonce]');
    const nonce = nonceNode?.nonce || nonceNode?.getAttribute('nonce') || '';
    const style = document.createElement('style');
    if (nonce) style.nonce = nonce;
    style.textContent = `
      .upgrade-account-actions{display:flex;align-items:center;gap:7px}
      .upgrade-user-button{display:inline-flex;align-items:center;justify-content:center;gap:8px;white-space:nowrap}
      .upgrade-account-actions .upgrade-signin-button{display:inline-flex!important}
      .upgrade-user-button .user-dot{width:8px;height:8px;background:#57c7ae;border-radius:50%;display:inline-block}
      .upgrade-field>span:first-child{display:block;font-weight:800;font-size:13px;margin-bottom:6px}
      .password-control{display:flex;align-items:stretch;gap:0;position:relative}
      .password-control input{padding-right:92px!important;min-width:0}
      .password-toggle{position:absolute;right:6px;top:6px;bottom:6px;border:0;border-radius:9px;background:#eef3ff;color:#1f5eff;padding:0 10px;font-weight:800;font-size:12px;display:inline-flex;align-items:center;gap:5px;cursor:pointer}
      .password-toggle:hover{background:#dce8ff}.password-toggle-icon{font-size:12px}.password-toggle-label{min-width:27px}
      .upgrade-trust{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:18px 0}.upgrade-trust span{padding:10px;border:1px solid #e5e1d8;border-radius:12px;background:#faf9f5;color:#777d75;font-size:11px;text-align:center;font-weight:700}
      .upgrade-verification-card{background:linear-gradient(135deg,#eef3ff,#f6fbf8);border:1px solid #dbe6f5;border-radius:16px;padding:16px;margin:18px 0}.upgrade-verification-card strong{display:block;color:#12233f;margin-bottom:5px}\n      .upgrade-signup-offer{display:flex;align-items:center;gap:14px;background:linear-gradient(135deg,#fff6d9,#eef8f4);border:1px solid #ead89a;border-radius:16px;padding:14px 16px;margin:16px 0 18px}.upgrade-signup-offer-mark{display:grid;place-items:center;flex:0 0 46px;width:46px;height:46px;border-radius:14px;background:#f0c85a;color:#12233f;font-weight:900;font-size:14px}.upgrade-signup-offer strong{display:block;color:#12233f;font-size:15px;margin-bottom:3px}.upgrade-signup-offer span{display:block;color:#68758a;font-size:12px;line-height:1.45}.upgrade-signup-offer b{color:#20735b}
      .upgrade-code-input{letter-spacing:.3em;text-align:center;font-size:21px;font-weight:800}
      .upgrade-text-button{border:0;background:transparent;color:#1f5eff;font-weight:800;padding:8px 0;text-align:left;cursor:pointer}.upgrade-text-button:hover{text-decoration:underline}
      .upgrade-form button:disabled{opacity:.6;cursor:wait}
      .upgrade-library-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-left:auto}.upgrade-library-actions button{white-space:nowrap}.upgrade-danger-action{color:#a83f4f!important;border-color:#efc8cf!important;background:#fff6f7!important}.upgrade-danger-action:hover{background:#ffecef!important;border-color:#d77c8a!important}
      .upgrade-overlay{position:fixed;inset:0;background:#07101bbf;backdrop-filter:blur(8px);z-index:110;display:none;place-items:center;padding:18px;overflow:auto}
      .upgrade-overlay.open{display:grid}
      .upgrade-panel{width:min(900px,100%);max-height:92vh;overflow:auto;background:#fffdf9;color:#1d211f;border-radius:24px;padding:28px;box-shadow:0 24px 80px #0006;position:relative}
      .upgrade-panel.narrow{width:min(540px,100%)}
      .upgrade-panel h2{font-size:clamp(30px,5vw,48px);letter-spacing:-.06em;margin:10px 0}
      .upgrade-close{position:absolute;right:18px;top:18px;border:0;background:#f0eee7;border-radius:10px;width:36px;height:36px;font-size:20px}
      .upgrade-tabs{display:flex;gap:8px;border-bottom:1px solid #e5e1d8;margin:12px 0 20px;padding-bottom:10px}
      .upgrade-tab{border:0;background:transparent;color:#777d75;font-weight:800;padding:9px 11px;border-radius:9px;cursor:pointer}
      .upgrade-tab.active{background:#1d1f1c;color:#fff}
      .upgrade-form{display:grid;gap:12px;max-width:640px}
      .upgrade-form label{font-weight:800;font-size:13px;display:grid;gap:6px}
      .upgrade-form input,.upgrade-form textarea,.upgrade-form select{border:1px solid #dedbd1;border-radius:12px;padding:13px;background:#faf9f5;color:#1d211f;font:inherit}
      .upgrade-form textarea{min-height:150px;resize:vertical}
      .upgrade-post-cost-box{display:grid;grid-template-columns:1fr auto;gap:14px;align-items:center;padding:15px 16px;border:1px solid #cfe0f2;border-radius:15px;background:linear-gradient(135deg,#eef3ff,#f4fbf7);margin:2px 0 4px}.upgrade-post-cost-box strong{display:block;font:800 24px Manrope;color:#12233f;margin-top:5px}.upgrade-post-cost-box small{display:block;color:#68758a;font-size:11px;line-height:1.45;margin-top:4px}.upgrade-post-cost-balance{text-align:right;border-left:1px solid #cfe0f2;padding-left:14px}.upgrade-post-cost-balance strong{font-size:18px}.upgrade-post-receipt{display:grid;gap:5px;padding:13px 15px;border-radius:13px;background:#e2f5ee;color:#20735b;font-size:12px}.upgrade-post-receipt strong{color:#165d49}.upgrade-post-edit-note{display:block;color:#68758a;font-size:11px;margin-top:2px}
      .upgrade-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
      .upgrade-muted{color:#777d75;font-size:13px}
      .upgrade-alert{padding:12px 14px;border-radius:12px;background:#fff3d8;color:#704d0c;font-size:13px;margin:12px 0}
      .upgrade-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:18px 0}
      .upgrade-stat{background:#f4f2ec;border:1px solid #e5e1d8;border-radius:16px;padding:17px}
      .upgrade-stat small{display:block;color:#777d75;font-weight:700}
      .upgrade-stat strong{display:block;font:800 28px Manrope;margin-top:8px}
      .upgrade-card{background:#faf9f5;border:1px solid #e5e1d8;border-radius:16px;padding:16px;margin:12px 0}
      .upgrade-row{display:flex;justify-content:space-between;gap:14px;align-items:center;padding:12px 0;border-bottom:1px solid #e5e1d8}
      .upgrade-row:last-child{border-bottom:0}
      .upgrade-row small{color:#777d75}
      .upgrade-link{color:#1f5eff;font-weight:800;word-break:break-all}
      .upgrade-balance{font:800 42px Manrope;letter-spacing:-.06em}
      .upgrade-dashboard{display:grid;grid-template-columns:236px minmax(0,1fr);min-height:720px;background:#f3f1eb;margin:-28px;border-radius:24px;overflow:hidden;color:#1d211f}.upgrade-dashboard-side{background:#1d1f1c;color:#fff;padding:26px 15px;display:flex;flex-direction:column}.upgrade-dashboard-brand{display:flex;align-items:center;gap:10px;padding:0 10px 26px}.upgrade-dashboard-brand>div{display:grid;line-height:1.15}.upgrade-dashboard-brand strong{font-size:15px}.upgrade-dashboard-brand small{color:#aeb2ab;font-size:11px;margin-top:4px}.upgrade-dashboard-avatar{display:grid;place-items:center;width:38px;height:38px;border-radius:12px;background:#f1b247;color:#1d1f1c;font:800 18px Manrope}.upgrade-dashboard-kicker{color:#747973;font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;padding:0 12px 10px}.upgrade-user-select{position:relative;z-index:5}.upgrade-user-select-toggle{width:100%;display:flex;align-items:center;gap:10px;border:1px solid #ffffff18;background:#343633;color:#fff;border-radius:12px;padding:11px 10px;text-align:left;cursor:pointer}.upgrade-user-select-toggle:hover,.upgrade-user-select-toggle:focus-visible{border-color:#f1b247;outline:0}.upgrade-user-select-icon{display:grid;place-items:center;width:25px;height:25px;border-radius:8px;background:#f1b247;color:#1d1f1c;font-size:13px;font-weight:800}.upgrade-user-select-copy{display:grid;gap:2px;min-width:0}.upgrade-user-select-copy small{color:#aeb2ab;font-size:10px}.upgrade-user-select-copy strong{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.upgrade-user-select-chevron{margin-left:auto;color:#f1b247;font-size:19px;line-height:1;transition:transform .2s}.upgrade-user-select-toggle[aria-expanded=true] .upgrade-user-select-chevron{transform:rotate(180deg)}.upgrade-user-menu{display:none;position:absolute;left:0;right:0;top:calc(100% + 8px);padding:6px;background:#2a2c29;border:1px solid #ffffff18;border-radius:14px;box-shadow:0 20px 45px #0006}.upgrade-user-menu.open{display:grid}.upgrade-user-menu button{display:flex;align-items:center;gap:10px;width:100%;border:0;border-left:3px solid transparent;background:transparent;color:#aeb2ab;border-radius:9px;padding:10px;font-weight:700;text-align:left;cursor:pointer}.upgrade-user-menu button:hover,.upgrade-user-menu button:focus-visible{background:#3a3d39;color:#fff;outline:0}.upgrade-user-menu button.active{background:#3a3d39;color:#fff;border-left-color:#f1b247}.upgrade-user-menu button span:first-child{width:18px;color:#f1b247;text-align:center}.upgrade-user-menu-rule{height:1px;background:#ffffff18;margin:5px 4px}.upgrade-dashboard-side-footer{display:grid;gap:8px;margin-top:auto}.upgrade-dashboard-side-footer a,.upgrade-dashboard-side-footer button{border:0;background:transparent;color:#aeb2ab;padding:11px 10px;text-align:left;font-weight:700}.upgrade-dashboard-side-footer a:hover,.upgrade-dashboard-side-footer button:hover{color:#fff}.upgrade-dashboard-main{background:#f3f1eb;padding:34px;min-width:0}.upgrade-dashboard-top{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:24px}.upgrade-dashboard-top>div:first-child{flex:1;min-width:0}.upgrade-dashboard-menu-anchor{flex:0 0 auto;min-width:220px;max-width:300px;z-index:12}.upgrade-dashboard-menu-anchor .upgrade-user-select-toggle{width:250px;background:#fffdf9;color:#1d211f;border-color:#d8e1ea;box-shadow:0 8px 22px #10213b12}.upgrade-dashboard-menu-anchor .upgrade-user-select-toggle:hover,.upgrade-dashboard-menu-anchor .upgrade-user-select-toggle:focus-visible{background:#fff;border-color:#f1b247;color:#1d211f}.upgrade-dashboard-menu-anchor .upgrade-user-select-copy small{color:#68758a}.upgrade-dashboard-menu-anchor .upgrade-user-select-chevron{color:#b57a09}.upgrade-dashboard-menu-anchor .upgrade-user-menu{left:auto;right:0;width:290px;max-width:min(290px,calc(100vw - 36px));max-height:min(70vh,520px);overflow:auto;top:calc(100% + 10px);z-index:20}.upgrade-dashboard-side-footer{display:none}.upgrade-dashboard-top h2{font:800 clamp(28px,4vw,46px) Manrope;letter-spacing:-.06em;margin:7px 0 5px}.upgrade-dashboard-top p{color:#7d817a;margin:0;max-width:620px}.upgrade-dashboard-site-link{max-width:290px;color:#1f5eff;font-size:12px;font-weight:800;word-break:break-all;text-align:right}.upgrade-user-panel{display:none}.upgrade-user-panel.active{display:block;animation:userPanelIn .25s ease both}@keyframes userPanelIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}.upgrade-user-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.upgrade-user-stats .upgrade-stat{min-height:124px;background:#fffdf9;border-color:#e4e0d6;display:flex;flex-direction:column;justify-content:space-between}.upgrade-user-stats .upgrade-stat strong{font-size:26px;color:#1d211f}.upgrade-user-stats .upgrade-stat span{color:#888d84;font-size:11px;line-height:1.35}.upgrade-user-stats .upgrade-stat.highlight{background:#1d1f1c;color:#fff;border-color:#1d1f1c}.upgrade-user-stats .upgrade-stat.highlight small,.upgrade-user-stats .upgrade-stat.highlight span{color:#aeb2ab}.upgrade-user-stats .upgrade-stat.highlight strong{color:#fff}.upgrade-two-col{display:grid;grid-template-columns:1.15fr .85fr;gap:14px}.upgrade-card{background:#fffdf9;border:1px solid #e4e0d6;border-radius:18px;padding:18px;margin:14px 0;box-shadow:0 10px 28px rgba(31,34,27,.04)}.upgrade-card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px}.upgrade-card-head h3{margin:4px 0 0;font-size:20px;letter-spacing:-.03em}.upgrade-welcome-card{display:flex;justify-content:space-between;align-items:center;gap:20px;background:linear-gradient(135deg,#dce8ff,#eef6f1);border:1px solid #cfe0f2;border-radius:20px;padding:22px;margin:0 0 14px}.upgrade-welcome-card h3{font-size:26px;letter-spacing:-.04em;margin:5px 0}.upgrade-welcome-card p{color:#65748d;margin:0}.upgrade-welcome-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.upgrade-status-pill{display:inline-flex;align-items:center;border-radius:99px;background:#f0eee7;color:#70776d;padding:5px 9px;font-size:11px;font-weight:800}.upgrade-status-pill.success{background:#e2f5ee;color:#20735b}.upgrade-status-pill.danger{background:#fff0ee;color:#b54f4a}.upgrade-public-link,.upgrade-profile-link{display:block;color:#1f5eff;font-weight:800;word-break:break-all;background:#eef3ff;border-radius:12px;padding:12px;margin:10px 0}.upgrade-history-row,.upgrade-breakdown-row{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:12px 0;border-bottom:1px solid #e8e5dd}.upgrade-history-row:last-child,.upgrade-breakdown-row:last-child{border-bottom:0}.upgrade-history-row>div{display:grid;gap:3px;min-width:0}.upgrade-history-row strong{font-size:13px;overflow:hidden;text-overflow:ellipsis}.upgrade-history-row small{color:#888d84;font-size:11px}.positive{color:#16805b}.negative{color:#c05750}.upgrade-empty-state,.upgrade-chart-empty{display:grid;gap:5px;place-items:center;text-align:center;padding:26px;color:#888d84;font-size:12px}.upgrade-empty-state strong,.upgrade-chart-empty strong{color:#444942;font-size:14px}.upgrade-chart{display:flex;align-items:end;gap:8px;min-height:178px;padding:16px 4px 4px;border-bottom:1px solid #e4e0d6;background:repeating-linear-gradient(to bottom,transparent 0,transparent 40px,#ece9e2 41px)}.upgrade-chart.tall{min-height:230px}.upgrade-chart-column{flex:1;min-width:12px;height:150px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:5px}.upgrade-chart.tall .upgrade-chart-column{height:205px}.upgrade-chart-value{font-size:10px;color:#7d817a}.upgrade-chart-bar{width:100%;max-width:25px;min-height:7px;border-radius:7px 7px 2px 2px;background:linear-gradient(180deg,#d48768,#f1b247)}.upgrade-chart-bar.level-1{height:10%}.upgrade-chart-bar.level-2{height:20%}.upgrade-chart-bar.level-3{height:30%}.upgrade-chart-bar.level-4{height:40%}.upgrade-chart-bar.level-5{height:50%}.upgrade-chart-bar.level-6{height:60%}.upgrade-chart-bar.level-7{height:70%}.upgrade-chart-bar.level-8{height:80%}.upgrade-chart-bar.level-9{height:90%}.upgrade-chart-bar.level-10{height:100%}.upgrade-chart-column small{font-size:9px;color:#9a9e98}.upgrade-breakdown-row span{color:#697069;font-size:13px;overflow:hidden;text-overflow:ellipsis}.upgrade-breakdown-row b{font-size:13px}.upgrade-service-row{display:flex;justify-content:space-between;align-items:center;gap:18px;padding:15px 0;border-bottom:1px solid #e8e5dd}.upgrade-service-row:last-child{border-bottom:0}.upgrade-service-row p{color:#888d84;font-size:12px;margin:4px 0 0}.upgrade-service-buy{display:grid;gap:8px;justify-items:end;white-space:nowrap}.upgrade-check{display:flex!important;align-items:center;gap:8px}.upgrade-check input{width:auto!important}.upgrade-contact-divider{display:grid;gap:5px;border-top:1px solid #e4e0d6;margin-top:8px;padding-top:18px}.upgrade-contact-divider span{color:#1d211f;font-size:12px;font-weight:800;letter-spacing:.04em;text-transform:uppercase}.upgrade-contact-divider small{color:#888d84;font-size:11px;line-height:1.45}.upgrade-contact-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.upgrade-contact-grid label{min-width:0}.upgrade-library-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.upgrade-product-fields{display:grid;gap:12px;padding:15px;border:1px solid #dbe5f2;border-radius:15px;background:#f4f7fc}.upgrade-product-fields[hidden]{display:none}.upgrade-image-upload{display:grid;gap:9px;padding:14px;border:1px dashed #cbd5e4;border-radius:15px;background:#faf9f5}.upgrade-image-upload-actions{display:flex;gap:8px;flex-wrap:wrap}.upgrade-upload-button{display:inline-flex!important;align-items:center;cursor:pointer;border:1px solid #bfd0f2;border-radius:10px;background:#eef3ff;color:#1f5eff;padding:10px 12px;font-weight:800;font-size:12px}.upgrade-upload-button input{display:none}.upgrade-image-preview{display:grid;grid-template-columns:auto 1fr;align-items:center;gap:10px;min-height:48px;color:#888d84;font-size:11px}.upgrade-image-preview img{width:70px;height:48px;object-fit:cover;border-radius:10px;border:1px solid #e4e0d6}.upgrade-public-content-group{margin-top:34px}.upgrade-public-content-heading{display:flex;align-items:end;justify-content:space-between;gap:15px;margin-bottom:16px}.upgrade-public-content-heading h2{font:800 clamp(27px,4vw,42px) Manrope;letter-spacing:-.06em;margin:8px 0 0}.upgrade-public-content-heading>span{color:#7a8495;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;white-space:nowrap}.upgrade-public-product-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.upgrade-public-product{display:flex;flex-direction:column;min-width:0;background:#fff;border:1px solid #e4e9f0;border-radius:22px;padding:17px;box-shadow:0 14px 35px #19335a0b}.upgrade-public-product-topline{display:flex;justify-content:space-between;align-items:center;color:#1f5eff;font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}.upgrade-public-product-topline b{color:#7a8495}.upgrade-public-product-image,.upgrade-public-product-placeholder{display:block;width:100%;height:170px;object-fit:cover;border-radius:15px;margin:13px 0;background:linear-gradient(135deg,#dce8ff,#eef6f1)}.upgrade-public-product-placeholder{display:grid;place-items:center;color:#1f5eff;font-size:42px}.upgrade-public-product-kicker{color:#1f5eff;font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;margin:14px 0 7px}.upgrade-public-product h3{font:800 24px/1.08 Manrope;letter-spacing:-.05em;margin:0 0 9px}.upgrade-public-product p{color:#68758a;line-height:1.6;min-height:50px;margin:0}.upgrade-public-product-foot{display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap;border-top:1px solid #e7ebf0;margin-top:16px;padding-top:13px}.upgrade-public-product-foot strong{font:800 19px Manrope}.upgrade-public-product-foot span{color:#7a8495;font-size:11px;text-align:right;margin-left:auto}.upgrade-product-buy,.upgrade-product-share{display:flex;width:100%;box-sizing:border-box;align-items:center;justify-content:center;margin-top:12px;min-height:48px;text-align:center;text-decoration:none}.upgrade-public-product-actions{display:grid;gap:10px;margin-top:12px}.upgrade-public-product-actions .upgrade-product-buy,.upgrade-public-product-actions .upgrade-product-share{margin-top:0}.upgrade-public-empty .upgrade-public-text-link{color:#1f5eff}.upgrade-public-cta .upgrade-public-eyebrow{color:#20735b}.upgrade-public-shell{min-height:100vh;background:#f7f8fb;color:#12233f;overflow:hidden}.upgrade-public-nav{max-width:1120px;margin:0 auto;padding:18px 22px;display:flex;align-items:center;justify-content:space-between;gap:18px}.upgrade-public-brand{display:flex;align-items:center;gap:10px;color:#12233f}.upgrade-public-brand-mark{display:grid;place-items:center;width:38px;height:38px;border-radius:12px;background:#0e1b32;color:#bdebdc;font:800 19px Manrope;box-shadow:0 8px 18px #0e1b3230}.upgrade-public-brand span:last-child{display:grid;gap:1px}.upgrade-public-brand strong{font:800 16px Manrope;letter-spacing:-.04em}.upgrade-public-brand small{color:#7a8495;font-size:10px}.upgrade-public-nav-actions{display:flex;align-items:center;gap:12px;color:#7a8495;font-size:12px;font-weight:800}.upgrade-public-nav-actions .ghost{padding:9px 12px}.upgrade-public-hero{background:linear-gradient(135deg,#0e1b32 0%,#183564 65%,#1f5eff 100%);color:#fff;position:relative;overflow:hidden}.upgrade-public-hero:after{content:'';position:absolute;width:420px;height:420px;right:-160px;top:-190px;border-radius:50%;background:#57c7ae55;box-shadow:-120px 470px 0 20px #f1b2471f}.upgrade-public-hero-inner{max-width:1120px;margin:0 auto;padding:64px 22px 78px;position:relative;z-index:1}.upgrade-public-eyebrow{color:#bdebdc;font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase}.upgrade-public-hero-grid{display:grid;grid-template-columns:minmax(0,1fr) 310px;align-items:end;gap:50px;margin-top:26px}.upgrade-public-handle{display:inline-flex;align-items:center;border:1px solid #ffffff22;background:#ffffff0d;color:#d9e5fa;border-radius:99px;padding:7px 12px;font-size:12px;font-weight:800}.upgrade-public-hero h1{font:800 clamp(44px,7vw,82px) Manrope;letter-spacing:-.08em;line-height:.98;max-width:760px;margin:20px 0 18px;overflow-wrap:anywhere}.upgrade-public-hero p{color:#b7c2d7;font-size:17px;line-height:1.6;max-width:620px;margin:0 0 26px}.upgrade-public-hero .primary{box-shadow:0 12px 28px #0003}.upgrade-public-text-link{display:inline-flex;align-items:center;color:#dce8ff;font-weight:800;padding:11px 3px}.upgrade-public-profile-card{display:grid;grid-template-columns:auto 1fr;align-items:center;gap:12px;background:#ffffff12;border:1px solid #ffffff2e;border-radius:22px;padding:18px;backdrop-filter:blur(12px);box-shadow:0 22px 45px #06132f40}.upgrade-public-profile-mark{display:grid;place-items:center;width:54px;height:54px;border-radius:17px;background:#f1b247;color:#1d1f1c;font:800 24px Manrope}.upgrade-public-profile-card>div:nth-child(2){display:grid;gap:3px}.upgrade-public-profile-card strong{font-size:16px}.upgrade-public-profile-card span{color:#b7c2d7;font-size:12px}.upgrade-public-profile-status{grid-column:1/-1;color:#bdebdc;font-size:11px;font-weight:800;border-top:1px solid #ffffff1c;padding-top:12px}.upgrade-public-profile-status i{display:inline-block;width:7px;height:7px;border-radius:50%;background:#57c7ae;margin-right:6px}.upgrade-public-body{max-width:1120px;margin:0 auto;padding:68px 22px 82px}.upgrade-public-section-head{display:flex;justify-content:space-between;align-items:end;gap:20px}.upgrade-public-section-head h2{font:800 clamp(34px,5vw,56px) Manrope;letter-spacing:-.07em;margin:10px 0 0}.upgrade-public-section-meta{display:grid;text-align:right;gap:2px;color:#7a8495;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.1em}.upgrade-public-section-meta b{font:800 30px Manrope;color:#12233f;letter-spacing:-.05em}.upgrade-public-section-note{color:#7a8495;margin:10px 0 30px;max-width:650px}.upgrade-public-body .upgrade-post-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.upgrade-public-body .upgrade-post{background:#fff;border:1px solid #e4e9f0;border-radius:22px;padding:20px;box-shadow:0 14px 35px #19335a0b;transition:transform .25s,box-shadow .25s}.upgrade-public-body .upgrade-post:hover{transform:translateY(-4px);box-shadow:0 22px 45px #19335a14}.upgrade-post-topline{display:flex;justify-content:space-between;align-items:center;color:#7a8495;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.upgrade-post-topline span{color:#1f5eff}.upgrade-public-shell .upgrade-post-image{display:block!important;width:100%!important;max-width:100%!important;height:220px!important;object-fit:cover;border-radius:15px;margin:16px 0;box-sizing:border-box}.upgrade-post-kicker{color:#1f5eff;font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;margin:18px 0 8px}.upgrade-public-body .upgrade-post h2{font:800 clamp(24px,3vw,32px) Manrope;letter-spacing:-.05em;margin:0 0 12px}.upgrade-public-body .upgrade-post p{color:#68758a;white-space:pre-wrap;line-height:1.75;margin:0}.upgrade-post-bottom{display:flex;justify-content:space-between;align-items:center;gap:12px;border-top:1px solid #e7ebf0;margin-top:22px;padding-top:15px;color:#7a8495;font-size:11px}.upgrade-post-bottom .ghost{padding:8px 10px;font-size:11px}.upgrade-public-empty{grid-column:1/-1;display:grid;place-items:center;text-align:center;background:#fff;border:1px dashed #cbd5e4;border-radius:22px;padding:54px 22px}.upgrade-public-empty-icon{display:grid;place-items:center;width:54px;height:54px;border-radius:18px;background:#eef3ff;color:#1f5eff;font-size:25px;margin-bottom:15px}.upgrade-public-empty h3{font:800 26px Manrope;letter-spacing:-.05em;margin:0 0 8px}.upgrade-public-empty p{color:#7a8495;max-width:420px;margin:0 0 16px}.upgrade-public-contact{background:#fff;border:1px solid #e4e9f0;border-radius:24px;padding:26px 28px;margin:0 0 22px;box-shadow:0 14px 35px #19335a0b}.upgrade-public-contact-head{display:flex;justify-content:space-between;align-items:end;gap:20px;margin-bottom:18px}.upgrade-public-contact-head h2{font:800 clamp(28px,4vw,42px) Manrope;letter-spacing:-.06em;margin:8px 0}.upgrade-public-contact-head p{color:#7a8495;margin:0}.upgrade-public-contact-count{color:#1f5eff;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;white-space:nowrap}.upgrade-public-contact-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.upgrade-public-contact-link{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:10px;color:#12233f;border:1px solid #e4e9f0;background:#f7f8fb;border-radius:15px;padding:13px;transition:background .2s,border-color .2s,transform .2s}.upgrade-public-contact-link:hover{background:#eef3ff;border-color:#bfd0f2;transform:translateY(-2px)}.upgrade-public-contact-icon{display:grid;place-items:center;width:32px;height:32px;border-radius:10px;background:#0e1b32;color:#bdebdc;font:800 13px Manrope}.upgrade-public-contact-link>span:nth-child(2){display:grid;gap:2px;min-width:0}.upgrade-public-contact-link strong{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.upgrade-public-contact-link small{color:#7a8495;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.upgrade-public-contact-link>b{color:#1f5eff;font-size:14px}.upgrade-public-cta{max-width:1076px;margin:0 auto 68px;background:linear-gradient(135deg,#dce8ff,#eef6f1);border:1px solid #cfe0f2;border-radius:26px;padding:30px 34px;display:flex;justify-content:space-between;align-items:center;gap:24px}.upgrade-public-cta h2{font:800 clamp(25px,4vw,39px) Manrope;letter-spacing:-.06em;margin:8px 0}.upgrade-public-cta p{color:#65748d;margin:0;max-width:590px}.upgrade-public-footer{max-width:1120px;margin:0 auto;padding:24px 22px 34px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;gap:18px;color:#7a8495;font-size:11px}.upgrade-public-footer .upgrade-public-brand strong{color:#12233f}.upgrade-public-footer .upgrade-public-brand-mark{width:30px;height:30px;font-size:15px}.upgrade-public-footer .upgrade-public-brand small{color:#7a8495}@media(max-width:780px){.upgrade-public-nav{align-items:flex-start;padding:15px 16px}.upgrade-public-nav-actions{display:grid;justify-items:end;gap:5px}.upgrade-public-nav-actions>span{display:none}.upgrade-public-nav-actions .ghost{font-size:12px;padding:8px 10px}.upgrade-public-hero-inner{padding:46px 16px 58px}.upgrade-public-hero-grid{grid-template-columns:1fr;gap:26px;margin-top:20px}.upgrade-public-hero h1{font-size:clamp(42px,14vw,64px);max-width:100%}.upgrade-public-hero p{font-size:15px}.upgrade-public-profile-card{max-width:360px}.upgrade-public-body{padding:50px 16px 60px}.upgrade-public-section-head{align-items:start}.upgrade-public-section-head h2{font-size:40px}.upgrade-public-section-meta{padding-top:6px}.upgrade-public-section-note{font-size:13px;margin-bottom:24px}.upgrade-public-body .upgrade-post-grid{grid-template-columns:1fr}.upgrade-public-body .upgrade-post{padding:17px}.upgrade-post-image{height:190px}.upgrade-public-cta{display:block;margin:0 16px 50px;padding:24px 20px}.upgrade-public-cta .primary{margin-top:18px}.upgrade-public-footer{display:grid;padding:22px 16px 30px}.upgrade-public-footer .upgrade-public-brand{order:0}.upgrade-public-contact-head{display:block}.upgrade-public-contact-count{display:inline-block;margin-top:12px}.upgrade-public-contact-grid{grid-template-columns:1fr}.upgrade-public-contact-link{padding:13px}.upgrade-contact-grid,.upgrade-library-grid,.upgrade-public-product-grid{grid-template-columns:1fr} }
      .upgrade-site-hero h1{font-size:clamp(38px,7vw,72px);margin:12px 0;letter-spacing:-.07em}
      .upgrade-site-hero p{color:#b7c2d7;max-width:680px}
      .upgrade-site-body{max-width:1000px;margin:0 auto;padding:38px 22px 70px}
      .upgrade-post-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:18px}
      .upgrade-post{background:#fff;border:1px solid #e5eaf1;border-radius:20px;padding:22px;box-shadow:0 12px 32px #19335a08}
      .upgrade-post h2{font-size:26px;letter-spacing:-.04em}
      .upgrade-post p{color:#6d7b92;white-space:pre-wrap}
      .upgrade-post time{color:#6d7b92;font-size:12px}
      .upgrade-site-hero-actions,.upgrade-post-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.upgrade-post-actions{margin-top:16px}.upgrade-site-share,.upgrade-post-share{cursor:pointer}
      .upgrade-admin-toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:0 0 16px}
      .upgrade-admin-toolbar input{flex:1;min-width:220px;padding:12px;border:1px solid #dedbd1;border-radius:12px;background:#fffdf9}
      @media(max-width:700px){.upgrade-dashboard-top{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:14px}.upgrade-dashboard-menu-anchor{width:min(100%,250px);min-width:0;max-width:250px;justify-self:end}.upgrade-dashboard-menu-anchor .upgrade-user-select-toggle{width:100%}.upgrade-dashboard-menu-anchor .upgrade-user-menu{width:min(290px,calc(100vw - 34px));max-width:calc(100vw - 34px);right:0;top:calc(100% + 8px)}.upgrade-dashboard-site-link{grid-column:1/-1}.upgrade-grid,.upgrade-post-grid{grid-template-columns:1fr}.upgrade-panel{padding:22px 17px}.upgrade-balance{font-size:34px}.upgrade-trust{grid-template-columns:1fr}.password-toggle{padding:0 8px}.upgrade-dashboard{grid-template-columns:1fr;margin:-22px -17px;border-radius:0;min-height:760px}.upgrade-dashboard-side{position:sticky;top:0;z-index:3;padding:18px 15px}.upgrade-dashboard-brand{padding-bottom:14px}.upgrade-dashboard-kicker{display:none}.upgrade-user-select{width:100%}.upgrade-user-menu{top:calc(100% + 7px)}.upgrade-dashboard-side-footer{display:none}.upgrade-dashboard-main{padding:22px 17px 35px}.upgrade-dashboard-top{display:block}.upgrade-dashboard-site-link{display:block;text-align:left;max-width:none;margin-top:10px}.upgrade-user-stats{grid-template-columns:repeat(2,1fr)}.upgrade-two-col{grid-template-columns:1fr}.upgrade-welcome-card{display:block}.upgrade-welcome-actions{justify-content:flex-start;margin-top:15px}.upgrade-service-row{align-items:flex-start}.upgrade-service-buy{justify-items:end}.upgrade-card{padding:15px}}
    `;
    document.head.appendChild(style);
  }
  function makeOverlay() {
    if (document.getElementById('upgradeUserOverlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'upgradeUserOverlay';
    overlay.className = 'upgrade-overlay';
    overlay.innerHTML = `<div class="upgrade-panel narrow"><button class="upgrade-close" data-upgrade-close>×</button><div id="upgradeAuthContent"></div></div>`;
    overlay.addEventListener('click', event => { if (event.target === overlay) overlay.classList.remove('open'); });
    overlay.querySelector('[data-upgrade-close]').addEventListener('click', () => overlay.classList.remove('open'));
    document.body.appendChild(overlay);
  }
  function openAuth(mode = 'signin') {
    makeOverlay();
    userState.mode = mode;
    const overlay = document.getElementById('upgradeUserOverlay');
    overlay.querySelector('.upgrade-panel').classList.add('narrow');
    renderAuth();
    overlay.classList.add('open');
  }
  function renderAuth() {
    const box = document.getElementById('upgradeAuthContent');
    const mode = userState.mode;
    if (mode === 'verify') {
      box.innerHTML = `<div class="eyebrow">Lee Tech community</div><h2>Verify your email.</h2><p class="upgrade-muted">We sent a secure verification link and a six-digit code. Use either one to activate your creator site.</p><div class="upgrade-verification-card"><strong>Check your inbox</strong><span class="upgrade-muted">The email is branded Lee Tech, powered by Lee Tech, and marked as an automated no-reply message.</span></div><form class="upgrade-form" id="upgradeVerifyForm"><label class="upgrade-field"><span>Verification code</span><input class="upgrade-code-input" name="code" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" placeholder="000000" autocomplete="one-time-code" required><span class="upgrade-muted">Enter the six-digit code from the email.</span></label><div class="upgrade-actions"><button class="primary" type="submit">Verify account</button><button class="ghost" type="button" id="upgradeResendButton">Send again</button></div><div id="upgradeVerifyMessage" class="upgrade-muted"></div></form><button class="upgrade-text-button" type="button" data-auth-mode="signin">Back to sign in</button>`;
      box.querySelector('#upgradeVerifyForm').addEventListener('submit', submitVerification);
      box.querySelector('#upgradeResendButton').addEventListener('click', resendVerification);
      box.querySelectorAll('[data-auth-mode]').forEach(button => button.addEventListener('click', () => { userState.mode = button.dataset.authMode; renderAuth(); }));
      return;
    }
    const register = mode === 'register';
    const forgot = mode === 'forgot';
    const title = register ? 'Create your site.' : forgot ? 'Reset your password.' : 'Welcome back.';
    const intro = register ? 'Choose the username that becomes your public site link.' : forgot ? 'We will send a secure one-hour reset link if the account exists.' : 'Sign in to manage your posts, wallet, and services.';
    const formFields = register
      ? '<label class="upgrade-field"><span>Username</span><input name="username" minlength="3" maxlength="30" pattern="[a-z0-9-]+" placeholder="leetech" autocomplete="username" required><span class="upgrade-muted">Your public link: post.leetec.online/username</span></label><label class="upgrade-field"><span>Email address</span><input type="email" name="email" autocomplete="email" required></label>' + passwordField({ hint: 'Use at least 12 characters for a stronger account.', confirm: false }) + passwordField({ confirm: true, autocomplete: 'new-password' })
      : `<label class="upgrade-field"><span>Email address</span><input type="email" name="email" autocomplete="email" required></label>${forgot ? '' : passwordField({ label: 'Password', autocomplete: 'current-password' })}`;
    box.innerHTML = `<div class="eyebrow">Lee Tech community</div><h2>${title}</h2><p class="upgrade-muted">${intro}</p>${register ? '<div class="upgrade-signup-offer"><div class="upgrade-signup-offer-mark">KES<br>10</div><div><strong>Start with a free KES 10.00 welcome credit.</strong><span>Use it for publishing and paid Lee Tech services. It is added to your wallet when your account is created.</span></div></div>' : ''}${!forgot ? `<div class="upgrade-tabs"><button class="upgrade-tab ${!register ? 'active' : ''}" data-auth-mode="signin">Sign in</button><button class="upgrade-tab ${register ? 'active' : ''}" data-auth-mode="register">Create account</button></div>` : ''}<div class="upgrade-trust"><span>Secure account</span><span>Private dashboard</span><span>Powered by Lee Tech</span></div><form class="upgrade-form" id="upgradeAuthForm">${formFields}<div class="upgrade-actions"><button class="primary" type="submit">${register ? 'Create account' : forgot ? 'Send reset link' : 'Sign in securely'}</button>${!register && !forgot ? '<button class="ghost" type="button" data-auth-mode="forgot">Forgot password?</button>' : ''}</div><div id="upgradeAuthMessage" class="upgrade-muted"></div></form>${!register && !forgot ? '<button class="upgrade-text-button" type="button" id="upgradeResendFromLogin">Need a new verification email?</button>' : ''}${register ? '<button class="upgrade-text-button" type="button" data-auth-mode="signin">Already have an account? Sign in</button>' : ''}`;
    box.querySelectorAll('[data-auth-mode]').forEach(button => button.addEventListener('click', () => { userState.mode = button.dataset.authMode; renderAuth(); }));
    box.querySelector('#upgradeAuthForm').addEventListener('submit', submitAuth);
    if (!register && !forgot) box.querySelector('#upgradeResendFromLogin')?.addEventListener('click', resendFromLogin);
    bindPasswordToggles(box);
  }
  async function submitAuth(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = form.querySelector('#upgradeAuthMessage');
    const values = Object.fromEntries(new FormData(form).entries());
    const button = form.querySelector('button[type=submit]');
    if (userState.mode === 'register' && values.password !== values.confirmPassword) { message.textContent = 'Passwords do not match.'; return; }
    button.disabled = true;
    message.textContent = 'Working…';
    try {
      let data;
      if (userState.mode === 'register') {
        userState.pendingUsername = values.username;
        data = await request('/api/auth/user/register', { method: 'POST', body: JSON.stringify({ username: values.username, email: values.email, password: values.password }) });
        userState.mode = 'verify';
        renderAuth();
        notify(data.message, 'success');
      } else if (userState.mode === 'forgot') {
        data = await request('/api/auth/user/forgot-password', { method: 'POST', body: JSON.stringify(values) });
        message.textContent = data.message;
        notify(data.message, 'success');
      } else {
        data = await request('/api/auth/user/login', { method: 'POST', body: JSON.stringify(values) });
        userState.user = data.user;
        document.getElementById('upgradeUserOverlay').classList.remove('open');
        renderUserButton();
        notify('Signed in successfully.', 'success');
        openDashboard();
      }
    } catch (error) { message.textContent = error.message; notify(error.message, 'error'); }
    finally { button.disabled = false; }
  }
  async function submitVerification(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = form.querySelector('#upgradeVerifyMessage');
    const button = form.querySelector('button[type=submit]');
    const code = String(new FormData(form).get('code') || '').trim();
    button.disabled = true;
    message.textContent = 'Verifying…';
    try {
      const data = await request(`/api/auth/user/verify-email?code=${encodeURIComponent(code)}&username=${encodeURIComponent(userState.pendingUsername)}`);
      notify(data.message, 'success');
      userState.mode = 'signin';
      renderAuth();
    } catch (error) { message.textContent = error.message; notify(error.message, 'error'); }
    finally { button.disabled = false; }
  }
  async function resendVerification() {
    if (!userState.pendingUsername) return notify('Please start account creation again.', 'error');
    try {
      const data = await request('/api/auth/user/resend-verification', { method: 'POST', body: JSON.stringify({ username: userState.pendingUsername }) });
      notify(data.message, 'success');
    } catch (error) { notify(error.message, 'error'); }
  }
  async function resendFromLogin() {
    const email = document.querySelector('#upgradeAuthForm input[name="email"]')?.value.trim();
    const message = document.querySelector('#upgradeAuthMessage');
    if (!email) { if (message) message.textContent = 'Enter your email address first.'; return; }
    try {
      const data = await request('/api/auth/user/resend-verification', { method: 'POST', body: JSON.stringify({ email }) });
      if (message) message.textContent = data.message;
      notify(data.message, 'success');
    } catch (error) { if (message) message.textContent = error.message; notify(error.message, 'error'); }
  }
  async function loadUser() {
    try { userState.user = (await request('/api/me')).user; renderUserButton(); } catch { userState.user = null; renderUserButton(); }
  }
  function renderUserButton() {
    const actions = document.querySelector('.nav-actions');
    if (!actions || document.getElementById('upgradeAccountActions')) return;
    const group = document.createElement('div');
    group.id = 'upgradeAccountActions';
    group.className = 'upgrade-account-actions';
    group.innerHTML = '<button id="upgradeSignInButton" class="ghost upgrade-user-button upgrade-signin-button" type="button">Sign in</button><button id="upgradeRegisterButton" class="primary upgrade-user-button upgrade-register-button" type="button">Create account</button>';
    actions.insertBefore(group, actions.firstChild);
    document.getElementById('upgradeSignInButton').addEventListener('click', () => userState.user ? openDashboard() : openAuth('signin'));
    document.getElementById('upgradeRegisterButton').addEventListener('click', () => userState.user ? openDashboard() : openAuth('register'));
    updateUserButton();
  }
  function updateUserButton() {
    const signIn = document.getElementById('upgradeSignInButton');
    const register = document.getElementById('upgradeRegisterButton');
    if (!signIn || !register) return;
    if (userState.user) {
      signIn.innerHTML = '<span class="user-dot"></span> My dashboard';
      register.style.display = 'none';
    } else {
      signIn.textContent = 'Sign in';
      register.textContent = 'Create account';
      register.style.display = 'inline-flex';
    }
  }
  async function ensureWallet() {
    if (!userState.user) return;
    try { userState.wallet = await request('/api/wallet'); } catch { userState.wallet = null; }
  }
  function formatUserDate(value) { try { return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return '—'; } }
  function chartLevel(value, max) { return Math.max(1, Math.min(10, Math.ceil((Number(value || 0) / Math.max(1, max)) * 10))); }
  function renderUserChart(daily = []) { const rows = daily.slice(-14); if (!rows.length) return '<div class="upgrade-chart-empty"><strong>Your audience is waiting.</strong><span>Share your site to start collecting visitor insights.</span></div>'; const max = Math.max(...rows.map(row => Number(row.visits || 0)), 1); return rows.map(row => `<div class="upgrade-chart-column"><div class="upgrade-chart-value">${Number(row.visits || 0)}</div><div class="upgrade-chart-bar level-${chartLevel(row.visits, max)}" title="${escapeHtml(String(row.visits || 0))} visits"></div><small>${escapeHtml(String(row.date || '').slice(5))}</small></div>`).join(''); }
  function renderActivityRows(rows = [], currency = 'KES') { return rows.length ? rows.map(row => `<div class="upgrade-history-row"><div><strong>${escapeHtml(row.description || row.type || row.serviceName || 'Activity')}</strong><small>${formatUserDate(row.createdAt)}</small></div><b class="${Number(row.amountMinor || 0) >= 0 ? 'positive' : 'negative'}">${row.amountMinor != null ? `${Number(row.amountMinor) >= 0 ? '+' : ''}${money(row.amountMinor, currency)}` : escapeHtml(row.status || 'Complete')}</b></div>`).join('') : '<div class="upgrade-empty-state">Nothing here yet.</div>'; }
  function renderUserLibrarySections(posts = []) {
    const blogs = posts.filter(post => post.contentType !== 'product');
    const products = posts.filter(post => post.contentType === 'product');
    const rows = (items, empty) => items.length ? items.map(post => { const kind = post.contentType === 'product' ? 'product' : 'blog'; const label = kind === 'product' ? 'product' : 'blog'; return `<div class="upgrade-history-row"><div><strong>${escapeHtml(post.title)}</strong><small>${post.published ? 'Published on your site' : 'Draft'} · ${formatUserDate(post.createdAt)}</small></div><div class="upgrade-library-actions"><button class="ghost" data-upgrade-edit-post="${escapeHtml(post._id)}">Edit</button><button class="ghost upgrade-danger-action" type="button" data-upgrade-delete-post="${escapeHtml(post._id)}" data-upgrade-delete-kind="${label}">Delete</button></div></div>`; }).join('') : `<div class="upgrade-empty-state">${empty}</div>`;
    return `<div class="upgrade-library-grid"><div class="upgrade-card"><div class="upgrade-card-head"><div><span class="eyebrow">Blog library</span><h3>Blogs & journal notes</h3></div><span class="upgrade-status-pill">${blogs.length}</span></div>${rows(blogs, 'Your first blog will appear here.')}</div><div class="upgrade-card"><div class="upgrade-card-head"><div><span class="eyebrow">Product library</span><h3>Digital & physical products</h3></div><span class="upgrade-status-pill">${products.length}</span></div>${rows(products, 'Your first product will appear here.')}</div></div>`;
  }
  function renderUserPostImagePreview(value = '') { const box = document.getElementById('upgradePostImagePreview'); if (!box) return; box.innerHTML = value ? `<img src="${escapeHtml(value)}" alt="Selected cover preview"><span>Compressed and ready to save</span>` : '<span>No image selected</span>'; }
  function compressUserPostImage(input) {
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { notify('Please choose an image file.', 'error'); input.value = ''; return; }
    if (file.size > 10 * 1024 * 1024) { notify('Choose an image smaller than 10 MB.', 'error'); input.value = ''; return; }
    const reader = new FileReader();
    reader.onload = () => { const image = new Image(); image.onload = () => { const max = 1400; const scale = Math.min(1, max / Math.max(image.width, image.height)); const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale)); const context = canvas.getContext('2d'); context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height); let result = ''; for (const quality of [.82, .68, .54, .42]) { result = canvas.toDataURL('image/jpeg', quality); if (result.length <= 1900000) break; } if (result.length > 1900000) { notify('That image is still too large after compression. Choose a smaller image.', 'error'); input.value = ''; return; } pendingUserPostImage = result; renderUserPostImagePreview(result); }; image.onerror = () => notify('Could not read that image.', 'error'); image.src = reader.result; }; reader.onerror = () => notify('Could not load that image.', 'error'); reader.readAsDataURL(file);
  }
  function updateUserPostCostPreview() {
    const form = document.getElementById('upgradePostForm');
    if (!form) return;
    const cost = Number(userState.postingCostMinor || 0);
    const balance = Number(userState.wallet?.balanceMinor || 0);
    const isProduct = form.elements.contentType?.value === 'product';
    const isEdit = !!userState.post;
    const wasPublished = !!userState.post?.published;
    const isPublishing = form.elements.published?.checked === true;
    const willCharge = isProduct && isPublishing && !wasPublished;
    const charge = willCharge ? cost : 0;
    const costNode = document.getElementById('upgradePostCost');
    const detailNode = document.getElementById('upgradePostCostDetail');
    const balanceNode = document.getElementById('upgradePostBalance');
    const labelNode = document.getElementById('upgradePostCostLabel');
    if (labelNode) labelNode.textContent = isProduct ? 'Product publishing fee' : 'Blog publishing';
    if (costNode) costNode.textContent = !isProduct ? 'Free' : userState.postingCostMinor === null ? 'Checking current price…' : charge ? money(charge, userState.postingCostCurrency) : 'No deduction';
    if (detailNode) detailNode.textContent = !isProduct ? 'Blogs and journal posts are free to publish.' : isEdit && wasPublished ? 'Editing this published product does not charge a new publishing fee.' : willCharge ? (balance >= charge ? 'This exact product-publishing fee will be deducted only after you confirm.' : 'Top up before publishing to cover this product fee.') : 'Save as a draft at no cost, or turn on Publish now to review the product fee.';
    if (balanceNode) balanceNode.textContent = money(Math.max(0, balance - charge), userState.postingCostCurrency);
    const receipt = document.getElementById('upgradePostReceipt');
    if (receipt) receipt.innerHTML = userState.postReceipt ? `<strong>Latest receipt: ${userState.postReceipt.chargedMinor ? 'Deducted ' + escapeHtml(money(userState.postReceipt.chargedMinor, userState.postReceipt.currency)) : 'No publishing fee deducted.'}</strong><span>Remaining wallet balance: ${escapeHtml(money(userState.postReceipt.balanceAfterMinor, userState.postReceipt.currency))}</span>` : '';
    const review = document.getElementById('upgradePostReview');
    if (review) {
      review.hidden = !isPublishing;
      review.textContent = isPublishing ? (!isProduct ? 'Review publishing\n\nBlogs and journal posts are free. No wallet deduction will be made.' : willCharge ? `Review: ${money(charge, userState.postingCostCurrency)} will be deducted. Estimated remaining balance: ${money(Math.max(0, balance - charge), userState.postingCostCurrency)}.` : 'Review: no additional product-publishing fee will be deducted for this edit.') : '';
    }
  }
  function updateUserPostTypeFields() { const form = document.getElementById('upgradePostForm'); if (!form) return; const isProduct = form.elements.contentType?.value === 'product'; const fields = document.getElementById('upgradeProductPostFields'); if (fields) fields.hidden = !isProduct; const stockField = document.getElementById('upgradeProductStockField'); const isPhysical = form.elements.productType?.value === 'physical'; if (stockField) stockField.hidden = !isProduct || !isPhysical; if (form.elements.price) form.elements.price.required = isProduct; if (form.elements.stock) form.elements.stock.required = isProduct && isPhysical; const saveLabel = form.querySelector('[data-post-save-label]'); if (saveLabel) saveLabel.textContent = isProduct ? 'Save product' : 'Save blog'; const title = form.querySelector('[data-post-form-title]'); if (title) title.textContent = userState.post ? (isProduct ? 'Edit product' : 'Edit blog') : (isProduct ? 'Create a product' : 'Create a post or blog'); const cancel = document.getElementById('upgradeCancelPostEdit'); if (cancel) cancel.hidden = !userState.post; updateUserPostCostPreview(); }
  function openDashboard(view = 'overview') {
    if (!userState.user) return openAuth('signin');
    userState.dashboardView = view;
    makeOverlay();
    const overlay = document.getElementById('upgradeUserOverlay');
    overlay.querySelector('.upgrade-panel').classList.remove('narrow');
    overlay.querySelector('#upgradeAuthContent').innerHTML = `<div id="upgradeDashboardContent" class="upgrade-dashboard"><aside class="upgrade-dashboard-side"><div class="upgrade-dashboard-brand"><span class="upgrade-dashboard-avatar">${escapeHtml((userState.user.displayName || userState.user.username).slice(0, 1).toUpperCase())}</span><div><strong>${escapeHtml(userState.user.displayName || userState.user.username)}</strong><small>@${escapeHtml(userState.user.username)}</small></div></div><div class="upgrade-dashboard-kicker">Creator workspace</div><div class="upgrade-dashboard-side-footer"><a href="${escapeHtml(userState.user.siteUrl)}" target="_blank" rel="noopener">↗ View public site</a><button data-upgrade-logout>⇥ Sign out securely</button></div></aside><section class="upgrade-dashboard-main"><header class="upgrade-dashboard-top"><div><div class="eyebrow">Lee Tech / Creator workspace</div><h2 id="upgradeUserViewTitle">Overview</h2><p>Build your site, understand your audience, and keep every transaction clear.</p></div><div class="upgrade-user-select upgrade-dashboard-menu-anchor"><button class="upgrade-user-select-toggle" type="button" aria-expanded="false" aria-haspopup="menu"><span class="upgrade-user-select-icon">◈</span><span class="upgrade-user-select-copy"><small>Workspace view</small><strong data-user-select-label>Overview</strong></span><span class="upgrade-user-select-chevron">⌄</span></button><div class="upgrade-user-menu" id="upgradeUserMenu" role="menu"><button class="active" type="button" data-user-view="overview" role="menuitem"><span>◈</span><span>Overview</span></button><button type="button" data-user-view="analytics" role="menuitem"><span>⌁</span><span>Visitor analytics</span></button><button type="button" data-user-view="content" role="menuitem"><span>▤</span><span>Posts & blogs</span></button><button type="button" data-user-view="wallet" role="menuitem"><span>¤</span><span>Wallet & history</span></button><button type="button" data-user-view="services" role="menuitem"><span>◇</span><span>Paid services</span></button><button type="button" data-user-view="profile" role="menuitem"><span>◎</span><span>Profile & site</span></button><button type="button" data-user-view="security" role="menuitem"><span>◌</span><span>Security</span></button><div class="upgrade-user-menu-rule"></div><button type="button" data-user-action="visit-site" role="menuitem"><span>↗</span><span>Visit my site</span></button><button type="button" data-user-action="logout" role="menuitem"><span>⇥</span><span>Log out</span></button></div></div><a class="upgrade-dashboard-site-link" href="${escapeHtml(userState.user.siteUrl)}" target="_blank" rel="noopener">${escapeHtml(userState.user.siteUrl)} ↗</a></header><div id="upgradeDashboardBody"><div class="upgrade-muted">Loading dashboard…</div></div></section></div>`;
    overlay.querySelector('[data-upgrade-logout]').addEventListener('click', logoutUser);
    overlay.querySelectorAll('.upgrade-user-menu [data-user-action]').forEach(button => button.addEventListener('click', () => { if (button.dataset.userAction === 'logout') logoutUser(); else window.open(userState.user.siteUrl, '_blank', 'noopener'); }));
    const userSelect = overlay.querySelector('.upgrade-user-select');
    const userToggle = overlay.querySelector('.upgrade-user-select-toggle');
    const userMenu = overlay.querySelector('.upgrade-user-menu');
    const closeUserMenu = () => { userMenu?.classList.remove('open'); userToggle?.setAttribute('aria-expanded', 'false'); };
    userToggle?.addEventListener('click', event => { event.stopPropagation(); const open = !userMenu.classList.contains('open'); userMenu.classList.toggle('open', open); userToggle.setAttribute('aria-expanded', String(open)); });
    overlay.querySelectorAll('.upgrade-user-menu [data-user-view]').forEach(button => button.addEventListener('click', () => { switchUserDashboardView(button.dataset.userView); closeUserMenu(); }));
    if (!overlay.dataset.userMenuBound) { document.addEventListener('click', event => { if (overlay.classList.contains('open') && userSelect && !userSelect.contains(event.target)) closeUserMenu(); }); document.addEventListener('keydown', event => { if (event.key === 'Escape') closeUserMenu(); }); overlay.dataset.userMenuBound = 'true'; }
    overlay.classList.add('open');
    loadDashboard();
    if (view !== 'overview') switchUserDashboardView(view);
  }
  function switchUserDashboardView(view) { userState.dashboardView = view; const body = document.getElementById('upgradeDashboardBody'); if (!body) return; body.querySelectorAll('[data-user-panel]').forEach(panel => panel.classList.toggle('active', panel.dataset.userPanel === view)); const dashboard = document.getElementById('upgradeDashboardContent'); dashboard?.querySelectorAll('[data-user-view]').forEach(button => button.classList.toggle('active', button.dataset.userView === view)); const title = { overview: 'Overview', analytics: 'Visitor analytics', content: 'Posts & blogs', wallet: 'Wallet & history', services: 'Paid services', profile: 'Profile & site', security: 'Security' }[view] || 'Overview'; const titleNode = document.getElementById('upgradeUserViewTitle'); if (titleNode) titleNode.textContent = title; const label = dashboard?.querySelector('[data-user-select-label]'); if (label) label.textContent = title; const toggle = dashboard?.querySelector('.upgrade-user-select-toggle'); const menu = dashboard?.querySelector('.upgrade-user-menu'); if (toggle) toggle.setAttribute('aria-expanded', 'false'); menu?.classList.remove('open'); bindUserDashboardActions(); }
  function renderUserDashboardPanels({ posts, services, wallet, analytics, security }) {
    const contact = userState.user.contact || {};
    const transactions = wallet.transactions || [];
    const payments = wallet.payments || [];
    const purchases = wallet.purchases || [];
    const published = posts.filter(post => post.published).length;
    const drafts = posts.length - published;
    const topups = payments.filter(payment => payment.status === 'credited');
    const serviceSpend = transactions.filter(row => row.type === 'service_charge').reduce((sum, row) => sum + Math.abs(Number(row.amountMinor || 0)), 0);
    const topupTotal = topups.reduce((sum, row) => sum + Number(row.amountMinor || 0), 0);
    const hasWelcomeCredit = transactions.some(row => row.type === 'welcome_credit');
    return `<section class="upgrade-user-panel active" data-user-panel="overview"><div class="upgrade-welcome-card"><div><span class="eyebrow">Your creator site is ready</span><h3>Make your next idea public.</h3><p>Share your link, publish thoughtful work, and watch your audience grow.</p>${hasWelcomeCredit ? '<span class="upgrade-status-pill success">KES 10.00 welcome credit included</span>' : ''}</div><div class="upgrade-welcome-actions"><a class="primary" href="${escapeHtml(userState.user.siteUrl)}" target="_blank" rel="noopener">Open my site ↗</a><button class="ghost" data-user-view="content">Write a post</button></div></div><div class="upgrade-user-stats"><div class="upgrade-stat"><small>Wallet balance</small><strong>${money(wallet.balanceMinor, wallet.currency)}</strong><span>Available to publish & use services</span></div><div class="upgrade-stat"><small>Visitors · 24 hours</small><strong>${Number(analytics.visits || 0)}</strong><span>${Number(analytics.sessions || 0)} unique sessions</span></div><div class="upgrade-stat"><small>Published posts</small><strong>${published}</strong><span>${drafts} draft${drafts === 1 ? '' : 's'} in your workspace</span></div><div class="upgrade-stat"><small>Account status</small><strong>${userState.user.emailVerified ? 'Verified' : 'Pending'}</strong><span>Protected creator account</span></div></div><div class="upgrade-two-col"><div class="upgrade-card upgrade-analytics-card"><div class="upgrade-card-head"><div><span class="eyebrow">Audience signal</span><h3>Visitors over time</h3></div><button class="upgrade-text-button" data-user-view="analytics">View analytics ↗</button></div><div class="upgrade-chart">${renderUserChart(analytics.daily)}</div></div><div class="upgrade-card"><div class="upgrade-card-head"><div><span class="eyebrow">Public identity</span><h3>Your site link</h3></div><span class="upgrade-status-pill">Live</span></div><a class="upgrade-public-link" href="${escapeHtml(userState.user.siteUrl)}" target="_blank" rel="noopener">${escapeHtml(userState.user.siteUrl)}</a><p class="upgrade-muted">Only your published posts and blogs appear on this public site.</p><button class="ghost" data-user-view="profile">Edit profile & bio</button></div></div><div class="upgrade-card"><div class="upgrade-card-head"><div><span class="eyebrow">Latest movement</span><h3>Wallet activity</h3></div><button class="upgrade-text-button" data-user-view="wallet">See full history ↗</button></div>${renderActivityRows(transactions.slice(0, 5), wallet.currency)}</div></section><section class="upgrade-user-panel" data-user-panel="analytics"><div class="upgrade-user-stats"><div class="upgrade-stat"><small>Total visits</small><strong>${Number(analytics.visits || 0)}</strong><span>Last ${analytics.days || 1} day</span></div><div class="upgrade-stat"><small>Unique sessions</small><strong>${Number(analytics.sessions || 0)}</strong><span>Privacy-safe session estimate</span></div><div class="upgrade-stat"><small>Top-up volume</small><strong>${money(topupTotal, wallet.currency)}</strong><span>${topups.length} completed top-up${topups.length === 1 ? '' : 's'}</span></div><div class="upgrade-stat"><small>Service spend</small><strong>${money(serviceSpend, wallet.currency)}</strong><span>${purchases.length} purchase${purchases.length === 1 ? '' : 's'}</span></div></div><div class="upgrade-card upgrade-analytics-card"><div class="upgrade-card-head"><div><span class="eyebrow">Audience signal</span><h3>Visitor trend</h3></div><span class="upgrade-muted">Operational activity expires after 24 hours</span></div><div class="upgrade-chart tall">${renderUserChart(analytics.daily)}</div></div><div class="upgrade-two-col"><div class="upgrade-card"><div class="upgrade-card-head"><h3>Devices</h3><span class="upgrade-muted">Visits</span></div>${(analytics.devices || []).length ? analytics.devices.map(row => `<div class="upgrade-breakdown-row"><span>${escapeHtml(row._id || 'Unknown')}</span><b>${Number(row.value || 0)}</b></div>`).join('') : '<div class="upgrade-empty-state">No device data yet.</div>'}</div><div class="upgrade-card"><div class="upgrade-card-head"><h3>Top sources</h3><span class="upgrade-muted">Referrers</span></div>${(analytics.sources || []).length ? analytics.sources.map(row => `<div class="upgrade-breakdown-row"><span>${escapeHtml(row._id || 'Direct')}</span><b>${Number(row.value || 0)}</b></div>`).join('') : '<div class="upgrade-empty-state">No referral data yet.</div>'}</div></div><div class="upgrade-card"><div class="upgrade-card-head"><h3>Popular pages</h3><span class="upgrade-muted">Paths</span></div>${(analytics.pages || []).length ? analytics.pages.map(row => `<div class="upgrade-breakdown-row"><span>${escapeHtml(row._id || '/')}</span><b>${Number(row.value || 0)}</b></div>`).join('') : '<div class="upgrade-empty-state">Your site pages will appear here.</div>'}</div></section><section class="upgrade-user-panel" data-user-panel="content"><div class="upgrade-card"><div class="upgrade-card-head"><div><span class="eyebrow">Publish to your site</span><h3 data-post-form-title>Create a post or blog</h3></div><span class="upgrade-muted">Product fee is shown before you confirm · Blogs are free</span></div><form class="upgrade-form" id="upgradePostForm"><label>Publishing format<select name="contentType" id="upgradePostType"><option value="blog">Blog / journal note</option><option value="product">Product listing</option></select></label><label>Title<input name="title" maxlength="180" required></label><label>Excerpt or short summary<input name="excerpt" maxlength="500" placeholder="A short introduction for your readers"></label><label>Description or content<textarea name="content" maxlength="50000" required placeholder="Write something worth sharing…"></textarea></label><div id="upgradeProductPostFields" class="upgrade-product-fields" hidden><label>Product type<select name="productType" id="upgradeProductType"><option value="digital">Digital product</option><option value="physical">Physical product</option></select></label><label>Price (KES)<input name="price" type="number" min="0" step="0.01" placeholder="0.00" inputmode="decimal"></label><label id="upgradeProductStockField" hidden>Stock quantity<input name="stock" type="number" min="0" step="1" placeholder="0" inputmode="numeric"></label><small class="upgrade-muted">Digital products can be delivered or accessed online. Physical products include stock information for your customers.</small></div><label>Cover image URL<input name="image" maxlength="2000000" placeholder="https://…"></label><div class="upgrade-image-upload"><div class="upgrade-image-upload-actions"><label class="upgrade-upload-button">Upload image<input id="upgradePostImageFile" type="file" accept="image/*"></label><label class="upgrade-upload-button">Use camera<input id="upgradePostImageCamera" type="file" accept="image/*" capture="environment"></label><button class="ghost" id="upgradeClearPostImage" type="button">Clear image</button></div><small class="upgrade-muted">JPG, PNG, or WEBP up to 10 MB. Images are compressed before saving to your account.</small><div id="upgradePostImagePreview" class="upgrade-image-preview" aria-live="polite"><span>No image selected</span></div></div><div class="upgrade-post-cost-box" id="upgradePostCostBox" role="status" aria-live="polite"><div><span class="eyebrow" id="upgradePostCostLabel">Blog publishing</span><strong id="upgradePostCost">Checking current price…</strong><small id="upgradePostCostDetail">The exact deduction is reviewed before anything is published.</small></div><div class="upgrade-post-cost-balance"><span>Balance after publish</span><strong id="upgradePostBalance">—</strong></div></div><div id="upgradePostReceipt" class="upgrade-post-receipt" aria-live="polite"></div><label class="upgrade-check"><input type="checkbox" name="published" value="true"> Publish now and review the wallet deduction</label><div id="upgradePostReview" class="upgrade-post-edit-note" hidden></div><div class="upgrade-actions"><button class="primary" type="submit"><span data-post-save-label>Save blog</span></button><button class="ghost" id="upgradeCancelPostEdit" type="button" hidden>Cancel edit</button><span id="upgradePostMessage" class="upgrade-muted"></span></div></form></div>${renderUserLibrarySections(posts)}</section><section class="upgrade-user-panel" data-user-panel="wallet"><div class="upgrade-user-stats"><div class="upgrade-stat highlight"><small>Available balance</small><strong>${money(wallet.balanceMinor, wallet.currency)}</strong><span>Use it for publishing and services</span></div><div class="upgrade-stat"><small>Completed top-ups</small><strong>${topups.length}</strong><span>${money(topupTotal, wallet.currency)} added</span></div><div class="upgrade-stat"><small>Publishing spend</small><strong>${money(transactions.filter(row => row.type === 'post_publish').reduce((sum, row) => sum + Math.abs(Number(row.amountMinor || 0)), 0), wallet.currency)}</strong><span>Post publishing fees</span></div><div class="upgrade-stat"><small>Service spend</small><strong>${money(serviceSpend, wallet.currency)}</strong><span>Paid services purchased</span></div></div><div class="upgrade-card"><div class="upgrade-card-head"><div><span class="eyebrow">Add funds</span><h3>Top up wallet</h3></div><span class="upgrade-muted">Paystack · ${escapeHtml(wallet.currency || 'KES')}</span></div><form class="upgrade-form" id="upgradeTopupForm"><label>Amount (KES)<input type="number" name="amount" min="4" step="0.01" placeholder="4" required><span class="upgrade-muted">Minimum deposit: KES 4.00</span></label><div class="upgrade-actions"><button class="primary" type="submit">Continue to secure payment</button><span class="upgrade-muted">Available payment channels depend on your Paystack account.</span><span id="upgradeTopupMessage" class="upgrade-muted" role="status" aria-live="polite"></span></div></form></div><div class="upgrade-card"><div class="upgrade-card-head"><h3>Wallet ledger</h3><span class="upgrade-muted">Every change is recorded</span></div>${renderActivityRows(transactions, wallet.currency)}</div><div class="upgrade-card"><div class="upgrade-card-head"><h3>Payment attempts</h3><span class="upgrade-muted">Paystack history</span></div>${payments.length ? payments.map(payment => `<div class="upgrade-history-row"><div><strong>${money(payment.amountMinor, wallet.currency)} top-up</strong><small>${escapeHtml(payment.reference)} · ${formatUserDate(payment.createdAt)}</small></div><span class="upgrade-status-pill ${payment.status === 'credited' ? 'success' : payment.status === 'failed' ? 'danger' : ''}">${escapeHtml(payment.status || 'pending')}</span>${payment.status === 'pending' ? `<button class="ghost" data-verify-payment="${escapeHtml(payment.reference)}">Check status</button>` : ''}</div>`).join('') : '<div class="upgrade-empty-state">No payment attempts yet.</div>'}</div></section><section class="upgrade-user-panel" data-user-panel="services"><div class="upgrade-card"><div class="upgrade-card-head"><div><span class="eyebrow">Concierge services</span><h3>Build your next chapter</h3></div><span class="upgrade-muted">Pay from wallet balance</span></div>${services.length ? services.map(service => `<div class="upgrade-service-row"><div><strong>${escapeHtml(service.name)}</strong><p>${escapeHtml(service.description || 'A focused Lee Tech service for your next move.')}</p></div><div class="upgrade-service-buy"><b>${money(service.priceMinor, wallet.currency)}</b><button class="primary" data-upgrade-service="${escapeHtml(service._id)}">Use service</button></div></div>`).join('') : '<div class="upgrade-empty-state">No paid services are available yet.</div>'}</div><div class="upgrade-card"><div class="upgrade-card-head"><h3>Service history</h3><span class="upgrade-muted">Your completed purchases</span></div>${purchases.length ? purchases.map(purchase => `<div class="upgrade-history-row"><div><strong>${escapeHtml(purchase.serviceName)}</strong><small>${formatUserDate(purchase.createdAt)}</small></div><b class="negative">-${money(purchase.amountMinor, wallet.currency)}</b></div>`).join('') : '<div class="upgrade-empty-state">Your service purchases will appear here.</div>'}</div></section><section class="upgrade-user-panel" data-user-panel="profile"><div class="upgrade-two-col"><div class="upgrade-card"><div class="upgrade-card-head"><div><span class="eyebrow">Public identity</span><h3>Profile & site</h3></div><span class="upgrade-status-pill success">${userState.user.emailVerified ? 'Verified' : 'Pending'}</span></div><p class="upgrade-muted">Your username is permanent and powers your public link.</p><div class="upgrade-profile-link">${escapeHtml(userState.user.siteUrl)}</div><form class="upgrade-form" id="upgradeProfileForm"><label>Display name<input name="displayName" maxlength="120" value="${escapeHtml(userState.user.displayName || userState.user.username)}" required></label><label>Bio<textarea name="bio" maxlength="600" placeholder="Tell visitors what you create…">${escapeHtml(userState.user.bio || '')}</textarea></label><div class="upgrade-contact-divider"><span>Contact & social links</span><small>Only the links you provide will appear on your public site.</small></div><label>Phone number <span class="upgrade-muted">Optional direct calls</span><input name="phoneNumber" maxlength="40" value="${escapeHtml(contact.phoneNumber || '')}" placeholder="+254 700 000 000" inputmode="tel"><small class="upgrade-muted">Visitors will see a Call button on your public site.</small></label><label>WhatsApp number<input name="whatsappNumber" maxlength="40" value="${escapeHtml(contact.whatsappNumber || '')}" placeholder="+254 700 000 000" inputmode="tel"></label><label>WhatsApp group link<input name="whatsappGroupLink" maxlength="500" value="${escapeHtml(contact.whatsappGroupLink || '')}" placeholder="https://chat.whatsapp.com/…" type="url"></label><div class="upgrade-contact-grid"><label>Instagram<input name="instagramUrl" maxlength="500" value="${escapeHtml(contact.instagramUrl || '')}" placeholder="https://instagram.com/…" type="url"></label><label>Facebook<input name="facebookUrl" maxlength="500" value="${escapeHtml(contact.facebookUrl || '')}" placeholder="https://facebook.com/…" type="url"></label><label>X / Twitter<input name="xUrl" maxlength="500" value="${escapeHtml(contact.xUrl || '')}" placeholder="https://x.com/…" type="url"></label><label>LinkedIn<input name="linkedinUrl" maxlength="500" value="${escapeHtml(contact.linkedinUrl || '')}" placeholder="https://linkedin.com/in/…" type="url"></label><label>TikTok<input name="tiktokUrl" maxlength="500" value="${escapeHtml(contact.tiktokUrl || '')}" placeholder="https://tiktok.com/@…" type="url"></label><label>YouTube<input name="youtubeUrl" maxlength="500" value="${escapeHtml(contact.youtubeUrl || '')}" placeholder="https://youtube.com/@…" type="url"></label><label>Telegram<input name="telegramUrl" maxlength="500" value="${escapeHtml(contact.telegramUrl || '')}" placeholder="https://t.me/…" type="url"></label><label>Website<input name="websiteUrl" maxlength="500" value="${escapeHtml(contact.websiteUrl || '')}" placeholder="https://yourwebsite.com" type="url"></label></div><div class="upgrade-actions"><button class="primary" type="submit">Save profile & contacts</button><span id="upgradeProfileMessage" class="upgrade-muted"></span></div></form></div><div class="upgrade-card"><div class="upgrade-card-head"><h3>Share your site</h3><span class="eyebrow">Invite your audience</span></div><p class="upgrade-muted">Your customers will only see posts and blogs you publish on this username site.</p><button class="primary" data-share-user-site>Share my site ↗</button></div></div></section><section class="upgrade-user-panel" data-user-panel="security"><div class="upgrade-two-col"><div class="upgrade-card"><div class="upgrade-card-head"><div><span class="eyebrow">Account security</span><h3>Change password</h3></div></div><form class="upgrade-form" id="upgradeChangePasswordForm">${passwordField({ name: 'currentPassword', label: 'Current password', autocomplete: 'current-password' })}${passwordField({ name: 'newPassword', label: 'New password', autocomplete: 'new-password', hint: 'Use at least 12 characters.' })}${passwordField({ name: 'confirmNewPassword', label: 'Confirm new password', autocomplete: 'new-password', confirm: true })}<div class="upgrade-actions"><button class="primary" type="submit">Update password</button><span id="upgradePasswordMessage" class="upgrade-muted"></span></div></form></div><div class="upgrade-card"><div class="upgrade-card-head"><div><span class="eyebrow">Recent security</span><h3>Sign-in activity</h3></div><span class="upgrade-muted">Kept for 24 hours</span></div>${security.length ? security.slice(0, 12).map(row => `<div class="upgrade-history-row"><div><strong>${escapeHtml(row.event || 'Account activity')}</strong><small>${escapeHtml(row.device || 'Unknown device')} · ${formatUserDate(row.createdAt)}</small></div><span class="upgrade-status-pill ${row.success ? 'success' : 'danger'}">${row.success ? 'Success' : 'Blocked'}</span></div>`).join('') : '<div class="upgrade-empty-state">Security activity will appear after your next account action.</div>'}</div></div></section>`;
  }
  function bindUserDashboardActions() { const body = document.getElementById('upgradeDashboardBody'); if (!body) return; body.querySelectorAll('[data-user-view]').forEach(button => { if (button.dataset.bound) return; button.dataset.bound = 'true'; button.addEventListener('click', () => switchUserDashboardView(button.dataset.userView)); }); body.querySelector('#upgradeTopupForm')?.addEventListener('submit', beginTopup); const postForm = body.querySelector('#upgradePostForm'); postForm?.addEventListener('submit', saveUserPost); postForm?.elements.contentType?.addEventListener('change', updateUserPostTypeFields); postForm?.elements.productType?.addEventListener('change', updateUserPostTypeFields); postForm?.elements.published?.addEventListener('change', updateUserPostCostPreview); postForm?.elements.price?.addEventListener('input', updateUserPostCostPreview); body.querySelector('#upgradeCancelPostEdit')?.addEventListener('click', () => { userState.post = null; userState.postReceipt = null; postForm?.reset(); pendingUserPostImage = ''; renderUserPostImagePreview(); updateUserPostTypeFields(); }); body.querySelector('#upgradePostImageFile')?.addEventListener('change', event => compressUserPostImage(event.currentTarget)); body.querySelector('#upgradePostImageCamera')?.addEventListener('change', event => compressUserPostImage(event.currentTarget)); body.querySelector('#upgradeClearPostImage')?.addEventListener('click', () => { pendingUserPostImage = ''; if (postForm?.elements.image) postForm.elements.image.value = ''; const file = body.querySelector('#upgradePostImageFile'); const camera = body.querySelector('#upgradePostImageCamera'); if (file) file.value = ''; if (camera) camera.value = ''; renderUserPostImagePreview(); }); updateUserPostTypeFields(); body.querySelector('#upgradeProfileForm')?.addEventListener('submit', saveUserProfile); body.querySelector('#upgradeChangePasswordForm')?.addEventListener('submit', saveUserPassword); body.querySelectorAll('[data-upgrade-service]').forEach(button => { if (button.dataset.bound) return; button.dataset.bound = 'true'; button.addEventListener('click', () => purchaseService(button.dataset.upgradeService)); }); body.querySelectorAll('[data-verify-payment]').forEach(button => { if (button.dataset.bound) return; button.dataset.bound = 'true'; button.addEventListener('click', () => verifyPayment(button.dataset.verifyPayment)); }); body.querySelectorAll('[data-upgrade-edit-post]').forEach(button => { if (button.dataset.bound) return; button.dataset.bound = 'true'; button.addEventListener('click', () => editPost((userState.dashboardPosts || []).find(post => post._id === button.dataset.upgradeEditPost))); }); body.querySelectorAll('[data-upgrade-delete-post]').forEach(button => { if (button.dataset.bound) return; button.dataset.bound = 'true'; button.addEventListener('click', () => deletePost(button.dataset.upgradeDeletePost, button.dataset.upgradeDeleteKind)); }); body.querySelector('[data-share-user-site]')?.addEventListener('click', () => window.shareItem?.(`${userState.user.displayName || userState.user.username} — Lee Tech creator site`, userState.user.bio || `Published posts from @${userState.user.username}.`, '', userState.user.siteUrl)); bindPasswordToggles(body); }
  async function loadDashboard() { const body = document.getElementById('upgradeDashboardBody'); if (!body) return; try { const results = await Promise.allSettled([request('/api/me/posts'), request('/api/services'), request('/api/wallet'), request('/api/me/analytics'), request('/api/me/security'), request('/api/me/posting-cost')]); const [postsResult, servicesResult, walletResult, analyticsResult, securityResult, postingCostResult] = results; if (postsResult.status === 'rejected' || servicesResult.status === 'rejected' || walletResult.status === 'rejected' || postingCostResult.status === 'rejected') throw (postsResult.reason || servicesResult.reason || walletResult.reason || postingCostResult.reason); const posts = postsResult.value || []; const services = servicesResult.value || []; const wallet = walletResult.value || { balanceMinor: 0, currency: 'KES', transactions: [], payments: [], purchases: [] }; const postingCost = postingCostResult.value || { priceMinor: 0, currency: wallet.currency || 'KES' }; const analytics = analyticsResult.status === 'fulfilled' ? analyticsResult.value : { days: 1, visits: 0, sessions: 0, daily: [], devices: [], sources: [], pages: [] }; const security = securityResult.status === 'fulfilled' ? securityResult.value : []; userState.wallet = wallet; userState.postingCostMinor = Number(postingCost.priceMinor || 0); userState.postingCostCurrency = postingCost.currency || wallet.currency || 'KES'; userState.dashboardPosts = posts; body.innerHTML = renderUserDashboardPanels({ posts, services, wallet, analytics, security }); bindUserDashboardActions(); switchUserDashboardView(userState.dashboardView || 'overview'); } catch (error) { body.innerHTML = `<div class="upgrade-alert">${escapeHtml(error.message)}. Verify your email and try again.</div>`; notify(error.message, 'error'); } }
  async function beginTopup(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = form.querySelector('#upgradeTopupMessage');
    const amount = String(new FormData(form).get('amount') || '').trim();
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount < 4) { if (message) message.textContent = 'Minimum deposit is KES 4.00.'; return notify('Minimum deposit is KES 4.00.', 'error'); }
    const submit = event.submitter;
    if (submit) submit.disabled = true;
    if (message) message.textContent = 'Preparing secure Paystack checkout…';
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    try {
      const result = await request('/api/wallet/paystack/initialize', { method: 'POST', body: JSON.stringify({ amount }), signal: controller.signal });
      const checkoutUrl = String(result?.authorizationUrl || '').trim();
      if (!result?.reference || !/^https:\/\//i.test(checkoutUrl)) throw new Error('Paystack did not return a valid secure checkout link. Please try again.');
      if (message) message.textContent = 'Redirecting to Paystack…';
      notify('Opening secure Paystack checkout…', 'info');
      window.location.assign(checkoutUrl);
    } catch (error) { const detail = error?.name === 'AbortError' ? 'Paystack checkout timed out. Check your connection and try again.' : error.message; if (message) message.textContent = detail; notify(detail, 'error'); }
    finally { window.clearTimeout(timeout); if (submit) submit.disabled = false; }
  }
  async function saveUserPost(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    const contentType = values.contentType === 'product' ? 'product' : 'blog';
    const title = String(values.title || '').trim();
    const content = String(values.content || '').trim();
    const isPhysical = contentType === 'product' && values.productType === 'physical';
    const price = String(values.price || '').trim();
    const stock = String(values.stock || '').trim();
    const message = form.querySelector('#upgradePostMessage');
    if (!title || !content) { message.textContent = 'Add a title and description before saving.'; notify('Add a title and description before saving.', 'error'); return; }
    if (contentType === 'product' && (!price || !Number.isFinite(Number(price)) || Number(price) < 0)) { message.textContent = 'Add a valid product price before saving.'; notify('Add a valid product price before saving.', 'error'); return; }
    if (isPhysical && (!stock || !Number.isInteger(Number(stock)) || Number(stock) < 0)) { message.textContent = 'Physical products require a whole-number stock quantity.'; notify('Physical products require a whole-number stock quantity.', 'error'); return; }
    const isEditing = !!userState.post;
    const wasPublished = !!userState.post?.published;
    const isPublishing = values.published === 'true';
    const fee = isPublishing && !wasPublished && contentType === 'product' ? Number(userState.postingCostMinor || 0) : 0;
    const balance = Number(userState.wallet?.balanceMinor || 0);
    if (fee > balance) { message.textContent = `Top up before publishing. Required: ${money(fee, userState.postingCostCurrency)}; available: ${money(balance, userState.postingCostCurrency)}.`; notify('Insufficient balance for this publishing fee.', 'error'); return; }
    const review = isPublishing ? (fee ? `Review product publishing\n\n${money(fee, userState.postingCostCurrency)} will be deducted from your wallet.\nEstimated remaining balance: ${money(balance - fee, userState.postingCostCurrency)}.\n\nContinue only if the title, details, product price, and stock are correct.` : contentType === 'blog' ? 'Review blog publishing\n\nBlogs and journal posts are free. No wallet deduction will be made.\n\nContinue only if the title and content are correct.' : isEditing ? 'Review this product edit\n\nNo additional product-publishing fee will be deducted.\n\nContinue only if all details are correct.' : 'Review product publishing\n\nNo product-publishing fee is currently configured.\n\nContinue only if the product details are correct.') : `Review saving this ${contentType === 'product' ? 'product' : 'blog'} as a draft.\n\nNo wallet deduction will be made.`;
    if (!window.confirm(review)) return;
    const body = { ...values, title, content, contentType, productType: contentType === 'product' ? values.productType : 'digital', price: contentType === 'product' ? price : '', stock: isPhysical ? stock : '', image: pendingUserPostImage || values.image || '', published: isPublishing, expectedPriceMinor: userState.postingCostMinor };
    const savedLabel = contentType === 'product' ? 'Product saved successfully.' : 'Blog saved successfully.';
    try { const result = await request('/api/me/posts' + (userState.post ? `/${userState.post._id}` : ''), { method: userState.post ? 'PUT' : 'POST', body: JSON.stringify(body) }); const chargedMinor = Number(result.chargedMinor || 0); const balanceAfterMinor = Number(result.balanceAfterMinor ?? Math.max(0, balance - chargedMinor)); userState.postReceipt = { chargedMinor, balanceAfterMinor, currency: userState.postingCostCurrency }; userState.post = null; message.textContent = chargedMinor ? `${savedLabel} Deducted ${money(chargedMinor, userState.postingCostCurrency)}. Remaining balance: ${money(balanceAfterMinor, userState.postingCostCurrency)}.` : isEditing ? 'Changes saved. No additional publishing fee was deducted.' : 'Draft saved. No wallet deduction was made.'; notify(chargedMinor ? `${savedLabel} ${money(chargedMinor, userState.postingCostCurrency)} deducted.` : (isEditing ? 'Changes saved with no additional publishing fee.' : 'Draft saved with no deduction.'), 'success'); pendingUserPostImage = ''; form.reset(); renderUserPostImagePreview(); updateUserPostTypeFields(); await loadDashboard(); }
    catch (error) { if (error?.priceMinor != null) { userState.postingCostMinor = Number(error.priceMinor); updateUserPostCostPreview(); } message.textContent = error.message; notify(error.message, 'error'); }
  }
  async function deletePost(id, kind = 'post') {
    if (!id) return;
    const label = kind === 'product' ? 'product' : 'blog';
    const warning = `Delete this ${label}?\n\nThis will permanently remove it from your creator workspace and public site. Wallet charges are not refunded. This action cannot be undone.`;
    if (!window.confirm(warning)) return;
    try { await request(`/api/me/posts/${encodeURIComponent(id)}`, { method: 'DELETE' }); userState.post = null; userState.postReceipt = null; notify(`${label[0].toUpperCase() + label.slice(1)} deleted.`, 'success'); await loadDashboard(); } catch (error) { notify(error.message || `Unable to delete ${label}.`, 'error'); }
  }
  function editPost(post) {
    if (!post) return;
    userState.postReceipt = null;
    userState.post = post;
    switchUserDashboardView('content');
    const form = document.getElementById('upgradePostForm');
    if (!form) return;
    if (form.elements.contentType) form.elements.contentType.value = post.contentType === 'product' ? 'product' : 'blog';
    if (form.elements.productType) form.elements.productType.value = post.productType === 'physical' ? 'physical' : 'digital';
    if (form.elements.price) form.elements.price.value = post.priceMinor ? (Number(post.priceMinor) / 100).toFixed(2) : '';
    if (form.elements.stock) form.elements.stock.value = post.stock ?? '';
    ['title', 'excerpt', 'content'].forEach(field => { if (form.elements[field]) form.elements[field].value = post[field] || ''; });
    if (form.elements.image) form.elements.image.value = post.image?.startsWith('data:') ? '' : (post.image || '');
    pendingUserPostImage = post.image?.startsWith('data:') ? post.image : '';
    renderUserPostImagePreview(post.image || '');
    if (form.elements.published) form.elements.published.checked = !!post.published;
    updateUserPostTypeFields();
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  async function verifyPayment(reference) { try { notify('Checking Paystack payment…', 'info'); const data = await request(`/api/wallet/paystack/verify/${encodeURIComponent(reference)}`, { method: 'POST' }); notify(`Wallet credited: ${money(data.balanceMinor)}`, 'success'); await loadDashboard(); switchUserDashboardView('wallet'); } catch (error) { notify(error.message, 'info'); } }
  async function purchaseService(id) {
    if (!window.confirm('Use wallet balance for this service?')) return;
    try { await request(`/api/services/${encodeURIComponent(id)}/purchase`, { method: 'POST' }); notify('Service purchased successfully.', 'success'); await loadDashboard(); } catch (error) { notify(error.message, 'error'); }
  }
  async function saveUserProfile(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = form.querySelector('#upgradeProfileMessage');
    try {
      const values = Object.fromEntries(new FormData(form).entries());
      const contactFields = ['phoneNumber', 'whatsappNumber', 'whatsappGroupLink', 'instagramUrl', 'facebookUrl', 'xUrl', 'linkedinUrl', 'tiktokUrl', 'youtubeUrl', 'telegramUrl', 'websiteUrl'];
      const contact = Object.fromEntries(contactFields.map(field => [field, values[field] || '']));
      const data = await request('/api/me/profile', { method: 'PUT', body: JSON.stringify({ displayName: values.displayName, bio: values.bio, contact }) });
      userState.user = data.user;
      updateUserButton();
      document.querySelector('#upgradeDashboardContent .upgrade-dashboard-brand strong')?.replaceChildren(document.createTextNode(userState.user.displayName || userState.user.username));
      document.querySelector('#upgradeDashboardContent .upgrade-dashboard-top p')?.replaceChildren(document.createTextNode('Build your site, understand your audience, and keep every transaction clear.'));
      if (message) message.textContent = 'Profile saved. Your public site is updated.';
      notify('Profile updated successfully.', 'success');
    } catch (error) { if (message) message.textContent = error.message; notify(error.message, 'error'); }
  }
  async function saveUserPassword(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    const message = form.querySelector('#upgradePasswordMessage');
    if (values.newPassword !== values.confirmNewPassword) { if (message) message.textContent = 'New passwords do not match.'; return; }
    try {
      const data = await request('/api/auth/user/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: values.currentPassword, newPassword: values.newPassword }) });
      form.reset();
      if (message) message.textContent = data.message;
      notify('Password updated successfully.', 'success');
    } catch (error) { if (message) message.textContent = error.message; notify(error.message, 'error'); }
  }
  async function logoutUser() {
    const siteUrl = String(userState.user?.siteUrl || '').trim();
    await request('/api/auth/user/logout', { method: 'POST' }).catch(() => {});
    userState.user = null;
    userState.wallet = null;
    document.getElementById('upgradeUserOverlay')?.classList.remove('open');
    updateUserButton();
    notify('Signed out successfully.', 'success');
    const destination = /^https?:\/\//i.test(siteUrl) ? siteUrl : '/';
    window.setTimeout(() => window.location.assign(destination), 120);
  }
  async function handleVerificationCallback() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('verify');
    const username = params.get('username');
    if (!token || !username) return;
    try {
      const data = await request(`/api/auth/user/verify-email?token=${encodeURIComponent(token)}&username=${encodeURIComponent(username)}`);
      notify(data.message, 'success');
      window.history.replaceState({}, '', window.location.pathname);
      openAuth('signin');
    } catch (error) { notify(error.message, 'error'); }
  }
  async function handleResetCallback() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('reset');
    const username = params.get('username');
    if (!token || !username) return;
    makeOverlay();
    const overlay = document.getElementById('upgradeUserOverlay');
    overlay.querySelector('.upgrade-panel').classList.add('narrow');
    overlay.querySelector('#upgradeAuthContent').innerHTML = `<div class="eyebrow">Account security</div><h2>Choose a new password.</h2><p class="upgrade-muted">Resetting the password for @${escapeHtml(username)}.</p><form class="upgrade-form" id="upgradeResetForm">${passwordField({ label: 'New password', autocomplete: 'new-password', hint: 'Use at least 12 characters.' })}<div class="upgrade-actions"><button class="primary" type="submit">Save new password</button></div><div id="upgradeResetMessage" class="upgrade-muted"></div></form>`;
    overlay.classList.add('open');
    bindPasswordToggles(overlay);
    overlay.querySelector('#upgradeResetForm').addEventListener('submit', async event => {
      event.preventDefault();
      const message = event.currentTarget.querySelector('#upgradeResetMessage');
      try {
        const values = Object.fromEntries(new FormData(event.currentTarget).entries());
        const data = await request('/api/auth/user/reset-password', { method: 'POST', body: JSON.stringify({ ...values, token, username }) });
        message.textContent = data.message;
        notify(data.message, 'success');
        window.history.replaceState({}, '', window.location.pathname);
        setTimeout(() => { overlay.classList.remove('open'); openAuth('signin'); }, 700);
      } catch (error) { message.textContent = error.message; notify(error.message, 'error'); }
    });
  }
  async function handlePaymentCallback() {
    const params = new URLSearchParams(window.location.search);
    const reference = params.get('reference') || params.get('trxref');
    const status = String(params.get('status') || '').toLowerCase();
    if (params.get('payment') !== 'complete') return;
    window.history.replaceState({}, '', window.location.pathname);
    if (['failed', 'abandoned', 'cancelled', 'canceled'].includes(status)) { notify('Payment was not completed. No wallet funds were added.', 'error'); if (userState.user) openDashboard('wallet'); return; }
    if (!reference) { notify('Paystack returned without a payment reference. Check your Paystack callback configuration.', 'error'); if (userState.user) openDashboard('wallet'); return; }
    try { const data = await request(`/api/wallet/paystack/verify/${encodeURIComponent(reference)}`, { method: 'POST' }); notify(`Wallet credited: ${money(data.balanceMinor)}`, 'success'); if (userState.user) openDashboard('wallet'); }
    catch (error) { notify(`Payment could not be confirmed yet: ${error.message}. Use Check status in Wallet & history.`, 'info'); if (userState.user) openDashboard('wallet'); }
  }
  function renderPublicContactLinks(contact = {}) {
    const links = [];
    const number = String(contact.whatsappNumber || '').trim();
    const digits = number.replace(/\D/g, '');
    const phone = String(contact.phoneNumber || '').trim();
    const phoneDigits = phone.replace(/\D/g, '');
    if (phoneDigits.length >= 7 && phoneDigits.length <= 15) links.push({ icon: '☎', label: 'Call', detail: 'Call me directly', href: `tel:${phone.startsWith('+') ? '+' : ''}${phoneDigits}`, external: false });
    if (digits.length >= 7 && digits.length <= 15) links.push({ icon: '◉', label: 'WhatsApp', detail: 'Message me directly', href: `https://wa.me/${digits}`, external: true });
    const definitions = [
      ['whatsappGroupLink', 'WhatsApp group', 'Join the community', '◉'],
      ['instagramUrl', 'Instagram', 'Follow on Instagram', '◎'],
      ['facebookUrl', 'Facebook', 'Connect on Facebook', 'f'],
      ['xUrl', 'X / Twitter', 'Follow on X', '𝕏'],
      ['linkedinUrl', 'LinkedIn', 'Connect on LinkedIn', 'in'],
      ['tiktokUrl', 'TikTok', 'Follow on TikTok', '♪'],
      ['youtubeUrl', 'YouTube', 'Watch on YouTube', '▶'],
      ['telegramUrl', 'Telegram', 'Message on Telegram', '➤'],
      ['websiteUrl', 'Website', 'Visit my website', '↗']
    ];
    definitions.forEach(([key, label, detail, icon]) => { const href = String(contact[key] || '').trim(); if (/^https?:\/\//i.test(href)) links.push({ icon, label, detail, href, external: true }); });
    if (!links.length) return '';
    return `<section class="upgrade-public-contact"><div class="upgrade-public-contact-head"><div><div class="upgrade-public-eyebrow">Connect with the creator</div><h2>Let’s stay in touch.</h2><p>Choose a channel to reach ${escapeHtml(userState.user?.displayName || 'this creator')}.</p></div><span class="upgrade-public-contact-count">${links.length} contact option${links.length === 1 ? '' : 's'}</span></div><div class="upgrade-public-contact-grid">${links.map(link => `<a class="upgrade-public-contact-link" href="${escapeHtml(link.href)}"${link.external ? ' target="_blank" rel="noopener noreferrer"' : ''}><span class="upgrade-public-contact-icon">${escapeHtml(link.icon)}</span><span><strong>${escapeHtml(link.label)}</strong><small>${escapeHtml(link.detail)}</small></span><b>↗</b></a>`).join('')}</div></section>`;
  }
  function renderPublicProductCards(products = [], contact = {}) {
    if (!products.length) return '<div class="upgrade-public-empty"><div class="upgrade-public-empty-icon">◈</div><h3>No products published yet.</h3><p>Digital and physical products from this creator will appear here when published.</p></div>';
    const digits = String(contact.whatsappNumber || '').replace(/\D/g, '');
    return products.map((product, index) => {
      const physical = product.productType === 'physical';
      const stockLabel = physical ? (product.stock === 0 ? 'Out of stock' : `${product.stock == null ? 'Available' : product.stock} in stock`) : 'Digital delivery';
      const buyable = digits.length >= 7 && digits.length <= 15 && (!physical || product.stock !== 0);
      const buyHref = buyable ? `https://wa.me/${digits}?text=${encodeURIComponent(`Hello, I would like to buy ${product.title}.`)}` : '';
      const shareData = `data-share-product data-share-product-id="${escapeHtml(String(product._id || ''))}" data-share-title="${escapeHtml(product.title)}" data-share-text="${escapeHtml(product.excerpt || product.content.slice(0, 170))}"`;
      const shareAction = `<button class="ghost upgrade-product-share" type="button" ${shareData}>Share product ↗</button>`;
      const action = `<div class="upgrade-public-product-actions">${buyable ? `<a class="primary upgrade-product-buy" href="${escapeHtml(buyHref)}" target="_blank" rel="noopener noreferrer">Buy via WhatsApp ↗</a>` : ''}${shareAction}</div>`;
      return `<article class="upgrade-public-product"><div class="upgrade-public-product-topline"><span>${physical ? 'Physical product' : 'Digital product'}</span><b>${index + 1 < 10 ? '0' : ''}${index + 1}</b></div>${product.image ? `<img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.title)}" class="upgrade-public-product-image" loading="lazy" decoding="async">` : '<div class="upgrade-public-product-placeholder">◈</div>'}<div class="upgrade-public-product-kicker">${escapeHtml(product.author || 'Creator product')}</div><h3>${escapeHtml(product.title)}</h3><p>${escapeHtml(product.content)}</p><div class="upgrade-public-product-foot"><strong>${money(product.priceMinor || 0)}</strong><span>${escapeHtml(stockLabel)}</span></div>${action}</article>`;
    }).join('');
  }
  let publicSiteSnapshot = '';
  let publicRefreshTimer = null;
  async function renderPublicUserSite(silent = false) {
    try {
      const suffix = silent ? `?ts=${Date.now()}` : '';
      const data = await request(`/api/public/sites/${encodeURIComponent(rootPath)}${suffix}`);
      const snapshot = JSON.stringify({ user: data.user, posts: data.posts, products: data.products || [] });
      if (silent && snapshot === publicSiteSnapshot) { window.setConnectionBanner?.(true); return; }
      const changed = Boolean(publicSiteSnapshot) && snapshot !== publicSiteSnapshot;
      publicSiteSnapshot = snapshot;
      if (silent && changed) notify('Creator site updated automatically.', 'success');
      userState.user = data.user;
      document.querySelector('header')?.remove();
      document.querySelector('main')?.remove();
      document.querySelector('footer')?.remove();
      const site = document.createElement('div');
      site.id = 'upgradePublicUserSite';
      site.innerHTML = `<div class="upgrade-public-shell"><header class="upgrade-public-nav"><a class="upgrade-public-brand" href="/"><span class="upgrade-public-brand-mark">L</span><span><strong>Lee Tech</strong><small>Technology with intention.</small></span></a><div class="upgrade-public-nav-actions"><span>Creator site</span><button class="ghost upgrade-site-share" type="button" data-share-site>Share site ↗</button></div></header><main><section class="upgrade-public-hero"><div class="upgrade-public-hero-inner"><div class="upgrade-public-eyebrow">Lee Tech / creator site</div><div class="upgrade-public-hero-grid"><div><div class="upgrade-public-handle">@${escapeHtml(data.user.username)}</div><h1>${escapeHtml(data.user.displayName)}</h1><p>${escapeHtml(data.user.bio || `Read the latest posts from @${data.user.username}.`)}</p><div class="upgrade-site-hero-actions"><button class="primary upgrade-site-share" type="button" data-share-site>Share this site ↗</button><a class="upgrade-public-text-link" href="/">Explore Lee Tech →</a></div></div><div class="upgrade-public-profile-card"><div class="upgrade-public-profile-mark">${escapeHtml((data.user.displayName || data.user.username).slice(0, 1).toUpperCase())}</div><div><strong>${escapeHtml(data.user.displayName)}</strong><span>@${escapeHtml(data.user.username)}</span></div><div class="upgrade-public-profile-status"><i></i> Verified creator</div></div></div></div></section><section class="upgrade-public-body"><div class="upgrade-public-section-head"><div><div class="upgrade-public-eyebrow">The latest from @${escapeHtml(data.user.username)}</div><h2>Published content</h2></div><div class="upgrade-public-section-meta"><span>Public journal</span><b data-post-count>—</b></div></div><p class="upgrade-public-section-note">Only blogs and products published by this creator appear on this site.</p>${renderPublicContactLinks(data.user.contact)}<section class="upgrade-public-content-group"><div class="upgrade-public-content-heading"><div><div class="upgrade-public-eyebrow">Creator journal</div><h2>Blogs & notes</h2></div><span>${data.posts.length} published</span></div><div class="upgrade-post-grid" id="upgradePublicPostGrid"></div></section><section class="upgrade-public-content-group"><div class="upgrade-public-content-heading"><div><div class="upgrade-public-eyebrow">Creator shop</div><h2>Products</h2></div><span>${(data.products || []).length} listed</span></div><div class="upgrade-public-product-grid" id="upgradePublicProductGrid"></div></section></section><section class="upgrade-public-cta"><div><div class="upgrade-public-eyebrow">Stay close to the signal</div><h2>Thoughtful work, shared publicly.</h2><p>Follow ${escapeHtml(data.user.displayName)}’s latest notes and ideas from their Lee Tech creator site.</p></div><button class="primary upgrade-site-share" type="button" data-share-site>Share this creator ↗</button></section></main><footer class="upgrade-public-footer"><a class="upgrade-public-brand" href="/"><span class="upgrade-public-brand-mark">L</span><span><strong>Lee Tech</strong><small>Powered by Lee Tech</small></span></a><span>© ${new Date().getFullYear()} Lee Tech · Made for momentum.</span></footer></div>`;
      document.body.appendChild(site);
      const grid = site.querySelector('#upgradePublicPostGrid');
      const productGrid = site.querySelector('#upgradePublicProductGrid');
      const postCount = site.querySelector('[data-post-count]'); if (postCount) postCount.textContent = String(data.posts.length);
      grid.innerHTML = data.posts.length ? data.posts.map((post, index) => `<article class="upgrade-post"><div class="upgrade-post-topline"><span>0${index + 1}</span><time>${new Date(post.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</time></div>${post.image ? `<img src="${escapeHtml(post.image)}" alt="${escapeHtml(post.title)}" class="upgrade-post-image" loading="lazy" decoding="async">` : ''}<div class="upgrade-post-kicker">${escapeHtml(post.author || data.user.displayName)} · Lee Tech journal</div><h2>${escapeHtml(post.title)}</h2><p>${escapeHtml(post.content)}</p><div class="upgrade-post-bottom"><span>Published on @${escapeHtml(data.user.username)}</span><button class="ghost upgrade-post-share" type="button" data-share-post data-share-title="${escapeHtml(post.title)}" data-share-text="${escapeHtml(post.excerpt || post.content.slice(0,170))}">Share post ↗</button></div></article>`).join('') : '<div class="upgrade-public-empty"><div class="upgrade-public-empty-icon">✦</div><h3>The first story is on its way.</h3><p>Published blogs from this creator will appear here for their audience.</p><a class="upgrade-public-text-link" href="/">Explore Lee Tech →</a></div>';
      productGrid.innerHTML = renderPublicProductCards(data.products || [], data.user.contact || {});
      site.querySelectorAll('[data-share-site]').forEach(button => button.addEventListener('click', () => window.shareItem?.(`${data.user.displayName} — Lee Tech creator site`, data.user.bio || `Published posts from @${data.user.username}.`, '', `${location.origin}${location.pathname}`)));
      site.querySelectorAll('[data-share-post], [data-share-product]').forEach(button => button.addEventListener('click', () => window.shareItem?.(button.dataset.shareTitle, button.dataset.shareText, '', `${location.origin}${location.pathname}`, button.dataset.shareImage || '', button.dataset.shareProductId || '')));
    } catch {
      if (!navigator.onLine) { window.setConnectionBanner?.(false); if (!silent && !document.getElementById('upgradePublicUserSite')) document.body.innerHTML = `<div class="upgrade-site-body"><div class="eyebrow">Lee Tech</div><h1>Waiting for connection.</h1><p class="upgrade-muted">This creator site will load automatically when the internet returns.</p><a class="primary" href="/">Return to Lee Tech</a></div>`; return; }
      if (!silent) document.body.innerHTML = `<div class="upgrade-site-body"><div class="eyebrow">Lee Tech</div><h1>Site not found.</h1><p class="upgrade-muted">This username site does not exist, is not verified, or has no public access yet.</p><a class="primary" href="/">Return to Lee Tech</a></div>`;
    }
  }
  function startPublicAutoRefresh() {
    clearInterval(publicRefreshTimer);
    publicRefreshTimer = setInterval(() => { if (!document.hidden && navigator.onLine) { renderPublicUserSite(true); checkForAppUpdate(); } }, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && navigator.onLine) { renderPublicUserSite(true); checkForAppUpdate(); } });
  }
  window.refreshPublicSite = () => renderPublicUserSite(true);

  function adminRequest(url, options = {}) {
    const token = localStorage.getItem('leeToken');
    return request(url, { ...options, headers: { ...(options.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  }
  function injectAdminNavigation() {
    const nav = document.querySelector('.admin-nav-secondary');
    if (!nav || document.getElementById('upgradeAdminUsersButton')) return;
    if (document.getElementById('view-users') && document.getElementById('view-finance') && document.getElementById('view-pricing')) return;
    nav.insertAdjacentHTML('afterbegin', '<button id="upgradeAdminUsersButton" data-upgrade-admin="users"><span class="nav-icon">♙</span><span>Users</span></button><button data-upgrade-admin="finance"><span class="nav-icon">¤</span><span>Funds & payments</span></button><button data-upgrade-admin="pricing"><span class="nav-icon">◈</span><span>Pricing & services</span></button>');
    nav.querySelectorAll('[data-upgrade-admin]').forEach(button => button.addEventListener('click', () => up_showAdmin(button.dataset.upgradeAdmin)));
    const main = document.querySelector('.admin-main');
    if (!main) return;
    main.insertAdjacentHTML('beforeend', `<div class="admin-view" id="upgrade-view-users"><div class="panel"><div class="section-head"><div><h3>User accounts</h3><p class="muted">Track sign-ups, verification, usernames, and wallet balances.</p></div></div><div class="upgrade-admin-toolbar"><input id="upgradeUserSearch" placeholder="Search username or email"><button class="primary" id="upgradeUserSearchButton">Search</button></div><div id="upgradeUsersTable"><div class="empty">Loading users…</div></div></div></div><div class="admin-view" id="upgrade-view-finance"><div class="stat-grid" id="upgradeFinanceStats"></div><div class="panel"><div class="section-head"><h3>Funds and payments</h3><span class="eyebrow">Paystack ledger</span></div><div id="upgradeFinanceTable"><div class="empty">Loading finance data…</div></div></div></div><div class="admin-view" id="upgrade-view-pricing"><div class="panel"><div class="section-head"><div><h3>Posting price</h3><p class="muted">Charge this amount once when a user publishes a new post.</p></div></div><form class="form" id="upgradePricingForm"><label>Price per published post (KES)<input id="upgradePostPrice" type="number" min="0" step="0.01" required></label><button class="primary">Save posting price</button><span class="muted" id="upgradePricingMessage"></span></form></div><div class="panel"><div class="section-head"><div><h3>Services</h3><p class="muted">Create paid services that users can purchase from wallet balance.</p></div></div><form class="form" id="upgradeServiceForm"><label>Name<input name="name" required></label><label>Slug<input name="slug" placeholder="design-review" required></label><label>Description<textarea name="description"></textarea></label><label>Price (KES)<input name="price" type="number" min="0" step="0.01" required></label><button class="primary">Add service</button></form><div id="upgradeServicesTable"><div class="empty">Loading services…</div></div></div></div>`);
    document.getElementById('upgradeUserSearchButton').addEventListener('click', loadAdminUsers);
    document.getElementById('upgradeUserSearch').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); loadAdminUsers(); } });
    document.getElementById('upgradePricingForm').addEventListener('submit', saveAdminPricing);
    document.getElementById('upgradeServiceForm').addEventListener('submit', createAdminService);
  }
  function up_showAdmin(view) {
    const admin = document.getElementById('admin');
    if (!admin) return;
    admin.classList.add('open');
    document.querySelectorAll('.admin-view').forEach(item => item.classList.remove('active'));
    const target = document.getElementById(`upgrade-view-${view}`);
    if (target) target.classList.add('active');
    const title = document.getElementById('adminTitle');
    if (title) title.textContent = ({ users: 'User accounts', finance: 'Funds & payments', pricing: 'Pricing & services' })[view] || view;
    document.querySelectorAll('.admin-side button').forEach(button => button.classList.toggle('active', button.dataset.upgradeAdmin === view));
    if (view === 'users') loadAdminUsers();
    if (view === 'finance') loadAdminFinance();
    if (view === 'pricing') loadAdminPricing();
  }
  async function loadAdminUsers() {
    const table = document.getElementById('upgradeUsersTable');
    if (!table) return;
    try {
      const search = document.getElementById('upgradeUserSearch')?.value || '';
      const users = await adminRequest(`/api/admin/users?search=${encodeURIComponent(search)}`);
      table.innerHTML = users.length ? users.map(user => `<div class="table-row"><span><b>${escapeHtml(user.username)}</b><br><span class="muted">${escapeHtml(user.email)} · ${user.emailVerified ? 'Verified' : 'Unverified'} · ${escapeHtml(user.siteUrl)}</span></span><span><b>${money(user.walletBalanceMinor)}</b><br><small class="muted">${new Date(user.createdAt).toLocaleDateString()}</small></span></div>`).join('') : '<div class="empty">No users found.</div>';
    } catch (error) { table.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`; notify(error.message, 'error'); }
  }
  async function loadAdminFinance() {
    try {
      const data = await adminRequest('/api/admin/finance');
      const credited = data.topups.reduce((sum, row) => sum + Number(row.totalMinor || 0), 0);
      const charged = data.charges.reduce((sum, row) => sum + Number(row.totalMinor || 0), 0);
      document.getElementById('upgradeFinanceStats').innerHTML = `<div class="stat"><small>Total users</small><b>${data.users}</b></div><div class="stat"><small>Top-ups credited</small><b>${money(credited)}</b></div><div class="stat"><small>Wallet charges</small><b>${money(charged)}</b></div><div class="stat"><small>Service purchases</small><b>${data.purchases}</b></div>`;
      document.getElementById('upgradeFinanceTable').innerHTML = data.recentPayments.length ? data.recentPayments.map(payment => `<div class="table-row"><span><b>${escapeHtml(payment.userId?.username || 'Unknown user')}</b><br><span class="muted">${escapeHtml(payment.reference)} · ${payment.status}</span></span><b>${money(payment.amountMinor, payment.currency)}</b></div>`).join('') : '<div class="empty">No payments yet.</div>';
    } catch (error) { document.getElementById('upgradeFinanceTable').innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`; notify(error.message, 'error'); }
  }
  async function loadAdminPricing() {
    try { const settings = await adminRequest('/api/admin/settings'); document.getElementById('upgradePostPrice').value = Number(settings.postPriceMinor || 0) / 100; const services = await adminRequest('/api/admin/services'); document.getElementById('upgradeServicesTable').innerHTML = services.length ? services.map(service => `<div class="table-row"><span><b>${escapeHtml(service.name)}</b><br><span class="muted">${escapeHtml(service.slug)} · ${service.active ? 'Active' : 'Inactive'}</span></span><b>${money(service.priceMinor)}</b></div>`).join('') : '<div class="empty">No paid services yet.</div>';     } catch (error) { document.getElementById('upgradeServicesTable').innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`; notify(error.message, 'error'); }
  }
  async function saveAdminPricing(event) {
    event.preventDefault();
    const message = document.getElementById('upgradePricingMessage');
      try { await adminRequest('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ postPrice: document.getElementById('upgradePostPrice').value }) }); message.textContent = 'Posting price saved.'; notify('Posting price saved.', 'success'); } catch (error) { message.textContent = error.message; notify(error.message, 'error'); }
  }
  async function createAdminService(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try { await adminRequest('/api/admin/services', { method: 'POST', body: JSON.stringify(values) }); event.currentTarget.reset(); notify('Service added.', 'success'); await loadAdminPricing(); } catch (error) { notify(error.message, 'error'); }
  }

  async function registerOfflineWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      registration.addEventListener('updatefound', () => { const worker = registration.installing; worker?.addEventListener('statechange', () => { if (worker.state === 'installed' && navigator.serviceWorker.controller) window.showUpdateAvailable?.(); }); });
    } catch { /* Offline fallback still works through the connection banner. */ }
  }
  async function init() {
    addStyles();
    bindPasswordToggles(document);
    installSharedConnectionRecovery();
    registerOfflineWorker();
    if (isPublicUserSite) { await renderPublicUserSite(); startPublicAutoRefresh(); checkForAppUpdate(); return; }
    makeOverlay();
    renderUserButton();
    injectAdminNavigation();
    await loadUser();
    await handleVerificationCallback();
    await handleResetCallback();
    await handlePaymentCallback();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
