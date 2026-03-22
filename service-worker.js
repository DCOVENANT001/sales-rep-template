// SalesRep Service Worker v1.0
// Handles background sync for offline sales queue

const CACHE_NAME = 'salesrep-v1';
const SYNC_TAG = 'salesrep-sync';

// Install
self.addEventListener('install', event => {
  self.skipWaiting();
});

// Activate
self.addEventListener('activate', event => {
  event.waitUntil(clients.claim());
});

// Background Sync
self.addEventListener('sync', event => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(flushQueue());
  }
});

// Flush offline queue
async function flushQueue() {
  try {
    const db = await openDB();
    const queue = await getAllFromDB(db, 'queue');
    if (!queue.length) return;

    for (const item of queue) {
      try {
        const response = await fetch(item.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item.payload)
        });
        if (response.ok) {
          await deleteFromDB(db, 'queue', item.id);
          // Notify client that item was synced
          const allClients = await clients.matchAll();
          allClients.forEach(client => {
            client.postMessage({ type: 'SYNCED', id: item.payload._id });
          });
        }
      } catch (e) {
        // Will retry on next sync
        break;
      }
    }
  } catch (e) {
    console.error('SW flush error:', e);
  }
}

// IndexedDB helpers
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('salesrep-db', 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('queue')) {
        db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('counters')) {
        db.createObjectStore('counters', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('session')) {
        db.createObjectStore('session', { keyPath: 'key' });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

function getAllFromDB(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

function deleteFromDB(db, storeName, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = e => reject(e.target.error);
  });
}

// Listen for messages from main thread
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
