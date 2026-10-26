//! ETABS text model files (`.e2k`, also written as `.$et`).
//!
//! The file is a sequence of sections introduced by `$ NAME` lines. Points are plan
//! coordinates; a line (beam, column, brace) connects two points and is instantiated on
//! every storey it is assigned to, columns and braces running down to the storey below.
//! This reader turns those storey instances into nodes and members with real elevations.

use std::collections::{BTreeMap, HashMap};

use crate::model::{
    AnalysisModel, Combination, Dimension, Factor, LineLoad, LoadCase, Material, Member,
    MemberKind, Node, PointLoad, Section, Storey, Support, Surface, SurfaceLoad, Units,
    parse_number,
};

#[derive(Debug, Clone)]
struct Line {
    kind: MemberKind,
    i: String,
    j: String,
    /// How many storeys below the assigned storey the J point sits.
    j_drop: usize,
}

#[derive(Debug, Clone)]
struct Area {
    kind: String,
    points: Vec<(String, usize)>,
}

pub fn read(text: &str) -> AnalysisModel {
    let mut model = AnalysisModel {
        source: "e2k".into(),
        ..Default::default()
    };
    let mut section = String::new();
    let mut points: HashMap<String, (f64, f64)> = HashMap::new();
    let mut lines: HashMap<String, Line> = HashMap::new();
    let mut areas: HashMap<String, Area> = HashMap::new();
    let mut storey_rows: Vec<(String, Option<f64>, Option<f64>)> = Vec::new(); // name, height, elev
    let mut materials: BTreeMap<String, Material> = BTreeMap::new();
    let mut sections: BTreeMap<String, Section> = BTreeMap::new();
    let mut combos: BTreeMap<String, Combination> = BTreeMap::new();
    let mut load_cases: Vec<LoadCase> = Vec::new();
    let mut members: Vec<Member> = Vec::new();
    let mut surfaces: Vec<Surface> = Vec::new();
    let mut supports: Vec<Support> = Vec::new();
    let mut point_loads: Vec<PointLoad> = Vec::new();
    let mut line_loads: Vec<LineLoad> = Vec::new();
    let mut surface_loads: Vec<SurfaceLoad> = Vec::new();

    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(name) = line.strip_prefix('$') {
            section = name.trim().to_ascii_uppercase();
            continue;
        }
        let (tokens, quoted) = tokenize(line);
        if tokens.is_empty() {
            continue;
        }
        let keyword = tokens[0].to_ascii_uppercase();
        let kv = pairs(&tokens, &quoted);
        match keyword.as_str() {
            "PROGRAM" => {
                if let Some(name) = tokens.get(1) {
                    let version = kv.get("VERSION").cloned().unwrap_or_default();
                    model.program = Some(format!("{name} {version}").trim().to_owned());
                }
            }
            "UNITS" => {
                model.units = Units {
                    force: tokens
                        .get(1)
                        .map(|t| normalise_force(t))
                        .unwrap_or("kN".into()),
                    length: tokens
                        .get(2)
                        .map(|t| normalise_length(t))
                        .unwrap_or("m".into()),
                };
            }
            "STORY" => {
                if let Some(name) = tokens.get(1) {
                    storey_rows.push((
                        name.clone(),
                        kv.get("HEIGHT").and_then(|v| parse_number(v)),
                        kv.get("ELEV").and_then(|v| parse_number(v)),
                    ));
                }
            }
            "POINT" if section.starts_with("POINT COORD") => {
                if let (Some(name), Some(x), Some(y)) = (
                    tokens.get(1),
                    tokens.get(2).and_then(|t| parse_number(t)),
                    tokens.get(3).and_then(|t| parse_number(t)),
                ) {
                    points.insert(name.clone(), (x, y));
                }
            }
            "LINE" if section.starts_with("LINE CONN") => {
                if let (Some(name), Some(kind), Some(i), Some(j)) =
                    (tokens.get(1), tokens.get(2), tokens.get(3), tokens.get(4))
                {
                    let kind = match kind.to_ascii_uppercase().as_str() {
                        "BEAM" => MemberKind::Beam,
                        "COLUMN" => MemberKind::Column,
                        "BRACE" => MemberKind::Brace,
                        _ => MemberKind::Other,
                    };
                    let j_drop = tokens
                        .get(5)
                        .and_then(|t| t.parse::<usize>().ok())
                        .unwrap_or(usize::from(kind == MemberKind::Column));
                    lines.insert(
                        name.clone(),
                        Line {
                            kind,
                            i: i.clone(),
                            j: j.clone(),
                            j_drop,
                        },
                    );
                }
            }
            "AREA" if section.starts_with("AREA CONN") => {
                if let (Some(name), Some(kind), Some(count)) = (
                    tokens.get(1),
                    tokens.get(2),
                    tokens.get(3).and_then(|t| t.parse::<usize>().ok()),
                ) {
                    let names = &tokens[4..(4 + count).min(tokens.len())];
                    let drops = &tokens[(4 + count).min(tokens.len())..];
                    let points = names
                        .iter()
                        .enumerate()
                        .map(|(k, p)| {
                            (
                                p.clone(),
                                drops.get(k).and_then(|d| d.parse().ok()).unwrap_or(0),
                            )
                        })
                        .collect();
                    areas.insert(
                        name.clone(),
                        Area {
                            kind: kind.to_ascii_lowercase(),
                            points,
                        },
                    );
                }
            }
            "MATERIAL" => {
                if let Some(name) = tokens.get(1) {
                    let entry = materials.entry(name.clone()).or_insert_with(|| Material {
                        name: name.clone(),
                        kind: "other".into(),
                        grade: None,
                        e_modulus: None,
                        unit_weight: None,
                    });
                    if let Some(kind) = kv.get("TYPE") {
                        entry.kind = kind.to_ascii_lowercase();
                    }
                    if let Some(grade) = kv.get("GRADE") {
                        entry.grade = Some(grade.clone());
                    }
                    if let Some(e) = kv.get("E").and_then(|v| parse_number(v)) {
                        entry.e_modulus = Some(e);
                    }
                    if let Some(w) = kv.get("WEIGHTPERVOLUME").and_then(|v| parse_number(v)) {
                        entry.unit_weight = Some(w);
                    }
                }
            }
            "FRAMESECTION" => {
                if let Some(name) = tokens.get(1) {
                    let entry = sections.entry(name.clone()).or_insert_with(|| Section {
                        name: name.clone(),
                        material: None,
                        shape: None,
                        dimensions: Vec::new(),
                        thickness: None,
                    });
                    if let Some(m) = kv.get("MATERIAL") {
                        entry.material = Some(m.clone());
                    }
                    if let Some(s) = kv.get("SHAPE") {
                        entry.shape = Some(s.clone());
                    }
                    for key in ["D", "B", "TF", "TW", "T", "DIA", "T3", "T2", "B2", "TF2"] {
                        if let Some(v) = kv.get(key).and_then(|v| parse_number(v))
                            && !entry.dimensions.iter().any(|d| d.name == key)
                        {
                            entry.dimensions.push(Dimension {
                                name: key.to_owned(),
                                value: v,
                            });
                        }
                    }
                }
            }
            "SHELLPROP" | "SLABPROP" | "WALLPROP" | "DECKPROP" => {
                if let Some(name) = tokens.get(1) {
                    let thickness = [
                        "SLABTHICKNESS",
                        "WALLTHICKNESS",
                        "THICKNESS",
                        "DECKSLABDEPTH",
                    ]
                    .iter()
                    .find_map(|k| kv.get(*k).and_then(|v| parse_number(v)));
                    let entry = sections.entry(name.clone()).or_insert_with(|| Section {
                        name: name.clone(),
                        material: None,
                        shape: None,
                        dimensions: Vec::new(),
                        thickness: None,
                    });
                    if let Some(m) = kv.get("MATERIAL") {
                        entry.material = Some(m.clone());
                    }
                    if let Some(s) = kv.get("PROPTYPE") {
                        entry.shape = Some(s.clone());
                    }
                    if thickness.is_some() {
                        entry.thickness = thickness;
                    }
                }
            }
            "POINTASSIGN" => {
                if let (Some(point), Some(storey), Some(restraint)) =
                    (tokens.get(1), tokens.get(2), kv.get("RESTRAINT"))
                {
                    let fixed = restraint_dofs(restraint);
                    if fixed.iter().any(|f| *f) {
                        supports.push(Support {
                            node: format!("{point}@{storey}"),
                            fixed,
                        });
                    }
                }
            }
            "LINEASSIGN" => {
                if let (Some(line), Some(storey)) = (tokens.get(1), tokens.get(2)) {
                    let Some(def) = lines.get(line) else {
                        model
                            .notes
                            .push(format!("line {line} assigned on {storey} is not defined"));
                        continue;
                    };
                    members.push(Member {
                        uid: format!("{line}@{storey}"),
                        name: line.clone(),
                        kind: def.kind,
                        start: format!("{}@{storey}", def.i),
                        end: String::new(), // resolved once storeys are known
                        section: kv.get("SECTION").cloned(),
                        material: None,
                        storey: Some(storey.clone()),
                    });
                }
            }
            "AREAASSIGN" => {
                if let (Some(area), Some(storey)) = (tokens.get(1), tokens.get(2))
                    && let Some(def) = areas.get(area)
                {
                    surfaces.push(Surface {
                        uid: format!("{area}@{storey}"),
                        name: area.clone(),
                        kind: match def.kind.as_str() {
                            "floor" => "slab".into(),
                            "panel" | "wall" => "wall".into(),
                            other => other.to_owned(),
                        },
                        nodes: Vec::new(), // resolved below
                        section: kv.get("SECTION").cloned(),
                        material: None,
                        storey: Some(storey.clone()),
                    });
                }
            }
            "LOADPATTERN" | "LOADCASE" => {
                if let Some(name) = tokens.get(1)
                    && !load_cases.iter().any(|c| &c.name == name)
                {
                    load_cases.push(LoadCase {
                        name: name.clone(),
                        kind: kv
                            .get("TYPE")
                            .map(|t| t.to_ascii_lowercase())
                            .unwrap_or_else(|| "other".into()),
                    });
                }
            }
            "COMBO" => {
                if let Some(name) = tokens.get(1) {
                    let entry = combos.entry(name.clone()).or_insert_with(|| Combination {
                        name: name.clone(),
                        kind: String::new(),
                        factors: Vec::new(),
                    });
                    if let Some(kind) = kv.get("TYPE") {
                        entry.kind.clone_from(kind);
                    }
                    let case = kv.get("LOADCASE").or_else(|| kv.get("LOADCOMBO"));
                    if let (Some(case), Some(factor)) =
                        (case, kv.get("SF").and_then(|v| parse_number(v)))
                    {
                        entry.factors.push(Factor {
                            case: case.clone(),
                            factor,
                        });
                    }
                }
            }
            "POINTLOAD" => {
                if let (Some(point), Some(storey), Some(case)) =
                    (tokens.get(1), tokens.get(2), kv.get("LC"))
                {
                    let f = |k: &str| kv.get(k).and_then(|v| parse_number(v)).unwrap_or(0.0);
                    point_loads.push(PointLoad {
                        node: format!("{point}@{storey}"),
                        case: case.clone(),
                        force: [f("FX"), f("FY"), f("FZ")],
                        moment: [f("MX"), f("MY"), f("MZ")],
                    });
                }
            }
            "LINELOAD" => {
                if let (Some(line), Some(storey), Some(case)) =
                    (tokens.get(1), tokens.get(2), kv.get("LC"))
                {
                    let f = |k: &str| kv.get(k).and_then(|v| parse_number(v));
                    let kind = kv
                        .get("TYPE")
                        .map(|t| t.to_ascii_uppercase())
                        .unwrap_or_default();
                    let (start, end, from, to) = match kind.as_str() {
                        "TRAPF" | "TRAPM" => (
                            f("FSTART").unwrap_or(0.0),
                            f("FEND").unwrap_or(0.0),
                            f("RDSTART").unwrap_or(0.0),
                            f("RDEND").unwrap_or(1.0),
                        ),
                        "POINTF" | "POINTM" => {
                            let at = f("RDIST").unwrap_or(0.5);
                            (f("FVAL").unwrap_or(0.0), f("FVAL").unwrap_or(0.0), at, at)
                        }
                        _ => (f("FVAL").unwrap_or(0.0), f("FVAL").unwrap_or(0.0), 0.0, 1.0),
                    };
                    line_loads.push(LineLoad {
                        member: format!("{line}@{storey}"),
                        case: case.clone(),
                        direction: kv
                            .get("DIR")
                            .map(|d| normalise_direction(d))
                            .unwrap_or_else(|| "gravity".into()),
                        start,
                        end,
                        from,
                        to,
                    });
                }
            }
            "AREALOAD" => {
                if let (Some(area), Some(storey), Some(case)) =
                    (tokens.get(1), tokens.get(2), kv.get("LC"))
                {
                    surface_loads.push(SurfaceLoad {
                        surface: format!("{area}@{storey}"),
                        case: case.clone(),
                        direction: kv
                            .get("DIR")
                            .map(|d| normalise_direction(d))
                            .unwrap_or_else(|| "gravity".into()),
                        value: kv.get("FVAL").and_then(|v| parse_number(v)).unwrap_or(0.0),
                    });
                }
            }
            _ => {}
        }
    }

    // Storeys are listed from the top; elevations build up from the base.
    let mut storeys: Vec<Storey> = Vec::with_capacity(storey_rows.len());
    let mut elevation = 0.0;
    for (name, height, elev) in storey_rows.iter().rev() {
        if let Some(e) = elev {
            elevation = *e;
        } else if let Some(h) = height {
            elevation += *h;
        }
        storeys.push(Storey {
            name: name.clone(),
            elevation,
        });
    }
    let index_of: HashMap<&str, usize> = storeys
        .iter()
        .enumerate()
        .map(|(i, s)| (s.name.as_str(), i))
        .collect();
    let storey_below = |name: &str, drop: usize| -> Option<&Storey> {
        let i = *index_of.get(name)?;
        storeys.get(i.checked_sub(drop)?)
    };

    // Nodes are point × storey instances that something refers to.
    let mut nodes: BTreeMap<String, Node> = BTreeMap::new();
    let ensure_node = |nodes: &mut BTreeMap<String, Node>, point: &str, storey: &Storey| {
        let name = format!("{point}@{}", storey.name);
        if let Some((x, y)) = points.get(point) {
            nodes.entry(name.clone()).or_insert(Node {
                name: name.clone(),
                x: *x,
                y: *y,
                z: storey.elevation,
            });
        }
        name
    };
    for member in &mut members {
        let storey_name = member.storey.clone().unwrap_or_default();
        let Some(def) = lines.get(&member.name) else {
            continue;
        };
        let Some(top) = storeys.iter().find(|s| s.name == storey_name) else {
            model.notes.push(format!(
                "member {} is on storey {storey_name}, which is not defined",
                member.uid
            ));
            continue;
        };
        member.start = ensure_node(&mut nodes, &def.i, top);
        let bottom = storey_below(&storey_name, def.j_drop).unwrap_or(top);
        member.end = ensure_node(&mut nodes, &def.j, bottom);
    }
    for surface in &mut surfaces {
        let storey_name = surface.storey.clone().unwrap_or_default();
        let (Some(def), Some(top)) = (
            areas.get(&surface.name),
            storeys.iter().find(|s| s.name == storey_name),
        ) else {
            continue;
        };
        surface.nodes = def
            .points
            .iter()
            .map(|(p, drop)| {
                ensure_node(
                    &mut nodes,
                    p,
                    storey_below(&storey_name, *drop).unwrap_or(top),
                )
            })
            .collect();
    }
    for support in &supports {
        if let Some((point, storey_name)) = support.node.split_once('@')
            && let Some(storey) = storeys.iter().find(|s| s.name == storey_name)
        {
            ensure_node(&mut nodes, point, storey);
        }
    }
    for load in &point_loads {
        if let Some((point, storey_name)) = load.node.split_once('@')
            && let Some(storey) = storeys.iter().find(|s| s.name == storey_name)
        {
            ensure_node(&mut nodes, point, storey);
        }
    }
    // Members and surfaces carry their section's material.
    for member in &mut members {
        member.material = member
            .section
            .as_ref()
            .and_then(|s| sections.get(s))
            .and_then(|s| s.material.clone());
    }
    for surface in &mut surfaces {
        surface.material = surface
            .section
            .as_ref()
            .and_then(|s| sections.get(s))
            .and_then(|s| s.material.clone());
    }

    model.storeys = storeys;
    model.nodes = nodes.into_values().collect();
    model.members = members;
    model.surfaces = surfaces;
    model.materials = materials.into_values().collect();
    model.sections = sections.into_values().collect();
    model.supports = supports;
    model.load_cases = load_cases;
    model.combinations = combos.into_values().collect();
    model.point_loads = point_loads;
    model.line_loads = line_loads;
    model.surface_loads = surface_loads;
    model.finish();
    model
}

