"""Make MOCA_ASR_MODEL loadable by the faster-whisper runtime.

Run at setup time (`npm run setup:asr`). Three cases:

  * The id is already a CTranslate2 model (its repo/dir has a model.bin):
    nothing to convert -- just warm the faster-whisper cache.
  * The id is a raw Transformers Whisper checkpoint (e.g.
    biodatlab/whisper-th-medium-combined): convert it once to CTranslate2 int8
    into sidecar/.models/<id>-ct2, then warm the cache.
  * A conversion already exists: reuse it.

Runtime resolves the same directory through model_paths.resolve_model, so what
setup builds is exactly what asr_server.py later loads.
"""

import os
import subprocess
import sys

from model_paths import converted_dir, has_ct2_weights, resolve_model

SIDECAR_DIR = os.path.dirname(os.path.abspath(__file__))
CONVERT_REQUIREMENTS = os.path.join(SIDECAR_DIR, "requirements-convert.txt")
DEFAULT_MODEL = "deepdml/faster-whisper-large-v3-turbo-ct2"

# Tokenizer / feature-extractor files faster-whisper looks for next to
# model.bin. config.json is intentionally absent: the converter writes its own
# CTranslate2 config.json and copying the Transformers one over it would break
# loading. Only the ones a given repo actually ships are copied.
COPY_CANDIDATES = [
    "tokenizer.json",
    "preprocessor_config.json",
    "tokenizer_config.json",
    "vocab.json",
    "merges.txt",
    "normalizer.json",
    "added_tokens.json",
    "special_tokens_map.json",
    "generation_config.json",
]


def repo_files(model_id):
    """The file names a model exposes, whether it is a local dir or an HF id."""
    if os.path.isdir(model_id):
        return set(os.listdir(model_id))
    from huggingface_hub import HfApi

    return set(HfApi().list_repo_files(model_id))


def is_ct2_model(files):
    return "model.bin" in files


def install_convert_deps():
    print("\n> Installing conversion dependencies (transformers, torch) -- one time")
    subprocess.check_call(
        [sys.executable, "-m", "pip", "install", "-r", CONVERT_REQUIREMENTS]
    )


def convert(model_id, files, output_dir):
    install_convert_deps()
    # Imported only after the deps are present: TransformersConverter pulls in
    # transformers + torch to load the source weights.
    from ctranslate2.converters import TransformersConverter

    copy_files = [name for name in COPY_CANDIDATES if name in files]
    print(f"\n> Converting {model_id} to CTranslate2 int8 -> {output_dir}")
    converter = TransformersConverter(model_id, copy_files=copy_files)
    converter.convert(output_dir, quantization="int8", force=True)


def warm(path):
    print(f"\n> Warming faster-whisper cache for {path}")
    from faster_whisper import WhisperModel

    WhisperModel(path, device="cpu", compute_type="int8")


def prepare(model_id):
    files = repo_files(model_id)

    if is_ct2_model(files):
        print(f"{model_id} is already a CTranslate2 model; no conversion needed.")
        warm(model_id)
    else:
        output_dir = converted_dir(model_id)
        if has_ct2_weights(output_dir):
            print(f"Reusing existing conversion at {output_dir}")
        else:
            convert(model_id, files, output_dir)
        warm(output_dir)

    print(f"\nModel ready. Runtime will load: {resolve_model(model_id)}")


def main():
    model_id = (
        sys.argv[1]
        if len(sys.argv) > 1
        else os.environ.get("MOCA_ASR_MODEL", DEFAULT_MODEL)
    )
    prepare(model_id)


if __name__ == "__main__":
    main()
