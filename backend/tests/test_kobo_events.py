import struct

from backend.app.kobo_events import (
    decode_event_payload,
    parse_dictionary_event,
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
