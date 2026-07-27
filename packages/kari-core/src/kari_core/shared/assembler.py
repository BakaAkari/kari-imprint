"""Processor assembler.

Converts a validated imprint config dict into the processor pipeline JSON that
the Kari Imprint filter expects.
"""

from __future__ import annotations

from typing import Any


def imprint_config_to_processors(config_dict: dict[str, Any]) -> list[dict[str, Any]]:
    """Build a single-node processor list for the Kari Imprint pipeline.

    The KariImprintFilter expects:
        {"processor_name": "kari_imprint", "imprint_config": <full config dict>}

    Margins, rounded corners, etc. are folded into the canvas config inside
    imprint_config, so no extra pipeline nodes are needed.
    """
    if not config_dict:
        return []
    return [{"processor_name": "kari_imprint", "imprint_config": config_dict}]
