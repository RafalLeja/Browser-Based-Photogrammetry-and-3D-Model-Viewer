import type { Unsubscribe } from './types';

type Handler<T> = (payload: T) => void;

/**
 * Small typed event emitter. `Events` maps each event name to its payload type,
 * so `emit('loaded', ...)` and `on('loaded', ...)` are checked by the compiler.
 *
 * The constraint is `object`, not `Record<string, unknown>`, because TypeScript does not
 * let an `interface` such as ViewerEvents satisfy an index signature.
 */
export class Emitter<Events extends object> {
  private readonly handlers = new Map<keyof Events, Set<Handler<Events[keyof Events]>>>();

  on<K extends keyof Events>(type: K, handler: Handler<Events[K]>): Unsubscribe {
    // The Map stores all events under one value type. This narrow cast is safe
    // because emit() only ever calls a handler with the payload of its own event.
    const stored = handler as Handler<Events[keyof Events]>;

    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(stored);

    const owner = set;
    return () => {
      owner.delete(stored);
    };
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    for (const handler of this.handlers.get(type) ?? []) {
      // One broken listener in the page must not break the viewer or other listeners.
      try {
        handler(payload);
      } catch (err) {
        console.error('[viewer]', `"${String(type)}" listener failed:`, err);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}
