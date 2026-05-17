/**
 * In-process fallback store used when the FastAPI backend is unreachable.
 *
 * The threaded assistant must keep working in pure-Next.js demo mode (e.g.
 * the public preview deployment with no backend) so an operator can still
 * exercise the per-module conversation flow. The shape mirrors the
 * backend's ``ThreadOut`` response so the UI code stays identical.
 */

export interface ThreadMessageShim {
  role: 'user' | 'assistant' | 'system';
  content: string;
  ts: number;
  tool_calls?: Array<{ name: string; args: Record<string, unknown> }>;
  tool_results?: Array<{ name: string; result: Record<string, unknown> }>;
}

interface ThreadShim {
  module_id: string;
  thread_id: number;
  created_at: string;
  updated_at: string;
  messages: ThreadMessageShim[];
}

class FallbackStore {
  private threads = new Map<string, ThreadShim>();
  private nextId = 1;

  read(moduleId: string): ThreadShim {
    let t = this.threads.get(moduleId);
    if (!t) {
      const now = new Date().toISOString();
      t = {
        module_id: moduleId,
        thread_id: this.nextId++,
        created_at: now,
        updated_at: now,
        messages: [],
      };
      this.threads.set(moduleId, t);
    }
    return t;
  }

  append(moduleId: string, msg: ThreadMessageShim): ThreadShim {
    const t = this.read(moduleId);
    t.messages.push(msg);
    t.updated_at = new Date().toISOString();
    return t;
  }

  clear(moduleId: string): void {
    const t = this.threads.get(moduleId);
    if (t) {
      t.messages = [];
      t.updated_at = new Date().toISOString();
    }
  }
}

// One shared instance per Node process. Next.js dev mode reloads modules,
// which would normally reset this; that's acceptable since the backend is
// the source of truth whenever it's up.
const globalAny = globalThis as unknown as { __agniFallbackStore?: FallbackStore };
if (!globalAny.__agniFallbackStore) {
  globalAny.__agniFallbackStore = new FallbackStore();
}
export const fallbackStore = globalAny.__agniFallbackStore!;
