from fastapi import APIRouter

from app.api.v1 import admin, orders, portal, restaurant, webhooks

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(portal.router)
api_router.include_router(orders.router)
api_router.include_router(restaurant.router)
api_router.include_router(admin.router)
api_router.include_router(webhooks.router)
