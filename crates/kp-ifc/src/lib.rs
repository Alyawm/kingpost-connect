//! IFC reading for KingPost Connect.
//!
//! `parse_bytes` turns a STEP file into an [`IfcModel`]: rooted elements with their storey,
//! type and material, every property set and quantity set attached to them, and the
//! project units. `import_file` does that for a file inside a project folder and writes
//! the result into the project database as a new revision.
//!
//! Geometry is not read here. The interface produces it with web-ifc and links it to
//! these records by express id, which both sides take from the same file.

use std::{io, path::PathBuf, time::Instant};

mod extract;
pub mod grids;
mod import;
pub mod model;
pub mod step;

pub use grids::{Grid, GridAxis, read_grids};
pub use import::{ImportSummary, import_file, import_model};
pub use model::{Element, IfcModel, ParseStats, Property, Units};
pub use step::{StepError, StepFile, Value};

#[derive(Debug, thiserror::Error)]
pub enum IfcError {
    #[error(transparent)]
    Step(#[from] StepError),
    #[error("{path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error(transparent)]
    Store(#[from] kp_store::StoreError),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, IfcError>;

pub fn parse_bytes(data: &[u8]) -> Result<IfcModel> {
    let started = Instant::now();
    let step = StepFile::parse(data)?;
    let scan_ms = started.elapsed().as_millis() as u64;
    Ok(extract::extract(&step, scan_ms))
}

pub fn parse_file(path: &std::path::Path) -> Result<IfcModel> {
    let data = std::fs::read(path).map_err(|source| IfcError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    parse_bytes(&data)
}
