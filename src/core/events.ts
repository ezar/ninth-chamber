/**
 * Simulation event queue. The simulation emits; render, audio and UI consume
 * the events after each tick. The simulation never calls those layers.
 */

export interface SimEvent {
  type: string;
  tick: number;
  [key: string]: unknown;
}

export class EventQueue {
  private queue: SimEvent[] = [];

  emit(event: SimEvent): void {
    this.queue.push(event);
  }

  /** Returns and clears the pending events. */
  drain(): SimEvent[] {
    const out = this.queue;
    this.queue = [];
    return out;
  }
}

export type Listener = (event: SimEvent) => void;

export class EventBus {
  private listeners = new Map<string, Set<Listener>>();

  on(type: string, fn: Listener): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
    return () => set.delete(fn);
  }

  dispatch(events: readonly SimEvent[]): void {
    for (const e of events) {
      this.listeners.get(e.type)?.forEach((fn) => fn(e));
      this.listeners.get('*')?.forEach((fn) => fn(e));
    }
  }
}
