"""Same functions as the HTTP server, for batch scripts.

    uv run python -m audio_sidecar.cli {embed|link|diarize|der|image-sim} <json-file | ->

Prints the response JSON to stdout. Exit code 2 on bad input.
"""

from __future__ import annotations

import json
import sys

from . import service
from .audio import AudioError
from .schemas import DerRequest, DiarizeRequest, EmbedRequest, ImageSimRequest, LinkRequest

COMMANDS = {
    "embed": (EmbedRequest, service.embed),
    "link": (LinkRequest, service.link_speakers),
    "diarize": (DiarizeRequest, service.diarize),
    "der": (DerRequest, service.der),
    "image-sim": (ImageSimRequest, service.image_sim),
}


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 2 or argv[0] not in COMMANDS:
        print(f"usage: python -m audio_sidecar.cli {{{'|'.join(COMMANDS)}}} <json-file | ->", file=sys.stderr)
        return 2
    cmd, src = argv
    raw = sys.stdin.read() if src == "-" else open(src, encoding="utf-8").read()
    model, fn = COMMANDS[cmd]
    try:
        result = fn(model.model_validate_json(raw))
    except (AudioError, ValueError) as e:
        print(json.dumps({"error": "bad_input", "message": str(e)}, ensure_ascii=False))
        return 2
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
