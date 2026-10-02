"""Function-score contract, independent of camera/UI and patient storage."""
from copy import deepcopy
from decimal import Decimal
import asyncio
import json
import os

import pytest

from backend.function_scoring import (
    LADDER_VERSION, VERSION, POSTURE_CHECKS, TASK_RUNGS, compare_function_scores,
    daily_activity_levels, level_from_legacy, round_score, score_function_assessment, task_level,
)

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "rehyn_function_score_tests")


def attempt(tid, rung=None, *, completed=True, assist=None, detected=(), unmeasured=()):
    checks = {cid: "detected" if cid in detected else "not_measured" if cid in unmeasured else "not_detected"
              for cid in POSTURE_CHECKS[tid]}
    return {"rung": rung or TASK_RUNGS[tid][-1], "completed": completed, "assist": assist,
            "compensations": checks, "near": True, "duration_ms": 5200}


def ladder(tid, attempts=None, **overrides):
    return {"task_id": tid, "completed_steps": 0, "total_steps": 0, "steps": [], "metrics": {"ladder": {
        "version": LADDER_VERSION, "rungs": list(TASK_RUNGS[tid]), "full_rung": TASK_RUNGS[tid][-1],
        "start_rung": TASK_RUNGS[tid][0], "attempts": [attempt(tid)] if attempts is None else attempts,
        "best_alone": None, "best_assisted": None, "movement_seen": False,
        "stretch_completed": False, "prerequisite_not_met": False, "measured": True,
        "stopped_by": "full_rung", **overrides,
    }}}


def gait(score=60, *, status="scored", skipped=False):
    return {"task_id": "L6", "metrics": {"walking_skipped": skipped,
            "gait_analysis": {"version": "existing-gait", "status": status, "score": score}}}


@pytest.mark.parametrize("protocol", ["hand_open_at_mouth_v1", "hand_open_at_chest_v2"])
def test_hand_opening_protocol_keeps_old_results_and_comparisons_honest(protocol):
    old = score_function_assessment([ladder("H4")])
    new = score_function_assessment([ladder("H4", protocol=protocol)])
    assert old["tasks"][0]["task_label"] == "Hand opening and closing"
    assert new["tasks"][0]["task_label"] == "Hand opening"
    assert new["tasks"][0]["protocol"] == protocol
    assert compare_function_scores(new, old)["total_comparable"] is False
    assert compare_function_scores(new, old)["task_ids"] == []
    assert compare_function_scores(new, new)["total_comparable"] is True
    unmeasured = task_level(ladder("H4", attempts=[], measured=False, protocol=protocol))
    assert unmeasured["level"] is None and unmeasured["task_label"] == "Hand opening"


def test_lowered_hand_opening_target_is_not_compared_with_the_old_mouth_protocol():
    mouth = score_function_assessment([ladder("H4", protocol="hand_open_at_mouth_v1")])
    chest = score_function_assessment([ladder("H4", protocol="hand_open_at_chest_v2")])
    assert chest["tasks"][0]["level"] == mouth["tasks"][0]["level"] == 4
    assert compare_function_scores(chest, mouth)["total_comparable"] is False
    assert compare_function_scores(chest, mouth)["task_ids"] == []
    assert compare_function_scores(chest, chest)["total_comparable"] is True


def legacy(tid, *, complete=None, assisted=False, detected=(), unmeasured=(), duration=600):
    complete = (f"{tid}-S1", f"{tid}-S2") if complete is None else complete
    steps = [{"step_id": f"{tid}-S{index}", "completed": f"{tid}-S{index}" in complete,
              "metrics": {"quality": {"version": "rehyn-task-quality-1", "measurements": {},
                  "compensations": {cid: {"eligible_ms": 0 if cid in unmeasured else 900,
                                         "max_value": 40 if cid in detected else 0,
                                         "max_streak_ms": duration if cid in detected else 0}
                                    for cid in POSTURE_CHECKS[tid]}}}} for index in (1, 2)]
    return {"task_id": tid, "steps": steps, "completed_steps": len(complete),
            "total_steps": 2, "metrics": {"assisted": assisted}}


