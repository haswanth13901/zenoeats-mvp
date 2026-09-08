.PHONY: help setup up down logs migrate seed test rls fresh key

help:
	@echo "make setup    copy .env.example to .env and generate an encryption key"
	@echo "make up       start every service"
	@echo "make migrate  apply database migrations"
	@echo "make seed     create the demo restaurant and menu"
	@echo "make test     run the test suite"
	@echo "make rls      run the tenant-isolation gates only"
	@echo "make down     stop everything"
	@echo "make fresh    destroy volumes and rebuild from scratch"

key:
	@python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

setup:
	@test -f .env || cp .env.example .env
	@echo "Created .env. Generate an encryption key with 'make key' and paste it"
	@echo "into FIELD_ENCRYPTION_KEY, then add your Clerk and Stripe keys."

up:
	docker compose up -d --build
	@echo "Portal:  http://spicehouse.zenoeats.local:8080"
	@echo "API doc: http://localhost:8000/docs"

down:
	docker compose down

logs:
	docker compose logs -f api worker

migrate:
	docker compose exec api alembic upgrade head

seed:
	docker compose exec api python scripts/seed.py

test:
	docker compose exec api pytest tests/ -v

rls:
	docker compose exec api pytest tests/test_rls_isolation.py -v

fresh:
	docker compose down -v
	docker compose up -d --build
	sleep 12
	$(MAKE) seed
