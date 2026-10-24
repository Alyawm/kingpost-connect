//! SAP2000 text model files (`.s2k`): a sequence of `TABLE:  "NAME"` headers followed by
//! rows of `Key=Value` pairs, long rows continued with a trailing `_`.

use std::collections::{BTreeMap, HashMap};

use crate::e2k::{normalise_direction, normalise_force, normalise_length};
use crate::model::{
    AnalysisModel, Combination, Dimension, Factor, LineLoad, LoadCase, Material, Member,
    MemberForce, MemberKind, Node, PointLoad, Section, Support, Surface, SurfaceLoad, Units,
    parse_number,
};

type Row = HashMap<String, String>;

pub fn read(text: &str) -> AnalysisModel {
    let tables = parse_tables(text);
    let mut model = AnalysisModel {
        source: "s2k".into(),
        ..Default::default()
    };
    let get = |name: &str| {
        tables
            .get(&name.to_ascii_uppercase())
            .map(Vec::as_slice)
            .unwrap_or(&[])
    };

    if let Some(row) = get("PROGRAM CONTROL").first() {
        let name = row
            .get("ProgramName")
            .cloned()
            .unwrap_or_else(|| "SAP2000".into());
        let version = row.get("Version").cloned().unwrap_or_default();
        model.program = Some(format!("{name} {version}").trim().to_owned());
        if let Some(units) = row.get("CurrUnits") {
            let parts: Vec<&str> = units.split(',').map(str::trim).collect();
            model.units = Units {
                force: parts
                    .first()
                    .map(|f| normalise_force(f))
                    .unwrap_or("kN".into()),
                length: parts
                    .get(1)
                    .map(|l| normalise_length(l))
                    .unwrap_or("m".into()),
            };
        }
    }

    for row in get("JOINT COORDINATES") {
        let Some(name) = row.get("Joint") else {
            continue;
        };
        let num = |a: &str, b: &str| {
            row.get(a)
                .and_then(|v| parse_number(v))
                .or_else(|| row.get(b).and_then(|v| parse_number(v)))
        };
        if let (Some(x), Some(y), Some(z)) = (
            num("GlobalX", "XorR"),
            num("GlobalY", "Y"),
            num("GlobalZ", "Z"),
        ) {
            model.nodes.push(Node {
                name: name.clone(),
                x,
                y,
                z,
            });
        }
    }

    let mut frame_sections: HashMap<String, String> = HashMap::new();
    for row in get("FRAME SECTION ASSIGNMENTS") {
        if let (Some(frame), Some(section)) = (
            row.get("Frame"),
            row.get("AnalSect").or_else(|| row.get("DesignSect")),
        ) {
            frame_sections.insert(frame.clone(), section.clone());
        }
    }
    let mut section_materials: HashMap<String, String> = HashMap::new();
    for row in get("FRAME SECTION PROPERTIES 01 - GENERAL") {
        let Some(name) = row.get("SectionName") else {
            continue;
        };
        let dims = ["t3", "t2", "tf", "tw", "t2b", "tfb"]
            .iter()
            .filter_map(|k| {
                row.get(*k)
                    .and_then(|v| parse_number(v))
                    .map(|value| Dimension {
                        name: k.to_ascii_uppercase(),
                        value,
                    })
            })
            .collect();
        if let Some(m) = row.get("Material") {
            section_materials.insert(name.clone(), m.clone());
        }
        model.sections.push(Section {
            name: name.clone(),
            material: row.get("Material").cloned(),
            shape: row.get("Shape").cloned(),
            dimensions: dims,
            thickness: None,
        });
    }
    for row in get("AREA SECTION PROPERTIES") {
        let Some(name) = row.get("Section") else {
            continue;
        };
        if let Some(m) = row.get("Material") {
            section_materials.insert(name.clone(), m.clone());
        }
        model.sections.push(Section {
            name: name.clone(),
            material: row.get("Material").cloned(),
            shape: row.get("AreaType").or_else(|| row.get("Type")).cloned(),
            dimensions: Vec::new(),
            thickness: row.get("Thickness").and_then(|v| parse_number(v)),
        });
    }

    let mut materials: BTreeMap<String, Material> = BTreeMap::new();
    for row in get("MATERIAL PROPERTIES 01 - GENERAL") {
        if let Some(name) = row.get("Material") {
            materials.insert(
                name.clone(),
                Material {
                    name: name.clone(),
                    kind: row
                        .get("Type")
                        .map(|t| t.to_ascii_lowercase())
                        .unwrap_or_else(|| "other".into()),
                    grade: row.get("Grade").cloned(),
                    e_modulus: None,
                    unit_weight: None,
                },
            );
        }
    }
    for row in get("MATERIAL PROPERTIES 02 - BASIC MECHANICAL PROPERTIES") {
        if let Some(name) = row.get("Material") {
            let entry = materials.entry(name.clone()).or_insert_with(|| Material {
                name: name.clone(),
                kind: "other".into(),
                grade: None,
                e_modulus: None,
                unit_weight: None,
            });
            entry.e_modulus = row.get("E1").and_then(|v| parse_number(v));
            entry.unit_weight = row.get("UnitWeight").and_then(|v| parse_number(v));
        }
    }
    model.materials = materials.into_values().collect();

    for row in get("CONNECTIVITY - FRAME") {
        if let (Some(frame), Some(i), Some(j)) =
            (row.get("Frame"), row.get("JointI"), row.get("JointJ"))
        {
            let section = frame_sections.get(frame).cloned();
            model.members.push(Member {
                uid: frame.clone(),
                name: frame.clone(),
                kind: MemberKind::Other,
                start: i.clone(),
                end: j.clone(),
                material: section
                    .as_ref()
                    .and_then(|s| section_materials.get(s))
                    .cloned(),
                section,
                storey: None,
            });
        }
    }

    let mut area_sections: HashMap<String, String> = HashMap::new();
    for row in get("AREA SECTION ASSIGNMENTS") {
        if let (Some(area), Some(section)) = (row.get("Area"), row.get("Section")) {
            area_sections.insert(area.clone(), section.clone());
        }
    }
    for row in get("CONNECTIVITY - AREA") {
        let Some(area) = row.get("Area") else {
            continue;
        };
        let count: usize = row
            .get("NumJoints")
            .and_then(|v| v.parse().ok())
            .unwrap_or(4);
        let nodes: Vec<String> = (1..=count)
            .filter_map(|k| row.get(&format!("Joint{k}")).cloned())
            .collect();
        let section = area_sections.get(area).cloned();
        let shape = section
            .as_ref()
            .and_then(|s| model.sections.iter().find(|x| &x.name == s))
            .and_then(|s| s.shape.clone())
            .unwrap_or_default()
            .to_ascii_lowercase();
        model.surfaces.push(Surface {
            uid: area.clone(),
            name: area.clone(),
            kind: if shape.contains("wall") {
                "wall".into()
            } else if shape.contains("slab") || shape.contains("shell") || shape.contains("plate") {
                "slab".into()
            } else {
                "other".into()
            },
            nodes,
            material: section
                .as_ref()
                .and_then(|s| section_materials.get(s))
                .cloned(),
            section,
            storey: None,
        });
    }

    for row in get("JOINT RESTRAINT ASSIGNMENTS") {
        let Some(joint) = row.get("Joint") else {
            continue;
        };
        let yes = |k: &str| row.get(k).is_some_and(|v| v.eq_ignore_ascii_case("yes"));
        let fixed = [
            yes("U1"),
            yes("U2"),
            yes("U3"),
            yes("R1"),
            yes("R2"),
            yes("R3"),
        ];
        if fixed.iter().any(|f| *f) {
            model.supports.push(Support {
                node: joint.clone(),
                fixed,
            });
        }
    }

    for row in get("LOAD PATTERN DEFINITIONS") {
        if let Some(name) = row.get("LoadPat") {
            model.load_cases.push(LoadCase {
                name: name.clone(),
                kind: row
                    .get("DesignType")
                    .map(|t| t.to_ascii_lowercase())
                    .unwrap_or_else(|| "other".into()),
            });
        }
    }
    for row in get("LOAD CASE DEFINITIONS") {
        if let Some(name) = row.get("Case")
            && !model.load_cases.iter().any(|c| &c.name == name)
        {
            model.load_cases.push(LoadCase {
                name: name.clone(),
                kind: row
                    .get("Type")
                    .map(|t| t.to_ascii_lowercase())
                    .unwrap_or_else(|| "other".into()),
            });
        }
    }

    let mut combos: BTreeMap<String, Combination> = BTreeMap::new();
    for row in get("COMBINATION DEFINITIONS") {
        let Some(name) = row.get("ComboName") else {
            continue;
        };
        let entry = combos.entry(name.clone()).or_insert_with(|| Combination {
            name: name.clone(),
            kind: String::new(),
            factors: Vec::new(),
        });
        if let Some(kind) = row.get("ComboType") {
            entry.kind = kind.clone();
        }
        if let (Some(case), Some(factor)) = (
            row.get("CaseName"),
            row.get("ScaleFactor").and_then(|v| parse_number(v)),
        ) {
            entry.factors.push(Factor {
                case: case.clone(),
                factor,
            });
        }
    }
    model.combinations = combos.into_values().collect();

    for row in get("JOINT LOADS - FORCE") {
        if let (Some(joint), Some(case)) = (row.get("Joint"), row.get("LoadPat")) {
            let f = |k: &str| row.get(k).and_then(|v| parse_number(v)).unwrap_or(0.0);
            model.point_loads.push(PointLoad {
                node: joint.clone(),
                case: case.clone(),
                force: [f("F1"), f("F2"), f("F3")],
                moment: [f("M1"), f("M2"), f("M3")],
            });
        }
    }
    for row in get("FRAME LOADS - DISTRIBUTED") {
        if let (Some(frame), Some(case)) = (row.get("Frame"), row.get("LoadPat")) {
            let f = |k: &str| row.get(k).and_then(|v| parse_number(v));
            model.line_loads.push(LineLoad {
                member: frame.clone(),
                case: case.clone(),
                direction: row
                    .get("Dir")
                    .map(|d| normalise_direction(d))
                    .unwrap_or_else(|| "gravity".into()),
                start: f("FOverLA").unwrap_or(0.0),
                end: f("FOverLB").unwrap_or(0.0),
                from: f("RelDistA").unwrap_or(0.0),
                to: f("RelDistB").unwrap_or(1.0),
            });
        }
    }
    for row in get("FRAME LOADS - POINT") {
        if let (Some(frame), Some(case)) = (row.get("Frame"), row.get("LoadPat")) {
            let at = row
                .get("RelDist")
                .and_then(|v| parse_number(v))
                .unwrap_or(0.5);
            let force = row
                .get("Force")
                .and_then(|v| parse_number(v))
                .unwrap_or(0.0);
            model.line_loads.push(LineLoad {
                member: frame.clone(),
                case: case.clone(),
                direction: row
                    .get("Dir")
                    .map(|d| normalise_direction(d))
                    .unwrap_or_else(|| "gravity".into()),
                start: force,
                end: force,
                from: at,
                to: at,
            });
        }
    }
    for row in get("AREA LOADS - UNIFORM") {
        if let (Some(area), Some(case)) = (row.get("Area"), row.get("LoadPat")) {
            model.surface_loads.push(SurfaceLoad {
                surface: area.clone(),
                case: case.clone(),
                direction: row
                    .get("Dir")
                    .map(|d| normalise_direction(d))
                    .unwrap_or_else(|| "gravity".into()),
                value: row
                    .get("UnifLoad")
                    .and_then(|v| parse_number(v))
                    .unwrap_or(0.0),
            });
        }
    }

    // Element forces come per station in length units; convert to a fraction of the
    // member length so the interface can draw them without the geometry.
    let lengths: HashMap<String, f64> = model
        .members
        .iter()
        .filter_map(|m| {
            let (a, b) = model.member_axis(m)?;
            Some((
                m.uid.clone(),
                ((b[0] - a[0]).powi(2) + (b[1] - a[1]).powi(2) + (b[2] - a[2]).powi(2)).sqrt(),
            ))
        })
        .collect();
    for row in get("ELEMENT FORCES - FRAMES") {
        let (Some(frame), Some(case), Some(station)) = (
            row.get("Frame"),
            row.get("OutputCase"),
            row.get("Station").and_then(|v| parse_number(v)),
        ) else {
            continue;
        };
        let length = lengths.get(frame).copied().unwrap_or(0.0);
        let f = |k: &str| row.get(k).and_then(|v| parse_number(v)).unwrap_or(0.0);
        model.results.push(MemberForce {
            member: frame.clone(),
            case: case.clone(),
            station: if length > 0.0 {
                (station / length).clamp(0.0, 1.0)
            } else {
                0.0
            },
            n: f("P"),
            vy: f("V2"),
            vz: f("V3"),
            t: f("T"),
            my: f("M2"),
            mz: f("M3"),
        });
    }

    model.finish();
    model
}

