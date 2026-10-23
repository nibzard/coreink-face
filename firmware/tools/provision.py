#!/usr/bin/env python3
"""Configure CoreInk over USB without putting secrets in arguments or logs."""
import argparse
import getpass
import json
import re
import sys
import time
from urllib.parse import urlsplit


def validate(config):
    for field, limit in (("ssid", 32), ("password", 64), ("baseUrl", 256), ("deviceId", 64), ("token", 256)):
        value = config[field]
        if "\x00" in value or len(value.encode("utf-8")) > limit:
            raise ValueError(f"{field} exceeds {limit} bytes or contains NUL")
    url = urlsplit(config["baseUrl"])
    if (url.scheme != "https" or not url.hostname or url.username or url.password or url.path or
            url.query or url.fragment or not all(33 <= ord(c) <= 126 for c in config["baseUrl"])):
        raise ValueError("baseUrl must be an HTTPS origin, without a trailing slash or path")
    if not config["ssid"] or not re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", config["deviceId"]):
        raise ValueError("Set an SSID and a device ID with 1–64 letters, digits, underscores or hyphens")
    if not config["token"] or not all(33 <= ord(c) <= 126 for c in config["token"]):
        raise ValueError("Reader token must contain printable ASCII without spaces")
    if config["pollSeconds"] != 0 and not 15 <= config["pollSeconds"] <= 3600:
        raise ValueError("Polling override must be 0 (server default) or 15–3600 seconds")


def exchange(ser, command, expected, timeout=45):
    """Ignore arbitrary device logs and any accidental command echo."""
    ser.write(command.encode("utf-8") + b"\n")
    ser.flush()
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        line = ser.readline().decode("utf-8", errors="replace").strip()
        if line.startswith(expected):
            return line
        if line.startswith("INK ERROR "):
            # Do not reflect untrusted device text, which might contain secrets.
            raise RuntimeError("Device rejected the command; check its configuration and firmware")
    raise TimeoutError("Device did not acknowledge the command; reset it and retry, or check --port")


def open_device(port, reset):
    import serial
    from serial.tools import list_ports
    if not port:
        ports = [p.device for p in list_ports.comports() if p.vid in (0x10C4, 0x1A86)]
        if len(ports) != 1:
            raise ValueError("Specify --port; could not identify exactly one CoreInk USB serial device")
        port = ports[0]
    ser = serial.Serial(port=None, baudrate=115200, timeout=0.25, write_timeout=2)
    ser.dtr = False
    ser.rts = False
    ser.port = port
    ser.open()
    if reset:
        ser.rts = True  # EN low, GPIO0 stays high: normal boot
        time.sleep(0.1)
        ser.rts = False
        time.sleep(0.5)
    return ser


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", help="USB serial port, e.g. /dev/cu.usbserial-XXXX")
    parser.add_argument("--no-reset", action="store_true", help="use a device already awake")
    sub = parser.add_subparsers(dest="command", required=True)
    setup = sub.add_parser("provision")
    setup.add_argument("--base-url")
    setup.add_argument("--device-id")
    setup.add_argument("--ssid")
    setup.add_argument("--poll-seconds", type=int, default=0)
    setup.add_argument("--stay-awake", action="store_true", help="disable deep sleep for USB development")
    sub.add_parser("status")
    sub.add_parser("poll")
    sub.add_parser("redraw")
    awake = sub.add_parser("awake")
    awake.add_argument("mode", choices=("on", "off"))
    sub.add_parser("erase")
    args = parser.parse_args()
    payload = None
    if args.command == "provision":
        payload = {
            "ssid": args.ssid or input("Wi-Fi SSID: ").strip(),
            "password": getpass.getpass("Wi-Fi password (empty for open network): "),
            "baseUrl": args.base_url or input("API origin (https://…; no trailing slash): ").strip(),
            "deviceId": args.device_id or input("Device ID: ").strip(),
            "token": getpass.getpass("DEVICE_TOKEN (reader token): "),
            "pollSeconds": args.poll_seconds,
            "stayAwake": args.stay_awake,
        }
        validate(payload)
    if args.command == "erase" and input("Type ERASE to clear this device's configuration and display cache: ") != "ERASE":
        raise ValueError("Erase cancelled")
    with open_device(args.port, not args.no_reset) as ser:
        exchange(ser, "ping", "INK READY 1")
        if payload:
            exchange(ser, "configure " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")), "INK OK configured")
            print("Configured. The device will reboot and fetch its display.")
        elif args.command == "status":
            # Acknowledge status, but expose only the known firmware fields.
            status = exchange(ser, "status", "INK STATUS ")
            pattern = r"INK STATUS configured=[01] device=[a-zA-Z0-9_-]{1,64} http=-?\d+ battery=-?\d+ heap=\d+"
            print(status if re.fullmatch(pattern, status) else "Device status received (unrecognized format)")
        elif args.command == "poll":
            exchange(ser, "poll", "INK OK poll")
            print("Poll requested.")
        elif args.command == "redraw":
            exchange(ser, "redraw", "INK OK redraw")
            print("Display recovery requested; the refresh guard still applies.")
        elif args.command == "awake":
            exchange(ser, "awake " + args.mode, "INK OK awake")
            print("Stay-awake mode " + args.mode + ".")
        elif args.command == "erase":
            exchange(ser, "reset-config ERASE", "INK OK erased")
            print("Configuration and display cache cleared.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, TimeoutError, OSError, ImportError) as error:
        # Serial exceptions sometimes contain data; print fixed messages for
        # transport failures, while our own validation messages are safe.
        if type(error) in (ValueError, RuntimeError, TimeoutError):
            print(str(error), file=sys.stderr)
        else:
            print("USB serial unavailable. Install tools/requirements.txt and check the port.", file=sys.stderr)
        sys.exit(1)
