"""The presentation contract, checked before a saved storefront can change.

Browser controls are conveniences. These bounds, including contrast, belong
on the server because a caller can send JSON without ever opening the form.
"""

from datetime import datetime
from typing import Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

FontPair = Literal["default", "lora_inter", "playfair_source", "fraunces_dm", "merriweather_sans"]
TargetKind = Literal["menu", "item_type", "item", "collection"]


def contrast(a: str, b: str) -> float:
    def luminance(colour):
        channels = [int(colour[i:i + 2], 16) / 255 for i in (1, 3, 5)]
        linear = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in channels]
        return sum(v * w for v, w in zip(linear, (.2126, .7152, .0722)))
    x, y = sorted((luminance(a), luminance(b)))
    return (y + .05) / (x + .05)


class StorefrontInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Theme(StorefrontInput):
    brand: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    hero: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    accent: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    paper: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    font_pair: FontPair = "default"

    @model_validator(mode="after")
    def readable(self) -> Self:
        for name, foreground, background in (
            ("Cream text on hero", "#FFF8E4", self.hero),
            ("CTA text on accent", "#1D3326", self.accent),
            ("Brand on paper", self.brand, self.paper),
            ("White text on brand", "#FFFFFF", self.brand),
            ("Body text on paper", "#252620", self.paper),
        ):
            if contrast(foreground, background) < 4.5:
                raise ValueError(f"{name} needs a contrast ratio of at least 4.5:1. Choose different colours.")
        return self


class ThemePatch(StorefrontInput):
    theme: Theme | None = None
    logo_path: str | None = Field(default=None, max_length=500)
    banner_interval_ms: int = Field(default=5000, ge=2000, le=10000, strict=True)


class CategoryPatch(StorefrontInput):
    image_path: str | None = Field(default=None, max_length=500)
    show_in_shortcuts: bool = True


class BannerIn(StorefrontInput):
    id: UUID | None = None
    image_path: str = Field(min_length=1, max_length=500)
    headline: str = Field(default="", max_length=80)
    subline: str = Field(default="", max_length=160)
    cta_label: str = Field(default="Explore the menu", max_length=30)
    cta_target_kind: TargetKind = "menu"
    cta_target_id: UUID | None = None
    is_active: bool = True
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    # Where the photo is anchored inside the banner's crop, and how far in.
    # Defaults reproduce the fixed framing every banner had before.
    focal_x: int = Field(default=50, ge=0, le=100, strict=True)
    focal_y: int = Field(default=60, ge=0, le=100, strict=True)
    zoom: int = Field(default=100, ge=100, le=200, strict=True)

    @model_validator(mode="after")
    def target_and_dates(self) -> Self:
        if (self.cta_target_kind == "menu") != (self.cta_target_id is None):
            raise ValueError("Choose a target for this banner, or choose the whole menu.")
        for value in (self.starts_at, self.ends_at):
            if value is not None and value.utcoffset() is None:
                raise ValueError("Banner dates must include a timezone.")
        if self.starts_at and self.ends_at and self.ends_at <= self.starts_at:
            raise ValueError("A banner must end after it starts.")
        return self


class BannersIn(StorefrontInput):
    banners: list[BannerIn] = Field(max_length=8)


class CollectionIn(StorefrontInput):
    id: UUID | None = None
    title: str = Field(min_length=1, max_length=60)
    is_active: bool = True
    item_ids: list[UUID] = Field(max_length=12)

    @field_validator("item_ids")
    @classmethod
    def unique_items(cls, value):
        if len(value) != len(set(value)):
            raise ValueError("Choose each item only once in a collection.")
        return value


class CollectionsIn(StorefrontInput):
    collections: list[CollectionIn] = Field(max_length=6)


class ShortcutIn(StorefrontInput):
    id: UUID | None = None
    item_type_id: UUID
    label: str = Field(min_length=1, max_length=40)
    image_path: str | None = Field(default=None, max_length=500)
    is_active: bool = True
    item_ids: list[UUID] = Field(max_length=40)

    @field_validator("item_ids")
    @classmethod
    def unique_items(cls, value):
        if len(value) != len(set(value)):
            raise ValueError("Choose each item only once in a shortcut.")
        return value


class ShortcutsIn(StorefrontInput):
    shortcuts: list[ShortcutIn] = Field(max_length=12)


class PublicBanner(BaseModel):
    id: UUID
    image_url: str
    headline: str
    subline: str
    cta_label: str
    cta_target_kind: TargetKind
    cta_target_id: UUID | None
    focal_x: int
    focal_y: int
    zoom: int


class PublicCategory(BaseModel):
    image_url: str | None
    show_in_shortcuts: bool
    sort_order: int


class PublicCollection(BaseModel):
    id: UUID
    title: str
    item_ids: list[UUID]


class PublicShortcut(BaseModel):
    id: UUID
    # So the page can tell a shortcut holding its whole category -- which
    # just scrolls to that category on the menu -- from a hand-picked one,
    # which gets a section of its own.
    item_type_id: UUID
    label: str
    # The shortcut's own photo, else its category's; null lets the page use
    # the first item photo in it.
    image_url: str | None
    item_ids: list[UUID]


class StorefrontOut(BaseModel):
    theme: Theme | None
    logo_url: str | None
    banner_interval_ms: int
    banners: list[PublicBanner]
    categories: dict[str, PublicCategory]
    collections: list[PublicCollection]
    shortcuts: list[PublicShortcut] = []
