const DATABASE_NAME = 'namsaard-offline-evidence';
const DATABASE_VERSION = 1;
const STORE_NAME = 'evidence';

export interface OfflineEvidence {
  transactionId: string;
  blob: Blob;
  fileName: string;
  mimeType: string;
}

function isOfflineEvidence(value: unknown): value is OfflineEvidence {
  return (
    typeof value === 'object' &&
    value !== null &&
    'transactionId' in value &&
    typeof value.transactionId === 'string' &&
    'blob' in value &&
    value.blob instanceof Blob &&
    'fileName' in value &&
    typeof value.fileName === 'string' &&
    'mimeType' in value &&
    typeof value.mimeType === 'string'
  );
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('Offline photo storage is unavailable in this browser.'));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'transactionId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('Could not open offline photo storage.'));
    request.onblocked = () =>
      reject(new Error('Offline photo storage is blocked by another open tab.'));
  });
}

export async function saveOfflineEvidence(
  transactionId: string,
  file: File,
): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put({
      transactionId,
      blob: file,
      fileName: file.name,
      mimeType: file.type,
    } satisfies OfflineEvidence);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Could not save the photo for offline sync.'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Saving the offline photo was cancelled.'));
  }).finally(() => database.close());
}

export async function getOfflineEvidence(
  transactionId: string,
): Promise<OfflineEvidence | undefined> {
  const database = await openDatabase();
  return new Promise<OfflineEvidence | undefined>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(transactionId);
    request.onsuccess = () => {
      const evidence: unknown = request.result;
      if (evidence === undefined || isOfflineEvidence(evidence)) {
        resolve(evidence);
      } else {
        reject(new Error('Saved offline photo data is invalid.'));
      }
    };
    request.onerror = () =>
      reject(request.error ?? new Error('Could not read the saved offline photo.'));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => database.close();
    transaction.onabort = () => database.close();
  });
}

export async function removeOfflineEvidence(transactionId: string): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(transactionId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Could not remove the synced offline photo.'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Removing the offline photo was cancelled.'));
  }).finally(() => database.close());
}
