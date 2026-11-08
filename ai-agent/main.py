
import json
import os
import math
import time
from google import genai

MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")


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
        
        api_key = os.getenv("GEMINI_API_KEY")

        if not api_key:
            raise RuntimeError("Gemini API key not configured")


        
        client = genai.Client(api_key=api_key)

        interaction = client.interactions.create(
            model=MODEL,
            input=prompt,
            background=True
        )

        print(f"Gemini interaction started: {interaction.id}")

        deadline = time.monotonic() + 120

        while interaction.status not in ("completed", "failed", "cancelled"):
            if time.monotonic() >= deadline:
                raise TimeoutError("Gemini is still processing the quest")

            time.sleep(3)
            interaction = client.interactions.get(interaction.id)

        if interaction.status != "completed":
            raise RuntimeError(f"Gemini interaction ended: {interaction.status}")

        ai_text = interaction.output_text


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
