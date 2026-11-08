
import json
import os
import math
from openai import OpenAI

MODEL = os.getenv("OPENAI_MODEL", "gpt-5.4")


def generate_quest(student_a, student_b):
    """Generate a personalized activity for two UBC students."""

    common_interests = list(
        set(student_a["interests"]) & set(student_b["interests"])
    )

    max_budget = min(student_a["budget"], student_b["budget"])

    if student_a["vibe"] == student_b["vibe"]:
        preferred_vibe = student_a["vibe"]
    else:
        preferred_vibe = "balanced"

    fallback_quest = {
        "title": "UBC Campus Discovery Walk",
        "description": (
            "Meet at UBC Main Mall and explore public campus spaces "
            "together. Share your interests and find three interesting "
            "places along the way."
        ),
        "location": "UBC Main Mall",
        "cost": 0,
        "duration_minutes": 30,
        "vibe": preferred_vibe
    }

    prompt = f"""
You are the AI quest planner for SideQuest, a UBC student activity app.

Generate ONE fun, personalized activity for two matched students.

Student A interests: {json.dumps(student_a["interests"])}
Student B interests: {json.dumps(student_b["interests"])}
Shared interests: {json.dumps(common_interests)}
Maximum budget per person: ${max_budget} CAD
Preferred vibe: {preferred_vibe}

Requirements:
- Activity must take place on UBC Vancouver campus.
- Suitable for two students meeting for the first time.
- Use a public, accessible location.
- Never exceed the maximum budget per person.
- Prefer free activities.
- The activity should take 15–60 minutes.
- Consider both students' interests, even when they don't overlap.
- Avoid isolated locations, dangerous activities, and private residences.
- Do not invent paid event availability or opening hours.
- Generate a specific, fun activity rather than a generic suggestion.

Return ONLY valid JSON with exactly these fields:
{{
    "title": "string",
    "description": "string",
    "location": "string",
    "cost": 0,
    "duration_minutes": 30,
    "vibe": "string"
}}

Use a numeric cost in CAD per person.
Do not include Markdown or explanations.
"""

    try:
        api_key = os.getenv("OPENAI_API_KEY")
        base_url = os.getenv("OPENAI_BASE_URL")

        if not api_key or not base_url:
            raise RuntimeError("Maritime LLM credentials not configured")

        client = OpenAI(api_key=api_key, base_url=base_url)

        response = client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "user", "content": prompt}
            ],
            timeout=30
        )

        ai_text = response.choices[0].message.content

        if not ai_text:
            raise ValueError("AI returned an empty response")

        quest = json.loads(ai_text)

        required_fields = {
            "title", "description", "location",
            "cost", "duration_minutes", "vibe"
        }

        if not isinstance(quest, dict):
            raise ValueError("Quest must be a JSON object")

        if set(quest.keys()) != required_fields:
            raise ValueError("Quest has missing or unexpected fields")

        for field in ("title", "description", "location", "vibe"):
            if not isinstance(quest[field], str) or not quest[field].strip():
                raise ValueError(f"Invalid field: {field}")

        if (
            isinstance(quest["cost"], bool)
            or not isinstance(quest["cost"], (int, float))
            or not math.isfinite(quest["cost"])
            or not 0 <= quest["cost"] <= max_budget
        ):
            raise ValueError("Invalid quest cost")

        duration = quest["duration_minutes"]

        if (
            isinstance(duration, bool)
            or not isinstance(duration, int)
            or not 15 <= duration <= 60
        ):
            raise ValueError("Invalid quest duration")

        # Location safety and accessibility require additional validation.
        # Do not treat AI-generated places as verified.
        return quest

    except Exception as error:
        print(f"Quest generation failed: {error}")
        return fallback_quest


if __name__ == "__main__":
    student_a = {
        "interests": ["photography", "coffee", "walking"],
        "budget": 10,
        "vibe": "chill"
    }

    student_b = {
        "interests": ["photography", "nature", "hiking"],
        "budget": 5,
        "vibe": "chill"
    }

    result = generate_quest(student_a, student_b)
    print(json.dumps(result, indent=4))