@pytest.mark.parametrize("case,rows,levels,arm,hand,total,display,daily", [
    ("A", [ladder("T1"), ladder("T3", [attempt("T3", detected=("head_drop",))]), ladder("H4"), ladder("H3")],
     [4, 3, 4, 4], 87.5, 100, 93.8, 94, [3, 4, 3]),
    ("B", [ladder("T1", [attempt("T1", "r120")]), ladder("T3", [attempt("T3", detected=("trunk_lean",))]),
           ladder("H4", [attempt("H4", "partial")]), ladder("H3", [attempt("H3", "partial")])],
     [2, 3, 2, 2], 62.5, 50, 56.3, 56, [2, 2, 2]),
    ("C", [ladder("T1", [attempt("T1", "r80", assist="helper")]), ladder("T3", [attempt("T3", "chest")]),
           ladder("H4", [], movement_seen=True), ladder("H3", [], prerequisite_not_met=True, measured=False)],
     [1, 2, 1, 0], 37.5, 12.5, 25, 25, [1, 0, 1]),
    ("D", [ladder("T1", [attempt("T1", unmeasured=("trunk_lean",))]), ladder("T3", [], measured=False),
           ladder("H4"), ladder("H3")],
     [3, None, 4, 4], 75, 100, 87.5, 88, [None, 3, None]),
    ("E", [ladder("T1", [attempt("T1", detected=("trunk_lean",))]), ladder("T3"), gait()],
     [3, 4, None], 87.5, None, 73.8, 74, [4, 3, 3]),
])
def test_worked_examples(case, rows, levels, arm, hand, total, display, daily):
    result = score_function_assessment(rows)
    assert result["version"] == VERSION and result["clinical_measure"] is False
    assert [task["level"] for task in result["tasks"]] == levels
    assert result["areas"]["upper_limb"]["score"] == arm
    assert result["areas"].get("hand", {}).get("score") == hand
    assert result["total"] == total and result["display_total"] == display
    assert [activity["level"] for activity in result["daily_activities"][:3]] == daily
    assert result["areas"]["upper_limb"]["partial"] == (case == "D")
    if case == "B":
        assert result["areas"]["upper_limb"]["display_score"] == 63
        assert result["daily_activities"][0]["limited_by"] == ["H4"]
    if case == "D":
        assert result["daily_activities"][0]["status"] == "estimated"
    if case == "E":
        assert result["areas"]["lower_limb"]["score"] == 60
        assert result["daily_activities"][3]["score"] == 60


@pytest.mark.parametrize("tid", ["T1", "T3", "H4"])
@pytest.mark.parametrize("kind,level,points", [
    ("clean", 4, 100), ("compensated", 3, 75), ("unobserved", 3, 75),
    ("partial", 2, 50), ("helper", 1, 25), ("self", 1, 25),
    ("movement", 1, 25), ("none", 0, 0), ("tracking", None, None),
])
def test_every_camera_task_uses_the_same_levels(tid, kind, level, points):
    rows = [] if kind in {"movement", "none", "tracking"} else [attempt(
        tid, TASK_RUNGS[tid][0] if kind == "partial" else None,
        assist=kind if kind in {"self", "helper"} else None,
        detected=("shoulder_hike",) if kind == "compensated" else (),
        unmeasured=POSTURE_CHECKS[tid] if kind == "unobserved" else (),
    )]
    result = task_level(ladder(tid, rows, movement_seen=kind == "movement", measured=kind != "tracking"))
    assert result["level"] == level and result["points"] == points
    assert result["derived"] is False and result["clinical_measure"] is False


@pytest.mark.parametrize("detected,unmeasured", [
    ((), ()), (("wrist_bend",), ()), (("trunk_lean", "shoulder_hike", "wrist_bend"), ()),
    ((), POSTURE_CHECKS["H3"]), (("wrist_bend",), ("trunk_lean",)),
])
def test_completed_full_pinch_earns_full_points_without_posture_deductions(detected, unmeasured):
    task = ladder("H3", [attempt("H3", detected=detected, unmeasured=unmeasured)])
    before = deepcopy(task)
    result = task_level(task)
    assert (result["level"], result["points"], result["label"]) == (4, 100, "Can do well")
    assert result["reason"] == "full_pinch_alone" and result["posture_scored"] is False
    assert result["compensations"] == {} and result["unmeasured_compensations"] == []
    assert result["posture_observations"] == before["metrics"]["ladder"]["attempts"][0]["compensations"]
    assert result["next_step"].startswith("Well done")
    assert "completed the pinch on your own" in result["next_step"]
    assert "steady" not in result["next_step"] and "wrist" not in result["next_step"]
    assert task == before, "Debug observations and recorded attempts must remain intact"


