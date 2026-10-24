//! One shape for every analysis source. Readers fill it; the application stores it as
//! JSON, draws it and matches it against the physical model.
//!
//! Coordinates stay in the source's own length unit with Z up; `Units::length_to_m` gives
//! the factor to metres. Names are the source's names so an engineer can find a member in
//! the originating program; `uid` is unique within the model (ETABS repeats a line name on
//! every storey it is assigned to, so there it is `line@storey`).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Units {
    /// m, mm, cm, ft or in.
    pub length: String,
    /// kN, N, kip or lb.
    pub force: String,
}

impl Default for Units {
    fn default() -> Self {
        Self {
            length: "m".into(),
            force: "kN".into(),
        }
    }
}

impl Units {
    pub fn length_to_m(&self) -> f64 {
        length_to_m(&self.length)
    }
}

/// Factor that turns a length in `unit` into metres; unknown units count as metres.
pub fn length_to_m(unit: &str) -> f64 {
    match unit.trim().to_ascii_lowercase().as_str() {
        "mm" => 0.001,
        "cm" => 0.01,
        "ft" | "feet" => 0.3048,
        "in" | "inch" => 0.0254,
        _ => 1.0,
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Storey {
    pub name: String,
    pub elevation: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Node {
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MemberKind {
    Beam,
    Column,
    Brace,
    Other,
}

impl MemberKind {
    /// Classifies a member by the slope of its axis: steeper than about 60° is a column,
    /// flatter than about 15° a beam, anything between a brace.
    pub fn from_axis(dx: f64, dy: f64, dz: f64) -> Self {
        let length = (dx * dx + dy * dy + dz * dz).sqrt();
        if length <= f64::EPSILON {
            return MemberKind::Other;
        }
        let vertical = dz.abs() / length;
        if vertical > 0.85 {
            MemberKind::Column
        } else if vertical < 0.25 {
            MemberKind::Beam
        } else {
            MemberKind::Brace
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Member {
    pub uid: String,
    pub name: String,
    pub kind: MemberKind,
    /// Node names.
    pub start: String,
    pub end: String,
    pub section: Option<String>,
    pub material: Option<String>,
    pub storey: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Surface {
    pub uid: String,
    pub name: String,
    /// slab, wall or other.
    pub kind: String,
    pub nodes: Vec<String>,
    pub section: Option<String>,
    pub material: Option<String>,
    pub storey: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Material {
    pub name: String,
    /// concrete, steel, timber, other.
    pub kind: String,
    pub grade: Option<String>,
    /// In the source's pressure unit, usually kN/m² or MPa; shown, not computed with.
    pub e_modulus: Option<f64>,
    pub unit_weight: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Dimension {
    pub name: String,
    /// In the model's length unit.
    pub value: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Section {
    pub name: String,
    pub material: Option<String>,
    pub shape: Option<String>,
    pub dimensions: Vec<Dimension>,
    /// Thickness for surface sections, in the model's length unit.
    pub thickness: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Support {
    pub node: String,
    /// Fixed degrees of freedom: ux, uy, uz, rx, ry, rz.
    pub fixed: [bool; 6],
}

impl Support {
    pub fn is_pinned(&self) -> bool {
        self.fixed[..3].iter().all(|f| *f) && !self.fixed[3..].iter().any(|f| *f)
    }
    pub fn is_fixed(&self) -> bool {
        self.fixed.iter().all(|f| *f)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LoadCase {
    pub name: String,
    /// dead, live, wind, seismic, snow, temperature, other — as the source names it.
    pub kind: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Factor {
    pub case: String,
    pub factor: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Combination {
    pub name: String,
    pub kind: String,
    pub factors: Vec<Factor>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PointLoad {
    pub node: String,
    pub case: String,
    pub force: [f64; 3],
    pub moment: [f64; 3],
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LineLoad {
    pub member: String,
    pub case: String,
    /// gravity, x, y, z or local-1/2/3 as the source gives it.
    pub direction: String,
    /// Force per length at the start and end of the loaded range.
    pub start: f64,
    pub end: f64,
    /// Loaded range as fractions of the member length.
    pub from: f64,
    pub to: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SurfaceLoad {
    pub surface: String,
    pub case: String,
    pub direction: String,
    pub value: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MemberForce {
    pub member: String,
    pub case: String,
    /// Position along the member as a fraction of its length.
    pub station: f64,
    pub n: f64,
    pub vy: f64,
    pub vz: f64,
    pub t: f64,
    pub my: f64,
    pub mz: f64,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct AnalysisModel {
    /// e2k, s2k, saf or ifc.
    pub source: String,
    pub program: Option<String>,
    pub units: Units,
    pub storeys: Vec<Storey>,
    pub nodes: Vec<Node>,
    pub members: Vec<Member>,
    pub surfaces: Vec<Surface>,
    pub materials: Vec<Material>,
    pub sections: Vec<Section>,
    pub supports: Vec<Support>,
    pub load_cases: Vec<LoadCase>,
    pub combinations: Vec<Combination>,
    pub point_loads: Vec<PointLoad>,
    pub line_loads: Vec<LineLoad>,
    pub surface_loads: Vec<SurfaceLoad>,
    pub results: Vec<MemberForce>,
    /// Anything the reader skipped or guessed, for the import log.
    pub notes: Vec<String>,
}

impl AnalysisModel {
    pub fn node(&self, name: &str) -> Option<&Node> {
        self.nodes.iter().find(|n| n.name == name)
    }

    pub fn member(&self, uid: &str) -> Option<&Member> {
        self.members.iter().find(|m| m.uid == uid)
    }

    pub fn section(&self, name: &str) -> Option<&Section> {
        self.sections.iter().find(|s| s.name == name)
    }

    /// Start and end of a member in the model's length unit.
    pub fn member_axis(&self, member: &Member) -> Option<([f64; 3], [f64; 3])> {
        let a = self.node(&member.start)?;
        let b = self.node(&member.end)?;
        Some(([a.x, a.y, a.z], [b.x, b.y, b.z]))
    }

    pub fn load_count(&self) -> usize {
        self.point_loads.len() + self.line_loads.len() + self.surface_loads.len()
    }

    /// Fills in member kinds that a reader left as `Other` from the member geometry, and
    /// drops members whose nodes are missing (noted, not failed).
    pub fn finish(&mut self) {
        let mut kept = Vec::with_capacity(self.members.len());
        for mut member in std::mem::take(&mut self.members) {
            let Some((a, b)) = self.member_axis(&member) else {
                self.notes.push(format!(
                    "member {} references a node that does not exist; skipped",
                    member.uid
                ));
                continue;
            };
            if member.kind == MemberKind::Other {
                member.kind = MemberKind::from_axis(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
            }
            kept.push(member);
        }
        self.members = kept;
    }
}

/// Reads a number the way the sources write them, including `1,5` from locales that use
/// a comma and thousands separators that must not be mistaken for decimals.
pub(crate) fn parse_number(text: &str) -> Option<f64> {
    let t = text.trim();
    if t.is_empty() {
        return None;
    }
    if let Ok(v) = t.parse::<f64>() {
        return Some(v);
    }
    if t.contains(',') && !t.contains('.') {
        return t.replace(',', ".").parse().ok();
    }
    None
}
