"""Say so, in the log, when the API stops answering.

A stalled API used to leave no trace at all. The browser gave up after fifteen
seconds and showed "can't reach the server"; nginx logged a 499; the API's own
log showed nothing, because a request that never finishes is never logged.
Nothing on the server side said what had happened, or that anything had.

There are two very different ways to go silent, and this tells them apart:

  * The event loop is blocked -- some code on it is doing synchronous work it
    should not. Everything else in the process keeps running, including this
    watcher's thread, which then logs the loop's stack: the exact line
    holding it up.

  * The whole process was paused -- the machine or VM it runs on stopped
    scheduling it. On a laptop that is usually memory pressure: Docker
    Desktop's VM being paged out to disk by Windows, and an API that had sat
    idle paged out first. The watcher's own thread was frozen too, so it can
    only notice afterwards, from how long it slept past its alarm. That is
    worth a log line of its own, because it is not a bug in this code and
    no amount of reading it will find one.
"""

import asyncio
import logging
import sys
import threading
import time
import traceback

log = logging.getLogger(__name__)

TICK_SECONDS = 0.5
# Long enough that ordinary scheduling jitter and a GC pause never trip it,
# short enough to catch what a user would notice.
REPORT_AFTER_SECONDS = 2.0


def start(loop: asyncio.AbstractEventLoop) -> threading.Event:
    """Watch `loop` from a daemon thread. Must be called on the loop's thread.
    Set the returned event to stop."""
    stop = threading.Event()
    loop_thread = threading.get_ident()
    last_tick = time.monotonic()

    def tick() -> None:
        nonlocal last_tick
        last_tick = time.monotonic()
        if not stop.is_set():
            loop.call_later(TICK_SECONDS, tick)

    def watch() -> None:
        blocked_since: float | None = None
        woke = time.monotonic()
        while not stop.wait(TICK_SECONDS):
            now = time.monotonic()
            overslept = now - woke - TICK_SECONDS
            woke = now
            if overslept > REPORT_AFTER_SECONDS:
                log.warning(
                    "the whole API process was paused for %.1fs -- not by its own "
                    "code: the host stopped running it (memory pressure or a "
                    "suspended VM). Requests in flight will have timed out.",
                    overslept,
                )
                # Whatever the loop looked like, it was frozen with us.
                blocked_since = None
                continue

            lag = now - last_tick
            if lag > REPORT_AFTER_SECONDS and blocked_since is None:
                blocked_since = last_tick
                frame = sys._current_frames().get(loop_thread)
                stack = "".join(traceback.format_stack(frame)) if frame else "(unavailable)"
                log.warning(
                    "event loop blocked for %.1fs and counting; every request is "
                    "waiting on it. It is here:\n%s",
                    lag,
                    stack,
                )
            elif lag <= REPORT_AFTER_SECONDS and blocked_since is not None:
                log.warning("event loop running again after %.1fs", last_tick - blocked_since)
                blocked_since = None

    loop.call_soon(tick)
    threading.Thread(target=watch, name="stall-watch", daemon=True).start()
    return stop
