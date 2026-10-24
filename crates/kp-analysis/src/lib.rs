//! Structural analysis models for KingPost Connect.
//!
//! Four sources — SAF workbooks, ETABS `.e2k`, SAP2000 `.s2k` and the structural view of
//! an IFC file — are read into one [`AnalysisModel`]: nodes, members, surfaces, supports,
//! materials, sections, load cases, combinations, loads and member forces where present.
//! [`link`] matches the members against the physical model's elements and reports what
//! does not line up.

use std::{io, path::Path};

pub mod e2k;
pub mod ifc;
pub mod link;
pub mod model;
pub mod s2k;
pub mod saf;

pub use link::{Link, LinkMethod, LinkReport, MatchSettings, PhysicalAxis, match_members};
pub use model::{
    AnalysisModel, Combination, Dimension, Factor, LineLoad, LoadCase, Material, Member,
    MemberForce, MemberKind, Node, PointLoad, Section, Storey, Support, Surface, SurfaceLoad,
    Units,
};

#[derive(Debug, thiserror::Error)]
pub enum AnalysisError {
    #[error("{0}")]
    Io(#[from] io::Error),
    #[error("workbook: {0}")]
    Xlsx(String),
    #[error(transparent)]
    Ifc(#[from] kp_ifc::IfcError),
    #[error("{0} is not a file type this reader knows (SAF .xlsx, .e2k, .s2k, .ifc)")]
    UnknownKind(String),
    #[error("the IFC file has no structural analysis members")]
    NoStructuralView,
    #[error("the file is not valid UTF-8 or Latin-1 text")]
    Encoding,
}

pub type Result<T> = std::result::Result<T, AnalysisError>;

/// Source kind from a file name: `saf`, `e2k`, `s2k` or `ifc`.
pub fn kind_of(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "xlsx" | "xlsm" => Some("saf"),
        "e2k" | "$et" => Some("e2k"),
        "s2k" | "$2k" => Some("s2k"),
        "ifc" => Some("ifc"),
        _ => None,
    }
}

/// Reads a file of any supported kind.
pub fn read_file(path: &Path) -> Result<AnalysisModel> {
    let kind =
        kind_of(path).ok_or_else(|| AnalysisError::UnknownKind(path.display().to_string()))?;
    let bytes = std::fs::read(path)?;
    read_bytes(kind, &bytes)
}

pub fn read_bytes(kind: &str, bytes: &[u8]) -> Result<AnalysisModel> {
    match kind {
        "saf" => saf::read_bytes(bytes),
        "e2k" => Ok(e2k::read(&text_of(bytes)?)),
        "s2k" => Ok(s2k::read(&text_of(bytes)?)),
        "ifc" => from_ifc_bytes(bytes)?.ok_or(AnalysisError::NoStructuralView),
        other => Err(AnalysisError::UnknownKind(other.to_owned())),
    }
}

/// The structural view of an IFC file, or `None` when it has none.
pub fn from_ifc_bytes(bytes: &[u8]) -> Result<Option<AnalysisModel>> {
    let step = kp_ifc::StepFile::parse(bytes).map_err(kp_ifc::IfcError::from)?;
    Ok(ifc::read_step(&step))
}

fn text_of(bytes: &[u8]) -> Result<String> {
    match std::str::from_utf8(bytes) {
        Ok(s) => Ok(s.to_owned()),
        // ETABS and SAP2000 write ANSI text; Latin-1 maps every byte to a character.
        Err(_) => Ok(bytes.iter().map(|&b| b as char).collect()),
    }
}

/// Counts for an import log or a file list.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Summary {
    pub source: String,
    pub program: Option<String>,
    pub length_unit: String,
    pub force_unit: String,
    pub nodes: usize,
    pub members: usize,
    pub surfaces: usize,
    pub supports: usize,
    pub load_cases: usize,
    pub combinations: usize,
    pub loads: usize,
    pub results: usize,
    pub notes: Vec<String>,
}

impl Summary {
    pub fn of(model: &AnalysisModel) -> Self {
        Self {
            source: model.source.clone(),
            program: model.program.clone(),
            length_unit: model.units.length.clone(),
            force_unit: model.units.force.clone(),
            nodes: model.nodes.len(),
            members: model.members.len(),
            surfaces: model.surfaces.len(),
            supports: model.supports.len(),
            load_cases: model.load_cases.len(),
            combinations: model.combinations.len(),
            loads: model.load_count(),
            results: model.results.len(),
            notes: model.notes.clone(),
        }
    }
}
