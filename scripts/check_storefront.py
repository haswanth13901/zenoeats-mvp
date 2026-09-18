"""Read-only edge latency check: python scripts/check_storefront.py --slug spicehouse.

Run after Docker startup or recreation. Never submits an order or prints keys.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
import statistics
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--slug", required=True)
    parser.add_argument("--base-url", default="http://127.0.0.1:8080")
    parser.add_argument("--requests", type=int, default=20)
    parser.add_argument("--timeout", type=float, default=10)
    args = parser.parse_args()
    if args.requests < 1 or args.timeout <= 0:
        parser.error("requests and timeout must be positive")

    def check(index):
        path = ("/portal", "/menu")[index % 2]
        request = Request(
            args.base_url.rstrip("/") + "/api/v1" + path,
            headers={"Host": f"{args.slug}.zenoeats.local:8080"},
        )
        started = time.monotonic()
        try:
            with urlopen(request, timeout=args.timeout) as response:
                response.read()
                status = str(response.status)
        except HTTPError as exc:
            status = str(exc.code)
            exc.close()
        except Exception as exc:
            status = type(exc).__name__
        elapsed = time.monotonic() - started
        return status == "200" and elapsed < args.timeout, elapsed, path, status

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(check, range(args.requests)))
    failures = [r for r in results if not r[0]]
    print(f"{len(results)} requests; {len(failures)} failures; "
          f"median {statistics.median(r[1] for r in results):.3f}s; "
          f"max {max(r[1] for r in results):.3f}s")
    for _, seconds, path, status in failures:
        print(f"{path}: {status} ({seconds:.3f}s)")
    return bool(failures)


if __name__ == "__main__":
    raise SystemExit(main())