/// Tables keyed by upper-case name, each a list of rows.
fn parse_tables(text: &str) -> HashMap<String, Vec<Row>> {
    let mut tables: HashMap<String, Vec<Row>> = HashMap::new();
    let mut current: Option<String> = None;
    let mut pending = String::new();
    for raw in text.lines() {
        let line = raw.trim_end();
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("TABLE:") {
            current = Some(rest.trim().trim_matches('"').to_ascii_uppercase());
            pending.clear();
            continue;
        }
        if trimmed.starts_with("END TABLE DATA") {
            current = None;
            continue;
        }
        let Some(table) = &current else { continue };
        if let Some(cont) = trimmed.strip_suffix('_') {
            pending.push_str(cont);
            pending.push(' ');
            continue;
        }
        pending.push_str(trimmed);
        let row = parse_row(&pending);
        pending.clear();
        if !row.is_empty() {
            tables.entry(table.clone()).or_default().push(row);
        }
    }
    tables
}

/// `Key=Value` pairs; values may be quoted and contain spaces or `=`.
fn parse_row(line: &str) -> Row {
    let mut row = Row::new();
    let chars: Vec<char> = line.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        while i < chars.len() && chars[i].is_whitespace() {
            i += 1;
        }
        let key_start = i;
        while i < chars.len() && chars[i] != '=' && !chars[i].is_whitespace() {
            i += 1;
        }
        if i >= chars.len() || chars[i] != '=' {
            break;
        }
        let key: String = chars[key_start..i].iter().collect();
        i += 1;
        let value: String = if i < chars.len() && chars[i] == '"' {
            i += 1;
            let start = i;
            while i < chars.len() && chars[i] != '"' {
                i += 1;
            }
            let v = chars[start..i].iter().collect();
            i += 1;
            v
        } else {
            let start = i;
            while i < chars.len() && !chars[i].is_whitespace() {
                i += 1;
            }
            chars[start..i].iter().collect()
        };
        row.insert(key, value);
    }
    row
}
