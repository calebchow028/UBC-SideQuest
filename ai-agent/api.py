
from fastapi import FastAPI
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
def create_quest(request: QuestRequest):
    quest = generate_quest(
        request.student_a.model_dump(),
        request.student_b.model_dump()
    )
    return quest
