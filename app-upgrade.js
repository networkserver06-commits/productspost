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
      .upgrade-site-hero{background:linear-gradient(135deg,#0e1b32,#19315d);color:#fff;padding:54px 7vw 36px}
      .upgrade-site-hero h1{font-size:clamp(38px,7vw,72px);margin:12px 0;letter-spacing:-.07em}
      .upgrade-site-hero p{color:#b7c2d7;max-width:680px}
      .upgrade-site-body{max-width:1000px;margin:0 auto;padding:38px 22px 70px}
      .upgrade-post-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:18px}
      .upgrade-post{background:#fff;border:1px solid #e5eaf1;border-radius:20px;padding:22px;box-shadow:0 12px 32px #19335a08}
      .upgrade-post h2{font-size:26px;letter-spacing:-.04em}
      .upgrade-post p{color:#6d7b92;white-space:pre-wrap}
      .upgrade-post time{color:#6d7b92;font-size:12px}
      .upgrade-admin-toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:0 0 16px}
      .upgrade-admin-toolbar input{flex:1;min-width:220px;padding:12px;border:1px solid #dedbd1;border-radius:12px;background:#fffdf9}
      @media(max-width:700px){.upgrade-grid,.upgrade-post-grid{grid-template-columns:1fr}.upgrade-panel{padding:22px 17px}.upgrade-balance{font-size:34px}.upgrade-trust{grid-template-columns:1fr}.password-toggle{padding:0 8px}}
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
  function openDashboard() {
    if (!userState.user) return openAuth('signin');
    makeOverlay();
    const overlay = document.getElementById('upgradeUserOverlay');
    overlay.querySelector('.upgrade-panel').classList.remove('narrow');
    overlay.querySelector('#upgradeAuthContent').innerHTML = `<div id="upgradeDashboardContent"><div class="eyebrow">@${escapeHtml(userState.user.username)}</div><h2>Your Lee Tech site.</h2><div class="upgrade-actions"><a class="upgrade-link" href="${escapeHtml(userState.user.siteUrl)}" target="_blank" rel="noopener">${escapeHtml(userState.user.siteUrl)}</a><button class="ghost" data-upgrade-logout>Sign out</button></div><div id="upgradeDashboardBody"><div class="upgrade-muted">Loading dashboard…</div></div></div>`;
    overlay.querySelector('[data-upgrade-logout]').addEventListener('click', logoutUser);
    overlay.classList.add('open');
    loadDashboard();
  }
  async function loadDashboard() {
    const body = document.getElementById('upgradeDashboardBody');
    if (!body) return;
    try {
      const [posts, services, wallet] = await Promise.all([request('/api/me/posts'), request('/api/services'), request('/api/wallet')]);
      userState.wallet = wallet;
      body.innerHTML = `<div class="upgrade-grid"><div class="upgrade-stat"><small>Wallet balance</small><strong>${money(wallet.balanceMinor, wallet.currency)}</strong></div><div class="upgrade-stat"><small>Published posts</small><strong>${posts.filter(post => post.published).length}</strong></div><div class="upgrade-stat"><small>Site status</small><strong>${userState.user.emailVerified ? 'Verified' : 'Pending'}</strong></div></div><div class="upgrade-card"><div class="upgrade-actions"><h3 style="margin-right:auto">Top up wallet</h3><span class="upgrade-muted">Paystack · ${escapeHtml(wallet.currency || 'KES')}</span></div><form class="upgrade-form" id="upgradeTopupForm"><label>Amount<input type="number" name="amount" min="1" step="0.01" placeholder="500" required></label><div class="upgrade-actions"><button class="primary" type="submit">Continue to secure payment</button><span class="upgrade-muted">Available channels depend on your Paystack account.</span></div></form></div><div class="upgrade-card"><div class="upgrade-actions"><h3 style="margin-right:auto">Create a post</h3><span class="upgrade-muted">Publishing uses the admin-set post price.</span></div><form class="upgrade-form" id="upgradePostForm"><label>Title<input name="title" maxlength="180" required></label><label>Excerpt<input name="excerpt" maxlength="500"></label><label>Content<textarea name="content" maxlength="50000" required></textarea></label><label>Image URL<input name="image" maxlength="2000000" placeholder="https://…"></label><label><input type="checkbox" name="published" value="true"> Publish now and charge the post fee</label><div class="upgrade-actions"><button class="primary" type="submit">Save post</button></div><div id="upgradePostMessage" class="upgrade-muted"></div></form></div><div class="upgrade-card"><h3>Available services</h3>${services.length ? services.map(service => `<div class="upgrade-row"><span><b>${escapeHtml(service.name)}</b><br><small>${escapeHtml(service.description || '')}</small></span><span><b>${money(service.priceMinor, wallet.currency)}</b><br><button class="ghost" data-upgrade-service="${escapeHtml(service._id)}">Use service</button></span></div>`).join('') : '<p class="upgrade-muted">No services are currently available.</p>'}</div><div class="upgrade-card"><h3>Recent wallet activity</h3>${wallet.transactions.length ? wallet.transactions.slice(0, 12).map(transaction => `<div class="upgrade-row"><span><b>${escapeHtml(transaction.description || transaction.type)}</b><br><small>${new Date(transaction.createdAt).toLocaleString()}</small></span><b>${transaction.amountMinor >= 0 ? '+' : ''}${money(transaction.amountMinor, wallet.currency)}</b></div>`).join('') : '<p class="upgrade-muted">No wallet activity yet.</p>'}</div><div class="upgrade-card"><h3>Your posts</h3>${posts.length ? posts.map(post => `<div class="upgrade-row"><span><b>${escapeHtml(post.title)}</b><br><small>${post.published ? 'Published' : 'Draft'} · ${new Date(post.createdAt).toLocaleDateString()}</small></span><button class="ghost" data-upgrade-edit-post="${escapeHtml(post._id)}">Edit</button></div>`).join('') : '<p class="upgrade-muted">Your first post will appear here.</p>'}</div>`;
      body.querySelector('#upgradeTopupForm').addEventListener('submit', beginTopup);
      body.querySelector('#upgradePostForm').addEventListener('submit', saveUserPost);
      body.querySelectorAll('[data-upgrade-service]').forEach(button => button.addEventListener('click', () => purchaseService(button.dataset.upgradeService)));
      body.querySelectorAll('[data-upgrade-edit-post]').forEach(button => button.addEventListener('click', () => editPost(posts.find(post => post._id === button.dataset.upgradeEditPost))));
    } catch (error) {
      body.innerHTML = `<div class="upgrade-alert">${escapeHtml(error.message)}. Verify your email and try again.</div>`;
    }
  }
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
      site.innerHTML = `<section class="upgrade-site-hero"><div class="eyebrow" style="color:#bdebdc">Lee Tech creator site</div><h1>${escapeHtml(data.user.displayName)}</h1><p>${escapeHtml(data.user.bio || `Read the latest posts from @${data.user.username}.`)}</p><a class="primary" href="/">Back to Lee Tech</a></section><section class="upgrade-site-body"><div class="section-head"><div><div class="eyebrow">@${escapeHtml(data.user.username)}</div><h2>Published posts</h2></div><p>Only posts published by this user appear on this site.</p></div><div class="upgrade-post-grid" id="upgradePublicPostGrid"></div></section>`;
      document.body.appendChild(site);
      const grid = site.querySelector('#upgradePublicPostGrid');
      grid.innerHTML = data.posts.length ? data.posts.map(post => `<article class="upgrade-post">${post.image ? `<img src="${escapeHtml(post.image)}" alt="" style="width:100%;max-height:280px;object-fit:cover;border-radius:12px;margin-bottom:14px">` : ''}<h2>${escapeHtml(post.title)}</h2><time>${new Date(post.createdAt).toLocaleDateString()} · ${escapeHtml(post.author || data.user.displayName)}</time><p>${escapeHtml(post.content)}</p></article>`).join('') : '<div class="upgrade-card"><p class="upgrade-muted">No published posts yet.</p></div>';
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
