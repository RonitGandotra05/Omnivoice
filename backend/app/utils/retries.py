"""Bounded randomized retries; server Retry-After is a floor, never shortened."""
import random
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import math


def retry_wait(attempt, retry_after=None, *, now=None, random_value=None):
    floor = 0.0
    if retry_after:
        try:
            floor = float(retry_after)
        except ValueError:
            try:
                deadline = parsedate_to_datetime(retry_after)
                if deadline.tzinfo is None:
                    deadline = deadline.replace(tzinfo=timezone.utc)
                floor = (deadline - (now or datetime.now(timezone.utc))).total_seconds()
            except (ValueError, TypeError, OverflowError):
                floor = 0.0
    if not math.isfinite(floor) or floor > 30:
        return None  # Do not hammer the service or hold a request for an unbounded wait.
    floor = max(0.0, floor)
    sample = random.random() if random_value is None else max(0.0, min(1.0, random_value))
    delay = min(30.0, max(floor, min(8.0, 0.5 * 2 ** attempt) * (0.5 + sample)))
    return delay
