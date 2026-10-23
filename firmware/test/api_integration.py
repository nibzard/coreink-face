#!/usr/bin/env python3
"""Check the native firmware parser/renderer against an isolated local Worker."""
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
PREVIEW = ROOT / "firmware/build-host/ink-preview"
WRITER = "firmware-integration-writer"
READER = "firmware-integration-reader"


def main():
    if not PREVIEW.exists():
        raise SystemExit("Build the host tests first")
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    origin = f"http://127.0.0.1:{port}"

    def request(path, token=READER, method="GET", body=None, etag=None):
        headers = {"Authorization": "Bearer " + token}
        if body is not None:
            headers["Content-Type"] = "application/json"
        if etag:
            headers["If-None-Match"] = etag
        req = Request(origin + path, headers=headers, method=method,
                      data=json.dumps(body).encode() if body is not None else None)
        try:
            with urlopen(req, timeout=3) as response:
                return response.status, response.headers, response.read()
        except HTTPError as response:
            return response.code, response.headers, response.read()

    with tempfile.TemporaryDirectory(prefix="coreink-firmware-test-") as tmp:
        with open(Path(tmp) / "worker.log", "w+") as log:
            proc = subprocess.Popen([
                str(ROOT / "node_modules/.bin/wrangler"), "dev", "--ip", "127.0.0.1", "--port", str(port),
                "--inspector-port", "0", "--persist-to", str(Path(tmp) / "storage"),
                "--var", "FACE_PROVIDER:rules", "--var", "API_TOKEN:" + WRITER, "--var", "DEVICE_TOKEN:" + READER,
            ], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT,
                env={**os.environ, "WRANGLER_SEND_METRICS": "false", "CI": "true"})
            try:
                deadline = time.monotonic() + 45
                while True:
                    try:
                        if request("/health")[0] == 200:
                            break
                    except (URLError, TimeoutError):
                        pass
                    if proc.poll() is not None or time.monotonic() >= deadline:
                        raise RuntimeError("Local Worker failed to start")
                    time.sleep(0.2)
                path = "/v1/devices/firmware-test/display"
                assert request(path)[0] == 404
                assert request(path, token="wrong")[0] == 401
                assert request(path, method="PUT", body={"face": "stars"})[0] == 401
                assert request(path, token=WRITER, method="PUT", body={"face": "stars", "message": "Čć Žž Šš Đđ"})[0] == 200
                status, headers, body = request(path)
                assert status == 200 and headers["ETag"]
                data = json.loads(body)
                assert data["face"] == "stars" and data["message"] == "Čć Žž Šš Đđ"
                snapshot = Path(tmp) / "snapshot.json"
                snapshot.write_bytes(body)
                first = Path(tmp) / "first.pbm"
                subprocess.run([str(PREVIEW), str(snapshot), str(first)], check=True)
                assert first.stat().st_size == 5011
                status, _, body304 = request(path, etag=headers["ETag"])
                assert status == 304 and not body304
                assert request(path, token=WRITER, method="PUT", body={"face": "stars", "message": ""})[0] == 200
                status, _, body = request(path, etag=headers["ETag"])
                assert status == 200 and json.loads(body)["message"] == ""
                snapshot.write_bytes(body)
                cleared = Path(tmp) / "cleared.pbm"
                subprocess.run([str(PREVIEW), str(snapshot), str(cleared)], check=True)
                assert first.read_bytes() != cleared.read_bytes()
                print("Worker → firmware parser → framebuffer: auth, initialization, UTF-8, ETag/304, message clear passed")
            finally:
                proc.terminate()
                try:
                    proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait()


if __name__ == "__main__":
    main()
