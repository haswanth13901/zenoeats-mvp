from celery import Celery
from celery.schedules import crontab

from app.config import settings

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
    },
)
