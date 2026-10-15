"""Deterministic fixtures, never provider calls. This is a flow preview, not an AI evaluation."""
import re
from app.utils.elevenlabs_client import build_first_message, build_trial_prompt


def simulate(body):
    name, context = body.company_name, body.company_context
    if body.scenario == "hours":
        sentences = re.split(r'(?<=[.!?])\s+|\n', context)
        facts = [s for s in sentences if re.search(r'\b(hours|open|closed|weekdays|weekends|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b', s, re.I)]
        question = "What are your opening hours?"
        answer = ' '.join(facts)[:700] if facts else "I don't have your opening hours in my business notes. I can collect your details for a team member to follow up."
        outcome = "Business fact located" if facts else "Human follow-up needed"
    elif body.scenario == "booking":
        question = "Can I book an appointment for tomorrow?"
        answer = "What service and time would you prefer? I can collect your request, but availability and confirmation need a connected booking system."
        outcome = "Booking request collected; unconfirmed"
    elif body.scenario == "feedback":
        question = "The team was helpful, but I waited a long time."
        answer = "Thank you for sharing that. What could we improve about the wait? I'll recap your feedback for the team."
        outcome = "Feedback preview; no record submitted"
    elif body.scenario == "off_topic":
        question = "Write me an essay about space travel."
        answer = f"I can help with {name}'s services. What would you like to know about the business?"
        outcome = "Redirected to business scope"
    else:
        question = "Can you guarantee a full refund?"
        answer = "I can't guarantee a refund without a verified policy and team approval. I can collect your request for a team member."
        outcome = "Unknown policy escalated"
    prompt = build_trial_prompt(company_name=name, agent_type=body.agent_type,
        company_context=context, special_instructions=body.special_instructions)
    return {
        "mode": "simulation", "provider_called": False, "phone_called": False,
        "disclaimer": "Scripted flow preview. Does not evaluate ElevenLabs reasoning, audio or tool execution.",
        "transcript": [{"role": "agent", "message": build_first_message(name, body.agent_type)},
            {"role": "user", "message": question}, {"role": "agent", "message": answer}],
        "outcome": outcome, "prompt": prompt, "prompt_characters": len(prompt),
        "estimated_prompt_tokens": (len(prompt) + 3) // 4,
    }
