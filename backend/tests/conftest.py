import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

os.environ.setdefault("DATABASE_URL_APP", "postgresql+psycopg2://zenoeats_app:app_dev_pw@localhost:5432/zenoeats")
os.environ.setdefault("DATABASE_URL_SYSTEM", "postgresql+psycopg2://zenoeats_system:system_dev_pw@localhost:5432/zenoeats")
os.environ.setdefault("DATABASE_URL_MIGRATE", "postgresql+psycopg2://zenoeats_migrate:migrate_dev_pw@localhost:5432/zenoeats")
os.environ.setdefault("FIELD_ENCRYPTION_KEY", "kZ0nQx3Yk8vJ9pL2mN7bR4tS6wU1cE5gH8jK0aD3fI4=")
os.environ.setdefault("ROOT_DOMAIN", "zenoeats.local")
