//! SAF, the Structural Analysis Format: an Excel workbook with one sheet per table
//! (`StructuralPointConnection`, `StructuralCurveMember`, …), a header row of
//! human-readable column names, and SI units (m, kN) throughout.
//!
//! Columns are found by a normalised header (lower-case, letters and digits only) so
//! minor wording differences between SAF versions and exporting programs do not matter.

use std::{collections::HashMap, io::Cursor, path::Path};

use calamine::{Data, Range, Reader, open_workbook_auto, open_workbook_auto_from_rs};

use crate::model::{
    AnalysisModel, Combination, Dimension, Factor, LineLoad, LoadCase, Material, Member,
    MemberForce, MemberKind, Node, PointLoad, Section, Support, Surface, SurfaceLoad, Units,
    parse_number,
};
use crate::{AnalysisError, Result};

pub fn read_path(path: &Path) -> Result<AnalysisModel> {
    let mut workbook = open_workbook_auto(path).map_err(|e| AnalysisError::Xlsx(e.to_string()))?;
    let names = workbook.sheet_names().clone();
    let mut sheets = Vec::new();
    for name in names {
        if let Ok(range) = workbook.worksheet_range(&name) {
            sheets.push((name, range));
        }
    }
    Ok(from_sheets(sheets))
}

pub fn read_bytes(bytes: &[u8]) -> Result<AnalysisModel> {
    let mut workbook = open_workbook_auto_from_rs(Cursor::new(bytes))
        .map_err(|e| AnalysisError::Xlsx(e.to_string()))?;
    let names = workbook.sheet_names().clone();
    let mut sheets = Vec::new();
    for name in names {
        if let Ok(range) = workbook.worksheet_range(&name) {
            sheets.push((name, range));
        }
    }
    Ok(from_sheets(sheets))
}

/// A sheet as rows of normalised-header → text.
struct Table {
    rows: Vec<HashMap<String, String>>,
}

impl Table {
    fn from_range(range: &Range<Data>) -> Self {
        let mut rows_iter = range.rows();
        let Some(header) = rows_iter.next() else {
            return Self { rows: Vec::new() };
        };
        let keys: Vec<String> = header.iter().map(|c| normalise(&cell_text(c))).collect();
        let rows = rows_iter
            .filter_map(|row| {
                let mut map = HashMap::new();
                let mut any = false;
                for (k, cell) in keys.iter().zip(row.iter()) {
                    let text = cell_text(cell);
                    if !text.is_empty() {
                        any = true;
                        map.insert(k.clone(), text);
                    }
                }
                any.then_some(map)
            })
            .collect();
        Self { rows }
    }
}

fn cell_text(cell: &Data) -> String {
    match cell {
        Data::Empty => String::new(),
        Data::String(s) => s.trim().to_owned(),
        Data::Float(f) => {
            if f.fract() == 0.0 && f.abs() < 1e15 {
                format!("{}", *f as i64)
            } else {
                f.to_string()
            }
        }
        Data::Int(i) => i.to_string(),
        Data::Bool(b) => b.to_string(),
        Data::DateTime(d) => d.to_string(),
        Data::DateTimeIso(s) | Data::DurationIso(s) => s.clone(),
        Data::Error(e) => format!("{e:?}"),
    }
}

/// Lower-case letters and digits only: "Coordinate X [m]" → "coordinatex".
fn normalise(header: &str) -> String {
    let mut out = String::new();
    for c in header.chars() {
        if c == '[' || c == '(' {
            break;
        }
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        }
    }
    out
}

fn field<'a>(row: &'a HashMap<String, String>, candidates: &[&str]) -> Option<&'a String> {
    candidates.iter().find_map(|c| row.get(*c))
}

fn number(row: &HashMap<String, String>, candidates: &[&str]) -> Option<f64> {
    field(row, candidates).and_then(|v| parse_number(v))
}

fn split_list(text: &str) -> Vec<String> {
    text.split([';', ','])
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .collect()
}

