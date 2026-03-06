// Auth module — handles authentication state and device flow
const Auth = {
  state: {
    authenticated: false,
    azureAuthenticated: false,
    azureUser: null,
    githubUser: null,
  },

  async checkStatus() {
    try {
      const res = await fetch('/auth/status');
      const data = await res.json();
      this.state = data;
      return data;
    } catch {
      this.state = { authenticated: false, azureAuthenticated: false, azureUser: null, githubUser: null };
      return this.state;
    }
  },

  async startDeviceFlow() {
    const res = await fetch('/auth/github/device/start', { method: 'POST' });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data; // { user_code, verification_uri, expires_in, interval }
  },

  async pollDeviceFlow() {
    const res = await fetch('/auth/github/device/poll', { method: 'POST' });
    const data = await res.json();
    if (res.status >= 500) throw new Error(data.error || 'Poll failed');
    return data; // { status: 'pending' | 'slow_down' | 'authorized' | 'expired', githubUser? }
  },

  logout() {
    window.location.href = '/auth/logout';
  },

  login() {
    window.location.href = '/auth/login';
  },
};
