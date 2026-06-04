import os
import shutil
import uuid
import gc
from deepface import DeepFace

def clear_tf_session():
    """
    Clears Keras session and garbage collects to free memory on small instances.
    """
    try:
        import tensorflow as tf
        tf.keras.backend.clear_session()
    except Exception:
        pass
    gc.collect()

DB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "registered_faces")
os.makedirs(DB_DIR, exist_ok=True)

def clear_representations_cache():
    """
    Clears DeepFace representation caches (.pkl files) to force re-indexing
    when new users are enrolled.
    """
    if os.path.exists(DB_DIR):
        for file in os.listdir(DB_DIR):
            if file.endswith(".pkl"):
                try:
                    os.remove(os.path.join(DB_DIR, file))
                except Exception as e:
                    print(f"Error clearing cache file {file}: {e}")

def register_face_deep(name: str, image_bytes: bytes) -> str:
    """
    Saves the user's face image under a dedicated directory, validates face presence,
    and clears the DeepFace cache.
    """
    sanitized_name = "".join(c for c in name if c.isalnum() or c in (" ", "_", "-")).strip()
    if not sanitized_name:
        raise ValueError("Invalid name provided.")

    person_dir = os.path.join(DB_DIR, sanitized_name)
    os.makedirs(person_dir, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.jpg"
    dest_path = os.path.join(person_dir, filename)

    with open(dest_path, "wb") as f:
        f.write(image_bytes)

    # Validate that a face is detectable in the registered photo
    try:
        DeepFace.extract_faces(img_path=dest_path, enforce_detection=True)
    except Exception as e:
        # Cleanup invalid photo
        if os.path.exists(dest_path):
            os.remove(dest_path)
        clear_tf_session()
        raise ValueError(f"Face verification failed: No face detected. Please try again.")

    # Clear cache so next recognition pass includes this face
    clear_representations_cache()
    clear_tf_session()
    return dest_path

def recognize_face_deep(image_path: str):
    """
    Matches the input image against registered faces database.
    """
    # Check if there are any registered users
    subdirs = [d for d in os.listdir(DB_DIR) if os.path.isdir(os.path.join(DB_DIR, d))]
    if not subdirs:
        return None

    try:
        results = DeepFace.find(
            img_path=image_path,
            db_path=DB_DIR,
            enforce_detection=False,
            silent=True
        )
        if results and not results[0].empty:
            match_path = results[0].iloc[0]['identity']
            rel_path = os.path.relpath(match_path, DB_DIR)
            name = rel_path.split(os.sep)[0]
            clear_tf_session()
            return name
    except Exception as e:
        print(f"Error in face recognition: {e}")
    clear_tf_session()
    return None

def analyze_face_deep(image_path: str) -> dict:
    """
    Analyzes face age, dominant gender, dominant emotion, and all emotion scores.
    """
    try:
        objs = DeepFace.analyze(
            img_path=image_path,
            actions=['age', 'gender', 'emotion'],
            enforce_detection=False,
            silent=True
        )
        if objs:
            obj = objs[0] if isinstance(objs, list) else objs
            res = {
                "age": int(obj.get("age", 0)),
                "gender": str(obj.get("dominant_gender", "Unknown")),
                "emotion": str(obj.get("dominant_emotion", "Unknown")),
                "emotions": {k: float(v) for k, v in obj.get("emotion", {}).items()}
            }
            clear_tf_session()
            return res
    except Exception as e:
        print(f"Error in face analysis: {e}")
    clear_tf_session()
    return {
        "age": 0,
        "gender": "Unknown",
        "emotion": "Unknown",
        "emotions": {}
    }
