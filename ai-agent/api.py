
import os
import secrets

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from main import generate_quest


app = FastAPI(title="SideQuest AI Agent")


class Student(BaseModel):
    interests: list[str]
    budget: float = Field(ge=0)
    vibe: str


class QuestRequest(BaseModel):
    student_a: Student
    student_b: Student


@app.get("/")
def home():
    return {"status": "SideQuest AI Agent is running!"}


@app.post("/generate-quest")
def create_quest(
    request: QuestRequest,
    x_api_key: str | None = Header(default=None)
):
    expected_key = os.getenv("SIDEQUEST_API_KEY")

    # Fail securely if the server secret has not been configured.
    if not expected_key:
        raise HTTPException(
            status_code=503,
            detail="API authentication is not configured"
        )

    # Reject missing or incorrect API keys.
    if not x_api_key or not secrets.compare_digest(x_api_key, expected_key):
        raise HTTPException(
            status_code=401,
            detail="Unauthorized"
        )

    return generate_quest(
        request.student_a.model_dump(),
        request.student_b.model_dump()
    )