@pytest.mark.parametrize("kind,level,points", [
    ("partial", 2, 50), ("helper", 1, 25), ("self", 1, 25),
    ("movement", 1, 25), ("none", 0, 0), ("tracking", None, None),
])
def test_pinch_still_requires_verified_full_independent_completion(kind, level, points):
    rows = [] if kind in {"movement", "none", "tracking"} else [attempt(
        "H3", "partial" if kind == "partial" else "full",
        assist=kind if kind in {"helper", "self"} else None, detected=("wrist_bend",),
    )]
    result = task_level(ladder("H3", rows, movement_seen=kind == "movement", measured=kind != "tracking"))
    assert (result["level"], result["points"]) == (level, points)


def test_failed_pinch_and_claimed_best_summary_cannot_earn_full_marks():
    result = task_level(ladder("H3", [attempt("H3", completed=False)], best_alone="full"))
    assert result["points"] == 0 and result["best_alone"] is None


def test_pinch_full_points_are_used_by_hand_total_and_daily_activity_results():
    rows = [ladder("T1"), ladder("T3"), ladder("H4"),
            ladder("H3", [attempt("H3", detected=("wrist_bend",))])]
    result = score_function_assessment(rows)
    assert result["areas"]["hand"]["score"] == result["total"] == 100
    dressing = next(row for row in result["daily_activities"] if row["activity"] == "Dressing")
    assert dressing["level"] == 4


def test_independent_partial_beats_assisted_full_and_stretch_does_not_add_points():
    result = task_level(ladder("T1", [attempt("T1", "r120"), attempt("T1", assist="helper")], stretch_completed=True))
    assert result["level"] == 2
    assert result["best_alone"] == "r120" and result["best_assisted"] == "r160"
    assert task_level(ladder("T1", stretch_completed=True))["points"] == 100


@pytest.mark.parametrize("assist,level", [(None, 2), ("helper", 1)])
def test_compensation_remains_coaching_evidence_without_reducing_lower_levels(assist, level):
    result = task_level(ladder("T1", [attempt("T1", "r120", assist=assist, detected=("trunk_lean",))]))
    assert result["level"] == level and result["compensations"]["trunk_lean"] == "detected"


def test_failed_attempt_and_unverified_best_summary_never_count_as_completion():
    result = task_level(ladder("T1", [attempt("T1", completed=False)], best_alone="r160"))
    assert result["level"] == 0 and result["best_alone"] is None


@pytest.mark.parametrize("rungs", [["r80", "r120", "r160"], ["r40", "r70", "r100"], ["r40", "r55", "r70", "r85", "r100"]])
def test_three_height_and_historical_five_height_records_keep_their_scores(rungs):
    for rung in rungs:
        task = ladder("T1", [attempt("T1", rung)], rungs=rungs, full_rung=rungs[-1])
        before = deepcopy(task)
        result = task_level(task)
        assert result["level"] == (4 if rung == rungs[-1] else 2)
        assert result["best_alone"] == rung
        assert task == before


def test_confirmed_help_is_required_and_hand_positioning_support_is_not_help():
    task = ladder("H4")
    task["metrics"]["positioning_support"] = "other_hand"
    assert task_level(task)["level"] == 4
    task["metrics"]["ladder"]["attempts"][0]["assist"] = "self"
    assert task_level(task)["level"] == 1


def test_clean_full_attempt_takes_precedence_over_an_earlier_compensated_attempt():
    result = task_level(ladder("T1", [attempt("T1", detected=("trunk_lean",)), attempt("T1")]))
    assert result["level"] == 4 and result["compensations"]["trunk_lean"] == "not_detected"


def test_any_movement_and_no_movement_have_distinct_reasons_and_labels():
    movement = task_level(ladder("T1", [], movement_seen=True))
    still = task_level(ladder("T1", []))
    assert (movement["reason"], movement["label"]) == ("movement_seen", "Getting started")
    assert (still["reason"], still["label"]) == ("no_movement_seen", "Not yet")


def test_unknown_task_is_not_guessed_from_an_arbitrary_completed_step():
    task = {"task_id": "T7", "steps": [{"step_id": "T7-S2", "completed": True}]}
    result = task_level(task)
    assert result["points"] is None and result["reason"] == "unsupported_task"


