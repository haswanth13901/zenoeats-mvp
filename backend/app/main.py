import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.api.v1.router import api_router
from app.config import settings
from app.db.session import app_engine

logging.basicConfig(
    level=settings.LOG_LEVEL,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("zenoeats")

if settings.ENV == "production" and settings.AUTH_DEV_BYPASS:
    raise RuntimeError("AUTH_DEV_BYPASS must never be enabled in production.")

app = FastAPI(
    title="Zenoeats API",
    version="1.0.0-mvp",
    # Production Swagger is restricted (section 16.3).
    docs_url=None if settings.ENV == "production" else "/docs",
    redoc_url=None,
    openapi_url=None if settings.ENV == "production" else "/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=(
        r"https?://([a-z0-9-]+\.)?"
        + settings.ROOT_DOMAIN.replace(".", r"\.")
        + r"(:\d+)?$"
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    # Never leak internals. The correlation is in the log, not the response.
    log.exception("unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"code": "INTERNAL_ERROR", "message": "Something went wrong."},
    )


@app.get("/", include_in_schema=False)
def root():
    """Signpost, not an endpoint.

    Nothing customer-facing is served from this port: the storefront is the
    Next.js app on the restaurant's subdomain. Landing here means the wrong
    host was typed, so say where to go instead of a bare 404.
    """
    body = {
        "service": "zenoeats-api",
        "version": app.version,
        "env": settings.ENV,
        "health": "/health",
        "api": api_router.prefix,
        "storefront": f"a restaurant subdomain of {settings.ROOT_DOMAIN}, served by the web app",
    }
    if settings.ENV != "production":
        body["docs"] = "/docs"
    return body


@app.get("/health")
def health():
    return {"status": "ok", "env": settings.ENV}


@app.get("/health/ready")
def ready():
    """Readiness: can we actually reach the database as the app role?"""
    try:
        with app_engine().connect() as conn:
            conn.execute(text("SELECT 1"))
        return {"status": "ready"}
    except Exception:
        log.exception("readiness check failed")
        return JSONResponse(status_code=503, content={"status": "not-ready"})


app.include_router(api_router)
