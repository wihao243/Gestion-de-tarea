"""
QUEST LOG — Crónicas de DAM
FastAPI Backend: CRUD de misiones + configuración de gremios (asignaturas).
Compatible con Vercel (serverless functions).
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
import json
import os
import uuid

# ── MODELOS ───────────────────────────────────────────────

class MissionCreate(BaseModel):
    id: Optional[str] = None
    name: str = Field(..., min_length=1, max_length=200)
    type: str = Field(..., pattern=r"^(slime|miniboss|boss)$")
    module: str = Field(..., min_length=1, max_length=100)
    deadline: str
    notes: Optional[str] = ""
    createdAt: Optional[str] = None


class MissionUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = Field(None, pattern=r"^(slime|miniboss|boss)$")
    module: Optional[str] = None
    deadline: Optional[str] = None
    notes: Optional[str] = None


# ── CONFIG: GREMIOS / ASIGNATURAS ─────────────────────────

SUBJECTS = [
    {"module": "Programación", "dm": "Jaume",    "emoji": "💻"},
    {"module": "Sistemas",     "dm": "Jaume",    "emoji": "🖥️"},
    {"module": "BBDD",         "dm": "Porti",    "emoji": "🗄️"},
    {"module": "Módulo 1709", "dm": "Robert",   "emoji": "🛠️"},
    {"module": "ERP",          "dm": "Gon",      "emoji": "🏭"},
    {"module": "Web",          "dm": "Josep",    "emoji": "🌐"},
    {"module": "Anglès",       "dm": "Gon",      "emoji": "🗣️"},
    {"module": "EIE",          "dm": "Eli",      "emoji": "💼"},
    {"module": "Tutoría",      "dm": "Claudina", "emoji": "🧭"},
]

# ── APP ───────────────────────────────────────────────────

app = FastAPI(title="Quest Log API — Crónicas de DAM", version="1.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── ALMACENAMIENTO (JSON file) ───────────────────────────

DATA_FILE = os.path.join(os.path.dirname(__file__), "missions.json")


def _load_missions() -> list[dict]:
    if not os.path.exists(DATA_FILE):
        return []
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def _save_missions(missions: list[dict]):
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(missions, f, ensure_ascii=False, indent=2)


# ── RUTA: CONFIGURACIÓN DE GREMIOS ────────────────────────

@app.get("/api/subjects")
def list_subjects():
    """Devuelve las asignaturas (gremios) y sus profesores (Dungeon Masters)."""
    return SUBJECTS


# ── RUTAS: CRUD DE MISIONES ───────────────────────────────

@app.get("/api/missions")
def list_missions():
    return _load_missions()


@app.get("/api/missions/{mission_id}")
def get_mission(mission_id: str):
    missions = _load_missions()
    for m in missions:
        if m["id"] == mission_id:
            return m
    raise HTTPException(status_code=404, detail="Misión no encontrada")


@app.post("/api/missions", status_code=201)
def create_mission(mission: MissionCreate):
    missions = _load_missions()

    mission_id = mission.id or str(uuid.uuid4())[:12]
    created_at = mission.createdAt or datetime.now().isoformat()

    new_mission = {
        "id": mission_id,
        "name": mission.name,
        "type": mission.type,
        "module": mission.module,
        "deadline": mission.deadline,
        "notes": mission.notes or "",
        "createdAt": created_at,
    }

    missions.append(new_mission)
    _save_missions(missions)
    return new_mission


@app.put("/api/missions/{mission_id}")
def update_mission(mission_id: str, updates: MissionUpdate):
    missions = _load_missions()

    for i, m in enumerate(missions):
        if m["id"] == mission_id:
            update_data = updates.model_dump(exclude_unset=True)
            missions[i].update(update_data)
            _save_missions(missions)
            return missions[i]

    raise HTTPException(status_code=404, detail="Misión no encontrada")


@app.delete("/api/missions/{mission_id}")
def delete_mission(mission_id: str):
    missions = _load_missions()
    original_len = len(missions)
    missions = [m for m in missions if m["id"] != mission_id]

    if len(missions) == original_len:
        raise HTTPException(status_code=404, detail="Misión no encontrada")

    _save_missions(missions)
    return {"detail": "Misión eliminada", "id": mission_id}


@app.delete("/api/missions")
def clear_missions():
    _save_missions([])
    return {"detail": "Todas las misiones han sido eliminadas"}


# ── RUTA: ESTADÍSTICAS ────────────────────────────────────

@app.get("/api/stats")
def get_stats():
    missions = _load_missions()
    completed = len([m for m in missions if m.get("defeatedAt")])
    return {
        "total_active": len(missions),
        "completed": completed,
        "slimes": len([m for m in missions if m["type"] == "slime"]),
        "minibosses": len([m for m in missions if m["type"] == "miniboss"]),
        "bosses": len([m for m in missions if m["type"] == "boss"]),
    }


# ── SERVIR FRONTEND (desarrollo local) ────────────────────

@app.get("/")
def serve_frontend():
    index_path = os.path.join(os.path.dirname(__file__), "..", "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"message": "Quest Log API — v1.1.0", "docs": "/docs"}


BASE_DIR = os.path.dirname(__file__)
if os.path.exists(os.path.join(BASE_DIR, "..", "css")):
    app.mount("/css", StaticFiles(directory=os.path.join(BASE_DIR, "..", "css")), name="css")
if os.path.exists(os.path.join(BASE_DIR, "..", "js")):
    app.mount("/js", StaticFiles(directory=os.path.join(BASE_DIR, "..", "js")), name="js")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)