@pytest.mark.parametrize("change,reason", [
    ({"version": "future"}, "unsupported_ladder"),
    ({"rungs": ["easy"]}, "invalid_rung_evidence"),
    ({"full_rung": "r80"}, "invalid_rung_evidence"),
    ({"attempts": "bad"}, "invalid_attempt_evidence"),
    ({"attempts": [{"rung": "r160", "completed": True}]}, "invalid_attempt_evidence"),
    ({"attempts": [attempt("T1", assist="unknown")]}, "invalid_attempt_evidence"),
    ({"attempts": [attempt("T1", rung="overhead")]}, "invalid_attempt_evidence"),
    ({"attempts": [attempt("T1", rung="r55")]}, "invalid_attempt_evidence"),
    ({"attempts": [attempt("T1", rung="r85")]}, "invalid_attempt_evidence"),
])
def test_invalid_ladder_is_unmeasured_not_zero_or_full_credit(change, reason):
    result = task_level(ladder("T1", **change))
    assert result["level"] is None and result["points"] is None and result["reason"] == reason


def test_missing_or_malformed_posture_status_never_means_clean():
    row = attempt("T3")
    row["compensations"] = {"trunk_lean": "not_detected", "head_drop": {"status": "not_detected"}}
    result = task_level(ladder("T3", [row]))
    assert result["level"] == 3
    assert result["unmeasured_compensations"] == ["shoulder_hike", "head_drop"]


@pytest.mark.parametrize("tid", ["T1", "T2", "T3", "H1", "H3", "H4"])
def test_legacy_main_steps_and_all_branches(tid):
    assert level_from_legacy(legacy(tid))["level"] == 4
    assert level_from_legacy(legacy(tid, detected=("shoulder_hike",)))["level"] == 3
    assert level_from_legacy(legacy(tid, unmeasured=("trunk_lean",)))["level"] == 3
    assert level_from_legacy(legacy(tid, complete=(f"{tid}-S1",)))["level"] == 2
    assert level_from_legacy(legacy(tid, assisted=True))["level"] == 1
    assert level_from_legacy(legacy(tid, complete=()))["level"] == 0
    assert level_from_legacy(legacy(tid, complete=(), assisted=True))["level"] == 0
    assert level_from_legacy(legacy(tid))["derived"] is True


@pytest.mark.parametrize("duration,level", [(499, 4), (500, 3), (501, 3)])
def test_legacy_reuses_existing_sustained_compensation_rule(duration, level):
    assert level_from_legacy(legacy("T3", detected=("head_drop",), duration=duration))["level"] == level


def test_legacy_compensation_during_earlier_movement_counts():
    task = legacy("T1")
    task["steps"][0]["metrics"]["quality"]["compensations"]["shoulder_hike"].update(max_value=40, max_streak_ms=600)
    assert level_from_legacy(task)["level"] == 3


def test_legacy_completion_without_posture_is_level_three_even_without_angles():
    task = legacy("T3")
    for step in task["steps"]:
        step["metrics"] = {}
    result = level_from_legacy(task)
    assert result["level"] == 3
    assert result["reason"] == "full_rung_alone_posture_unobserved"


def test_angle_attainment_and_effort_or_pain_do_not_change_function_points():
    task = legacy("T1")
    task["metrics"].update(effort="hard", pain="yes")
    task["steps"][1]["metrics"]["quality"]["measurements"] = {"arm_elevation": {"value": 1, "samples": 10}}
    assert level_from_legacy(task)["points"] == 100


def test_legacy_return_only_and_missing_steps_are_not_false_ability():
    task = legacy("T1", complete=())
    task["steps"].append({"step_id": "T1-S4", "completed": True})
    assert level_from_legacy(task)["level"] is None
    task.update(steps=[], completed_steps=4)
    assert level_from_legacy(task)["reason"] == "missing_step_evidence"


def test_legacy_explicit_tracking_problem_is_not_zero():
    task = legacy("T1", complete=())
    task["metrics"]["measured"] = False
    assert level_from_legacy(task)["points"] is None


@pytest.mark.parametrize("score", [None, True, float("nan"), float("inf"), -1, 101, "60"])
def test_invalid_gait_values_are_excluded(score):
    assert task_level(gait(score))["points"] is None


