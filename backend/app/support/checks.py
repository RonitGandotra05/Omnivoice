"""Tenant-owned deterministic knowledge regression checks, independent of voice providers."""
import asyncio
import hashlib
import json
import unicodedata
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession
from app.config.database import get_db
from app.models.models import Company
from app.support.api import tenant, profile_for, documents_for
from app.support.models import SupportCheckSuite
from app.support.service import answer, voice_prompt, prepared_passages
from app.config.settings import get_settings

router = APIRouter()


def normalized(value):
    return ' '.join(unicodedata.normalize('NFKC', value).casefold().split())


class CheckCase(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    query: str = Field(min_length=2, max_length=2000)
    expect_escalation: bool = False
    expected_phrases: list[str] = Field(default_factory=list, max_length=5)
    expected_document: str | None = Field(default=None, max_length=255)
    expected_team: str | None = Field(default=None, max_length=80)

    @field_validator('name', 'query')
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError('Check name and question must contain text.')
        return value.strip()

    @field_validator('expected_phrases')
    @classmethod
    def phrases(cls, values):
        if any(not value.strip() or len(value) > 200 for value in values):
            raise ValueError('Use non-empty expected phrases of at most 200 characters.')
        return list(dict.fromkeys(value.strip() for value in values))

    @model_validator(mode='after')
    def meaningful_expectation(self):
        if not self.expect_escalation and not (self.expected_phrases or self.expected_document):
            raise ValueError('An answer check needs an expected phrase or source document.')
        if self.expected_team and not self.expect_escalation:
            raise ValueError('A team expectation requires an escalation check.')
        return self


class CheckSuite(BaseModel):
    cases: list[CheckCase] = Field(default_factory=list, max_length=25)

    @field_validator('cases')
    @classmethod
    def unique_names(cls, values):
        if len({normalized(item.name) for item in values}) != len(values):
            raise ValueError('Check names must be unique.')
        return values


def evaluate(profile, documents, cases):
    results = []
    prepared = list(prepared_passages(documents)) if cases else []
    for case in cases:
        outcome = answer(case.query, profile, documents, prepared)
        reasons = []
        if outcome['needs_escalation'] != case.expect_escalation:
            reasons.append('Expected a human handoff.' if case.expect_escalation else 'Expected a grounded answer.')
        if not case.expect_escalation and not outcome['sources']:
            reasons.append('No supporting source was found.')
        if any(normalized(phrase) not in normalized(outcome['response']) for phrase in case.expected_phrases):
            reasons.append('An expected answer phrase was missing.')
        if case.expected_document and not any(normalized(source['document']) == normalized(case.expected_document) for source in outcome['sources']):
            reasons.append('The expected source document was not used.')
        if case.expected_team and normalized((outcome.get('routing') or {}).get('team', '')) != normalized(case.expected_team):
            reasons.append('The handoff reached a different team.')
        results.append({'name': case.name, 'status': 'failed' if reasons else 'passed', 'reasons': reasons,
            'response': outcome['response'], 'sources': [s['document'] for s in outcome['sources']],
            'needs_escalation': outcome['needs_escalation'], 'team': (outcome.get('routing') or {}).get('team')})
    passed = sum(item['status'] == 'passed' for item in results)
    return {'status': 'not_run' if not cases else 'passed' if passed == len(cases) else 'failed',
        'passed': passed, 'failed': len(cases) - passed, 'total': len(cases), 'results': results,
        'scope': 'local_document_search', 'voice_tested': False}


_evaluation_loop = None
_evaluation_slot = None
_running_evaluations = set()


async def evaluate_limited(profile, documents, cases):
    global _evaluation_loop, _evaluation_slot
    loop = asyncio.get_running_loop()
    if _evaluation_loop is not loop:
        _evaluation_loop, _evaluation_slot = loop, asyncio.Semaphore(1)
    slot = _evaluation_slot
    try:
        await asyncio.wait_for(slot.acquire(), 1)
    except TimeoutError:
        raise HTTPException(429, 'Knowledge checks are busy. Retry shortly.', headers={'Retry-After': '3'})
    task = asyncio.create_task(asyncio.to_thread(evaluate, profile, documents, cases))
    _running_evaluations.add(task)
    def finished(done):
        slot.release()
        _running_evaluations.discard(done)
        if not done.cancelled():
            done.exception()
    task.add_done_callback(finished)
    try:
        # A timed-out/cancelled request cannot release its slot while the thread runs.
        return await asyncio.wait_for(asyncio.shield(task), 60)
    except TimeoutError:
        raise HTTPException(503, 'Knowledge checks exceeded the time limit. Reduce the suite and retry.')


async def workspace_revision(company, db):
    profile = await profile_for(company, db)
    documents = await documents_for(company.id, db)
    suite = await db.get(SupportCheckSuite, company.id)
    snapshot = {'profile': profile.model_dump(), 'documents': sorted((str(d.id), d.name, d.content) for d in documents),
        'cases': suite.cases if suite else [], 'prompt': voice_prompt(profile),
        'agent': get_settings().elevenlabs_company_agents.get(str(company.id)),
        'embedding_model': get_settings().rag_embedding_model}
    return hashlib.sha256(json.dumps(snapshot, sort_keys=True).encode()).hexdigest()


async def run_checks(company, db):
    before = await workspace_revision(company, db)
    suite = await db.get(SupportCheckSuite, company.id)
    cases = CheckSuite(cases=suite.cases if suite else []).cases
    report = await evaluate_limited(await profile_for(company, db), await documents_for(company.id, db), cases)
    after = await workspace_revision(company, db)
    report.update(revision=before, checked_at=datetime.now(timezone.utc).isoformat(), stale=before != after)
    if before != after:
        report['status'] = 'stale'
    return report


async def publication_gate(company, db):
    report = await run_checks(company, db)
    if report['status'] not in ('passed', 'not_run'):
        raise HTTPException(409, 'Saved knowledge checks failed. Update the documents or checks, then run them again before publishing.')
    return report


@router.get('/{company_id}/checks')
async def get_checks(company: Company = Depends(tenant), db: AsyncSession = Depends(get_db)):
    suite = await db.get(SupportCheckSuite, company.id)
    report = dict(suite.last_report or {}) if suite else {}
    current = await workspace_revision(company, db)
    if report and report.get('revision') != current:
        report['stale'] = True
    return {'cases': suite.cases if suite else [], 'report': report}


@router.put('/{company_id}/checks')
async def save_checks(body: CheckSuite, company: Company = Depends(tenant), db: AsyncSession = Depends(get_db)):
    await db.execute(update(Company).where(Company.id == company.id).values(updated_at=Company.updated_at))
    suite = await db.get(SupportCheckSuite, company.id)
    if suite is None:
        suite = SupportCheckSuite(company_id=company.id)
        db.add(suite)
    suite.cases, suite.last_report = [case.model_dump() for case in body.cases], {}
    await db.flush()
    return {'cases': suite.cases, 'report': {}}


@router.post('/{company_id}/checks/run')
async def execute_checks(company: Company = Depends(tenant), db: AsyncSession = Depends(get_db)):
    # Serialize edits to keep the saved result attached to one workspace revision.
    await db.execute(update(Company).where(Company.id == company.id).values(updated_at=Company.updated_at))
    report = await run_checks(company, db)
    suite = await db.get(SupportCheckSuite, company.id)
    if suite:
        suite.last_report = report
        await db.flush()
    return report
