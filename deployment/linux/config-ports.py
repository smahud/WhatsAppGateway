"""Inspect config.json before installing anything; print PUBLIC and BACKEND."""

import json
import re
import sys


def port(value, default):
    value = default if value is None else value
    if isinstance(value, bool) or not re.fullmatch(r"[0-9]{1,5}", str(value)):
        raise ValueError("Port harus berupa angka 1–65535")
    result = int(value)
    if not 1 <= result <= 65535:
        raise ValueError("Port harus antara 1 dan 65535")
    return result


try:
    with open(sys.argv[1], encoding="utf-8-sig") as config:
        cfg = json.load(config)
    if not isinstance(cfg, dict):
        raise ValueError("config.json harus berupa objek JSON")
    if "backend_port" not in cfg and "public_port" in cfg:
        # Existing installations stored the private listener as .port.
        print(port(cfg["public_port"], 3000), port(cfg.get("port"), 39000))
    else:
        print(port(cfg.get("port"), 3000), port(cfg.get("backend_port"), 39000))
except (OSError, ValueError):
    print("config.json tidak valid atau port tidak berada pada rentang 1–65535.", file=sys.stderr)
    sys.exit(1)