/// Splits a line into words, keeping quoted strings together (quotes removed), and says
/// which words were quoted: names and values may be, keys never are.
pub(crate) fn tokenize(line: &str) -> (Vec<String>, Vec<bool>) {
    let mut out = Vec::new();
    let mut flags = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    let mut had_quote = false;
    for c in line.chars() {
        match c {
            '"' => {
                quoted = !quoted;
                had_quote = true;
            }
            c if c.is_whitespace() && !quoted => {
                if !current.is_empty() || had_quote {
                    out.push(std::mem::take(&mut current));
                    flags.push(had_quote);
                    had_quote = false;
                }
            }
            c => current.push(c),
        }
    }
    if !current.is_empty() || had_quote {
        out.push(current);
        flags.push(had_quote);
    }
    (out, flags)
}

/// `KEY value` pairs after the record's leading names. Keys are bare (unquoted)
/// upper-case words; a value is whatever token follows one.
fn pairs(tokens: &[String], quoted: &[bool]) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let mut i = 1;
    while i + 1 < tokens.len() {
        let t = &tokens[i];
        if !quoted.get(i).copied().unwrap_or(false) && is_key(t) {
            out.insert(t.to_ascii_uppercase(), tokens[i + 1].clone());
            i += 2;
        } else {
            i += 1;
        }
    }
    out
}

