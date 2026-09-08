import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Deliberately no os.environ.setdefault of DATABASE_URL_* here.
#
# pydantic-settings reads real environment variables in preference to the
# .env file, so a "default" set in this module is not a fallback at all --
# it silently overrides the project's actual configuration. The previous
# values pointed at localhost:5432, correct only inside the api container,
# while a native run publishes Postgres on 127.0.0.1:5433. The suite then
# failed against a database that was running the whole time, and the fix
# looked like exporting three DSNs by hand before every run.
#
# app.config resolves the repo-root .env from its own file location, so
# alembic, uvicorn, celery and pytest all agree without help. If that file
# is missing, Settings raises naming the field, which is a far better
# failure than connecting somewhere unintended.