pub fn from_sheets(sheets: Vec<(String, Range<Data>)>) -> AnalysisModel {
    let mut tables: HashMap<String, Table> = HashMap::new();
    for (name, range) in &sheets {
        tables.insert(normalise(name), Table::from_range(range));
    }
    let table = |name: &str| -> &[HashMap<String, String>] {
        tables.get(name).map(|t| t.rows.as_slice()).unwrap_or(&[])
    };

    let mut model = AnalysisModel {
        source: "saf".into(),
        units: Units::default(),
        ..Default::default()
    };
    if let Some(row) = table("project").first() {
        model.program = field(row, &["sourcesoftware", "program", "application"]).cloned();
    }

    for row in table("structuralpointconnection") {
        let (Some(name), Some(x), Some(y), Some(z)) = (
            field(row, &["name"]),
            number(row, &["coordinatex", "x"]),
            number(row, &["coordinatey", "y"]),
            number(row, &["coordinatez", "z"]),
        ) else {
            continue;
        };
        model.nodes.push(Node {
            name: name.clone(),
            x,
            y,
            z,
        });
    }

    for row in table("structuralmaterial") {
        let Some(name) = field(row, &["name"]) else {
            continue;
        };
        model.materials.push(Material {
            name: name.clone(),
            kind: field(row, &["type"])
                .map(|t| t.to_ascii_lowercase())
                .unwrap_or_else(|| "other".into()),
            grade: field(row, &["quality", "grade"]).cloned(),
            e_modulus: number(row, &["emodulus", "e"]),
            unit_weight: number(row, &["unitmass", "unitweight"]),
        });
    }

    for row in table("structuralcrosssection") {
        let Some(name) = field(row, &["name"]) else {
            continue;
        };
        let dimensions = field(row, &["parameters", "dimensions"])
            .map(|p| {
                split_list(p)
                    .iter()
                    .enumerate()
                    .filter_map(|(i, v)| {
                        parse_number(v).map(|value| Dimension {
                            name: format!("p{}", i + 1),
                            value,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        model.sections.push(Section {
            name: name.clone(),
            material: field(row, &["material"]).cloned(),
            shape: field(row, &["profile", "shape", "crosssectiontype"]).cloned(),
            dimensions,
            thickness: None,
        });
    }

    let section_material: HashMap<String, String> = model
        .sections
        .iter()
        .filter_map(|s| s.material.clone().map(|m| (s.name.clone(), m)))
        .collect();

    for row in table("structuralcurvemember") {
        let (Some(name), Some(start), Some(end)) = (
            field(row, &["name"]),
            field(row, &["begnode", "beginnode", "startnode", "nodestart"]),
            field(row, &["endnode", "nodeend"]),
        ) else {
            continue;
        };
        let section = field(row, &["crosssection", "section"]).cloned();
        let kind = match field(row, &["type"])
            .map(|t| t.to_ascii_lowercase())
            .unwrap_or_default()
            .as_str()
        {
            t if t.contains("column") => MemberKind::Column,
            t if t.contains("bracing") || t.contains("diagonal") => MemberKind::Brace,
            "beam" | "rafter" | "purlin" | "girt" | "beam slab" | "plate rib" | "truss chord" => {
                MemberKind::Beam
            }
            _ => MemberKind::Other,
        };
        model.members.push(Member {
            uid: name.clone(),
            name: name.clone(),
            kind,
            start: start.clone(),
            end: end.clone(),
            material: section
                .as_ref()
                .and_then(|s| section_material.get(s))
                .cloned(),
            section,
            storey: field(row, &["layer", "storey", "story"]).cloned(),
        });
    }

    for row in table("structuralsurfacemember") {
        let Some(name) = field(row, &["name"]) else {
            continue;
        };
        let nodes = field(row, &["nodes", "node"])
            .map(|n| split_list(n))
            .unwrap_or_default();
        let kind = field(row, &["type"])
            .map(|t| t.to_ascii_lowercase())
            .unwrap_or_default();
        model.surfaces.push(Surface {
            uid: name.clone(),
            name: name.clone(),
            kind: if kind.contains("wall") {
                "wall".into()
            } else if kind.contains("plate") || kind.contains("slab") || kind.contains("shell") {
                "slab".into()
            } else {
                "other".into()
            },
            nodes,
            section: number(row, &["thickness"]).map(|t| format!("t={t}")),
            material: field(row, &["material"]).cloned(),
            storey: field(row, &["layer", "storey", "story"]).cloned(),
        });
        if let Some(thickness) = number(row, &["thickness"]) {
            let section_name = format!("t={thickness}");
            if !model.sections.iter().any(|s| s.name == section_name) {
                model.sections.push(Section {
                    name: section_name,
                    material: field(row, &["material"]).cloned(),
                    shape: Some("surface".into()),
                    dimensions: Vec::new(),
                    thickness: Some(thickness),
                });
            }
        }
    }

    for row in table("structuralpointsupport") {
        let Some(node) = field(row, &["node"]) else {
            continue;
        };
        let fixed_dof = |k: &str| {
            field(row, &[k]).is_some_and(|v| {
                let v = v.to_ascii_lowercase();
                v.starts_with("rigid") || v.starts_with("fixed") || v.starts_with("flexible")
            })
        };
        let fixed = [
            fixed_dof("x"),
            fixed_dof("y"),
            fixed_dof("z"),
            fixed_dof("rx"),
            fixed_dof("ry"),
            fixed_dof("rz"),
        ];
        if fixed.iter().any(|f| *f) {
            model.supports.push(Support {
                node: node.clone(),
                fixed,
            });
        }
    }

    for row in table("structuralloadcase") {
        if let Some(name) = field(row, &["name"]) {
            model.load_cases.push(LoadCase {
                name: name.clone(),
                kind: field(row, &["actiontype", "loadtype", "type"])
                    .map(|t| t.to_ascii_lowercase())
                    .unwrap_or_else(|| "other".into()),
            });
        }
    }

    for row in table("structuralloadcombination") {
        let Some(name) = field(row, &["name"]) else {
            continue;
        };
        let cases = field(row, &["loadcases", "loadcase"])
            .map(|c| split_list(c))
            .unwrap_or_default();
        let factors = field(row, &["loadfactors", "factors", "factor", "multiplier"])
            .map(|f| split_list(f))
            .unwrap_or_default();
        let factors = cases
            .iter()
            .enumerate()
            .map(|(i, case)| Factor {
                case: case.clone(),
                factor: factors
                    .get(i)
                    .or(factors.first())
                    .and_then(|f| parse_number(f))
                    .unwrap_or(1.0),
            })
            .collect();
        model.combinations.push(Combination {
            name: name.clone(),
            kind: field(row, &["category", "type", "nationalstandard"])
                .cloned()
                .unwrap_or_default(),
            factors,
        });
    }

    for row in table("structuralpointaction") {
        let (Some(node), Some(case)) = (
            field(row, &["referencenode", "node"]),
            field(row, &["loadcase"]),
        ) else {
            continue;
        };
        let value = number(row, &["value"]).unwrap_or(0.0);
        let axis = match field(row, &["direction"])
            .map(|d| d.to_ascii_uppercase())
            .as_deref()
        {
            Some("X") => 0,
            Some("Y") => 1,
            _ => 2,
        };
        let is_moment =
            field(row, &["type"]).is_some_and(|t| t.to_ascii_lowercase().contains("moment"));
        let mut force = [0.0; 3];
        let mut moment = [0.0; 3];
        if is_moment {
            moment[axis] = value;
        } else {
            force[axis] = value;
        }
        model.point_loads.push(PointLoad {
            node: node.clone(),
            case: case.clone(),
            force,
            moment,
        });
    }

    for row in table("structuralcurveaction") {
        let (Some(member), Some(case)) = (
            field(row, &["member", "1dmember", "curvemember"]),
            field(row, &["loadcase"]),
        ) else {
            continue;
        };
        let start = number(row, &["value1", "value"]).unwrap_or(0.0);
        let end = number(row, &["value2"]).unwrap_or(start);
        model.line_loads.push(LineLoad {
            member: member.clone(),
            case: case.clone(),
            direction: field(row, &["direction"])
                .map(|d| d.to_ascii_lowercase())
                .unwrap_or_else(|| "z".into()),
            start,
            end,
            from: number(row, &["startpoint", "from"]).unwrap_or(0.0),
            to: number(row, &["endpoint", "to"]).unwrap_or(1.0),
        });
    }

    for row in table("structuralsurfaceaction") {
        let (Some(surface), Some(case)) = (
            field(row, &["2dmember", "member", "surfacemember"]),
            field(row, &["loadcase"]),
        ) else {
            continue;
        };
        model.surface_loads.push(SurfaceLoad {
            surface: surface.clone(),
            case: case.clone(),
            direction: field(row, &["direction"])
                .map(|d| d.to_ascii_lowercase())
                .unwrap_or_else(|| "z".into()),
            value: number(row, &["value"]).unwrap_or(0.0),
        });
    }

    for row in table("resultinternalforce1d") {
        let (Some(member), Some(case)) = (
            field(row, &["member", "1dmember"]),
            field(
                row,
                &["loadcase", "combination", "combinationkey", "resultfor"],
            ),
        ) else {
            continue;
        };
        let f = |keys: &[&str]| number(row, keys).unwrap_or(0.0);
        model.results.push(MemberForce {
            member: member.clone(),
            case: case.clone(),
            station: number(row, &["sectionat", "position", "x"]).unwrap_or(0.0),
            n: f(&["n"]),
            vy: f(&["vy"]),
            vz: f(&["vz"]),
            t: f(&["mx", "t"]),
            my: f(&["my"]),
            mz: f(&["mz"]),
        });
    }

    model.finish();
    model
}