def test_walking_stays_continuous_and_requires_a_scored_analysis():
    assert task_level(gait(63.7))["points"] == 63.7
    assert task_level(gait(63.7))["level"] is None
    assert task_level(gait(100, status="pending"))["points"] is None
    assert task_level(gait(100, skipped=True))["points"] is None
    assert task_level(gait(0))["points"] == 0


def test_missing_assigned_task_makes_area_partial_without_inventing_zero():
    result = score_function_assessment([ladder("T1")], assigned_task_ids=["T1", "T3", "H4"])
    assert result["areas"]["upper_limb"]["score"] == 100
    assert result["areas"]["upper_limb"]["partial"] is True
    assert result["areas"]["hand"]["score"] is None
    assert result["total"] == 100
    assert result["daily_activities"][0]["status"] == "estimated"
    assert result["tasks"][1]["reason"] == "task_missing"


def test_all_unmeasured_and_empty_assessments_have_no_total():
    assert score_function_assessment([])["total"] is None
    result = score_function_assessment([ladder("T1", measured=False), gait(None)])
    assert result["total"] is None and result["display_total"] is None
    assert all(area["score"] is None for area in result["areas"].values())


def test_daily_activity_helper_treats_absent_assigned_rows_as_estimated():
    rows = daily_activity_levels([task_level(ladder("T3"))], ["T3", "H4"])
    assert rows[0]["status"] == "estimated" and rows[0]["level"] is None


def test_assigned_zero_still_counts_and_unassigned_area_does_not_limit_daily_life():
    result = score_function_assessment([ladder("T1", []), ladder("T3")])
    assert result["total"] == 50
    assert result["daily_activities"][0]["level"] == 4
    assert result["daily_activities"][1]["level"] == 0
    assert result["daily_activities"][3]["status"] == "not_assessed"


def test_supplied_but_unassigned_tasks_do_not_change_scores():
    result = score_function_assessment([ladder("T1"), ladder("T3", [])], assigned_task_ids=["T1"])
    assert result["total"] == 100 and len(result["tasks"]) == 1


def test_round_half_up_and_no_double_rounding():
    assert round_score(Decimal("56.25")) == 56.3
    assert round_score(Decimal("62.5"), display=True) == 63
    assert round_score(Decimal("49.45"), display=True) == 49
    result = score_function_assessment([ladder("T1", [attempt("T1", "r80")]), gait(48.9)])
    assert result["total"] == 49.5 and result["display_total"] == 49
    assert round_score(None) is None


def test_comparison_uses_shared_core_tasks_not_removed_legacy_tasks():
    baseline = score_function_assessment([legacy("T1", complete=("T1-S1",)), legacy("T2", complete=()), legacy("T3")])
    current = score_function_assessment([ladder("T1", [attempt("T1", "r100")],
        rungs=["r40", "r70", "r100"], full_rung="r100"), ladder("T3")], baseline=baseline)
    comparison = current["comparison"]
    assert comparison["task_ids"] == ["T1", "T3"]
    assert comparison["total_comparable"] is True and comparison["total_change"] == 25


def test_different_scored_areas_only_compare_area_by_area():
    old = score_function_assessment([ladder("T1"), gait(60)])
    new = score_function_assessment([ladder("T1"), ladder("H4"), gait(70)])
    comparison = compare_function_scores(new, old)
    assert comparison["total_change"] is None and comparison["total_comparable"] is False
    assert comparison["areas"]["lower_limb"]["change"] == 10
    assert "hand" not in comparison["areas"]


def test_no_common_tasks_cannot_produce_a_total_change():
    assert compare_function_scores(score_function_assessment([ladder("T1")]),
                                   score_function_assessment([ladder("T3")]))["total_change"] is None


def test_new_reach_benchmark_does_not_report_old_target_scores_as_recovery_change():
    old = score_function_assessment([ladder("T1", [attempt("T1", "r100")],
        rungs=["r40", "r70", "r100"], full_rung="r100"), ladder("T3")])
    new = score_function_assessment([ladder("T1"), ladder("T3")])
    for historic_has_benchmark in [True, False]:
        if not historic_has_benchmark:
            old["tasks"][0].pop("full_rung")
        comparison = compare_function_scores(new, old)
        assert comparison["task_ids"] == ["T3"]
        assert comparison["total_comparable"] is False
        assert comparison["total_change"] is None


