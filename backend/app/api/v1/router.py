from fastapi import APIRouter, Depends

from app.api.deps import require_admin_host, require_same_origin
from app.api.v1 import admin, orders, portal, restaurant, webhooks

api_router = APIRouter(prefix="/api/v1")

# The customer routers authenticate with a bearer token the caller must
# possess, so a request from another origin carries no authority of its own.
api_router.include_router(portal.router)
api_router.include_router(orders.router)

# The two operator portals authenticate with cookies, which a browser attaches
# by itself. Both are pinned to the origin they are served from: the staff API
# to its own restaurant's hostname, the platform API to admin.<root domain>.
api_router.include_router(restaurant.router, dependencies=[Depends(require_same_origin)])
api_router.include_router(
    admin.router, dependencies=[Depends(require_admin_host), Depends(require_same_origin)]
)

# Stripe signs its webhooks and calls them server to server; there is no
# origin, and no session cookie to protect.
api_router.include_router(webhooks.router)
