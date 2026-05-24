// DEMO-only persistence + synthetic frame synthesis for the EL workspace.
// idb-keyval is not a project dependency, so this is a thin IndexedDB wrapper.
// No real camera SDK is touched here — frames are generated in the browser.

export interface ElFrame {
  id: string;
  ts: number;
  camera: string;
  setpointA: number;
  exposureMs: number;
  gain: number;
  recipe: string;
  dataUrl: string; // grayscale PNG data URL
  histogram: number[]; // 32 luminance bins
}

export interface ElRecipe {
  name: string;
  camera: string;
  setpointA: number;
  exposureMs: number;
  gain: number;
}

const DB_NAME = 'agnipariksha-el';
const DB_VERSION = 1;
const FRAMES = 'frames';
const RECIPES = 'recipes';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(FRAMES)) db.createObjectStore(FRAMES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(RECIPES)) db.createObjectStore(RECIPES, { keyPath: 'name' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
      }),
  );
}

export const saveFrame = (f: ElFrame) => run(FRAMES, 'readwrite', (s) => s.put(f));
export const listFrames = () => run<ElFrame[]>(FRAMES, 'readonly', (s) => s.getAll());
export const saveRecipe = (r: ElRecipe) => run(RECIPES, 'readwrite', (s) => s.put(r));
export const listRecipes = () => run<ElRecipe[]>(RECIPES, 'readonly', (s) => s.getAll());

const FW = 160;
const FH = 120;

// Build a synthetic NIR-like grayscale frame: brightness gradient modulated by
// gain, plus sensor noise and a diagonal "crack" of dark pixels so the Analysis
// view has something to find in demo mode. Returns the PNG data URL + histogram.
export function synthFrame(setpointA: number, gain: number): { dataUrl: string; histogram: number[] } {
  const canvas = document.createElement('canvas');
  canvas.width = FW;
  canvas.height = FH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { dataUrl: '', histogram: new Array(32).fill(0) };

  const img = ctx.createImageData(FW, FH);
  const histogram = new Array(32).fill(0);
  const drive = Math.min(1.6, Math.max(0.1, (setpointA / 9.5) * gain));

  for (let y = 0; y < FH; y++) {
    for (let x = 0; x < FW; x++) {
      let v = 110 + 90 * Math.sin((x / FW) * Math.PI) * (1 - (y / FH) * 0.6);
      v = v * drive + (Math.random() - 0.5) * 28;
      if (Math.abs(x - y * (FW / FH)) < 1.5) v = 8; // synthetic crack
      const px = Math.max(0, Math.min(255, Math.round(v)));
      const i = (y * FW + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = px;
      img.data[i + 3] = 255;
      histogram[px >> 3]++;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { dataUrl: canvas.toDataURL('image/png'), histogram };
}
