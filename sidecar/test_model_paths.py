import os

import model_paths
import prepare_model


def test_converted_dir_sanitizes_the_hf_id_into_one_folder():
    path = model_paths.converted_dir("biodatlab/whisper-th-medium-combined")
    assert os.path.dirname(path) == model_paths.MODELS_DIR
    name = os.path.basename(path)
    assert "/" not in name
    assert name == "biodatlab__whisper-th-medium-combined-ct2"


def test_resolve_returns_the_local_conversion_when_it_exists(tmp_path, monkeypatch):
    model_id = "biodatlab/whisper-th-medium-combined"
    out = tmp_path / "converted"
    out.mkdir()
    (out / "model.bin").write_bytes(b"stub")
    monkeypatch.setattr(model_paths, "converted_dir", lambda _id: str(out))

    assert model_paths.resolve_model(model_id) == str(out)


def test_resolve_passes_ct2_ids_through_untouched(monkeypatch):
    # No conversion on disk -> the id is loaded directly, so genuine CT2 repos
    # and local CT2 paths keep working.
    monkeypatch.setattr(model_paths, "converted_dir", lambda _id: "/does/not/exist")
    assert model_paths.resolve_model("deepdml/faster-whisper-large-v3-turbo-ct2") == (
        "deepdml/faster-whisper-large-v3-turbo-ct2"
    )


def test_ct2_detection_keys_off_model_bin():
    assert prepare_model.is_ct2_model({"config.json", "model.bin", "vocabulary.json"})
    # A raw Transformers checkpoint ships safetensors, not model.bin.
    assert not prepare_model.is_ct2_model(
        {"config.json", "model.safetensors", "tokenizer.json"}
    )
