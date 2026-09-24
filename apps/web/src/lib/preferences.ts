'use client';

import { useSyncExternalStore } from 'react';

/**
 * Interface preferences: motion, and whose cursor you see.
 *
 * These are per-device display choices, not account data, so they live in
 * `localStorage` rather than on the server — the same person may well want
 * the full treatment on a desktop and none of it on a laptop running on
 * battery, and neither answer should follow them between machines.
 *
 * They are applied to `<html>` as a class and a data attribute, by a script
 * that runs before the first paint (see `app/layout.tsx`). That ordering is
 * the whole point: reading the preference in React would mean the first
 * frame animates and the second does not, which is worse than either
 * setting on its own. This module keeps the same attributes in step
 * afterwards and lets components subscribe.
 *
 * `prefers-reduced-motion` still wins where it is set: the CSS honours it
 * regardless of what is stored here, because that is an accessibility
 * setting and this is a taste one.
 */

export const MOTION_KEY = 'omniplay:motion';
export const CURSOR_KEY = 'omniplay:cursor';

/** The class on `<html>` when animation is switched off. */
export const MOTION_OFF_CLASS = 'motion-off';

export type CursorStyle = 'custom' | 'system';

interface Preferences {
  motion: boolean;
  cursor: CursorStyle;
}

const DEFAULTS: Preferences = { motion: true, cursor: 'custom' };

let state: Preferences = DEFAULTS;
let loaded = false;
const listeners = new Set<() => void>();

function read(): Preferences {
  try {
    return {
      motion: window.localStorage.getItem(MOTION_KEY) !== 'off',
      cursor: window.localStorage.getItem(CURSOR_KEY) === 'system' ? 'system' : 'custom',
    };
  } catch {
    // Storage blocked (private window, blocked site data): the defaults
    // stand, and the interface is fully usable with them.
    return DEFAULTS;
  }
}

/** Reads storage once, on first use in the browser. */
function ensureLoaded(): void {
  if (loaded || typeof window === 'undefined') return;
  state = read();
  loaded = true;
}

function emit(): void {
  for (const listener of listeners) listener();
}

function apply(next: Preferences): void {
  const root = document.documentElement;
  root.classList.toggle(MOTION_OFF_CLASS, !next.motion);
  root.dataset['cursor'] = next.cursor;
}

function subscribe(listener: () => void): () => void {
  ensureLoaded();
  listeners.add(listener);
  // Another tab is another window of the same app; a preference changed
  // there should not leave this one disagreeing with its own storage.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== MOTION_KEY && event.key !== CURSOR_KEY) return;
    state = read();
    apply(state);
    emit();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

const getSnapshot = (): Preferences => {
  ensureLoaded();
  return state;
};

// The server renders the defaults. The pre-paint script has already put the
// real answer on <html>, so what the server assumed never reaches the eye.
const getServerSnapshot = (): Preferences => DEFAULTS;

export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function setMotion(enabled: boolean): void {
  state = { ...getSnapshot(), motion: enabled };
  try {
    window.localStorage.setItem(MOTION_KEY, enabled ? 'on' : 'off');
  } catch {
    // Not stored, but still applied for this session.
  }
  apply(state);
  emit();
}

export function setCursorStyle(cursor: CursorStyle): void {
  state = { ...getSnapshot(), cursor };
  try {
    window.localStorage.setItem(CURSOR_KEY, cursor);
  } catch {
    // As above.
  }
  apply(state);
  emit();
}

/**
 * Whether animation is on, outside React — for the curtain, which is driven
 * from module state rather than from a component.
 */
export function motionEnabled(): boolean {
  if (typeof document === 'undefined') return true;
  return !document.documentElement.classList.contains(MOTION_OFF_CLASS);
}

/**
 * The script that runs before the first paint. Inlined into the document
 * head, so it must be self-contained and must never throw: a failure here
 * would block the page from rendering at all.
 */
export const PREFERENCES_SCRIPT = `try{var d=document.documentElement,s=localStorage;if(s.getItem('${MOTION_KEY}')==='off')d.classList.add('${MOTION_OFF_CLASS}');d.dataset.cursor=s.getItem('${CURSOR_KEY}')==='system'?'system':'custom'}catch(e){}`;
