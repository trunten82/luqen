#!/usr/bin/env python3
"""
Static lint for docker-compose files.

Catches structural issues that don't require a Docker runtime:
  - deprecated top-level `version:` key (compose v2 ignores it)
  - services missing image/build, healthcheck, or restart policy
  - depends_on referencing undeclared services
  - bind-mounted volume names that aren't declared at top-level

Exit code 0 if clean, 1 if any findings.

Usage: tools/lint-compose.py [files...]   (defaults to all docker-compose*.yml)
"""

from __future__ import annotations
import sys
import os
import glob
from typing import Any

try:
    import yaml  # type: ignore
except ImportError:
    print("PyYAML required: pip install pyyaml", file=sys.stderr)
    sys.exit(2)


def lint(path: str) -> list[str]:
    with open(path) as fh:
        raw = fh.read()
    d: dict[str, Any] = yaml.safe_load(raw) or {}
    fn = os.path.relpath(path)
    issues: list[str] = []

    # Catch ${VAR} interpolations that aren't backed by a sibling
    # `.env.example`. Compose silently defaults missing vars to an empty
    # string, which can cause Dashboard to start without a session secret
    # and other silent-but-broken setups. Either set a default in the
    # compose file via ${VAR:-default} or document it in .env.example.
    import re
    referenced = set(re.findall(r"\$\{([A-Z_][A-Z0-9_]*)\}", raw))
    if referenced:
        env_example = os.path.join(os.path.dirname(path), ".env.example")
        if os.path.exists(env_example):
            with open(env_example) as fh2:
                documented = set(
                    re.findall(r"^([A-Z_][A-Z0-9_]*)\s*=", fh2.read(), re.M)
                )
            missing = referenced - documented
            for v in sorted(missing):
                issues.append(
                    f"{fn}: env `${{{v}}}` referenced but not in .env.example"
                )
        else:
            for v in sorted(referenced):
                issues.append(
                    f"{fn}: env `${{{v}}}` referenced but no .env.example beside compose file"
                )

    if "version" in d:
        issues.append(
            f"{fn}: deprecated top-level `version` key ({d['version']!r}) — "
            f"remove for compose v2"
        )

    services: dict[str, Any] = d.get("services") or {}
    declared_volumes = set((d.get("volumes") or {}).keys())

    for name, s in services.items():
        if not isinstance(s, dict):
            continue
        if "image" not in s and "build" not in s:
            issues.append(f"{fn}::{name}: no image or build directive")
        if "healthcheck" not in s:
            issues.append(f"{fn}::{name}: no healthcheck")
        if "restart" not in s:
            issues.append(f"{fn}::{name}: no restart policy")

        deps = s.get("depends_on") or []
        if isinstance(deps, list):
            for dep in deps:
                if isinstance(dep, str) and dep not in services:
                    issues.append(
                        f"{fn}::{name}: depends_on `{dep}` — service not declared"
                    )
        elif isinstance(deps, dict):
            for dep in deps.keys():
                if dep not in services:
                    issues.append(
                        f"{fn}::{name}: depends_on `{dep}` — service not declared"
                    )

        for v in s.get("volumes") or []:
            vs = v if isinstance(v, str) else (v.get("source") or "")
            head = vs.split(":", 1)[0]
            if (
                head
                and not head.startswith(".")
                and not head.startswith("/")
                and head not in declared_volumes
            ):
                issues.append(
                    f"{fn}::{name}: volume `{head}` not declared in top-level "
                    f"volumes"
                )

    return issues


def main(argv: list[str]) -> int:
    if argv:
        files = argv
    else:
        # Walk the repo for any docker-compose*.yml.
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        files = sorted(
            glob.glob(os.path.join(root, "docker-compose*.yml"))
            + glob.glob(os.path.join(root, "deploy", "**", "docker-compose*.yml"), recursive=True)
        )

    if not files:
        print("No compose files found", file=sys.stderr)
        return 0

    all_issues: list[str] = []
    for f in files:
        all_issues.extend(lint(f))

    if not all_issues:
        print(f"OK — {len(files)} compose file(s), no structural issues")
        return 0

    for i in all_issues:
        print(i)
    print(f"\n{len(all_issues)} finding(s) across {len(files)} file(s)")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
