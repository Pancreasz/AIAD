"""Where a converted CTranslate2 model lives, shared by setup and runtime.

faster-whisper only loads CTranslate2 models. When MOCA_ASR_MODEL names a raw
Transformers checkpoint, `prepare_model.py` converts it once into
`sidecar/.models/<id>-ct2`, and the runtime (`asr_server.py`) loads from that
same directory. Both sides compute the path here so they can never disagree.
"""

import os

SIDECAR_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(SIDECAR_DIR, ".models")


def converted_dir(model_id):
    """Local directory a conversion of `model_id` is written to / read from."""
    safe = model_id.replace("/", "__").replace("\\", "__").replace(":", "_")
    return os.path.join(MODELS_DIR, safe + "-ct2")


def has_ct2_weights(path):
    """True when `path` is a directory holding a CTranslate2 model.bin."""
    return os.path.isfile(os.path.join(path, "model.bin"))


def resolve_model(model_id):
    """The path/id faster-whisper should actually load for `model_id`.

    A local conversion wins if one exists; otherwise the id is passed through
    unchanged, so genuine CT2 repo ids (and local CT2 paths) still work.

    Deliberately does no network I/O: the runtime must resolve instantly and
    offline. Deciding whether a *remote* repo needs conversion is setup's job.
    """
    local = converted_dir(model_id)
    if has_ct2_weights(local):
        return local
    return model_id
