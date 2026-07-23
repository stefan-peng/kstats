import io
import struct
from typing import Any


DICTIONARY_EVENT_TYPE = 9
READING_EVENT_TYPE = 3


class EventDecodeError(ValueError):
    pass


MAX_ELEMENT_BYTES = 10_000_000
MAX_CONTAINER_ITEMS = 100_000
MAX_CONTAINER_DEPTH = 100



class QDataStreamReader:
    def __init__(self, payload: bytes):
        self.stream = io.BytesIO(payload)
        self.container_depth = 0

    def _enter_container(self) -> None:
        if self.container_depth >= MAX_CONTAINER_DEPTH:
            raise EventDecodeError("Exceeded maximum QVariant container depth")
        self.container_depth += 1

    def _leave_container(self) -> None:
        self.container_depth -= 1

    def _read(self, size: int) -> bytes:
        value = self.stream.read(size)
        if len(value) != size:
            raise EventDecodeError("Unexpected end of Kobo event payload")
        return value

    def _unpack(self, format_string: str) -> Any:
        size = struct.calcsize(format_string)
        return struct.unpack(format_string, self._read(size))[0]

    def read_bool(self) -> bool:
        return bool(self._unpack(">B"))

    def read_u32(self) -> int:
        return self._unpack(">I")

    def read_qstring(self) -> str | None:
        byte_length = self.read_u32()
        if byte_length == 0xFFFFFFFF:
            return None
        if byte_length % 2 or byte_length > MAX_ELEMENT_BYTES:
            raise EventDecodeError("Invalid QString byte length")
        try:
            return self._read(byte_length).decode("utf-16-be")
        except UnicodeDecodeError as error:
            raise EventDecodeError("Invalid QString data") from error

    def read_qbytearray(self) -> bytes | None:
        length = self.read_u32()
        if length == 0xFFFFFFFF:
            return None
        if length > MAX_ELEMENT_BYTES:
            raise EventDecodeError("Invalid QByteArray length")
        return self._read(length)

    def read_qvariant(self) -> Any:
        value_type = self.read_u32()
        if self.read_bool():
            if value_type == 0:
                marker = self.read_u32()
                if marker != 0xFFFFFFFF:
                    raise EventDecodeError("Invalid null QVariant marker")
            return None

        readers = {
            1: self.read_bool,
            2: lambda: self._unpack(">i"),
            3: self.read_u32,
            4: lambda: self._unpack(">q"),
            5: lambda: self._unpack(">Q"),
            6: lambda: self._unpack(">d"),
            8: self.read_qvariant_map,
            9: self.read_qvariant_list,
            10: self.read_qstring,
            11: self.read_qstring_list,
            12: self.read_qbytearray,
            28: self.read_qvariant_map,
            33: lambda: self._unpack(">h"),
            34: lambda: self._unpack(">b"),
            36: lambda: self._unpack(">H"),
            37: lambda: self._unpack(">B"),
            38: lambda: self._unpack(">f"),
            40: lambda: self._unpack(">b"),
        }
        reader = readers.get(value_type)
        if reader is None:
            raise EventDecodeError(f"Unsupported QVariant type {value_type}")
        return reader()

    def read_qvariant_list(self) -> list[Any]:
        self._enter_container()
        try:
            count = self.read_u32()
            if count > MAX_CONTAINER_ITEMS:
                raise EventDecodeError("Exceeded maximum QVariant list size")
            return [self.read_qvariant() for _ in range(count)]
        finally:
            self._leave_container()

    def read_qstring_list(self) -> list[str | None]:
        count = self.read_u32()
        if count > MAX_CONTAINER_ITEMS:
            raise EventDecodeError("Exceeded maximum QString list size")
        return [self.read_qstring() for _ in range(count)]

    def read_qvariant_map(self) -> dict[str, Any]:
        self._enter_container()
        try:
            count = self.read_u32()
            if count > MAX_CONTAINER_ITEMS:
                raise EventDecodeError("Exceeded maximum QVariant map size")
            values: dict[str, Any] = {}
            for _ in range(count):
                key = self.read_qstring()
                if key is None:
                    raise EventDecodeError("Kobo event map contains a null key")
                values[key] = self.read_qvariant()
            return values
        finally:
            self._leave_container()

    def finished(self) -> bool:
        return self.stream.read(1) == b""


def decode_event_payload(payload: bytes | None) -> dict[str, Any]:
    if not payload:
        return {}
    reader = QDataStreamReader(payload)
    values = reader.read_qvariant_map()
    if not reader.finished():
        raise EventDecodeError("Trailing data in Kobo event payload")
    return values


def parse_dictionary_event(payload: dict[str, Any]) -> dict[str, Any] | None:
    word = payload.get("Word")
    if not isinstance(word, str) or not word.strip():
        return None
    dictionary = payload.get("DictionaryName")
    dictionary_name = (
        dictionary.strip() if isinstance(dictionary, str) and dictionary.strip() else None
    )
    return {
        "word": word.strip(),
        "dictionary": dictionary_name,
    }


def parse_reading_event(payload: dict[str, Any]) -> dict[str, Any] | None:
    seconds = payload.get("ExtraDataReadingSeconds")
    sessions = payload.get("ExtraDataReadingSessions")
    timestamps = payload.get("eventTimestamps")
    if (
        not isinstance(seconds, int)
        or isinstance(seconds, bool)
        or seconds < 0
        or not isinstance(sessions, int)
        or isinstance(sessions, bool)
        or sessions < 1
        or not isinstance(timestamps, list)
    ):
        return None

    valid_timestamps = [
        value
        for value in timestamps
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0
    ]
    return {
        "seconds": seconds,
        "sessions": sessions,
        "timestamps": valid_timestamps,
    }
