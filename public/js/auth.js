// Auth module — handles GitHub device flow authentication
const Auth = {
  async checkStatus() {
    try {
      const res = await fetch('/auth/status');
      return await res.json();
    } catch {
      return { authenticated: false, githubUser: null };
    }
  },

  async startDeviceFlow() {
    const res = await fetch('/auth/github/device/start', { method: 'POST' });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  },

  async pollDeviceFlow() {
    const res = await fetch('/auth/github/device/poll', { method: 'POST' });
    const data = await res.json();
    if (res.status >= 500) throw new Error(data.error || 'Poll failed');
    return data;
  },

  logout() {
    window.location.href = '/auth/logout';
  },
};
