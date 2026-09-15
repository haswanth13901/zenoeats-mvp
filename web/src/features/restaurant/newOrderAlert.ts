import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Tell a busy kitchen that an order has arrived.
 *
 * The board polls every few seconds and a new ticket simply appeared among
 * the others. On a tablet across the kitchen, nobody looking at it, that is
 * an order sitting unmade until someone happens to glance over.
 *
 * Three signals, because any one of them can be missed:
 *   - a short chime, synthesised rather than loaded, so there is no file to
 *     serve or fail to fetch;
 *   - the new tickets marked "new" until someone taps them or a minute passes;
 *   - the tab title counting them, for a board left in a background tab.
 *
 * Browsers refuse to play sound a page starts on its own until someone has
 * interacted with it, so sound is switched on by a tap -- that tap is the
 * interaction that unlocks it -- and the choice is remembered on this device.
 * On a fresh page it asks again, which is the browser's rule, not ours.
 *
 * The first answer the board gets is what was already waiting, not news, so
 * it marks those as seen without a sound.
 */

const SOUND_KEY = "zenoeats.kitchen.sound";
const FRESH_FOR_MS = 60_000;

export function useNewOrderAlert(orderIds: string[] | undefined) {
  const seen = useRef<Set<string> | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const [fresh, setFresh] = useState<Record<string, number>>({});
  const [soundWanted, setSoundWanted] = useState(() => readPreference());
  // Wanted and actually allowed are different: a remembered "on" still needs
  // a tap on this page before the browser lets it play.
  const [soundReady, setSoundReady] = useState(false);

  const chime = useCallback(() => {
    const context = audio.current;
    if (!context || context.state !== "running") return;
    // Two short rising notes: distinct from a phone ringing, and over quickly.
    [880, 1320].forEach((frequency, index) => {
      const start = context.currentTime + index * 0.18;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.4, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.18);
    });
  }, []);

  useEffect(() => {
    if (!orderIds) return;
    if (seen.current === null) {
      seen.current = new Set(orderIds);
      return;
    }
    const arrived = orderIds.filter((id) => !seen.current!.has(id));
    if (!arrived.length) return;
    arrived.forEach((id) => seen.current!.add(id));
    const now = Date.now();
    setFresh((current) => {
      const next = { ...current };
      arrived.forEach((id) => (next[id] = now));
      return next;
    });
    chime();
  }, [orderIds, chime]);

  // Fresh marks fade after a minute, and go with the order when it leaves.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const cutoff = Date.now() - FRESH_FOR_MS;
      setFresh((current) => {
        const kept = Object.entries(current).filter(
          ([id, at]) => at > cutoff && (!orderIds || orderIds.includes(id)),
        );
        return kept.length === Object.keys(current).length ? current : Object.fromEntries(kept);
      });
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [orderIds]);

  const freshCount = Object.keys(fresh).length;
  useEffect(() => {
    const original = document.title.replace(/^\(\d+ new\) /, "");
    document.title = freshCount ? `(${freshCount} new) ${original}` : original;
    return () => {
      document.title = original;
    };
  }, [freshCount]);

  const enableSound = useCallback(async () => {
    try {
      const Context =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) return;
      audio.current ??= new Context();
      await audio.current.resume();
      setSoundReady(audio.current.state === "running");
      setSoundWanted(true);
      writePreference(true);
      chime(); // so whoever tapped hears what to listen for
    } catch {
      setSoundReady(false);
    }
  }, [chime]);

  const disableSound = useCallback(() => {
    void audio.current?.suspend();
    setSoundReady(false);
    setSoundWanted(false);
    writePreference(false);
  }, []);

  const acknowledge = useCallback((id: string) => {
    setFresh((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  return { fresh, soundWanted, soundReady, enableSound, disableSound, acknowledge };
}

/** Storage can be missing or refuse -- a private window, a locked-down tablet --
 *  and a kitchen board must still work without it. */
function readPreference(): boolean {
  try {
    return window.localStorage.getItem(SOUND_KEY) === "on";
  } catch {
    return false;
  }
}

function writePreference(on: boolean): void {
  try {
    window.localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    /* the choice lasts for this page instead */
  }
}
