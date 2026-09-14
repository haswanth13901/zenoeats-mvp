// Runtime configuration, read before the app starts.
//
// This file is a placeholder. The web container overwrites it at startup
// (docker-entrypoint.d/40-zenoeats-config.sh) from its environment, which is
// what lets one image run in staging and production with different Clerk
// instances. In development it stays empty and the Vite build-time variables
// are used instead.
window.__ZENOEATS_CONFIG__ = window.__ZENOEATS_CONFIG__ || {};
