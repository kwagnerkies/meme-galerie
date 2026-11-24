import { useSyncExternalStore } from 'react';

// Latest state of every meme, by id. Votes and comments only change this store, not the
// List's data: handing the Flow List a new data array re-processes every item (sorting, collection),
// which costs ~200 ms per click with 50 memes. Components showing live values subscribe per meme.

const memes = new Map();
const listeners = new Map(); // id -> Set<fn>

function notify(id) {
  for (const fn of listeners.get(id) || []) fn();
}

export const memeStore = {
  get: (id) => memes.get(id),
  setAll(list) {
    memes.clear();
    for (const m of list) memes.set(m.id, m);
    for (const id of listeners.keys()) notify(id);
  },
  set(meme) {
    memes.set(meme.id, { ...memes.get(meme.id), ...meme });
    notify(meme.id);
  },
  remove(id) {
    memes.delete(id);
    notify(id);
  },
  subscribe(id, fn) {
    if (!listeners.has(id)) listeners.set(id, new Set());
    listeners.get(id).add(fn);
    return () => listeners.get(id).delete(fn);
  },
};

export function useMeme(id) {
  return useSyncExternalStore(
    (fn) => (id ? memeStore.subscribe(id, fn) : () => {}),
    () => (id ? memeStore.get(id) : undefined),
  );
}
