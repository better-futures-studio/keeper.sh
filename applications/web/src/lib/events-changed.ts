type Listener = () => void;

const listeners = new Set<Listener>();

export function subscribeEventsChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyEventsChanged(): void {
  for (const listener of listeners) listener();
}
