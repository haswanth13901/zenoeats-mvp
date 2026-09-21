"""Refuse to run the app twice: natively and in Docker at the same time.

    python scripts/dev_preflight.py docker   # before `make up-all`
    python scripts/dev_preflight.py native   # before `make api` / `make web`

Both modes use ports 8000 and 3000. On Windows they do not even collide: the
containers publish on 127.0.0.1 and the native servers bind 0.0.0.0, and the
OS lets both listen. So nothing fails -- instead nginx sends some requests to
one copy and some to the other (the native one is its backup upstream), each
running whatever code it last loaded, and the laptop carries two API
processes, two frontends and two Celery workers at once. On an 8 GB machine
that is what pushed Docker's VM into the page file, and an API paged out to
disk is an API that stops answering for a minute and a half at a time.
"""

import json
import socket
import subprocess
import sys

# port -> (compose service, what starts it natively)
PORTS = {8000: ("api", "make api"), 3000: ("web", "make web")}


def running_services() -> set[str]:
    try:
        out = subprocess.run(
            ["docker", "compose", "--profile", "app", "ps", "--status", "running", "--format", "json"],
            capture_output=True, text=True, timeout=20, check=True,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return set()  # no Docker, so nothing in Docker to collide with
    # One JSON object per line on current Compose; a single array on older ones.
    rows = []
    for line in out.splitlines():
        line = line.strip()
        if line:
            parsed = json.loads(line)
            rows.extend(parsed if isinstance(parsed, list) else [parsed])
    return {row.get("Service", "") for row in rows}


def answering(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def main(mode: str) -> int:
    in_docker = running_services()
    clashes = []
    for port, (service, native_cmd) in PORTS.items():
        if mode == "docker" and service not in in_docker and answering(port):
            clashes.append(f"  port {port} is already served on this machine -- stop `{native_cmd}` first")
    if mode == "native":
        # The worker has no port, but two of them on one broker take turns at
        # the same payment tasks, each with its own copy of the code.
        for service in ("api", "web", "worker"):
            if service in in_docker:
                clashes.append(
                    f"  the Docker `{service}` container is running -- `make down` first, or keep using it"
                )
    if clashes:
        print(f"Refusing to start the {mode} app alongside the other one:", file=sys.stderr)
        print("\n".join(clashes), file=sys.stderr)
        print("Run the app one way at a time. See scripts/dev_preflight.py for why.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in ("docker", "native"):
        sys.exit(__doc__)
    sys.exit(main(sys.argv[1]))