def test_patient_labels_coaching_and_nonclinical_flags():
    row = task_level(ladder("T3", [attempt("T3", detected=("trunk_lean", "shoulder_hike", "head_drop"))]))
    assert "leaning forward" in row["next_step"] and "lifting your shoulder" in row["next_step"]
    assert "bringing your head to your hand" in row["next_step"]
    result = score_function_assessment([ladder("T1", [attempt("T1", "r120")])])
    assert result["tasks"][0]["next_step"].startswith("Good effort")
    assert "highest target wasn’t completed" in result["tasks"][0]["next_step"]
    assert result["tasks"][0]["next_step"].endswith("Next: one circle higher.")
    assert all(item["clinical_measure"] is False for item in result["tasks"] + result["daily_activities"])
    assert all(item["clinical_measure"] is False for item in result["areas"].values())
    assert "fail" not in json.dumps(result).lower()


def test_scoring_is_deterministic_and_never_mutates_input():
    rows = [legacy("T1"), ladder("T3"), gait()]
    before = deepcopy(rows)
    result = score_function_assessment(rows)
    assert result == score_function_assessment(rows)
    assert rows == before


def test_backend_returns_both_scores_and_backfills_legacy_without_changing_saved_metrics():
    from backend import server
    task = legacy("T1")
    previous = {"function_score": {"version": "obsolete", "total": 5}, "retained": "value"}
    before = deepcopy(previous)
    metrics = server.build_functional_metrics([task], ["T1"])
    assert metrics["task_quality"] == server.score_assessment([task], server.ASSESSMENT_RUBRICS, ["T1"])
    assert metrics["function_score"]["total"] == 100
    normalized = server._functional_metrics_with_survey_mobility(previous, [task], ["T1"], {})
    assert normalized["function_score"]["version"] == VERSION
    assert normalized["function_score"]["tasks"][0]["derived"] is True
    assert normalized["retained"] == "value" and previous == before


def test_preview_api_returns_ladder_and_legacy_levels_without_database_access(monkeypatch):
    from backend import server
    from backend.tests.test_local_assessment_preview import request
    class NoDatabase:
        def __getattr__(self, name):
            raise AssertionError("Function-score preview must not access storage")
    monkeypatch.setenv("REHYN_LOCAL_ASSESSMENT_PREVIEW", "1")
    monkeypatch.delenv("RENDER", raising=False)
    monkeypatch.setattr(server, "db", NoDatabase())
    tasks = [ladder("T1", [attempt("T1", "r120")]), legacy("T3")]
    payload = server.AssessmentSubmit(assessment_package="initial", assigned_task_ids=["T1", "T3"], task_results=tasks)
    result = asyncio.run(server.preview_assessment_results(payload, request()))
    assert result["preview_only"] and not result["saved_to_assessment"]
    score = result["metrics"]["function_score"]
    assert score["total"] == 75
    assert [row["derived"] for row in score["tasks"]] == [False, True]
    assert result["metrics"]["task_quality"] == server.score_assessment(payload.task_results, server.ASSESSMENT_RUBRICS, ["T1", "T3"])

@pytest.mark.parametrize('kind,opening,detail', [
    ('compensated', 'Well done', 'leaning forward'),
    ('unobserved', 'Well done', 'posture wasn’t clear'),
    ('partial', 'Good effort', 'highest target wasn’t completed'),
    ('help', 'Good effort', 'with help'),
    ('movement', 'Good effort', 'target wasn’t completed'),
    ('none', 'Thank you', 'did not record a completed movement'),
    ('tracking', 'Thank you', 'couldn’t measure'),
])
def test_partial_result_explains_recorded_reason_after_encouragement(kind, opening, detail):
    rows = [] if kind in {'movement', 'none', 'tracking'} else [attempt(
        'T1', 'r120' if kind == 'partial' else None,
        assist='helper' if kind == 'help' else None,
        detected=('trunk_lean',) if kind == 'compensated' else (),
        unmeasured=POSTURE_CHECKS['T1'] if kind == 'unobserved' else (),
    )]
    result = task_level(ladder('T1', rows, movement_seen=kind == 'movement', measured=kind != 'tracking'))
    assert result['next_step'].startswith(opening)
    assert detail in result['next_step']
    if kind not in {'compensated'}:
        assert 'leaning forward' not in result['next_step']
