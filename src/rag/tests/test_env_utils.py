import os

from src import env_utils


def test_load_local_env_supports_multiline_quoted_values(monkeypatch, tmp_path):
    env_path = tmp_path / ".env"
    env_path.write_text(
        "MEDHA_SOURCE_DIRS='[\n"
        '  "/tmp/notes",\n'
        '  "/tmp/papers"\n'
        "]'\n",
        encoding="utf-8",
    )

    monkeypatch.setattr(env_utils, "BASE_DIR", tmp_path)
    env_utils.load_local_env.cache_clear()
    monkeypatch.delenv("MEDHA_SOURCE_DIRS", raising=False)

    env_utils.load_local_env()

    assert os.environ["MEDHA_SOURCE_DIRS"] == '[\n  "/tmp/notes",\n  "/tmp/papers"\n]'
    assert env_utils.env_list("MEDHA_SOURCE_DIRS") == ["/tmp/notes", "/tmp/papers"]
