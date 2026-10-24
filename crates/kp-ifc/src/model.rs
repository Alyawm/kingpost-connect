//! What the reader produces: the parts of an IFC model that the application stores and
//! shows. Geometry is deliberately absent; it is produced in the interface by web-ifc and
//! linked to these records through the express id.

use serde::Serialize;

/// Project units resolved from `IfcProject.UnitsInContext`, as display symbols.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Units {
    pub length: Option<String>,
    pub area: Option<String>,
    pub volume: Option<String>,
    pub mass: Option<String>,
    pub angle: Option<String>,
}

impl Units {
    pub fn for_kind(&self, kind: &str) -> Option<&str> {
        match kind {
            "length" => self.length.as_deref(),
            "area" => self.area.as_deref(),
            "volume" => self.volume.as_deref(),
            "mass" => self.mass.as_deref(),
            "angle" => self.angle.as_deref(),
            _ => None,
        }
    }
}

/// A rooted product or spatial element.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Element {
    pub express_id: u32,
    pub global_id: String,
    pub ifc_type: String,
    pub name: Option<String>,
    pub tag: Option<String>,
    /// Name of the storey (or other spatial container) the element belongs to.
    pub storey: Option<String>,
    pub type_name: Option<String>,
    pub material: Option<String>,
    /// Express id of the aggregating parent: the storey for spatial children, the
    /// assembly for its parts.
    pub parent: Option<u32>,
    pub has_geometry: bool,
    pub is_spatial: bool,
}

/// One property or quantity attached to an element.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Property {
    pub element: u32,
    pub pset: String,
    pub name: String,
    pub value_text: Option<String>,
    pub value_num: Option<f64>,
    pub unit: Option<String>,
    /// One of: length, area, volume, mass, count, number, bool, text, date, angle,
    /// force, pressure, density.
    pub kind: &'static str,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct ParseStats {
    pub entities: usize,
    pub types: usize,
    pub elements: usize,
    pub spatial: usize,
    pub property_sets: usize,
    pub quantity_sets: usize,
    pub properties: usize,
    pub scan_ms: u64,
    pub extract_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct IfcModel {
    pub schema: String,
    pub units: Units,
    pub elements: Vec<Element>,
    pub properties: Vec<Property>,
    pub stats: ParseStats,
}
