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

  function roleLabel(role) {
    return role === 'admin' ? '管理員' : '測試帳號';
  }

  function updateSessionUi() {
    if (!sidebarSession) return;
    sidebarSession.innerHTML = '';
    sidebarSession.hidden = !state.user;
    if (!state.user) return;

    const identity = document.createElement('span');
    identity.className = 'sidebar-session-name';
    identity.textContent = `${state.user.username} · ${roleLabel(state.user.role)}`;
    const logout = document.createElement('button');
    logout.type = 'button';
    logout.className = 'sidebar-logout-button';
    logout.textContent = '登出';
    logout.addEventListener('click', logoutSession);
    sidebarSession.append(identity, logout);
  }

  function openLoginModal(route = null) {
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
      const result = await cloudApi.session();
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
      const result = await cloudApi.login(loginUsername.value.trim(), loginPassword.value);
      state.user = result.user;
      updateSessionUi();
      closeLoginModal();
      window.dispatchEvent(new CustomEvent('opentab:auth-changed', { detail: { user: state.user } }));
      const route = state.pendingRoute;
      state.pendingRoute = null;
      if (route && typeof setRoute === 'function') setRoute(route);
    } catch (error) {
      console.error(error);
      loginError.textContent = error?.message === 'INVALID_CREDENTIALS' ? '帳號或密碼錯誤' : '登入失敗，請確認後端設定。';
      loginPassword.select();
    } finally {
      submit.disabled = false;
    }
  }

  async function logoutSession() {
    try { await cloudApi.logout(); } catch (error) { console.error(error); }
    state.user = null;
    state.pendingRoute = null;
    updateSessionUi();
    window.dispatchEvent(new CustomEvent('opentab:auth-changed', { detail: { user: null } }));
    if (typeof setRoute === 'function') setRoute('#/catalog');
  }

  loginForm.addEventListener('submit', submitLogin);
  loginCancel.addEventListener('click', closeLoginModal);
  loginModal.addEventListener('click', event => { if (event.target === loginModal) closeLoginModal(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && loginModal.classList.contains('open')) closeLoginModal(); });

  const googleEnabled = Boolean(window.APP_CONFIG?.googleOAuthEnabled);
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
