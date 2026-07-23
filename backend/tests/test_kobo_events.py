import struct

import pytest

from backend.app.kobo_events import (
    MAX_CONTAINER_DEPTH,
    EventDecodeError,
    decode_event_payload,
    parse_dictionary_event,
    parse_reading_event,
)


def test_decodes_native_kobo_dictionary_event_blob():
    payload = bytes.fromhex(
        "000000030000001E006500760065006E007400540069006D0065007300740061"
        "006D0070007300000009000000000100000003005EBF873C000000080057006F"
        "007200640000000A000000001200700072006F00730065006300750074006500"
        "00001C00440069006300740069006F006E006100720079004E0061006D006500"
        "00000A00000000040065006E"
    )

    decoded = decode_event_payload(payload)

    assert decoded == {
        "eventTimestamps": [1589610300],
        "Word": "prosecute",
        "DictionaryName": "en",
    }
    assert parse_dictionary_event(decoded) == {
        "word": "prosecute",
        "dictionary": "en",
    }


def test_decodes_qt_invalid_variant_value():
    key = "StartPercentage".encode("utf-16-be")
    payload = (
        struct.pack(">II", 1, len(key))
        + key
        + struct.pack(">IBI", 0, 1, 0xFFFFFFFF)
    )

    assert decode_event_payload(payload) == {"StartPercentage": None}


def test_rejects_excessively_nested_variant_containers():
    key = "x".encode("utf-16-be")
    value = struct.pack(">IB", 1, 0) + b"\x01"
    for _ in range(MAX_CONTAINER_DEPTH):
        value = (
            struct.pack(">IBI", 8, 0, 1)
            + struct.pack(">I", len(key))
            + key
            + value
        )
    payload = struct.pack(">I", 1) + struct.pack(">I", len(key)) + key + value

    with pytest.raises(EventDecodeError, match="container depth"):
        decode_event_payload(payload)


def test_dictionary_lookup_preserves_source_spelling():
    assert parse_dictionary_event(
        {
            "Word": " RCA ",
            "DictionaryName": " -EN ",
        }
    ) == {
        "word": "RCA",
        "dictionary": "-EN",
    }


def test_parses_valid_reading_telemetry_and_discards_invalid_timestamps():
    assert parse_reading_event(
        {
            "ExtraDataReadingSeconds": 120,
            "ExtraDataReadingSessions": 2,
            "eventTimestamps": [100, True, -1, "200", 200],
        }
    ) == {
        "seconds": 120,
        "sessions": 2,
        "timestamps": [100, 200],
    }


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"ExtraDataReadingSeconds": -1, "ExtraDataReadingSessions": 1},
        {
            "ExtraDataReadingSeconds": 1,
            "ExtraDataReadingSessions": 0,
            "eventTimestamps": [],
        },
    ],
)
def test_rejects_incomplete_reading_telemetry(payload):
    assert parse_reading_event(payload) is None
