#!/usr/bin/env python3
"""Run live CoreInk/API acceptance checks; credentials are read from a private file."""
import argparse
import json
from pathlib import Path
import re
import time
from urllib.request import Request, urlopen
import provision


class Acceptance:
    def __init__(self, args, serial):
        self.args, self.serial = args, serial
        self.secrets = json.loads(Path(args.secrets_file).read_text())
        self.report = {"device": args.device_id, "checks": [], "visual": {}}
        self.last_complete = None
        self.refresh_gaps = []
        self.refreshes = 0

    def line(self):
        line = self.serial.readline().decode("utf-8", errors="replace").strip()
        if line.startswith(("Guru Meditation", "Backtrace:", "abort()")):
            raise RuntimeError("Device crashed")
        if line.startswith("INK "):
            print(line, flush=True)
        now = time.monotonic()
        if line == "INK DISPLAY begin" and self.last_complete is not None:
            self.refresh_gaps.append(now - self.last_complete)
        if line == "INK DISPLAY complete":
            self.last_complete = now
            self.refreshes += 1
        return line

    def until(self, predicate, timeout=50):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            line = self.line()
            if predicate(line):
                return line
        raise TimeoutError("Expected device event not observed")

    def send(self, command, ack):
        self.serial.write(command.encode() + b"\n")
        self.serial.flush()
        return self.until(lambda line: line.startswith(ack))

    def poll(self):
        line = self.until(lambda line: line.startswith("INK POLL "))
        fields = dict(re.findall(r"(status|retry|failures|heap)=(-?\d+)", line))
        return {key: int(value) for key, value in fields.items()}

    def paint(self):
        self.until(lambda line: line == "INK DISPLAY complete")

    def publish(self, body):
        req = Request(self.args.origin + "/v1/devices/" + self.args.device_id + "/display",
                      method="PUT", data=json.dumps(body).encode(), headers={
                          "Authorization": "Bearer " + self.secrets["API_TOKEN"],
                          "Content-Type": "application/json", "User-Agent": "CoreInkFaces/0.1.0"})
        with urlopen(req, timeout=20) as response:
            return json.load(response)

    def check(self, name, **evidence):
        self.report["checks"].append({"name": name, "passed": True, **evidence})
        print("PASS " + name, flush=True)
        self.save()

    def save(self):
        path = Path(self.args.report)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.report, indent=2) + "\n")

    def visual(self, name, prompt):
        print("VISUAL " + name + ": " + prompt, flush=True)
        answer = "unverified" if self.args.noninteractive else input("Confirm physical display with y, or n: ").strip().lower()
        self.report["visual"][name] = answer == "y"
        self.save()
        if answer == "n":
            raise RuntimeError("Physical display check failed: " + name)

    def changed(self, body):
        frame = self.publish(body)
        self.send("poll", "INK OK poll")
        assert self.poll()["status"] == 200
        self.paint()
        return frame

    def run(self):
        self.until(lambda line: line == "INK READY 1")
        self.send("awake on", "INK OK awake")
        self.publish({"face": "hearts", "message": "Hello, Pebble!"})
        self.send("redraw", "INK OK redraw")
        assert self.poll()["status"] in (200, 304)
        self.paint()
        self.check("explicit_payload", face="hearts", message="Hello, Pebble!")

        # Trigger a new whole-screen update well before the 15s guard expires.
        self.changed({"face": "hearts", "message": "A small bright moment for you"})
        gap = self.refresh_gaps[-1]
        assert gap >= 14.5, "Physical refresh guard was bypassed"
        self.check("whole_screen_refresh_guard", observed_gap_seconds=round(gap, 3))
        self.visual("word_wrap", "Hearts and two centered lines: 'A small bright' / 'moment for you'")

        self.changed({"face": "hearts", "message": ""})
        self.check("message_clear")
        self.visual("message_clear", "The hearts face remains and all message text is gone")
        self.changed({"face": "hearts", "message": "Hello, Pebble!"})

        # The device uses the real network/HTTP paths, but faults are temporary
        # USB diagnostics, never changes to credentials or server identity.
        for mode in ("wifi", "api"):
            before = self.refreshes
            self.send("fault " + mode, "INK FAULT " + mode)
            results = [self.poll()]
            for _ in range(2):
                self.send("poll", "INK OK poll")
                results.append(self.poll())
            assert all(r["status"] == -1 for r in results)
            assert results[-1]["failures"] >= 3 and results[-1]["retry"] >= 120
            assert self.refreshes == before, "Outage caused an unnecessary redraw"
            self.check(mode + "_unavailable", polls=results, redraws=0)
            self.send("fault off", "INK FAULT off")
            recovery = self.poll()
            assert recovery["status"] == 304 and recovery["failures"] == 0
            assert self.refreshes == before
            self.check(mode + "_recovery", status=304, redraws=0)
        self.visual("offline_retention", "The same hearts/greeting remained throughout both outages")

        before = self.refreshes
        self.send("reboot", "INK OK reboot")
        self.until(lambda line: line == "INK READY 1")
        result = self.poll()
        assert result["status"] == 304 and self.refreshes == before
        self.check("restart_persistence", status=304, redraws=0)

        frame = self.changed({"state": {"event": "resting", "energy": "very low", "mood": "sleepy"},
                              "message": "Time for a little nap."})
        selection = frame.get("selection", {})
        assert selection.get("source") == "jev", "Live server did not use Jev"
        assert selection.get("reason") not in ("provider-unavailable", "low-confidence"), "Jev did not select confidently"
        self.check("live_jev", face=frame["face"], source=selection["source"], reason=selection.get("reason"))
        self.visual("jev_face", "Face ID " + frame["face"] + " with the centered message 'Time for a little nap.'")
        self.report["complete"] = all(self.report["visual"].values())
        self.save()
        print("HARDWARE ACCEPTANCE COMPLETE", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port")
    parser.add_argument("--origin", default="https://coreink-face-api.nikola-balic.workers.dev")
    parser.add_argument("--device-id", default="pebble")
    parser.add_argument("--secrets-file", required=True)
    parser.add_argument("--report", default="firmware/build-host/hardware-acceptance.json")
    parser.add_argument("--noninteractive", action="store_true")
    args = parser.parse_args()
    with provision.open_device(args.port, True) as serial:
        run = Acceptance(args, serial)
        try:
            run.run()
        finally:
            # Fault modes are also self-expiring and reset clears them.
            try:
                run.send("fault off", "INK FAULT off")
                run.send("awake off", "INK OK awake")
            finally:
                run.save()


if __name__ == "__main__":
    main()
