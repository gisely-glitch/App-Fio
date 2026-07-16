// db.js — IndexedDB wrapper for all structured data + binary attachments.
// Simple config/tokens live in localStorage (see integrations/*.js); everything
// else (appointments, expenses, documents, attachments) lives here so the app
// never loses data between sessions.

const DB_NAME = 'fio-db';
const DB_VERSION = 1;

const STORES = {
  appointments: { keyPath: 'id', indexes: [['datetime', 'datetime'], ['status', 'status'], ['type', 'type']] },
  attachments: { keyPath: 'id', indexes: [['appointmentId', 'appointmentId']] },
  fixedExpenses: { keyPath: 'id', indexes: [['dueDay', 'dueDay']] },
  variableExpenses: { keyPath: 'id', indexes: [['date', 'date'], ['cardId', 'cardId'], ['category', 'category']] },
  financialDocuments: { keyPath: 'id', indexes: [['uploadedAt', 'uploadedAt']] },
  cards: { keyPath: 'id', indexes: [] },
  emailSuggestions: { keyPath: 'id', indexes: [['status', 'status']] },
};

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      for (const [name, def] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath: def.keyPath });
          for (const [idxName, idxKey] of def.indexes) {
            store.createIndex(idxName, idxKey, { unique: false });
          }
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode) {
  return openDb().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function promisifyRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const db = {
  async put(storeName, value) {
    const store = await tx(storeName, 'readwrite');
    await promisifyRequest(store.put(value));
    return value;
  },
  async get(storeName, id) {
    const store = await tx(storeName, 'readonly');
    return promisifyRequest(store.get(id));
  },
  async getAll(storeName) {
    const store = await tx(storeName, 'readonly');
    return promisifyRequest(store.getAll());
  },
  async delete(storeName, id) {
    const store = await tx(storeName, 'readwrite');
    return promisifyRequest(store.delete(id));
  },
  async getAllByIndex(storeName, indexName, value) {
    const store = await tx(storeName, 'readonly');
    const idx = store.index(indexName);
    return promisifyRequest(idx.getAll(value));
  },
  async clear(storeName) {
    const store = await tx(storeName, 'readwrite');
    return promisifyRequest(store.clear());
  },
};

export function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}