fn is_key(token: &str) -> bool {
    !token.is_empty()
        && token
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
        && token.chars().next().is_some_and(|c| c.is_ascii_uppercase())
}

fn restraint_dofs(text: &str) -> [bool; 6] {
    let upper = text.to_ascii_uppercase();
    let has = |dof: &str| upper.split_whitespace().any(|t| t == dof);
    [
        has("UX"),
        has("UY"),
        has("UZ"),
        has("RX"),
        has("RY"),
        has("RZ"),
    ]
}

pub(crate) fn normalise_length(unit: &str) -> String {
    match unit.trim().to_ascii_lowercase().as_str() {
        "m" | "meter" | "metre" => "m".into(),
        "mm" => "mm".into(),
        "cm" => "cm".into(),
        "ft" | "feet" => "ft".into(),
        "in" | "inch" => "in".into(),
        other => other.to_owned(),
    }
}

pub(crate) fn normalise_force(unit: &str) -> String {
    match unit.trim().to_ascii_lowercase().as_str() {
        "kn" => "kN".into(),
        "n" => "N".into(),
        "kip" | "kips" => "kip".into(),
        "lb" | "lbs" => "lb".into(),
        "tonf" | "tf" => "tf".into(),
        other => other.to_owned(),
    }
}

pub(crate) fn normalise_direction(dir: &str) -> String {
    match dir.trim().to_ascii_uppercase().as_str() {
        "GRAV" | "GRAVITY" => "gravity".into(),
        "X" | "GLOBALX" => "x".into(),
        "Y" | "GLOBALY" => "y".into(),
        "Z" | "GLOBALZ" => "z".into(),
        other => other.to_ascii_lowercase(),
    }
}
