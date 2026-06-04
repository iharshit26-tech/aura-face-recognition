import os
import json
import datetime
import shutil
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from backend.face_utils_deep import register_face_deep, recognize_face_deep, analyze_face_deep

app = FastAPI(title="AURA: Neural Identity Protocol Server")

# Configure CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Base directories
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(os.path.dirname(BASE_DIR), "frontend")
TEMP_DIR = os.path.join(BASE_DIR, "temp")
HISTORY_FILE = os.path.join(BASE_DIR, "history.json")

os.makedirs(TEMP_DIR, exist_ok=True)

# Helper functions for history logging
def load_history():
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, "r") as f:
                return json.load(f)
        except Exception:
            return []
    return []

def save_history(history):
    try:
        with open(HISTORY_FILE, "w") as f:
            json.dump(history, f, indent=2)
    except Exception as e:
        print(f"Error saving history: {e}")

def add_history_entry(name: str, status: str, attributes: dict):
    history = load_history()
    entry = {
        "timestamp": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "name": name,
        "attributes": attributes,
        "status": status
    }
    history.insert(0, entry)  # Prepend new scan
    history = history[:100]   # Keep only last 100 entries
    save_history(history)
    return entry

# API routes
@app.get("/health")
def health_check():
    return {"status": "ok", "timestamp": datetime.datetime.now().isoformat()}

@app.get("/history")
def get_history():
    return JSONResponse(content=load_history())

@app.post("/register")
async def register_user(name: str = Form(...), file: UploadFile = File(...)):
    try:
        image_bytes = await file.read()
        dest_path = register_face_deep(name, image_bytes)
        return {"status": "success", "message": f"Successfully enrolled {name}", "path": dest_path}
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Registration failed: {str(e)}")

@app.post("/recognize")
async def recognize_user(file: UploadFile = File(...)):
    temp_file_path = os.path.join(TEMP_DIR, f"query_{datetime.datetime.now().timestamp()}.jpg")
    try:
        # Save temp file
        with open(temp_file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        # 1. Run face recognition
        matched_name = recognize_face_deep(temp_file_path)

        # 2. Run attribute analysis
        analysis = analyze_face_deep(temp_file_path)

        # Determine registration status
        if matched_name:
            status = "Verified"
            display_name = matched_name
        else:
            status = "Unknown"
            display_name = "Unknown"

        # Log verification attempt
        entry = add_history_entry(display_name, status, analysis)

        return {
            "status": "success",
            "match": matched_name is not None,
            "name": display_name,
            "verification_status": status,
            "analysis": analysis,
            "timestamp": entry["timestamp"]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Recognition processing failed: {str(e)}")
    finally:
        # Always clean up temporary image
        if os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
            except Exception:
                pass

# Serve static frontend files
# Note: we mount the static files for frontend assets first
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

@app.get("/")
def read_root():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))
