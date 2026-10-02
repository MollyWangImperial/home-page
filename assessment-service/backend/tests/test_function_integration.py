from copy import deepcopy
import asyncio
import os
import pytest

os.environ.setdefault('MONGO_URL', 'mongodb://127.0.0.1:27017')
os.environ.setdefault('DB_NAME', 'rehyn_test')

from backend.function_assessment_config import ladder_runner_config, with_function_history
from backend.function_scoring import score_function_assessment
from backend.function_rehab_plan import select_function_exercises
from backend.daily_activity_metrics import build_daily_activity_metrics


def row(tid, level, **extra):
    return dict(task_id=tid, task_label=tid, level=level, points=None if level is None else level*25,
                domain='hand' if tid.startswith('H') else 'upper_limb', **extra)


def test_flag_defaults_off_and_followup_starts_below_last_best(monkeypatch):
    monkeypatch.delenv('FUNCTION_LADDER_ENABLED', raising=False)
    profile = {'affected_arm_movement': 'some_movement', 'has_caregiver': False}
    assert ladder_runner_config(profile)['enabled'] is False
    assert ladder_runner_config(profile)['helper'] == '0'
    monkeypatch.setenv('FUNCTION_LADDER_ENABLED', '1')
    history = [{'created_at':'2026-09-02', 'metrics': {'function_score': {'tasks': [row('T1', 2, best_alone='r120'), row('H4', 4, best_alone='full')]}}}]
    result = ladder_runner_config(profile, history)
    assert result['enabled'] is True
    assert result['start_rung'] == {'T1':'r80','T3':'mouth','H4':'partial','H3':'full'}


@pytest.mark.parametrize('previous,start', [('r40','r80'), ('r55','r80'), ('r70','r80'), ('r85','r80'), ('r100','r80'), ('r80','r80'), ('r120','r80'), ('r160','r120')])
@pytest.mark.parametrize('best_field', ['best_alone', 'best_assisted'])
def test_followup_uses_three_heights_with_old_or_new_reach_history(previous, start, best_field):
    history = [{'metrics': {'function_score': {'tasks': [row('T1', 2, **{best_field: previous})]}}}]
    before = deepcopy(history)
    assert ladder_runner_config({'affected_arm_movement':'most_movements'}, history)['start_rung']['T1'] == start
    assert history == before


def test_missing_previous_rung_retains_survey_start():
    config=ladder_runner_config({'affected_arm_movement':'help_only'}, [{'metrics':{'function_score':{'tasks':[row('T1',None)]}}}])
    assert config['start_rung']['T1']=='r80'
    assert config['start_rung']['T3']=='chest'


def test_history_is_derived_without_mutating_records():
    old=score_function_assessment([], assigned_task_ids=['T1'])
    new=score_function_assessment([], assigned_task_ids=['T1','H4'])
    baseline={'id':'a','created_at':'2026-01-01','metrics':{'function_score':old}}
    current={'id':'b','created_at':'2026-02-01','metrics':{'function_score':new}}
    before=deepcopy(current)
    result=with_function_history(current,[baseline,current])
    assert current==before
    assert result['metrics']['function_score']['comparison']['total_comparable'] is False


def test_plan_uses_two_lowest_goal_and_success_without_duplicate_exercises():
    score={'tasks':[row('T1',2,best_alone='r120'),row('T3',3,compensations={'shoulder_hike':'detected'}),row('H4',4),row('H3',4)]}
    plan=select_function_exercises(score,{'primary_goal':'Eating'},lambda *_:True)
    assert [item['code'] for item in plan['exercises']]==['REACH_INCOMPLETE','SHOULDER_HIKE','PINCH_IMPAIRED']
    assert plan['exercises'][0]['target_rung']=='r120'
    assert plan['exercises'][0]['difficulty']=='easy'
    assert plan['exercises'][1]['selection_slots']==['building','goal']
    assert all(item['clinical_measure'] is False for item in plan['exercises'])


def test_unmeasured_tasks_do_not_become_lowest_and_eligibility_is_enforced():
    score={'tasks':[row('T1',None),row('T3',3),row('H4',2)]}
    plan=select_function_exercises(score,{},lambda code,_:code=='H2M_IMPAIRED')
    assert [item['source_task'] for item in plan['exercises']]==['T3']
    assert plan['caregiver_domains']==[]


def test_supported_levels_route_to_existing_caregiver_domains():
    plan=select_function_exercises({'tasks':[row('T1',0),row('H4',1)]},{},lambda *_:True)
    assert plan['exercises']==[]
    assert plan['caregiver_domains']==['upper_limb','hand']


