
import json
import math
import os
import time

from google import genai


MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
MAX_WAIT_SECONDS = 30


def generate_quest(student_a, student_b):
    """Generate one personalized activity for two matched UBC students."""

    common_interests = sorted(
        set(student_a["interests"]) & set(student_b["interests"])
    )

    max_budget = min(student_a["budget"], student_b["budget"])

    preferred_vibe = (
        student_a["vibe"]
        if student_a["vibe"] == student_b["vibe"]
        else "balanced"
    )

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

    # Keep the prompt short while preserving important constraints.
    prompt = f"""
Create ONE fun, specific activity for two matched UBC students.

Student A interests: {json.dumps(student_a["interests"])}
Student B interests: {json.dumps(student_b["interests"])}
Shared interests: {json.dumps(common_interests)}
Maximum cost per person: {max_budget} CAD
Preferred vibe: {preferred_vibe}

Rules:
- Location must be a public, accessible place on UBC Vancouver campus.
- Suitable for two students meeting for the first time.
- Choose a safe, non-isolated location.
- No private residences or dangerous activities.
- Cost must be between $0 and ${max_budget} per person.
- Prefer free activities lasting 15–60 minutes.
- Consider both students' interests.
- Don't invent opening hours or event availability.
- Suggest a concrete activity, not just a place to visit.

Return exactly one JSON object with:
title, description, location, cost, duration_minutes, vibe.
"""

    # Ask Gemini for structured JSON.
    quest_schema = {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "description": {"type": "string"},
            "location": {"type": "string"},
            "cost": {"type": "number"},
            "duration_minutes": {"type": "integer"},
            "vibe": {"type": "string"}
        },
        "required": [
            "title",
            "description",
            "location",
            "cost",
            "duration_minutes",
            "vibe"
        ],
        "additionalProperties": False
    }

    start_time = time.monotonic()
    interaction_id = None

    try:
        api_key = os.getenv("GEMINI_API_KEY")

        if not api_key:
            raise RuntimeError("Gemini API key not configured")

        client = genai.Client(api_key=api_key)

        
        # Generate the quest synchronously using Flash-Lite.
        interaction = client.interactions.create(
            model=MODEL,
            input=prompt,
            generation_config={
                "thinking_level": "minimal"
            },
            response_format={
                "type": "text",
                "mime_type": "application/json",
                "schema": quest_schema
            },
            timeout=MAX_WAIT_SECONDS
        )

        interaction_id = interaction.id

        if interaction.status != "completed":
            raise RuntimeError(
                f"Gemini ended with status: {interaction.status}"
            )


        ai_text = interaction.output_text

        if not ai_text or not ai_text.strip():
            raise ValueError("Gemini returned empty text")

        quest = json.loads(ai_text.strip())

        # Validate the returned quest.
        required_fields = {
            "title",
            "description",
            "location",
            "cost",
            "duration_minutes",
            "vibe"
        }

        if not isinstance(quest, dict):
            raise ValueError("Quest must be a JSON object")

        if set(quest.keys()) != required_fields:
            raise ValueError("Unexpected or missing quest fields")

        for field in ("title", "description", "location", "vibe"):
            if (
                not isinstance(quest[field], str)
                or not quest[field].strip()
            ):
                raise ValueError(f"Invalid field: {field}")

        cost = quest["cost"]

        if (
            isinstance(cost, bool)
            or not isinstance(cost, (int, float))
            or not math.isfinite(cost)
            or not 0 <= cost <= max_budget
        ):
            raise ValueError("Invalid quest cost")

        duration = quest["duration_minutes"]

        if (
            isinstance(duration, bool)
            or not isinstance(duration, int)
            or not 15 <= duration <= 60
        ):
            raise ValueError("Invalid quest duration")

        elapsed = time.monotonic() - start_time

        print(
            f"Gemini quest generated successfully in {elapsed:.2f}s",
            flush=True
        )

        # AI-generated locations still require independent verification
        # before being presented as confirmed accessible or safe.
        return quest

    except Exception as error:
        elapsed = time.monotonic() - start_time

        print(
            f"Quest generation failed after {elapsed:.2f}s: {error}",
            flush=True
        )

        if interaction_id:
            print(f"Interaction ID: {interaction_id}", flush=True)

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
