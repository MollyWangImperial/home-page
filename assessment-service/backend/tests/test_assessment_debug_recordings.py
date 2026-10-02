import asyncio
import json
import os

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "rehyn_debug_recording_test")

import pytest
from fastapi import HTTPException
from starlette.requests import Request
from backend import assessment_debug_recordings as debug
from backend.tests.test_local_assessment_recordings import local_client


@pytest.fixture
def prepared(monkeypatch, tmp_path):
    monkeypatch.setenv("REHYN_LOCAL_ASSESSMENT_PREVIEW", "1")
    monkeypatch.delenv("RENDER", raising=False)
    monkeypatch.setattr(debug, "DEBUG_DIR", tmp_path / "latest")
    return local_client(), debug.DEBUG_DIR


def url(session, task="T1", kind="video"):
    return f"/api/local-assessment-recordings/debug/sessions/{session}/tasks/{task}/{kind}?local_preview=1"


def start(client):
    response = client.post("/api/local-assessment-recordings/debug/sessions?local_preview=1")
    assert response.status_code == 200, response.text
    return response.json()["session_id"]


VIDEO = b"\x1a\x45\xdf\xa3synthetic webm test bytes"


def test_latest_task_videos_reset_and_old_uploads_cannot_restore_them(prepared):
    client, folder = prepared
    folder.mkdir()
    (folder / "unrelated.txt").write_text("keep")
    historical = folder.parent / "historic-T1.webm"
    historical.write_bytes(VIDEO)
    first = start(client)
    for task in ["T1", "T3", "H4", "H3", "L6"]:
        saved = client.post(url(first, task), content=VIDEO, headers={"Content-Type": "video/webm"})
        assert saved.status_code == 200
        assert (folder / f"{task}.webm").read_bytes() == VIDEO
        evidence = {"task_result": {"task_id": task, "metrics": {"ladder": {"measured": True}}}, "geometry": []}
        assert client.post(url(first, task, "evidence"), json=evidence).status_code == 200
        assert client.get(url(first, task)).content == VIDEO
    # Same task is replaced, including when the browser changes container type.
    mp4 = b"\0\0\0\x18ftypisomfixture"
    assert client.post(url(first), content=mp4, headers={"Content-Type": "video/mp4"}).status_code == 200
    assert (folder / "T1.mp4").read_bytes() == mp4
    assert not (folder / "T1.webm").exists()
    second = start(client)
    assert second != first
    assert not list(folder.glob("*.webm")) and not list(folder.glob("*.mp4"))
    assert client.post(url(first), content=VIDEO, headers={"Content-Type": "video/webm"}).status_code == 409
    assert client.post(url(first, kind="evidence"), json={"task_result": {"task_id": "T1"}}).status_code == 409
    assert (folder / "unrelated.txt").read_text() == "keep" and historical.read_bytes() == VIDEO
    assert client.post(url(second), content=VIDEO, headers={"Content-Type": "video/webm"}).status_code == 200


def test_reset_while_old_video_is_streaming_rejects_commit(prepared):
    client, folder = prepared
    first = start(client)
    received = False
    async def receive():
        nonlocal received
        if not received:
            received = True
            return {"type": "http.request", "body": VIDEO[:4], "more_body": True}
        # Simulate a new session starting after the first chunk was accepted.
        debug.write_json(folder / "session.json", {"session_id": "new"})
        return {"type": "http.request", "body": VIDEO[4:], "more_body": False}
    request = Request({"type": "http", "scheme": "http", "path": "/", "query_string": b"local_preview=1",
        "headers": [(b"host", b"localhost"), (b"content-type", b"video/webm")], "client": ("127.0.0.1", 1)}, receive)
    with pytest.raises(HTTPException) as error:
        asyncio.run(debug.save_video(first, "T1", request))
    assert error.value.status_code == 409
    assert not (folder / "T1.webm").exists() and not list(folder.parent.glob("*.part"))


def test_debug_guard_size_validation_and_task_paths(prepared, monkeypatch):
    client, folder = prepared
    first = start(client)
    assert local_client("203.0.113.1").post("/api/local-assessment-recordings/debug/sessions?local_preview=1").status_code == 404
    assert client.post("/api/local-assessment-recordings/debug/sessions?local_preview=1", headers={"Origin": "https://example.com"}).status_code == 404
    assert client.post(url(first, "NO_TASK"), content=VIDEO, headers={"Content-Type": "video/webm"}).status_code == 422
    assert client.post(url(first), content=b"not video", headers={"Content-Type": "video/webm"}).status_code == 415
    monkeypatch.setattr(debug, "MAX_VIDEO_BYTES", 8)
    assert client.post(url(first), content=VIDEO, headers={"Content-Type": "video/webm"}).status_code == 413
    assert not list(folder.parent.glob("*.part"))
    monkeypatch.setenv("RENDER", "true")
    assert client.post("/api/local-assessment-recordings/debug/sessions?local_preview=1").status_code == 404
