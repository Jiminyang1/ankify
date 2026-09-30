import type { OutboxOperation, OutboxRejection, OutboxStore } from "./outbox";

/**
 * IndexedDB outbox store in the extension's own origin. Only trusted contexts
 * (the background worker) open it; content scripts run in the page's origin,
 * whose storage LeetCode's scripts could read, and never touch it.
 */
const DB_NAME = "ankify-sync";
const DB_VERSION = 1;
const OPERATIONS = "operations";
const REJECTIONS = "rejections";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    tx.onerror = () => reject(tx.error);
  });
}

export function openSyncDatabase(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = factory.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(OPERATIONS)) db.createObjectStore(OPERATIONS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(REJECTIONS)) {
        db.createObjectStore(REJECTIONS, { keyPath: "id" }).createIndex("at", "at");
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error("IndexedDB upgrade blocked"));
  });
}

export function createIdbOutboxStore(open: () => Promise<IDBDatabase>): OutboxStore {
  // One connection per worker lifetime; reopened if the browser closes it.
  let connection: Promise<IDBDatabase> | null = null;
  const database = () => {
    connection ??= open().then((db) => {
      db.onclose = () => {
        connection = null;
      };
      return db;
    }, (error: unknown) => {
      connection = null;
      throw error;
    });
    return connection;
  };
  async function run<T>(stores: string[], mode: IDBTransactionMode, body: (tx: IDBTransaction) => Promise<T>) {
    const db = await database();
    const tx = db.transaction(stores, mode);
    const [result] = await Promise.all([body(tx), done(tx)]);
    return result;
  }
  return {
    get: (id) => run([OPERATIONS], "readonly", (tx) => request(tx.objectStore(OPERATIONS).get(id)) as Promise<OutboxOperation | undefined>),
    put: (operation) => run([OPERATIONS], "readwrite", async (tx) => {
      await request(tx.objectStore(OPERATIONS).put(operation));
    }),
    remove: (id) => run([OPERATIONS], "readwrite", async (tx) => {
      await request(tx.objectStore(OPERATIONS).delete(id));
    }),
    all: () => run([OPERATIONS], "readonly", (tx) => request(tx.objectStore(OPERATIONS).getAll()) as Promise<OutboxOperation[]>),
    addRejection: (rejection, keep) => run([REJECTIONS], "readwrite", async (tx) => {
      const store = tx.objectStore(REJECTIONS);
      await request(store.put(rejection));
      const keys = (await request(store.index("at").getAllKeys())) as IDBValidKey[];
      for (const key of keys.slice(0, Math.max(0, keys.length - keep))) await request(store.delete(key));
    }),
    rejections: () => run([REJECTIONS], "readonly", async (tx) =>
      ((await request(tx.objectStore(REJECTIONS).index("at").getAll())) as OutboxRejection[])),
  };
}