def test_daily_life_uses_weakest_link_and_missing_evidence_remains_unscored():
    score=score_function_assessment([],assigned_task_ids=['T1','T3','H4','H3'])
    report=build_daily_activity_metrics([{'function_score':score}],{'affected_arm_movement':'most_movements'})
    assert all(row['score'] is None for row in report['activities'])
    assert report['activities'][0]['status']=='estimated'


def test_config_endpoint_auth_and_package_order(monkeypatch):
    from fastapi import HTTPException
    from starlette.requests import Request
    from backend import server
    async def no_user(_): return None
    monkeypatch.setattr(server,'_user_from_header',no_user)
    try:
        asyncio.run(server.get_function_ladder_config(Request({'type':'http','headers':[]})))
        assert False, 'Anonymous configuration must be rejected'
    except HTTPException as error:
        assert error.status_code==401
    assert server._validated_assigned_task_ids('functional',['H3','T3','H4','T1','L6'])==['T1','T3','H4','H3','L6']
    assert any(task['id']=='T2' for task in server.TASKS_DATA)
    assert any(task['id']=='H1' for task in server.HAND_TASKS_DATA)


def test_level_plan_preserves_existing_safety_block_and_stops_for_reported_pain(monkeypatch):
    from backend import server
    monkeypatch.setenv('FUNCTION_LADDER_ENABLED','1')
    doc={'patient_parameters':{'sitting_ability':'independent','affected_arm_movement':'some_movement','affected_hand_movement':'some_finger_movement'},
         'metrics':{'function_score':{'tasks':[row('T1',2,best_alone='r120')]}},
         'task_results':[], 'clinical_review_gate':{'rehab_access':'blocked','status':'therapist_confirmation_required'}}
    result=server._apply_function_rehab_policy(doc)
    assert result['clinical_review_gate']['rehab_access']=='blocked'
    assert result['rehab_plan'][0]['target_rung']=='r120'
    doc['task_results']=[{'task_id':'T1','metrics':{'pain':'yes'}}]
    result=server._apply_function_rehab_policy(doc)
    assert result['rehab_plan']==[]
    assert result['function_rehab_plan']['caregiver_domains']==[]


def test_testing_accepts_ladder_evidence_without_saving(monkeypatch):
    from backend import server
    from backend.tests.test_function_scoring import ladder, attempt
    from starlette.requests import Request
    async def user(_): return {'id':'ladder-test'}
    class NoDatabase:
        def __getattr__(self, _): raise AssertionError('Testing must not save a patient record')
    monkeypatch.setattr(server,'_user_from_header',user)
    monkeypatch.setattr(server,'db',NoDatabase())
    data=ladder('T1',[attempt('T1','r120')])
    data['steps']=[{'step_id':'T1-R1','completed':True,'duration_ms':3000}]
    report=asyncio.run(server.get_testing_assessment_score(server.TaskResult(**data),Request({'type':'http','headers':[]})))
    assert report['function_score']['tasks'][0]['level']==2
    assert report['recorded'] is False


def test_core_followup_keeps_all_affected_areas_and_caregiver_plan(monkeypatch):
    from backend.tests.test_alira_care_orchestrator import ready_profile, assessment, NOW
    from backend.alira_care_orchestrator import build_adaptive_care_plan
    record=assessment(days_ago=60)
    record['function_rehab_plan']={'caregiver_domains':['upper_limb','hand']}
    plan=build_adaptive_care_plan(ready_profile(),[record],[],now=NOW)
    assert plan['assessment']['task_ids']==['T1','T3','H4','H3','L6']
    assert {item['domain'] for item in plan['caregiver_plan']['programmes']}=={'upper_limb','hand'}


