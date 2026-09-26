/**
 * Cola de eventos de la simulación. La simulación emite; render, audio y UI
 * los consumen después de cada tick. La simulación nunca llama a esas capas.
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

  /** Devuelve y vacía los eventos pendientes. */
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
