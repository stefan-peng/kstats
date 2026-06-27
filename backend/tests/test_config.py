from pathlib import Path

from backend.app.config import (
    SOURCE_DB_ENV,
    default_source_db,
    kobo_database_candidates,
)


def test_source_database_can_be_configured_from_environment(tmp_path):
    configured = tmp_path / "custom.sqlite"

    assert default_source_db({SOURCE_DB_ENV: str(configured)}) == configured


def test_windows_source_database_scans_drive_roots(tmp_path):
    drive_c = tmp_path / "C"
    drive_d = tmp_path / "D"
    expected = drive_d / ".kobo" / "KoboReader.sqlite"
    expected.parent.mkdir(parents=True)
    expected.write_text("", encoding="utf-8")

    assert (
        default_source_db(
            {},
            system="Windows",
            windows_drive_roots=[drive_c, drive_d],
        )
        == expected
    )


def test_windows_source_database_falls_back_to_first_candidate(tmp_path):
    drive_c = tmp_path / "C"
    drive_d = tmp_path / "D"

    assert (
        default_source_db(
            {},
            system="Windows",
            windows_drive_roots=[drive_c, drive_d],
        )
        == drive_c / ".kobo" / "KoboReader.sqlite"
    )


def test_windows_source_database_rejects_empty_drive_roots():
    try:
        default_source_db({}, system="Windows", windows_drive_roots=[])
    except RuntimeError as error:
        assert str(error) == "No Kobo database candidates are configured"
    else:
        raise AssertionError("Expected empty drive roots to fail explicitly")


def test_macos_source_database_candidate_keeps_existing_default():
    assert kobo_database_candidates("Darwin") == [
        Path("/Volumes/KOBOeReader/.kobo/KoboReader.sqlite")
    ]
