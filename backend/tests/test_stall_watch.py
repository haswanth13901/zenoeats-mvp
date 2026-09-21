"""The stall watcher names the code holding the event loop, and says when it
lets go. Without it a blocked loop left no trace in the API's log at all."""

import asyncio
import logging
import time

from app.core import stall_watch


def _block_the_loop_on_purpose() -> None:
    time.sleep(stall_watch.REPORT_AFTER_SECONDS + 1)


def test_a_blocked_loop_is_logged_with_its_stack(caplog):
    async def scenario():
        stop = stall_watch.start(asyncio.get_running_loop())
        try:
            await asyncio.sleep(stall_watch.TICK_SECONDS * 2)
            _block_the_loop_on_purpose()
            # Give the watcher a couple of ticks to see the loop running again.
            await asyncio.sleep(stall_watch.TICK_SECONDS * 3)
        finally:
            stop.set()

    with caplog.at_level(logging.WARNING, logger=stall_watch.__name__):
        asyncio.run(scenario())

    messages = [r.getMessage() for r in caplog.records]
    blocked = [m for m in messages if m.startswith("event loop blocked")]
    assert blocked, messages
    assert "_block_the_loop_on_purpose" in blocked[0]
    assert any(m.startswith("event loop running again") for m in messages), messages


def test_a_healthy_loop_logs_nothing(caplog):
    async def scenario():
        stop = stall_watch.start(asyncio.get_running_loop())
        try:
            await asyncio.sleep(stall_watch.TICK_SECONDS * 4)
        finally:
            stop.set()

    with caplog.at_level(logging.WARNING, logger=stall_watch.__name__):
        asyncio.run(scenario())

    assert caplog.records == []
