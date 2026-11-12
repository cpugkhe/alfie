//! Persists UI session (open tabs, recents, pane sizes) as JSON in the app
//! config directory. The frontend owns the shape.

use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("session.json"))
}

pub fn load(app: &AppHandle) -> Value {
    file(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(Value::Null)
}

pub fn save(app: &AppHandle, session: &Value) -> Result<(), String> {
    let path = file(app)?;
    let tmp = path.with_extension("json.tmp");
    let data = serde_json::to_vec_pretty(session).map_err(|e| e.to_string())?;
    fs::write(&tmp, data).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}
