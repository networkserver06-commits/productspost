(() => {
  'use strict';

  const rootPath = window.location.pathname.replace(/^\/+|\/+$/g, '');
  const isPublicUserSite = !!rootPath && !rootPath.startsWith('api') && rootPath !== 'app-upgrade.js';
  const userState = { user: null, wallet: null, mode: 'signin', post: null, pendingUsername: '' };
  const upgrade = {};

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  }
  function money(minor = 0, currency = 'KES') {
    return new Intl.NumberFormat('en-KE', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(minor || 0) / 100);
  }
  async function request(url, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const response = await fetch(url, { ...options, headers, credentials: 'include' });
    const data = response.status === 204 ? null : await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || 'Something went wrong');
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
    const nonce = document.querySelector('style[nonce]')?.getAttribute('nonce') || '';
    const style = document.createElement('style');
    if (nonce) style.setAttribute('nonce', nonce);
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
      .upgrade-verification-card{background:linear-gradient(135deg,#eef3ff,#f6fbf8);border:1px solid #dbe6f5;border-radius:16px;padding:16px;margin:18px 0}.upgrade-verification-card strong{display:block;color:#12233f;margin-bottom:5px}
      .upgrade-code-input{letter-spacing:.3em;text-align:center;font-size:21px;font-weight:800}
      .upgrade-text-button{border:0;background:transparent;color:#1f5eff;font-weight:800;padding:8px 0;text-align:left;cursor:pointer}.upgrade-text-button:hover{text-decoration:underline}
      .upgrade-form button:disabled{opacity:.6;cursor:wait}
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
      .upgrade-dashboard{display:grid;grid-template-columns:236px minmax(0,1fr);min-height:720px;background:#f3f1eb;margin:-28px;border-radius:24px;overflow:hidden;color:#1d211f}.upgrade-dashboard-side{background:#1d1f1c;color:#fff;padding:26px 15px;display:flex;flex-direction:column}.upgrade-dashboard-brand{display:flex;align-items:center;gap:10px;padding:0 10px 26px}.upgrade-dashboard-brand>div{display:grid;line-height:1.15}.upgrade-dashboard-brand strong{font-size:15px}.upgrade-dashboard-brand small{color:#aeb2ab;font-size:11px;margin-top:4px}.upgrade-dashboard-avatar{display:grid;place-items:center;width:38px;height:38px;border-radius:12px;background:#f1b247;color:#1d1f1c;font:800 18px Manrope}.upgrade-dashboard-kicker{color:#747973;font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;padding:0 12px 10px}.upgrade-user-nav{display:grid;gap:5px}.upgrade-user-nav button{display:flex;align-items:center;gap:12px;color:#aeb2ab;border:0;border-left:3px solid transparent;background:transparent;border-radius:8px;padding:12px;font-weight:700;text-align:left}.upgrade-user-nav button:hover,.upgrade-user-nav button.active{background:#343633;color:#fff;border-left-color:#f1b247}.upgrade-user-nav button:first-letter{color:#d1d4ca}.upgrade-dashboard-side-footer{display:grid;gap:8px;margin-top:auto}.upgrade-dashboard-side-footer a,.upgrade-dashboard-side-footer button{border:0;background:transparent;color:#aeb2ab;padding:11px 10px;text-align:left;font-weight:700}.upgrade-dashboard-side-footer a:hover,.upgrade-dashboard-side-footer button:hover{color:#fff}.upgrade-dashboard-main{background:#f3f1eb;padding:34px;min-width:0}.upgrade-dashboard-top{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:24px}.upgrade-dashboard-top h2{font:800 clamp(28px,4vw,46px) Manrope;letter-spacing:-.06em;margin:7px 0 5px}.upgrade-dashboard-top p{color:#7d817a;margin:0;max-width:620px}.upgrade-dashboard-site-link{max-width:290px;color:#1f5eff;font-size:12px;font-weight:800;word-break:break-all;text-align:right}.upgrade-user-panel{display:none}.upgrade-user-panel.active{display:block;animation:userPanelIn .25s ease both}@keyframes userPanelIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}.upgrade-user-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.upgrade-user-stats .upgrade-stat{min-height:124px;background:#fffdf9;border-color:#e4e0d6;display:flex;flex-direction:column;justify-content:space-between}.upgrade-user-stats .upgrade-stat strong{font-size:26px;color:#1d211f}.upgrade-user-stats .upgrade-stat span{color:#888d84;font-size:11px;line-height:1.35}.upgrade-user-stats .upgrade-stat.highlight{background:#1d1f1c;color:#fff;border-color:#1d1f1c}.upgrade-user-stats .upgrade-stat.highlight small,.upgrade-user-stats .upgrade-stat.highlight span{color:#aeb2ab}.upgrade-user-stats .upgrade-stat.highlight strong{color:#fff}.upgrade-two-col{display:grid;grid-template-columns:1.15fr .85fr;gap:14px}.upgrade-card{background:#fffdf9;border:1px solid #e4e0d6;border-radius:18px;padding:18px;margin:14px 0;box-shadow:0 10px 28px rgba(31,34,27,.04)}.upgrade-card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px}.upgrade-card-head h3{margin:4px 0 0;font-size:20px;letter-spacing:-.03em}.upgrade-welcome-card{display:flex;justify-content:space-between;align-items:center;gap:20px;background:linear-gradient(135deg,#dce8ff,#eef6f1);border:1px solid #cfe0f2;border-radius:20px;padding:22px;margin:0 0 14px}.upgrade-welcome-card h3{font-size:26px;letter-spacing:-.04em;margin:5px 0}.upgrade-welcome-card p{color:#65748d;margin:0}.upgrade-welcome-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.upgrade-status-pill{display:inline-flex;align-items:center;border-radius:99px;background:#f0eee7;color:#70776d;padding:5px 9px;font-size:11px;font-weight:800}.upgrade-status-pill.success{background:#e2f5ee;color:#20735b}.upgrade-status-pill.danger{background:#fff0ee;color:#b54f4a}.upgrade-public-link,.upgrade-profile-link{display:block;color:#1f5eff;font-weight:800;word-break:break-all;background:#eef3ff;border-radius:12px;padding:12px;margin:10px 0}.upgrade-history-row,.upgrade-breakdown-row{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:12px 0;border-bottom:1px solid #e8e5dd}.upgrade-history-row:last-child,.upgrade-breakdown-row:last-child{border-bottom:0}.upgrade-history-row>div{display:grid;gap:3px;min-width:0}.upgrade-history-row strong{font-size:13px;overflow:hidden;text-overflow:ellipsis}.upgrade-history-row small{color:#888d84;font-size:11px}.positive{color:#16805b}.negative{color:#c05750}.upgrade-empty-state,.upgrade-chart-empty{display:grid;gap:5px;place-items:center;text-align:center;padding:26px;color:#888d84;font-size:12px}.upgrade-empty-state strong,.upgrade-chart-empty strong{color:#444942;font-size:14px}.upgrade-chart{display:flex;align-items:end;gap:8px;min-height:178px;padding:16px 4px 4px;border-bottom:1px solid #e4e0d6;background:repeating-linear-gradient(to bottom,transparent 0,transparent 40px,#ece9e2 41px)}.upgrade-chart.tall{min-height:230px}.upgrade-chart-column{flex:1;min-width:12px;height:150px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:5px}.upgrade-chart.tall .upgrade-chart-column{height:205px}.upgrade-chart-value{font-size:10px;color:#7d817a}.upgrade-chart-bar{width:100%;max-width:25px;min-height:7px;border-radius:7px 7px 2px 2px;background:linear-gradient(180deg,#d48768,#f1b247)}.upgrade-chart-bar.level-1{height:10%}.upgrade-chart-bar.level-2{height:20%}.upgrade-chart-bar.level-3{height:30%}.upgrade-chart-bar.level-4{height:40%}.upgrade-chart-bar.level-5{height:50%}.upgrade-chart-bar.level-6{height:60%}.upgrade-chart-bar.level-7{height:70%}.upgrade-chart-bar.level-8{height:80%}.upgrade-chart-bar.level-9{height:90%}.upgrade-chart-bar.level-10{height:100%}.upgrade-chart-column small{font-size:9px;color:#9a9e98}.upgrade-breakdown-row span{color:#697069;font-size:13px;overflow:hidden;text-overflow:ellipsis}.upgrade-breakdown-row b{font-size:13px}.upgrade-service-row{display:flex;justify-content:space-between;align-items:center;gap:18px;padding:15px 0;border-bottom:1px solid #e8e5dd}.upgrade-service-row:last-child{border-bottom:0}.upgrade-service-row p{color:#888d84;font-size:12px;margin:4px 0 0}.upgrade-service-buy{display:grid;gap:8px;justify-items:end;white-space:nowrap}.upgrade-check{display:flex!important;align-items:center;gap:8px}.upgrade-check input{width:auto!important}.upgrade-site-hero{background:linear-gradient(135deg,#0e1b32,#19315d);color:#fff;padding:54px 7vw 36px}
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
      @media(max-width:700px){.upgrade-grid,.upgrade-post-grid{grid-template-columns:1fr}.upgrade-panel{padding:22px 17px}.upgrade-balance{font-size:34px}.upgrade-trust{grid-template-columns:1fr}.password-toggle{padding:0 8px}.upgrade-dashboard{grid-template-columns:1fr;margin:-22px -17px;border-radius:0;min-height:760px}.upgrade-dashboard-side{position:sticky;top:0;z-index:3;padding:18px 15px}.upgrade-dashboard-brand{padding-bottom:14px}.upgrade-dashboard-kicker,.upgrade-dashboard-side-footer{display:none}.upgrade-user-nav{display:flex;overflow:auto;gap:5px}.upgrade-user-nav button{white-space:nowrap;padding:10px 11px;font-size:12px}.upgrade-dashboard-main{padding:22px 17px 35px}.upgrade-dashboard-top{display:block}.upgrade-dashboard-site-link{display:block;text-align:left;max-width:none;margin-top:10px}.upgrade-user-stats{grid-template-columns:repeat(2,1fr)}.upgrade-two-col{grid-template-columns:1fr}.upgrade-welcome-card{display:block}.upgrade-welcome-actions{justify-content:flex-start;margin-top:15px}.upgrade-service-row{align-items:flex-start}.upgrade-service-buy{justify-items:end}.upgrade-card{padding:15px}}
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
    box.innerHTML = `<div class="eyebrow">Lee Tech community</div><h2>${title}</h2><p class="upgrade-muted">${intro}</p>${!forgot ? `<div class="upgrade-tabs"><button class="upgrade-tab ${!register ? 'active' : ''}" data-auth-mode="signin">Sign in</button><button class="upgrade-tab ${register ? 'active' : ''}" data-auth-mode="register">Create account</button></div>` : ''}<div class="upgrade-trust"><span>Secure account</span><span>Private dashboard</span><span>Powered by Lee Tech</span></div><form class="upgrade-form" id="upgradeAuthForm">${formFields}<div class="upgrade-actions"><button class="primary" type="submit">${register ? 'Create account' : forgot ? 'Send reset link' : 'Sign in securely'}</button>${!register && !forgot ? '<button class="ghost" type="button" data-auth-mode="forgot">Forgot password?</button>' : ''}</div><div id="upgradeAuthMessage" class="upgrade-muted"></div></form>${!register && !forgot ? '<button class="upgrade-text-button" type="button" id="upgradeResendFromLogin">Need a new verification email?</button>' : ''}${register ? '<button class="upgrade-text-button" type="button" data-auth-mode="signin">Already have an account? Sign in</button>' : ''}`;
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
      } else {
        data = await request('/api/auth/user/login', { method: 'POST', body: JSON.stringify(values) });
        userState.user = data.user;
        document.getElementById('upgradeUserOverlay').classList.remove('open');
        renderUserButton();
        openDashboard();
      }
    } catch (error) { message.textContent = error.message; }
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
    } catch (error) { message.textContent = error.message; }
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
    } catch (error) { if (message) message.textContent = error.message; }
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
  function openDashboard() {
    if (!userState.user) return openAuth('signin');
    makeOverlay();
    const overlay = document.getElementById('upgradeUserOverlay');
    overlay.querySelector('.upgrade-panel').classList.remove('narrow');
    overlay.querySelector('#upgradeAuthContent').innerHTML = `<div id="upgradeDashboardContent" class="upgrade-dashboard"><aside class="upgrade-dashboard-side"><div class="upgrade-dashboard-brand"><span class="upgrade-dashboard-avatar">${escapeHtml((userState.user.displayName || userState.user.username).slice(0, 1).toUpperCase())}</span><div><strong>${escapeHtml(userState.user.displayName || userState.user.username)}</strong><small>@${escapeHtml(userState.user.username)}</small></div></div><div class="upgrade-dashboard-kicker">Creator workspace</div><nav class="upgrade-user-nav" aria-label="Creator dashboard"><button class="active" data-user-view="overview">◈ <span>Overview</span></button><button data-user-view="analytics">⌁ <span>Visitor analytics</span></button><button data-user-view="content">▤ <span>Posts & blogs</span></button><button data-user-view="wallet">¤ <span>Wallet & history</span></button><button data-user-view="services">◇ <span>Paid services</span></button><button data-user-view="profile">◎ <span>Profile & site</span></button><button data-user-view="security">◌ <span>Security</span></button></nav><div class="upgrade-dashboard-side-footer"><a href="${escapeHtml(userState.user.siteUrl)}" target="_blank" rel="noopener">↗ View public site</a><button data-upgrade-logout>⇥ Sign out securely</button></div></aside><section class="upgrade-dashboard-main"><header class="upgrade-dashboard-top"><div><div class="eyebrow">Lee Tech / Creator workspace</div><h2 id="upgradeUserViewTitle">Overview</h2><p>Build your site, understand your audience, and keep every transaction clear.</p></div><a class="upgrade-dashboard-site-link" href="${escapeHtml(userState.user.siteUrl)}" target="_blank" rel="noopener">${escapeHtml(userState.user.siteUrl)} ↗</a></header><div id="upgradeDashboardBody"><div class="upgrade-muted">Loading dashboard…</div></div></section></div>`;
    overlay.querySelector('[data-upgrade-logout]').addEventListener('click', logoutUser);
    overlay.querySelectorAll('[data-user-view]').forEach(button => button.addEventListener('click', () => switchUserDashboardView(button.dataset.userView)));
    overlay.classList.add('open');
    loadDashboard();
  }
  function switchUserDashboardView(view) { const body = document.getElementById('upgradeDashboardBody'); if (!body) return; body.querySelectorAll('[data-user-panel]').forEach(panel => panel.classList.toggle('active', panel.dataset.userPanel === view)); document.querySelectorAll('#upgradeDashboardContent [data-user-view]').forEach(button => button.classList.toggle('active', button.dataset.userView === view)); const title = { overview: 'Overview', analytics: 'Visitor analytics', content: 'Posts & blogs', wallet: 'Wallet & history', services: 'Paid services', profile: 'Profile & site', security: 'Security' }[view] || 'Overview'; const titleNode = document.getElementById('upgradeUserViewTitle'); if (titleNode) titleNode.textContent = title; bindUserDashboardActions(); }
  function renderUserDashboardPanels({ posts, services, wallet, analytics, security }) {
    const transactions = wallet.transactions || [];
    const payments = wallet.payments || [];
    const purchases = wallet.purchases || [];
    const published = posts.filter(post => post.published).length;
    const drafts = posts.length - published;
    const topups = payments.filter(payment => payment.status === 'credited');
    const serviceSpend = transactions.filter(row => row.type === 'service_charge').reduce((sum, row) => sum + Math.abs(Number(row.amountMinor || 0)), 0);
    const topupTotal = topups.reduce((sum, row) => sum + Number(row.amountMinor || 0), 0);
    return `<section class="upgrade-user-panel active" data-user-panel="overview"><div class="upgrade-welcome-card"><div><span class="eyebrow">Your creator site is ready</span><h3>Make your next idea public.</h3><p>Share your link, publish thoughtful work, and watch your audience grow.</p></div><div class="upgrade-welcome-actions"><a class="primary" href="${escapeHtml(userState.user.siteUrl)}" target="_blank" rel="noopener">Open my site ↗</a><button class="ghost" data-user-view="content">Write a post</button></div></div><div class="upgrade-user-stats"><div class="upgrade-stat"><small>Wallet balance</small><strong>${money(wallet.balanceMinor, wallet.currency)}</strong><span>Available to publish & use services</span></div><div class="upgrade-stat"><small>Visitors · 30 days</small><strong>${Number(analytics.visits || 0)}</strong><span>${Number(analytics.sessions || 0)} unique sessions</span></div><div class="upgrade-stat"><small>Published posts</small><strong>${published}</strong><span>${drafts} draft${drafts === 1 ? '' : 's'} in your workspace</span></div><div class="upgrade-stat"><small>Account status</small><strong>${userState.user.emailVerified ? 'Verified' : 'Pending'}</strong><span>Protected creator account</span></div></div><div class="upgrade-two-col"><div class="upgrade-card upgrade-analytics-card"><div class="upgrade-card-head"><div><span class="eyebrow">Audience signal</span><h3>Visitors over time</h3></div><button class="upgrade-text-button" data-user-view="analytics">View analytics ↗</button></div><div class="upgrade-chart">${renderUserChart(analytics.daily)}</div></div><div class="upgrade-card"><div class="upgrade-card-head"><div><span class="eyebrow">Public identity</span><h3>Your site link</h3></div><span class="upgrade-status-pill">Live</span></div><a class="upgrade-public-link" href="${escapeHtml(userState.user.siteUrl)}" target="_blank" rel="noopener">${escapeHtml(userState.user.siteUrl)}</a><p class="upgrade-muted">Only your published posts and blogs appear on this public site.</p><button class="ghost" data-user-view="profile">Edit profile & bio</button></div></div><div class="upgrade-card"><div class="upgrade-card-head"><div><span class="eyebrow">Latest movement</span><h3>Wallet activity</h3></div><button class="upgrade-text-button" data-user-view="wallet">See full history ↗</button></div>${renderActivityRows(transactions.slice(0, 5), wallet.currency)}</div></section><section class="upgrade-user-panel" data-user-panel="analytics"><div class="upgrade-user-stats"><div class="upgrade-stat"><small>Total visits</small><strong>${Number(analytics.visits || 0)}</strong><span>Last ${analytics.days || 30} days</span></div><div class="upgrade-stat"><small>Unique sessions</small><strong>${Number(analytics.sessions || 0)}</strong><span>Privacy-safe session estimate</span></div><div class="upgrade-stat"><small>Top-up volume</small><strong>${money(topupTotal, wallet.currency)}</strong><span>${topups.length} completed top-up${topups.length === 1 ? '' : 's'}</span></div><div class="upgrade-stat"><small>Service spend</small><strong>${money(serviceSpend, wallet.currency)}</strong><span>${purchases.length} purchase${purchases.length === 1 ? '' : 's'}</span></div></div><div class="upgrade-card upgrade-analytics-card"><div class="upgrade-card-head"><div><span class="eyebrow">Audience signal</span><h3>Visitor trend</h3></div><span class="upgrade-muted">Last ${analytics.days || 30} days</span></div><div class="upgrade-chart tall">${renderUserChart(analytics.daily)}</div></div><div class="upgrade-two-col"><div class="upgrade-card"><div class="upgrade-card-head"><h3>Devices</h3><span class="upgrade-muted">Visits</span></div>${(analytics.devices || []).length ? analytics.devices.map(row => `<div class="upgrade-breakdown-row"><span>${escapeHtml(row._id || 'Unknown')}</span><b>${Number(row.value || 0)}</b></div>`).join('') : '<div class="upgrade-empty-state">No device data yet.</div>'}</div><div class="upgrade-card"><div class="upgrade-card-head"><h3>Top sources</h3><span class="upgrade-muted">Referrers</span></div>${(analytics.sources || []).length ? analytics.sources.map(row => `<div class="upgrade-breakdown-row"><span>${escapeHtml(row._id || 'Direct')}</span><b>${Number(row.value || 0)}</b></div>`).join('') : '<div class="upgrade-empty-state">No referral data yet.</div>'}</div></div><div class="upgrade-card"><div class="upgrade-card-head"><h3>Popular pages</h3><span class="upgrade-muted">Paths</span></div>${(analytics.pages || []).length ? analytics.pages.map(row => `<div class="upgrade-breakdown-row"><span>${escapeHtml(row._id || '/')}</span><b>${Number(row.value || 0)}</b></div>`).join('') : '<div class="upgrade-empty-state">Your site pages will appear here.</div>'}</div></section><section class="upgrade-user-panel" data-user-panel="content"><div class="upgrade-card"><div class="upgrade-card-head"><div><span class="eyebrow">Publish to your site</span><h3>Create a post or blog</h3></div><span class="upgrade-muted">Posting price is set by Lee Tech</span></div><form class="upgrade-form" id="upgradePostForm"><label>Title<input name="title" maxlength="180" required></label><label>Excerpt<input name="excerpt" maxlength="500" placeholder="A short introduction for your readers"></label><label>Content<textarea name="content" maxlength="50000" required placeholder="Write something worth sharing…"></textarea></label><label>Image URL<input name="image" maxlength="2000000" placeholder="https://…"></label><label class="upgrade-check"><input type="checkbox" name="published" value="true"> Publish now and charge the post fee</label><div class="upgrade-actions"><button class="primary" type="submit">Save post</button><span id="upgradePostMessage" class="upgrade-muted"></span></div></form></div><div class="upgrade-card"><div class="upgrade-card-head"><div><span class="eyebrow">Your library</span><h3>Posts & blogs</h3></div><span class="upgrade-status-pill">${posts.length} total</span></div>${posts.length ? posts.map(post => `<div class="upgrade-history-row"><div><strong>${escapeHtml(post.title)}</strong><small>${post.published ? 'Published on your site' : 'Draft'} · ${formatUserDate(post.createdAt)}</small></div><button class="ghost" data-upgrade-edit-post="${escapeHtml(post._id)}">Edit</button></div>`).join('') : '<div class="upgrade-empty-state">Your first post will appear here.</div>'}</div></section><section class="upgrade-user-panel" data-user-panel="wallet"><div class="upgrade-user-stats"><div class="upgrade-stat highlight"><small>Available balance</small><strong>${money(wallet.balanceMinor, wallet.currency)}</strong><span>Use it for publishing and services</span></div><div class="upgrade-stat"><small>Completed top-ups</small><strong>${topups.length}</strong><span>${money(topupTotal, wallet.currency)} added</span></div><div class="upgrade-stat"><small>Publishing spend</small><strong>${money(transactions.filter(row => row.type === 'post_publish').reduce((sum, row) => sum + Math.abs(Number(row.amountMinor || 0)), 0), wallet.currency)}</strong><span>Post publishing fees</span></div><div class="upgrade-stat"><small>Service spend</small><strong>${money(serviceSpend, wallet.currency)}</strong><span>Paid services purchased</span></div></div><div class="upgrade-card"><div class="upgrade-card-head"><div><span class="eyebrow">Add funds</span><h3>Top up wallet</h3></div><span class="upgrade-muted">Paystack · ${escapeHtml(wallet.currency || 'KES')}</span></div><form class="upgrade-form" id="upgradeTopupForm"><label>Amount<input type="number" name="amount" min="1" step="0.01" placeholder="500" required></label><div class="upgrade-actions"><button class="primary" type="submit">Continue to secure payment</button><span class="upgrade-muted">Available payment channels depend on your Paystack account.</span></div></form></div><div class="upgrade-card"><div class="upgrade-card-head"><h3>Wallet ledger</h3><span class="upgrade-muted">Every change is recorded</span></div>${renderActivityRows(transactions, wallet.currency)}</div><div class="upgrade-card"><div class="upgrade-card-head"><h3>Payment attempts</h3><span class="upgrade-muted">Paystack history</span></div>${payments.length ? payments.map(payment => `<div class="upgrade-history-row"><div><strong>${money(payment.amountMinor, wallet.currency)} top-up</strong><small>${escapeHtml(payment.reference)} · ${formatUserDate(payment.createdAt)}</small></div><span class="upgrade-status-pill ${payment.status === 'credited' ? 'success' : ''}">${escapeHtml(payment.status || 'pending')}</span></div>`).join('') : '<div class="upgrade-empty-state">No payment attempts yet.</div>'}</div></section><section class="upgrade-user-panel" data-user-panel="services"><div class="upgrade-card"><div class="upgrade-card-head"><div><span class="eyebrow">Concierge services</span><h3>Build your next chapter</h3></div><span class="upgrade-muted">Pay from wallet balance</span></div>${services.length ? services.map(service => `<div class="upgrade-service-row"><div><strong>${escapeHtml(service.name)}</strong><p>${escapeHtml(service.description || 'A focused Lee Tech service for your next move.')}</p></div><div class="upgrade-service-buy"><b>${money(service.priceMinor, wallet.currency)}</b><button class="primary" data-upgrade-service="${escapeHtml(service._id)}">Use service</button></div></div>`).join('') : '<div class="upgrade-empty-state">No paid services are available yet.</div>'}</div><div class="upgrade-card"><div class="upgrade-card-head"><h3>Service history</h3><span class="upgrade-muted">Your completed purchases</span></div>${purchases.length ? purchases.map(purchase => `<div class="upgrade-history-row"><div><strong>${escapeHtml(purchase.serviceName)}</strong><small>${formatUserDate(purchase.createdAt)}</small></div><b class="negative">-${money(purchase.amountMinor, wallet.currency)}</b></div>`).join('') : '<div class="upgrade-empty-state">Your service purchases will appear here.</div>'}</div></section><section class="upgrade-user-panel" data-user-panel="profile"><div class="upgrade-two-col"><div class="upgrade-card"><div class="upgrade-card-head"><div><span class="eyebrow">Public identity</span><h3>Profile & site</h3></div><span class="upgrade-status-pill success">${userState.user.emailVerified ? 'Verified' : 'Pending'}</span></div><p class="upgrade-muted">Your username is permanent and powers your public link.</p><div class="upgrade-profile-link">${escapeHtml(userState.user.siteUrl)}</div><form class="upgrade-form" id="upgradeProfileForm"><label>Display name<input name="displayName" maxlength="120" value="${escapeHtml(userState.user.displayName || userState.user.username)}" required></label><label>Bio<textarea name="bio" maxlength="600" placeholder="Tell visitors what you create…">${escapeHtml(userState.user.bio || '')}</textarea></label><div class="upgrade-actions"><button class="primary" type="submit">Save profile</button><span id="upgradeProfileMessage" class="upgrade-muted"></span></div></form></div><div class="upgrade-card"><div class="upgrade-card-head"><h3>Share your site</h3><span class="eyebrow">Invite your audience</span></div><p class="upgrade-muted">Your customers will only see posts and blogs you publish on this username site.</p><button class="primary" data-share-user-site>Share my site ↗</button></div></div></section><section class="upgrade-user-panel" data-user-panel="security"><div class="upgrade-two-col"><div class="upgrade-card"><div class="upgrade-card-head"><div><span class="eyebrow">Account security</span><h3>Change password</h3></div></div><form class="upgrade-form" id="upgradeChangePasswordForm">${passwordField({ name: 'currentPassword', label: 'Current password', autocomplete: 'current-password' })}${passwordField({ name: 'newPassword', label: 'New password', autocomplete: 'new-password', hint: 'Use at least 12 characters.' })}${passwordField({ name: 'confirmNewPassword', label: 'Confirm new password', autocomplete: 'new-password', confirm: true })}<div class="upgrade-actions"><button class="primary" type="submit">Update password</button><span id="upgradePasswordMessage" class="upgrade-muted"></span></div></form></div><div class="upgrade-card"><div class="upgrade-card-head"><div><span class="eyebrow">Recent security</span><h3>Sign-in activity</h3></div><span class="upgrade-muted">Private & protected</span></div>${security.length ? security.slice(0, 12).map(row => `<div class="upgrade-history-row"><div><strong>${escapeHtml(row.event || 'Account activity')}</strong><small>${escapeHtml(row.device || 'Unknown device')} · ${formatUserDate(row.createdAt)}</small></div><span class="upgrade-status-pill ${row.success ? 'success' : 'danger'}">${row.success ? 'Success' : 'Blocked'}</span></div>`).join('') : '<div class="upgrade-empty-state">Security activity will appear after your next account action.</div>'}</div></div></section>`;
  }
  function bindUserDashboardActions() { const body = document.getElementById('upgradeDashboardBody'); if (!body) return; body.querySelectorAll('[data-user-view]').forEach(button => { if (button.dataset.bound) return; button.dataset.bound = 'true'; button.addEventListener('click', () => switchUserDashboardView(button.dataset.userView)); }); body.querySelector('#upgradeTopupForm')?.addEventListener('submit', beginTopup); body.querySelector('#upgradePostForm')?.addEventListener('submit', saveUserPost); body.querySelector('#upgradeProfileForm')?.addEventListener('submit', saveUserProfile); body.querySelector('#upgradeChangePasswordForm')?.addEventListener('submit', saveUserPassword); body.querySelectorAll('[data-upgrade-service]').forEach(button => { if (button.dataset.bound) return; button.dataset.bound = 'true'; button.addEventListener('click', () => purchaseService(button.dataset.upgradeService)); }); body.querySelectorAll('[data-upgrade-edit-post]').forEach(button => { if (button.dataset.bound) return; button.dataset.bound = 'true'; button.addEventListener('click', () => editPost((userState.dashboardPosts || []).find(post => post._id === button.dataset.upgradeEditPost))); }); body.querySelector('[data-share-user-site]')?.addEventListener('click', () => window.shareItem?.(`${userState.user.displayName || userState.user.username} — Lee Tech creator site`, userState.user.bio || `Published posts from @${userState.user.username}.`, '', userState.user.siteUrl)); bindPasswordToggles(body); }
  async function loadDashboard() { const body = document.getElementById('upgradeDashboardBody'); if (!body) return; try { const results = await Promise.allSettled([request('/api/me/posts'), request('/api/services'), request('/api/wallet'), request('/api/me/analytics'), request('/api/me/security')]); const [postsResult, servicesResult, walletResult, analyticsResult, securityResult] = results; if (postsResult.status === 'rejected' || servicesResult.status === 'rejected' || walletResult.status === 'rejected') throw (postsResult.reason || servicesResult.reason || walletResult.reason); const posts = postsResult.value || []; const services = servicesResult.value || []; const wallet = walletResult.value || { balanceMinor: 0, currency: 'KES', transactions: [], payments: [], purchases: [] }; const analytics = analyticsResult.status === 'fulfilled' ? analyticsResult.value : { days: 30, visits: 0, sessions: 0, daily: [], devices: [], sources: [], pages: [] }; const security = securityResult.status === 'fulfilled' ? securityResult.value : []; userState.wallet = wallet; userState.dashboardPosts = posts; body.innerHTML = renderUserDashboardPanels({ posts, services, wallet, analytics, security }); bindUserDashboardActions(); } catch (error) { body.innerHTML = `<div class="upgrade-alert">${escapeHtml(error.message)}. Verify your email and try again.</div>`; } }
  async function beginTopup(event) {
    event.preventDefault();
    const amount = new FormData(event.currentTarget).get('amount');
    try { const result = await request('/api/wallet/paystack/initialize', { method: 'POST', body: JSON.stringify({ amount }) }); window.location.href = result.authorizationUrl; }
    catch (error) { notify(error.message, 'error'); }
  }
  async function saveUserPost(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    const body = { ...values, published: values.published === 'true' };
    const message = form.querySelector('#upgradePostMessage');
    try { await request('/api/me/posts' + (userState.post ? `/${userState.post._id}` : ''), { method: userState.post ? 'PUT' : 'POST', body: JSON.stringify(body) }); userState.post = null; message.textContent = 'Post saved successfully.'; form.reset(); await loadDashboard(); }
    catch (error) { message.textContent = error.message; }
  }
  function editPost(post) {
    if (!post) return;
    userState.post = post;
    const form = document.getElementById('upgradePostForm');
    if (!form) return;
    ['title', 'excerpt', 'content', 'image'].forEach(field => { if (form.elements[field]) form.elements[field].value = post[field] || ''; });
    if (form.elements.published) form.elements.published.checked = !!post.published;
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  async function purchaseService(id) {
    if (!window.confirm('Use wallet balance for this service?')) return;
    try { await request(`/api/services/${encodeURIComponent(id)}/purchase`, { method: 'POST' }); notify('Service purchased successfully.', 'success'); await loadDashboard(); } catch (error) { notify(error.message, 'error'); }
  }
  async function saveUserProfile(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = form.querySelector('#upgradeProfileMessage');
    try {
      const data = await request('/api/me/profile', { method: 'PUT', body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
      userState.user = data.user;
      updateUserButton();
      document.querySelector('#upgradeDashboardContent .upgrade-dashboard-brand strong')?.replaceChildren(document.createTextNode(userState.user.displayName || userState.user.username));
      document.querySelector('#upgradeDashboardContent .upgrade-dashboard-top p')?.replaceChildren(document.createTextNode('Build your site, understand your audience, and keep every transaction clear.'));
      if (message) message.textContent = 'Profile saved. Your public site is updated.';
      notify('Profile updated successfully.', 'success');
    } catch (error) { if (message) message.textContent = error.message; }
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
    } catch (error) { if (message) message.textContent = error.message; }
  }
  async function logoutUser() {
    await request('/api/auth/user/logout', { method: 'POST' }).catch(() => {});
    userState.user = null;
    userState.wallet = null;
    document.getElementById('upgradeUserOverlay')?.classList.remove('open');
    updateUserButton();
    notify('Signed out successfully.', 'success');
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
        window.history.replaceState({}, '', window.location.pathname);
        setTimeout(() => { overlay.classList.remove('open'); openAuth('signin'); }, 700);
      } catch (error) { message.textContent = error.message; }
    });
  }
  async function handlePaymentCallback() {
    const params = new URLSearchParams(window.location.search);
    const reference = params.get('reference') || params.get('trxref');
    if (params.get('payment') !== 'complete' || !reference) return;
    try { const data = await request(`/api/wallet/paystack/verify/${encodeURIComponent(reference)}`, { method: 'POST' }); notify(`Wallet credited: ${money(data.balanceMinor)}`, 'success'); window.history.replaceState({}, '', window.location.pathname); if (userState.user) openDashboard(); }
    catch (error) { notify(`Payment is still being confirmed: ${error.message}`, 'info'); }
  }
  async function renderPublicUserSite() {
    try {
      const data = await request(`/api/public/sites/${encodeURIComponent(rootPath)}`);
      document.querySelector('header')?.remove();
      document.querySelector('main')?.remove();
      document.querySelector('footer')?.remove();
      const site = document.createElement('div');
      site.id = 'upgradePublicUserSite';
      site.innerHTML = `<section class="upgrade-site-hero"><div class="eyebrow" style="color:#bdebdc">Lee Tech creator site</div><h1>${escapeHtml(data.user.displayName)}</h1><p>${escapeHtml(data.user.bio || `Read the latest posts from @${data.user.username}.`)}</p><div class="upgrade-site-hero-actions"><a class="primary" href="/">Back to Lee Tech</a><button class="ghost upgrade-site-share" type="button" data-share-site>Share this site ↗</button></div></section><section class="upgrade-site-body"><div class="section-head"><div><div class="eyebrow">@${escapeHtml(data.user.username)}</div><h2>Published posts</h2></div><p>Only posts published by this user appear on this site.</p></div><div class="upgrade-post-grid" id="upgradePublicPostGrid"></div></section>`;
      document.body.appendChild(site);
      const grid = site.querySelector('#upgradePublicPostGrid');
      grid.innerHTML = data.posts.length ? data.posts.map(post => `<article class="upgrade-post">${post.image ? `<img src="${escapeHtml(post.image)}" alt="" style="width:100%;max-height:280px;object-fit:cover;border-radius:12px;margin-bottom:14px">` : ''}<h2>${escapeHtml(post.title)}</h2><time>${new Date(post.createdAt).toLocaleDateString()} · ${escapeHtml(post.author || data.user.displayName)}</time><p>${escapeHtml(post.content)}</p><div class="upgrade-post-actions"><button class="ghost upgrade-post-share" type="button" data-share-post data-share-title="${escapeHtml(post.title)}" data-share-text="${escapeHtml(post.excerpt || post.content.slice(0,170))}">Share this post ↗</button></div></article>`).join('') : '<div class="upgrade-card"><p class="upgrade-muted">No published posts yet.</p></div>';
      site.querySelector('[data-share-site]')?.addEventListener('click', () => window.shareItem?.(`${data.user.displayName} — Lee Tech creator site`, data.user.bio || `Published posts from @${data.user.username}.`, '', `${location.origin}${location.pathname}`));
      site.querySelectorAll('[data-share-post]').forEach(button => button.addEventListener('click', () => window.shareItem?.(button.dataset.shareTitle, button.dataset.shareText, '', `${location.origin}${location.pathname}`)));
    } catch {
      document.body.innerHTML = `<div class="upgrade-site-body"><div class="eyebrow">Lee Tech</div><h1>Site not found.</h1><p class="upgrade-muted">This username site does not exist, is not verified, or has no public access yet.</p><a class="primary" href="/">Return to Lee Tech</a></div>`;
    }
  }

  function adminRequest(url, options = {}) {
    const token = localStorage.getItem('leeToken');
    return request(url, { ...options, headers: { ...(options.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  }
  function injectAdminNavigation() {
    const nav = document.querySelector('.admin-nav-secondary');
    if (!nav || document.getElementById('upgradeAdminUsersButton')) return;
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
    } catch (error) { table.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`; }
  }
  async function loadAdminFinance() {
    try {
      const data = await adminRequest('/api/admin/finance');
      const credited = data.topups.reduce((sum, row) => sum + Number(row.totalMinor || 0), 0);
      const charged = data.charges.reduce((sum, row) => sum + Number(row.totalMinor || 0), 0);
      document.getElementById('upgradeFinanceStats').innerHTML = `<div class="stat"><small>Total users</small><b>${data.users}</b></div><div class="stat"><small>Top-ups credited</small><b>${money(credited)}</b></div><div class="stat"><small>Wallet charges</small><b>${money(charged)}</b></div><div class="stat"><small>Service purchases</small><b>${data.purchases}</b></div>`;
      document.getElementById('upgradeFinanceTable').innerHTML = data.recentPayments.length ? data.recentPayments.map(payment => `<div class="table-row"><span><b>${escapeHtml(payment.userId?.username || 'Unknown user')}</b><br><span class="muted">${escapeHtml(payment.reference)} · ${payment.status}</span></span><b>${money(payment.amountMinor, payment.currency)}</b></div>`).join('') : '<div class="empty">No payments yet.</div>';
    } catch (error) { document.getElementById('upgradeFinanceTable').innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`; }
  }
  async function loadAdminPricing() {
    try { const settings = await adminRequest('/api/admin/settings'); document.getElementById('upgradePostPrice').value = Number(settings.postPriceMinor || 0) / 100; const services = await adminRequest('/api/admin/services'); document.getElementById('upgradeServicesTable').innerHTML = services.length ? services.map(service => `<div class="table-row"><span><b>${escapeHtml(service.name)}</b><br><span class="muted">${escapeHtml(service.slug)} · ${service.active ? 'Active' : 'Inactive'}</span></span><b>${money(service.priceMinor)}</b></div>`).join('') : '<div class="empty">No paid services yet.</div>'; } catch (error) { document.getElementById('upgradeServicesTable').innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`; }
  }
  async function saveAdminPricing(event) {
    event.preventDefault();
    const message = document.getElementById('upgradePricingMessage');
    try { await adminRequest('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ postPrice: document.getElementById('upgradePostPrice').value }) }); message.textContent = 'Posting price saved.'; } catch (error) { message.textContent = error.message; }
  }
  async function createAdminService(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try { await adminRequest('/api/admin/services', { method: 'POST', body: JSON.stringify(values) }); event.currentTarget.reset(); notify('Service added.', 'success'); await loadAdminPricing(); } catch (error) { notify(error.message, 'error'); }
  }

  async function init() {
    addStyles();
    bindPasswordToggles(document);
    if (isPublicUserSite) { await renderPublicUserSite(); return; }
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
