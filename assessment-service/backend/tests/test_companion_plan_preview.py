import asyncio
import os
import random
from copy import deepcopy

import pytest
from fastapi import HTTPException
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "rehyn_companion_preview_tests")
from backend import server
from backend.companion_plan_preview import random_task_results
from backend.tests.test_local_assessment_preview import request


@pytest.fixture(autouse=True)
def local_only(monkeypatch):
    monkeypatch.setenv("REHYN_LOCAL_ASSESSMENT_PREVIEW", "1")
    monkeypatch.setenv("FUNCTION_LADDER_ENABLED", "1")
    monkeypatch.delenv("RENDER", raising=False)
    class NoDatabase:
        def __getattr__(self, name):
            raise AssertionError("Companion testing must not access patient records")
    monkeypatch.setattr(server, "db", NoDatabase())


def payload(rows=None):
    ids = ["T1", "T3", "H4", "H3", "L6"]
    return server.AssessmentSubmit(assessment_package="initial", assigned_task_ids=ids,
        task_results=rows or [], patient_parameters={"companion_answers": {
            "arm_hand_movement": "fairly_well", "help_at_home": "own", "main_goal": "eating"}})


@pytest.mark.parametrize("route", [server.companion_preview_random_results, server.companion_preview_plan])
@pytest.mark.parametrize("bad", [{"query": ""}, {"host": "rehyn.com"}, {"headers": {"x-user-id": "patient"}},
                                {"headers": {"origin": "https://example.com"}}])
def test_both_preview_routes_reject_nonlocal_account_requests(route, bad):
    with pytest.raises(HTTPException) as error:
        asyncio.run(route(payload(), request(**bad)))
    assert error.value.status_code == 403


def test_random_scoring_then_plan_never_saves_account_or_changes_payload_profile():
    incoming = payload()
    report = asyncio.run(server.companion_preview_random_results(incoming, request()))
    assert report["preview_only"] and report["testing_random"]
    assert not report["saved_to_assessment"] and "rehab_plan" not in report
    assert report["metrics"]["function_score"]["tasks"][-1]["points"] is None
    profile = deepcopy(incoming.patient_parameters)
    planned = asyncio.run(server.companion_preview_plan(incoming, request()))
    assert planned["testing_random"] and planned["clinical_review_gate"]["rehab_access"] == "allowed"
    assert incoming.patient_parameters == profile
    assert planned["metrics"]["function_score"] == report["metrics"]["function_score"]
    assert all(exercise["id"] in {ex.id for ex in server.EXERCISE_LIBRARY.values()} for exercise in planned["rehab_plan"])


def test_real_preview_keeps_marks_but_unknown_sitting_only_allows_candidate_view():
    rows = random_task_results(["T1", "T3", "H4", "H3", "L6"], random.Random(5))
    for row in rows:
        row["metrics"].pop("generated_testing_sample")
    incoming = payload(rows)
    report = asyncio.run(server.preview_assessment_results(incoming, request()))
    planned = asyncio.run(server.companion_preview_plan(incoming, request()))
    assert planned["metrics"]["function_score"] == report["metrics"]["function_score"]
    assert planned["function_rehab_plan"]["candidate_only"] is True
    assert planned["clinical_review_gate"]["rehab_access"] == "blocked"
    assert "sitting_ability" not in planned["patient_parameters"]
    assert not planned.get("testing_random")


def test_reported_pain_blocks_the_plan_even_for_testing():
    incoming = payload(random_task_results(["T1", "T3", "H4", "H3", "L6"], random.Random(5)))
    incoming.task_results[0].metrics["pain"] = "yes"
    planned = asyncio.run(server.companion_preview_plan(incoming, request()))
    assert planned["clinical_review_gate"]["rehab_access"] == "blocked"
    assert planned["rehab_plan"] == []


def test_preview_completion_hands_its_actual_report_to_companion():
    html = asyncio.run(server.pose_runner(request())).body.decode()
    assert 'type:"assessment_preview_complete", assessment:data' in html
