"""Pont JSON minimal vers l'API cron officielle de Hermes."""

import json
import sys

from tools.cronjob_tools import cronjob


def main() -> None:
    payload = json.load(sys.stdin)
    result = cronjob(**payload)
    if isinstance(result, str):
        print(result)
    else:
        print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
