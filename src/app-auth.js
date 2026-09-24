(() => {
  const state = { user: null, ready: false, pendingRoute: null };
  const loginModal = document.getElementById('loginModal');
  const loginForm = document.getElementById('loginForm');
  const loginUsername = document.getElementById('loginUsername');
  const loginPassword = document.getElementById('loginPassword');
  const loginError = document.getElementById('loginError');
  const loginCancel = document.getElementById('loginCancel');
  const googleLoginSection = document.getElementById('googleLoginSection');
  const googleLoginButton = document.getElementById('googleLoginButton');
  const sidebarSession = document.getElementById('sidebarSession');

  function roleLabel(user) {
    if (user?.localTest) return 'GitHub Test';
    return user?.role === 'admin' ? '管理員' : '測試帳號';
  }

  function loginErrorMessage(error) {
    if (error?.message === 'INVALID_CREDENTIALS') return '帳號或密碼錯誤';
    if (error?.message === 'VERCEL_SECURITY_CHALLENGE') {
      return 'Vercel 安全檢查暫時阻擋登入，請稍後再試或檢查 Firewall / Attack Mode。';
    }
    if (error?.status === 429) return '登入服務暫時受到流量限制，請稍後再試。';
    return '登入失敗，請確認後端設定。';
  }

  function updateSessionUi() {
    if (!sidebarSession) return;
    sidebarSession.innerHTML = '';
    sidebarSession.hidden = !state.user;
    if (!state.user) return;
    const identity = document.createElement('span');
    identity.className = 'sidebar-session-name';
    identity.textContent = `${state.user.username} · ${roleLabel(state.user)}`;
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'sidebar-logout-button';
    if (state.user.localTest) {
      action.textContent = '重設測試資料';
      action.addEventListener('click', resetTestData);
    } else {
      action.textContent = '登出';
      action.addEventListener('click', logoutSession);
    }
    sidebarSession.append(identity, action);
  }

  function openLoginModal(route = null) {
    if (dataSource.isLocalTest || state.user?.localTest) return;
    if (route) state.pendingRoute = route;
    loginError.textContent = '';
    loginPassword.value = '';
    loginModal.classList.add('open');
    loginModal.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => loginUsername.focus());
  }

  function closeLoginModal() {
    loginModal.classList.remove('open');
    loginModal.setAttribute('aria-hidden', 'true');
    loginError.textContent = '';
  }

  async function initializeAuth() {
    try {
      const result = await dataSource.session();
      state.user = result.user || null;
    } catch (error) {
      console.error(error);
      state.user = null;
    }
    state.ready = true;
    updateSessionUi();
    return state.user;
  }

  async function submitLogin(event) {
    event.preventDefault();
    loginError.textContent = '';
    const submit = loginForm.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const result = await dataSource.login(loginUsername.value.trim(), loginPassword.value);
      state.user = result.user;
      updateSessionUi();
      closeLoginModal();
      const pendingRoute = state.pendingRoute;
      state.pendingRoute = null;
      window.dispatchEvent(new CustomEvent('opentab:auth-changed', { detail: { user: state.user, pendingRoute } }));
    } catch (error) {
      console.error(error);
      loginError.textContent = loginErrorMessage(error);
      loginPassword.select();
    } finally {
      submit.disabled = false;
    }
  }

  async function logoutSession() {
    try { await dataSource.logout(); } catch (error) { console.error(error); }
    state.user = null;
    state.pendingRoute = null;
    updateSessionUi();
    window.dispatchEvent(new CustomEvent('opentab:auth-changed', { detail: { user: null, pendingRoute: '#/catalog' } }));
  }

  async function resetTestData() {
    if (!dataSource.isLocalTest || !dataSource.capabilities?.reset) return;
    await dataSource.reset();
    window.dispatchEvent(new CustomEvent('opentab:test-data-reset'));
  }

  loginForm.addEventListener('submit', submitLogin);
  loginCancel.addEventListener('click', closeLoginModal);
  loginModal.addEventListener('click', event => { if (event.target === loginModal) closeLoginModal(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && loginModal.classList.contains('open')) closeLoginModal(); });
  const googleEnabled = !dataSource.isLocalTest && Boolean(window.APP_CONFIG?.googleOAuthEnabled);
  if (googleLoginSection) googleLoginSection.hidden = !googleEnabled;
  if (googleLoginButton) {
    googleLoginButton.addEventListener('click', () => {
      if (!googleEnabled) return;
      window.location.assign('/api?action=google-start');
    });
  }

  window.authState = state;
  window.initializeAuth = initializeAuth;
  window.openLoginModal = openLoginModal;
  window.closeLoginModal = closeLoginModal;
  window.updateSessionUi = updateSessionUi;
})();
