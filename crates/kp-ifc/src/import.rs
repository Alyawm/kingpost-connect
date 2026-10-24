//! Writing a parsed model into the project database as a revision of a tracked file.

use std::{
    path::Path,
    time::{Instant, UNIX_EPOCH},
};

use kp_store::{ElementRow, PropertyRow, Store};
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::{IfcError, IfcModel, ParseStats, Result, Units, parse_bytes};

#[derive(Debug, Clone, Serialize)]
pub struct ImportSummary {
    pub file_id: i64,
    pub revision_id: i64,
    pub revision_index: i64,
    pub schema: String,
    pub units: Units,
    pub sha256: String,
    pub stats: ParseStats,
    pub store_ms: u64,
    pub total_ms: u64,
}

/// Reads `rel_path` under `root`, parses it and stores it as the next revision of that file.
pub fn import_file(store: &Store, root: &Path, rel_path: &str) -> Result<ImportSummary> {
    let started = Instant::now();
    let path = root.join(rel_path);
    let data = std::fs::read(&path).map_err(|source| IfcError::Io {
        path: path.clone(),
        source,
    })?;
    let sha256 = hex(&Sha256::digest(&data));
    let metadata = std::fs::metadata(&path).ok();
    let size = metadata.as_ref().map(|m| m.len() as i64);
    let mtime = metadata
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs().to_string());

    let model = parse_bytes(&data)?;
    let file_id = store.upsert_file(rel_path, "ifc", Some(&sha256), size, mtime.as_deref())?;
    let (revision_id, revision_index, store_ms) = import_model(store, file_id, &sha256, &model)?;

    Ok(ImportSummary {
        file_id,
        revision_id,
        revision_index,
        schema: model.schema,
        units: model.units,
        sha256,
        stats: model.stats,
        store_ms,
        total_ms: started.elapsed().as_millis() as u64,
    })
}

/// Stores an already parsed model as a new revision of `file_id`.
/// Returns the revision id, its index within the file, and the time spent writing.
pub fn import_model(
    store: &Store,
    file_id: i64,
    source_sha256: &str,
    model: &IfcModel,
) -> Result<(i64, i64, u64)> {
    let started = Instant::now();
    let units_json = serde_json::to_string(&model.units)?;
    let (revision_id, revision_index) = store.create_revision(
        file_id,
        source_sha256,
        Some(&model.schema),
        &units_json,
        None,
    )?;

    let elements: Vec<ElementRow> = model
        .elements
        .iter()
        .map(|e| ElementRow {
            express_id: e.express_id as i64,
            global_id: e.global_id.clone(),
            ifc_type: e.ifc_type.clone(),
            name: e.name.clone(),
            tag: e.tag.clone(),
            storey: e.storey.clone(),
            type_name: e.type_name.clone(),
            material: e.material.clone(),
            parent_express_id: e.parent.map(|p| p as i64),
            has_geometry: e.has_geometry,
            is_spatial: e.is_spatial,
        })
        .collect();
    let properties: Vec<PropertyRow> = model
        .properties
        .iter()
        .map(|p| PropertyRow {
            element_express_id: p.element as i64,
            pset: p.pset.clone(),
            name: p.name.clone(),
            value_text: p.value_text.clone(),
            value_num: p.value_num,
            unit: p.unit.clone(),
            kind: p.kind.to_owned(),
        })
        .collect();
    store.write_revision_content(revision_id, &elements, &properties)?;

    Ok((
        revision_id,
        revision_index,
        started.elapsed().as_millis() as u64,
    ))
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    bytes
        .iter()
        .fold(String::with_capacity(bytes.len() * 2), |mut s, b| {
            let _ = write!(s, "{b:02x}");
            s
        })
}
