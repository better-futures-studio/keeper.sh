import { atom, getDefaultStore } from "jotai";

export const eventsVersionAtom = atom(0);

export function bumpEventsVersion(): void {
  getDefaultStore().set(eventsVersionAtom, (version) => version + 1);
}
