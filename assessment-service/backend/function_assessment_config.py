"""Function-ladder routing and read-time history; no stored record mutations."""
from copy import deepcopy
import os

try:
    from .function_scoring import LEGACY_REACH_RUNGS, TASK_RUNGS, compare_function_scores
except ImportError:
    from function_scoring import LEGACY_REACH_RUNGS, TASK_RUNGS, compare_function_scores


def function_ladder_enabled():
    return os.getenv("FUNCTION_LADDER_ENABLED", "0").lower() in {"1", "true", "yes"}


def ladder_runner_config(profile, history=()):
    arm = profile.get("affected_arm_movement")
    start = {"T1": "r160" if arm == "most_movements" else "r120" if arm == "some_movement" else "r80",
             "T3": "chest" if arm == "help_only" else "mouth", "H4": "full", "H3": "full"}
    # Missing/unmeasured results do not invent an earlier rung.
    for record in sorted(history, key=lambda row: row.get("created_at", ""), reverse=True)[:1]:
        score = (record.get("metrics") or {}).get("function_score") or {}
        for task in score.get("tasks", []):
            tid = task.get("task_id")
            rungs = TASK_RUNGS.get(tid, ())
            best = task.get("best_alone") or task.get("best_assisted")
            if tid == "T1" and best in LEGACY_REACH_RUNGS:
                # All previous ladder heights are below the new middle target.
                start[tid] = rungs[0]
            elif best in rungs:
                start[tid] = rungs[max(0, rungs.index(best) - 1)]
    helper = profile.get("has_caregiver")
    if helper is None:
        helper = profile.get("has_helper")
    priorities = profile.get("patient_priorities") or []
    if isinstance(priorities, str):
        priorities = [priorities]
    return {"enabled": function_ladder_enabled(), "start_rung": start,
            "helper": "0" if helper is False or str(helper).lower() in {"no", "false", "0"} else "ask",
            "main_goal": profile.get("primary_goal") or next(iter(priorities), ""),
            "walking_helper": profile.get("mobility_level") == "person_assist", "clinical_measure": False}


def with_function_history(record, history):
    result = deepcopy(record)
    score = (result.get("metrics") or {}).get("function_score")
    earlier = sorted((row for row in history if row.get("id") != record.get("id")
                      and row.get("created_at", "") < record.get("created_at", "")),
                     key=lambda row: row.get("created_at", ""))
    if not score or not earlier:
        return result
    baseline = (earlier[0].get("metrics") or {}).get("function_score")
    previous = (earlier[-1].get("metrics") or {}).get("function_score")
    if baseline:
        score["comparison"] = compare_function_scores(score, baseline)
    if previous:
        reach = next((task for task in previous.get("tasks", []) if task.get("task_id") == "T1"), None)
        if reach:
            score["previous_reach"] = {key: reach.get(key) for key in ("best_alone", "best_assisted")}
    return result
