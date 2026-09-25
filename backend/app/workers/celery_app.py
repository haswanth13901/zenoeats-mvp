from celery import Celery
from celery.schedules import crontab

from app.config import settings
from app.core.observability import init_error_tracking

# Before any task runs, so a failure in the first one is reported. Sentry's
# Celery integration switches itself on when Celery is importable.
init_error_tracking("worker")

celery_app = Celery(
    "zenoeats",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=["app.workers.tasks"],
)

celery_app.conf.update(
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    task_track_started=True,
    timezone="UTC",
    # Celery result state is not business truth. PostgreSQL is.
    result_expires=3600,
    beat_schedule={
        "expire-stale-pending-orders": {
            "task": "app.workers.tasks.expire_pending_orders",
            "schedule": crontab(minute="*/5"),
        },
        # Hourly, off the top of the hour, so it never lands on the same
        # minute as the order sweep.
        "sweep-retention": {
            "task": "app.workers.tasks.sweep_retention",
            "schedule": crontab(minute=23),
        },
        # Proof of life for beat and the workers together, read by
        # /health/operations. See services/ops_health.
        "heartbeat": {
            "task": "app.workers.tasks.heartbeat",
            "schedule": 60.0,
            # A heartbeat that waited out an outage in the queue proves
            # nothing about now; drop it rather than deliver it late.
            "options": {"expires": 50},
        },
    },
)
