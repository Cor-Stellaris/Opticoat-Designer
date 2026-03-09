const DB_NAME = 'opticoat-db';
const DB_VERSION = 1;

const STORES = {
  SESSION: 'session',
  DESIGNS: 'designs',
  MATERIALS: 'materials',
  MACHINES: 'machines',
  TRACKING_RUNS: 'trackingRuns',
  META: 'meta',
  SYNC_QUEUE: 'syncQueue',
};

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      // Key-value stores for session and meta
      if (!db.objectStoreNames.contains(STORES.SESSION)) {
        db.createObjectStore(STORES.SESSION);
      }
      if (!db.objectStoreNames.contains(STORES.META)) {
        db.createObjectStore(STORES.META);
      }
      // Record stores with auto-incrementing IDs
      if (!db.objectStoreNames.contains(STORES.DESIGNS)) {
        db.createObjectStore(STORES.DESIGNS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.MATERIALS)) {
        db.createObjectStore(STORES.MATERIALS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.MACHINES)) {
        db.createObjectStore(STORES.MACHINES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.TRACKING_RUNS)) {
        db.createObjectStore(STORES.TRACKING_RUNS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.SYNC_QUEUE)) {
        db.createObjectStore(STORES.SYNC_QUEUE, { autoIncrement: true });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Generic helpers
async function putItem(storeName, key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.put(value, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

async function getItem(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

async function getAllItems(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

async function deleteItem(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

async function clearStore(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

// ============ Session (working state) ============

export async function saveSession(data) {
  try {
    await putItem(STORES.SESSION, 'current', data);
  } catch (e) {
    console.warn('Failed to save session to IndexedDB:', e);
  }
}

export async function loadSession() {
  try {
    return await getItem(STORES.SESSION, 'current');
  } catch (e) {
    console.warn('Failed to load session from IndexedDB:', e);
    return null;
  }
}

// ============ Meta (tier info, timestamps) ============

export async function saveMeta(key, value) {
  try {
    await putItem(STORES.META, key, value);
  } catch (e) {
    console.warn('Failed to save meta:', e);
  }
}

export async function getMeta(key) {
  try {
    return await getItem(STORES.META, key);
  } catch (e) {
    console.warn('Failed to get meta:', e);
    return null;
  }
}

// ============ Tier caching ============

const TIER_TTL = 24 * 60 * 60 * 1000; // 24 hours

export async function saveTier(tierInfo) {
  await saveMeta('tier', {
    ...tierInfo,
    lastChecked: Date.now(),
  });
}

export async function getCachedTier() {
  const cached = await getMeta('tier');
  if (!cached) return null;

  const age = Date.now() - (cached.lastChecked || 0);
  return {
    ...cached,
    expired: age > TIER_TTL,
  };
}

// ============ Sync Queue ============

export async function addToSyncQueue(action) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.SYNC_QUEUE, 'readwrite');
      const store = tx.objectStore(STORES.SYNC_QUEUE);
      const request = store.add({
        ...action,
        timestamp: Date.now(),
      });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    });
  } catch (e) {
    console.warn('Failed to add to sync queue:', e);
  }
}

export async function getSyncQueue() {
  try {
    return await getAllItems(STORES.SYNC_QUEUE);
  } catch (e) {
    console.warn('Failed to get sync queue:', e);
    return [];
  }
}

export async function clearSyncQueue() {
  try {
    await clearStore(STORES.SYNC_QUEUE);
  } catch (e) {
    console.warn('Failed to clear sync queue:', e);
  }
}

// ============ Designs (local cache) ============

export async function saveDesignLocally(design) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.DESIGNS, 'readwrite');
      const store = tx.objectStore(STORES.DESIGNS);
      store.put(design);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  } catch (e) {
    console.warn('Failed to save design locally:', e);
  }
}

export async function getLocalDesigns() {
  return getAllItems(STORES.DESIGNS);
}

export async function deleteLocalDesign(id) {
  return deleteItem(STORES.DESIGNS, id);
}

// ============ Migration helper ============

export async function migrateFromLocalStorage() {
  try {
    const saved = localStorage.getItem('opticoat-customMaterials');
    if (saved) {
      const materials = JSON.parse(saved);
      const session = (await loadSession()) || {};
      session.customMaterials = materials;
      await saveSession(session);
      localStorage.removeItem('opticoat-customMaterials');
      console.log('Migrated customMaterials from localStorage to IndexedDB');
      return materials;
    }
  } catch (e) {
    console.warn('Migration from localStorage failed:', e);
  }
  return null;
}