def test_ladder_submit_and_read_roundtrip_preserves_evidence_and_level_plan(monkeypatch):
    """Exercise real submit/read handlers with an isolated in-memory patient store."""
    from types import SimpleNamespace
    from starlette.requests import Request
    from backend import server
    from backend.tests.test_alira_care_orchestrator import ready_profile
    from backend.tests.test_function_scoring import ladder, attempt

    saved = []
    user = {'id': 'function-roundtrip-only', 'consent': {'health_data_consent': True},
            'profile': ready_profile(affected_areas=['right_upper'], mobility_level='wheelchair')}

    class Collection:
        async def insert_one(self, doc):
            saved.append(deepcopy(doc))

        async def find_one(self, query, projection=None):
            return next((deepcopy(doc) for doc in saved if all(doc.get(k) == v for k, v in query.items())), None)

    async def get_user(_): return user
    async def history(_): return deepcopy(saved)
    async def no_videos(*_): return {}
    async def no_side_effects(*_): pass
    def reject_local_fallback(*_): raise AssertionError('The test store should accept the assessment')

    monkeypatch.setenv('FUNCTION_LADDER_ENABLED', '1')
    monkeypatch.setattr(server, 'db', SimpleNamespace(assessments=Collection()))
    monkeypatch.setattr(server, '_user_from_header', get_user)
    monkeypatch.setattr(server, '_care_assessments_for_user', history)
    monkeypatch.setattr(server, '_latest_task_videos', no_videos)
    monkeypatch.setattr(server, 'consume_credits', no_side_effects)
    monkeypatch.setattr(server, '_record_initial_assessment_completion', no_side_effects)
    monkeypatch.setattr(server, '_mark_functional_issue_assessed', no_side_effects)
    monkeypatch.setattr(server, '_record_alira_action', lambda *_, **__: None)
    monkeypatch.setattr(server, '_queue_assessment_for_mongodb_sync', reject_local_fallback)
    monkeypatch.setattr(server, '_local_assessment', lambda *_: None)
    monkeypatch.setattr(server, 'LOCAL_GPU_WORKER_URL', '')

    rows = [ladder('T1', [attempt('T1', 'r120')]), ladder('T3'), ladder('H4'), ladder('H3')]
    for data in rows:
        data.update(completed_steps=1, total_steps=1, duration_ms=5200)
        data['steps'] = [{'step_id': data['task_id']+'-R1', 'completed': True, 'duration_ms': 5200}]
        data['metrics'].update(effort='OK', pain='no')
    request = Request({'type': 'http', 'headers': []})
    payload = server.AssessmentSubmit(assessment_package='initial', assigned_task_ids=['T1','T3','H4','H3'],
                                      task_results=rows)
    submitted = asyncio.run(server.submit_assessment(payload, request))
    before_read = deepcopy(saved)
    loaded = asyncio.run(server.get_assessment(submitted.id, request))

    assert len(saved) == 1
    assert saved == before_read, 'Derived score/history reads must not rewrite saved records'
    assert [task.metrics['ladder'] for task in loaded.task_results] == [row['metrics']['ladder'] for row in rows]
    assert [task['level'] for task in loaded.metrics['function_score']['tasks']] == [2,4,4,4]
    assert loaded.metrics['function_score']['clinical_measure'] is False
    assert 'task_quality' in loaded.metrics
    assert loaded.function_rehab_plan == submitted.function_rehab_plan
    assert any(exercise.target_rung == 'r120' and exercise.difficulty == 'easy' for exercise in loaded.rehab_plan)


def test_later_model_results_keep_the_ladder_plan(monkeypatch):
    from types import SimpleNamespace
    from starlette.requests import Request
    from backend import server
    from backend.tests.test_alira_care_orchestrator import ready_profile
    from backend.tests.test_function_scoring import ladder, attempt

    rows = [ladder('T1', [attempt('T1', 'r120')])]
    doc = {'id':'ladder-model-only', 'user_id':'ladder-test', 'affected_side':'right',
           'assessment_package':'upper_limb', 'assigned_task_ids':['T1'], 'task_results':rows,
           'patient_parameters':ready_profile(), 'functional_issues':[],
           'metrics':{'function_score':score_function_assessment(rows)},
           'model_analysis':{'tasks':[{'task_id':'T1','video_id':'synthetic-video'}]}}
    updates = {}
    class Collection:
        async def find_one(self, *_): return deepcopy(doc)
        async def update_one(self, query, update): updates.update(deepcopy(update['$set']))
    monkeypatch.setattr(server, 'db', SimpleNamespace(assessments=Collection()))
    monkeypatch.setattr(server, 'ANALYSIS_WORKER_TOKEN', 'synthetic-worker-token')
    monkeypatch.setattr(server, '_record_alira_action', lambda *_, **__: None)
    monkeypatch.delenv('FUNCTION_LADDER_ENABLED', raising=False)  # The saved evidence keeps its policy.
    payload = server.ModelResultSubmit(status='completed', per_task=[{
        'task_id':'T1', 'quality':{'kinematics_valid':True, 'model_scaled':True,
                                 'external_loads_valid':True, 'residuals_within_threshold':True},
        'external_load_method':'gravity_only_seated_no_external_object',
        'muscle_activations':{'anterior_deltoid':{'mean':0.3,'peak':0.6}},
        'functional_findings':[],
        'provenance':{'solver':'OpenSim MocoInverse','model_version':'upper-extremity-1.0',
                      'source_video_id':'synthetic-video','code_version':'test'}
    }])
    request = Request({'type':'http','headers':[(b'x-analysis-worker-token',b'synthetic-worker-token')]})
    result = asyncio.run(server.save_model_results(doc['id'], payload, request))
    assert result['status'] == 'completed'
    assert updates['clinical_review_gate']['rehab_plan_source'] == 'function_levels'
    assert [exercise['id'] for exercise in updates['rehab_plan']] == ['ex_reach']
    assert updates['rehab_plan'][0]['target_rung'] == 'r120'
    assert updates['function_rehab_plan']['clinical_measure'] is False
    assert 'task_results' not in updates
