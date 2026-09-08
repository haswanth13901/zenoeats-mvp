# The project virtualenv. Windows puts binaries in Scripts/, POSIX in bin/.
PY := .venv/Scripts/python.exe

.PHONY: help setup infra api web worker up-all down logs migrate seed test rls fresh key

help:
	@echo "Development (app runs natively, infrastructure in Docker):"
	@echo "  make setup    copy .env.example to .env and generate an encryption key"
	@echo "  make infra    start postgres, redis x2 and nginx -- builds nothing"
	@echo "  make api      run the API natively (own terminal)"
	@echo "  make web      run the frontend natively (own terminal)"
	@echo "  make worker   run Celery natively (only needed for payments)"
	@echo "  make migrate  apply database migrations"
	@echo "  make seed     create the demo restaurant and menu"
	@echo "  make test     run the test suite"
	@echo "  make rls      run the tenant-isolation gates only"
	@echo "  make down     stop the containers"
	@echo ""
	@echo "Production rehearsal (builds images -- slow, not for daily work):"
	@echo "  make up-all   build and start every service in Docker"

key:
	@python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

setup:
	@test -f .env || cp .env.example .env
	@echo "Created .env. Generate an encryption key with 'make key' and paste it"
	@echo "into FIELD_ENCRYPTION_KEY, then add your Clerk and Stripe keys."

# Infrastructure only. The app services sit behind the "app" profile, so this
# starts postgres, redis and nginx and builds nothing. Image builds are what
# repeatedly wedged the Docker engine; nothing here needs one to run the app.
infra:
	docker compose up -d
	@echo "postgres 127.0.0.1:5433  redis 6379/6380  nginx :8080"
	@echo "Now run 'make api' and 'make web' in their own terminals."

# Each of these runs in the foreground in its own terminal.
api:
	cd backend && ../$(PY) -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

web:
	cd frontend && npm run dev

# Only needed to test payments: an order cannot leave PENDING_PAYMENT without
# a worker to process the Stripe webhook. --pool=solo because Celery's default
# prefork pool silently hangs on Windows.
worker:
	cd backend && ../$(PY) -m celery -A app.workers.celery_app.celery_app worker --loglevel=info --pool=solo

# Everything in Docker, images included. Slow. Use to rehearse production,
# not for day-to-day work.
up-all:
	docker compose --profile app up -d --build
	@echo "Portal:  http://spicehouse.zenoeats.local:8080"

down:
	docker compose down

logs:
	docker compose logs -f

migrate:
	cd backend && ../$(PY) -m alembic upgrade head

seed:
	cd backend && ../$(PY) scripts/seed.py

test:
	cd backend && ../$(PY) -m pytest tests/ -q

rls:
	cd backend && ../$(PY) -m pytest tests/test_rls_isolation.py -v

fresh:
	docker compose --profile app down -v
	$(MAKE) infra
	sleep 12
	$(MAKE) migrate
	$(MAKE) seed
