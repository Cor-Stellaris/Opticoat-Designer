import { getSyncQueue, clearSyncQueue, saveTier, getCachedTier } from './offlineStore';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';
const SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes

class SyncManager {
  constructor() {
    this.isOnline = navigator.onLine;
    this.listeners = [];
    this.syncIntervalId = null;
    this.syncing = false;

    this._handleOnline = this._handleOnline.bind(this);
    this._handleOffline = this._handleOffline.bind(this);

    window.addEventListener('online', this._handleOnline);
    window.addEventListener('offline', this._handleOffline);
  }

  _handleOnline() {
    this.isOnline = true;
    this._notify('online');
    // When connectivity returns, sync immediately
    this.syncPendingActions();
    this.checkTierIfExpired();
  }

  _handleOffline() {
    this.isOnline = false;
    this._notify('offline');
  }

  // Subscribe to online/offline status changes
  onStatusChange(callback) {
    this.listeners.push(callback);
    // Return unsubscribe function
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  _notify(status) {
    this.listeners.forEach(cb => {
      try {
        cb(status);
      } catch (e) {
        console.warn('SyncManager listener error:', e);
      }
    });
  }

  // Start periodic sync checks (call once on app init)
  startPeriodicSync() {
    if (this.syncIntervalId) return;
    this.syncIntervalId = setInterval(() => {
      if (this.isOnline) {
        this.syncPendingActions();
        this.checkTierIfExpired();
      }
    }, SYNC_INTERVAL);
  }

  stopPeriodicSync() {
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
  }

  // Replay queued write actions to the server
  async syncPendingActions() {
    if (this.syncing || !this.isOnline) return;
    this.syncing = true;

    try {
      const queue = await getSyncQueue();
      if (queue.length === 0) {
        this.syncing = false;
        return;
      }

      let allSucceeded = true;

      for (const action of queue) {
        try {
          const response = await fetch(`${API_BASE}${action.endpoint}`, {
            method: action.method,
            headers: {
              'Content-Type': 'application/json',
              // Auth header will be added when Clerk is integrated
              // 'Authorization': `Bearer ${token}`,
            },
            body: action.body ? JSON.stringify(action.body) : undefined,
          });

          if (!response.ok) {
            console.warn(`Sync failed for ${action.method} ${action.endpoint}:`, response.status);
            allSucceeded = false;
          }
        } catch (e) {
          console.warn('Sync action failed:', e);
          allSucceeded = false;
          break; // Stop if we've gone offline mid-sync
        }
      }

      if (allSucceeded) {
        await clearSyncQueue();
        this._notify('synced');
      }
    } catch (e) {
      console.warn('Sync queue processing error:', e);
    }

    this.syncing = false;
  }

  // Check user tier if cache has expired (>24h)
  async checkTierIfExpired() {
    if (!this.isOnline) return;

    try {
      const cached = await getCachedTier();

      // If tier is cached and not expired, skip
      if (cached && !cached.expired) return;

      const response = await fetch(`${API_BASE}/api/auth/tier`, {
        headers: {
          // Auth header will be added when Clerk is integrated
          // 'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const tierInfo = await response.json();
        await saveTier(tierInfo);
        this._notify('tierUpdated');
      }
    } catch (e) {
      // Tier check failed — use cached version (graceful degradation)
      console.warn('Tier check failed, using cached tier:', e);
    }
  }

  // Clean up listeners
  destroy() {
    this.stopPeriodicSync();
    window.removeEventListener('online', this._handleOnline);
    window.removeEventListener('offline', this._handleOffline);
    this.listeners = [];
  }
}

// Singleton instance
const syncManager = new SyncManager();
export default syncManager;
