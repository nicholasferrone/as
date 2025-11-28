
import { Story } from '../types';

const DB_NAME = 'DreamWeaverDB';
const STORE_NAME = 'stories';
const DB_VERSION = 1;

/**
 * Open IndexedDB database
 */
const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

/**
 * Generate a random ID
 */
const generateId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
};

/**
 * Save a story to IndexedDB
 */
export const saveStory = async (story: Story): Promise<string> => {
  const db = await openDB();
  const id = generateId();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    // Create a record with ID
    const record = { id, ...story, createdAt: Date.now() };
    
    store.put(record);
    
    // Wait for the transaction to complete to guarantee data is saved
    transaction.oncomplete = () => resolve(id);
    transaction.onerror = () => reject(transaction.error);
  });
};

/**
 * Get a story by ID
 */
export const getStory = async (id: string): Promise<Story | undefined> => {
  const db = await openDB();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);
    
    request.onsuccess = () => {
      const result = request.result;
      if (result) {
        resolve(result as Story);
      } else {
        resolve(undefined);
      }
    };
    request.onerror = () => reject(request.error);
  });
};
