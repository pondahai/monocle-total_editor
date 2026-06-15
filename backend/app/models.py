from pydantic import BaseModel, Field
from typing import Optional, List

class ProjectCreate(BaseModel):
    name: str
    description: Optional[str] = None
    persona_prompt: Optional[str] = Field(None, description="System Prompt for LLM polishing style")
    deadline: Optional[str] = Field(None, description="ISO datetime string")

class OutlineNodeCreate(BaseModel):
    project_id: str
    title: str
    description: Optional[str] = None
    sort_order: int = 0

class TaskCreate(BaseModel):
    project_id: str
    outline_node_id: Optional[str] = None
    title: str
    duration_minutes: int = 20

class MaterialIngest(BaseModel):
    project_id: str
    outline_node_id: Optional[str] = None
    filename: str
    raw_content: str
    source_url: Optional[str] = None

class StateUpdate(BaseModel):
    active_project_id: Optional[str] = None
    active_outline_node_id: Optional[str] = None
    active_task_id: Optional[str] = None

class DraftSave(BaseModel):
    outline_node_id: str
    draft_text: str

class DraftPolish(BaseModel):
    project_id: str
    outline_node_id: str
    draft_text: str

class DecomposeOutlineRequest(BaseModel):
    project_id: str
    outline_node_id: str
    macro_text: str

class TimerControl(BaseModel):
    action: str = Field(..., description="start, pause, reset")
    duration_seconds: Optional[int] = 1200

class AnswerItem(BaseModel):
    question: str
    answer: str

class DraftFuseRequest(BaseModel):
    project_id: str
    outline_node_id: str
    answers: List[AnswerItem]

class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    persona_prompt: Optional[str] = None
    deadline: Optional[str] = None

class OutlineNodeUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    sort_order: Optional[int] = None
