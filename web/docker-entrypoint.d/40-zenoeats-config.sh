#!/bin/sh
# Runtime configuration for the web container, written before nginx starts:
#
#   /usr/share/nginx/html/config.js             the Clerk publishable key
#   /etc/nginx/zenoeats/security-headers.conf   the Content-Security-Policy
#
# The official nginx image runs every executable script in
# /docker-entrypoint.d at startup. Doing this here rather than at build time
# is the point: the image carries no environment-specific value, so the image
# CI built and staging tested is byte for byte the one production runs.
#
# Environment:
#   CLERK_PUBLISHABLE_KEY  pk_test_... or pk_live_... Public by definition --
#                          it ships to every browser.
#   CSP_EXTRA_IMG_SRC      optional, space-separated https:// origins images may
#                          load from, e.g. the bucket in IMAGES_PUBLIC_BASE.
#   CSP_REPORT_ONLY        "true" sends the policy as Report-Only: violations
#                          are reported in the browser console, nothing is
#                          blocked. For a first rollout on staging.
set -eu

config_js=/usr/share/nginx/html/config.js
headers_dir=/etc/nginx/zenoeats
key="${CLERK_PUBLISHABLE_KEY:-}"

# --- config.js ---------------------------------------------------------------

# A publishable key is pk_test_ or pk_live_ followed by base64. Refusing
# anything else means a stray quote or script tag in the environment can
# never become JavaScript in every customer's browser.
if [ -n "$key" ] && ! printf '%s' "$key" | grep -Eq '^pk_(test|live)_[A-Za-z0-9+/=]+$'; then
  echo "40-zenoeats-config: CLERK_PUBLISHABLE_KEY is not a Clerk publishable key; refusing to start" >&2
  exit 1
fi

if [ -z "$key" ]; then
  echo "40-zenoeats-config: CLERK_PUBLISHABLE_KEY is empty; checkout will say sign-in is not configured" >&2
fi

cat > "$config_js" <<EOF
// Written at container start by 40-zenoeats-config.sh. Do not edit.
window.__ZENOEATS_CONFIG__ = { clerkPublishableKey: "$key" };
EOF

# --- Content-Security-Policy -------------------------------------------------

# The Clerk Frontend API host is encoded in the key: base64 of "host$". The
# SDK script and every Clerk API call come from it, and it differs between a
# development instance (*.clerk.accounts.dev) and production (clerk.<domain>).
clerk_host=""
if [ -n "$key" ]; then
  encoded="${key#pk_test_}"
  encoded="${encoded#pk_live_}"
  # Clerk omits base64 padding; busybox base64 will not decode without it.
  while [ $(( ${#encoded} % 4 )) -ne 0 ]; do encoded="${encoded}="; done
  clerk_host="$(printf '%s' "$encoded" | base64 -d 2>/dev/null | tr -d '$' || true)"
  if ! printf '%s' "$clerk_host" | grep -Eq '^[a-z0-9.-]+\.[a-z]{2,}$'; then
    echo "40-zenoeats-config: could not read the Clerk host from CLERK_PUBLISHABLE_KEY; refusing to start" >&2
    exit 1
  fi
fi
clerk_origin=""
[ -n "$clerk_host" ] && clerk_origin="https://$clerk_host"

extra_img=""
for origin in ${CSP_EXTRA_IMG_SRC:-}; do
  if ! printf '%s' "$origin" | grep -Eq '^https://[A-Za-z0-9.*-]+(:[0-9]+)?$'; then
    echo "40-zenoeats-config: CSP_EXTRA_IMG_SRC entry '$origin' is not an https origin; refusing to start" >&2
    exit 1
  fi
  extra_img="$extra_img $origin"
done

# Sources, per Clerk's and Stripe's published CSP requirements:
#   Clerk   Frontend API host; challenges.cloudflare.com (bot protection);
#           *.protect.clerk.com (fraud protection, on non-443 ports, hence :*);
#           img.clerk.com; blob: workers; inline styles (runtime CSS-in-JS).
#   Stripe  js.stripe.com and *.js.stripe.com (Stripe.js and its frames);
#           hooks.stripe.com (3-D Secure); api.stripe.com; *.stripe.com images;
#           link.com and *.link.com (Link, offered by the Payment Element).
# No 'unsafe-inline' for scripts: the built pages carry none.
policy="default-src 'self'"
policy="$policy; script-src 'self' $clerk_origin https://challenges.cloudflare.com https://*.protect.clerk.com https://js.stripe.com https://*.js.stripe.com"
policy="$policy; connect-src 'self' $clerk_origin https://*.protect.clerk.com:* https://api.stripe.com https://link.com https://*.link.com"
policy="$policy; frame-src https://challenges.cloudflare.com https://*.protect.clerk.com https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com https://link.com https://*.link.com"
policy="$policy; img-src 'self' data: https://img.clerk.com https://*.stripe.com https://*.link.com$extra_img"
policy="$policy; style-src 'self' 'unsafe-inline'"
policy="$policy; worker-src 'self' blob:"
policy="$policy; font-src 'self'"
policy="$policy; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
# Collapse the double spaces an empty Clerk origin leaves behind.
policy="$(printf '%s' "$policy" | tr -s ' ')"

header="Content-Security-Policy"
if [ "${CSP_REPORT_ONLY:-false}" = "true" ]; then
  header="Content-Security-Policy-Report-Only"
  echo "40-zenoeats-config: CSP is report-only; nothing will be blocked" >&2
fi

mkdir -p "$headers_dir"
cat > "$headers_dir/security-headers.conf" <<EOF
# Written at container start by 40-zenoeats-config.sh. Do not edit.
add_header $header "$policy" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
EOF
