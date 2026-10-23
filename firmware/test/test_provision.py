import importlib.util
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location("provision", Path(__file__).parents[1] / "tools/provision.py")
provision = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(provision)


class SerialFake:
    def __init__(self, replies):
        self.replies = iter(replies)
        self.written = b""

    def write(self, data):
        self.written += data

    def flush(self):
        pass

    def readline(self):
        return next(self.replies, b"")


class ProvisionTest(unittest.TestCase):
    def config(self):
        return dict(ssid="room", password="secret", baseUrl="https://example.com", deviceId="pebble", token="reader", pollSeconds=0)

    def test_validation(self):
        provision.validate(self.config())
        for field, value in (("baseUrl", "http://example.com"), ("baseUrl", "https://example.com/"),
                             ("baseUrl", "https://user@example.com"), ("token", "bad\nheader"),
                             ("ssid", "é" * 17), ("deviceId", "../pebble"), ("pollSeconds", 1)):
            config = self.config()
            config[field] = value
            with self.assertRaises(ValueError):
                provision.validate(config)

    def test_ignores_echo_and_logs(self):
        serial = SerialFake([b"configure SECRET\n", b"boot log\n", b"INK OK configured\n"])
        self.assertEqual(provision.exchange(serial, "configure SECRET", "INK OK configured"), "INK OK configured")
        self.assertEqual(serial.written, b"configure SECRET\n")

    def test_error_does_not_reflect_device_text(self):
        serial = SerialFake([b"INK ERROR SECRET\n"])
        with self.assertRaises(RuntimeError) as caught:
            provision.exchange(serial, "configure SECRET", "INK OK configured")
        self.assertNotIn("SECRET", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
