// Audit-session persistence via IndexedDB (screenshot data URLs are far too
// large for localStorage's ~5MB quota).
import type { TestIssue, TestResult, ChecklistStatus, RecentReport, TestingIssue } from '../types';

export interface SavedSession {
  testedUrl: string;
  testResult: TestResult | null;
  issues: TestIssue[];
  checklistStatus: ChecklistStatus;
  recentReports: RecentReport[];
  manualIssues: TestingIssue[];
  savedAt: string;
}

const DB_NAME = 'testing-agent';
const STORE = 'sessions';
const KEY = 'latest';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveSession(data: SavedSession): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(data, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Persistence is best-effort; never break the app over it.
  }
}

export async function loadSession(): Promise<SavedSession | null> {
  try {
    const db = await openDb();
    const data = await new Promise<SavedSession | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as SavedSession) ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return data;
  } catch {
    return null;
  }
}
