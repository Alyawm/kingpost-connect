//! The structural analysis view of an IFC file: `IfcStructuralCurveMember`,
//! `IfcStructuralSurfaceMember`, `IfcStructuralPointConnection` with boundary
//! conditions, load cases and the point and linear actions assigned to them.
//!
//! Geometry comes from the topology representations (vertex points and edges) placed
//! through the `IfcLocalPlacement` chain. The walk is schema-free like the rest of the
//! reader: it collects the Cartesian points reachable from a representation in order.

use std::collections::{BTreeMap, HashMap, HashSet};

use kp_ifc::{StepFile, Value};

use crate::model::{
    AnalysisModel, Combination, Factor, LineLoad, LoadCase, Material, Member, MemberKind, Node,
    PointLoad, Section, Support, Surface, Units,
};

type Point = [f64; 3];

/// Rotation plus translation; enough for placements.
#[derive(Clone, Copy)]
struct Transform {
    m: [[f64; 3]; 3],
    t: Point,
}

impl Transform {
    const IDENTITY: Transform = Transform {
        m: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
        t: [0.0; 3],
    };

    fn apply(&self, p: Point) -> Point {
        let m = &self.m;
        [
            m[0][0] * p[0] + m[0][1] * p[1] + m[0][2] * p[2] + self.t[0],
            m[1][0] * p[0] + m[1][1] * p[1] + m[1][2] * p[2] + self.t[1],
            m[2][0] * p[0] + m[2][1] * p[1] + m[2][2] * p[2] + self.t[2],
        ]
    }

    /// `self` after `other`: applies `other` in the frame of `self`.
    fn then(&self, local: &Transform) -> Transform {
        let mut m = [[0.0; 3]; 3];
        for (i, row) in m.iter_mut().enumerate() {
            for (j, cell) in row.iter_mut().enumerate() {
                *cell = (0..3).map(|k| self.m[i][k] * local.m[k][j]).sum();
            }
        }
        Transform {
            m,
            t: self.apply(local.t),
        }
    }
}

/// Returns `None` when the file has no structural members.
pub fn read_step(step: &StepFile) -> Option<AnalysisModel> {
    let members: Vec<u32> = [
        "IFCSTRUCTURALCURVEMEMBER",
        "IFCSTRUCTURALCURVEMEMBERVARYING",
    ]
    .iter()
    .flat_map(|t| step.instances_of(t).iter().copied())
    .collect();
    let surfaces: Vec<u32> = [
        "IFCSTRUCTURALSURFACEMEMBER",
        "IFCSTRUCTURALSURFACEMEMBERVARYING",
    ]
    .iter()
    .flat_map(|t| step.instances_of(t).iter().copied())
    .collect();
    if members.is_empty() && surfaces.is_empty() {
        return None;
    }

    let mut reader = Reader {
        step,
        placements: HashMap::new(),
        model: AnalysisModel {
            source: "ifc".into(),
            program: application_name(step),
            units: read_units(step),
            ..Default::default()
        },
        node_by_key: BTreeMap::new(),
        node_counter: 0,
    };
    reader.read(&members, &surfaces);
    let mut model = reader.model;
    model.finish();
    Some(model)
}

struct Reader<'s, 'a> {
    step: &'s StepFile<'a>,
    placements: HashMap<u32, Transform>,
    model: AnalysisModel,
    node_by_key: BTreeMap<(i64, i64, i64), String>,
    node_counter: usize,
}

impl Reader<'_, '_> {
    fn read(&mut self, member_ids: &[u32], surface_ids: &[u32]) {
        // Named connections first, so members can attach to them.
        let mut connection_names: HashMap<u32, String> = HashMap::new();
        for &id in self.step.instances_of("IFCSTRUCTURALPOINTCONNECTION") {
            let Some(args) = self.step.args(id) else {
                continue;
            };
            let Some(point) = self.product_points(&args).into_iter().next() else {
                continue;
            };
            let proposed = args
                .get(2)
                .and_then(Value::as_str)
                .filter(|n| !n.trim().is_empty())
                .map(str::to_owned);
            let name = self.node_at(point, proposed);
            connection_names.insert(id, name.clone());
            if let Some(condition) = args.get(7).and_then(Value::as_ref)
                && let Some(fixed) = self.boundary_condition(condition)
                && fixed.iter().any(|f| *f)
            {
                self.model.supports.push(Support { node: name, fixed });
            }
        }

        // Member → its connections, from IfcRelConnectsStructuralMember.
        let mut member_connections: HashMap<u32, Vec<u32>> = HashMap::new();
        for &rel in self.step.instances_of("IFCRELCONNECTSSTRUCTURALMEMBER") {
            if let Some(args) = self.step.args(rel)
                && let (Some(member), Some(connection)) = (
                    args.get(4).and_then(Value::as_ref),
                    args.get(5).and_then(Value::as_ref),
                )
            {
                member_connections
                    .entry(member)
                    .or_default()
                    .push(connection);
            }
        }

        let (materials, profiles) = self.associations();

        for &id in member_ids {
            let Some(args) = self.step.args(id) else {
                continue;
            };
            let points = self.product_points(&args);
            let (Some(&first), Some(&last)) = (points.first(), points.last()) else {
                self.model
                    .notes
                    .push(format!("structural member #{id} has no vertices; skipped"));
                continue;
            };
            let global_id = args
                .first()
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned();
            let name = args
                .get(2)
                .and_then(Value::as_str)
                .filter(|n| !n.trim().is_empty())
                .map(str::to_owned)
                .unwrap_or_else(|| global_id.clone());
            let connections = member_connections.get(&id).cloned().unwrap_or_default();
            // A connection counts as the member end when it sits within 0.1 % of the
            // member length of it; anything farther is another member's end.
            let tolerance = (distance(&first, &last) * 1e-3).max(1e-6);
            let start = self.end_node(first, &connections, &connection_names, tolerance);
            let end = self.end_node(last, &connections, &connection_names, tolerance);
            let (material, section) = (materials.get(&id).cloned(), profiles.get(&id).cloned());
            if let Some(section) = &section
                && !self.model.sections.iter().any(|s| &s.name == section)
            {
                self.model.sections.push(Section {
                    name: section.clone(),
                    material: material.clone(),
                    shape: None,
                    dimensions: Vec::new(),
                    thickness: None,
                });
            }
            if let Some(material) = &material
                && !self.model.materials.iter().any(|m| &m.name == material)
            {
                self.model.materials.push(Material {
                    name: material.clone(),
                    kind: "other".into(),
                    grade: None,
                    e_modulus: None,
                    unit_weight: None,
                });
            }
            self.model.members.push(Member {
                uid: if global_id.is_empty() {
                    format!("#{id}")
                } else {
                    global_id
                },
                name,
                kind: MemberKind::Other,
                start,
                end,
                section,
                material,
                storey: None,
            });
        }

        for &id in surface_ids {
            let Some(args) = self.step.args(id) else {
                continue;
            };
            let points = self.product_points(&args);
            if points.len() < 3 {
                continue;
            }
            let global_id = args
                .first()
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned();
            let name = args
                .get(2)
                .and_then(Value::as_str)
                .filter(|n| !n.trim().is_empty())
                .map(str::to_owned)
                .unwrap_or_else(|| global_id.clone());
            let nodes: Vec<String> = points
                .iter()
                .map(|p| self.node_at(*p, None))
                .collect::<Vec<_>>();
            let mut nodes_dedup: Vec<String> = Vec::new();
            for n in nodes {
                if nodes_dedup.last() != Some(&n) && !nodes_dedup.contains(&n) {
                    nodes_dedup.push(n);
                }
            }
            let z_span = points.iter().map(|p| p[2]).fold(f64::MIN, f64::max)
                - points.iter().map(|p| p[2]).fold(f64::MAX, f64::min);
            let xy_span = points
                .iter()
                .map(|p| p[0].hypot(p[1]))
                .fold(f64::MIN, f64::max)
                - points
                    .iter()
                    .map(|p| p[0].hypot(p[1]))
                    .fold(f64::MAX, f64::min);
            let thickness = args.get(9).and_then(Value::as_f64);
            let material = materials.get(&id).cloned();
            self.model.surfaces.push(Surface {
                uid: if global_id.is_empty() {
                    format!("#{id}")
                } else {
                    global_id
                },
                name,
                kind: if z_span <= xy_span * 0.1 {
                    "slab".into()
                } else {
                    "wall".into()
                },
                nodes: nodes_dedup,
                section: thickness.map(|t| format!("t={t}")),
                material,
                storey: None,
            });
        }

        self.loads();
    }

    /// Node name for a coordinate, reusing a node already there (within a micron).
    fn node_at(&mut self, p: Point, proposed: Option<String>) -> String {
        let key = (
            (p[0] * 1e6).round() as i64,
            (p[1] * 1e6).round() as i64,
            (p[2] * 1e6).round() as i64,
        );
        if let Some(existing) = self.node_by_key.get(&key) {
            return existing.clone();
        }
        let taken = |nodes: &[Node], n: &str| nodes.iter().any(|x| x.name == n);
        let name = match proposed.filter(|n| !taken(&self.model.nodes, n)) {
            Some(n) => n,
            None => loop {
                // Generated names must not collide with names the file gave its connections.
                self.node_counter += 1;
                let candidate = format!("N{}", self.node_counter);
                if !taken(&self.model.nodes, &candidate) {
                    break candidate;
                }
            },
        };
        self.model.nodes.push(Node {
            name: name.clone(),
            x: p[0],
            y: p[1],
            z: p[2],
        });
        self.node_by_key.insert(key, name.clone());
        name
    }

    /// The connection nearest to an end (within `tolerance`), else a node created there.
    fn end_node(
        &mut self,
        at: Point,
        connections: &[u32],
        names: &HashMap<u32, String>,
        tolerance: f64,
    ) -> String {
        let mut best: Option<(f64, &String)> = None;
        for c in connections {
            let Some(name) = names.get(c) else { continue };
            let Some(node) = self.model.node(name) else {
                continue;
            };
            let d =
                ((node.x - at[0]).powi(2) + (node.y - at[1]).powi(2) + (node.z - at[2]).powi(2))
                    .sqrt();
            if d <= tolerance && best.is_none_or(|(bd, _)| d < bd) {
                best = Some((d, name));
            }
        }
        if let Some((_, name)) = best {
            return name.clone();
        }
        self.node_at(at, None)
    }

    /// World coordinates of the Cartesian points in a product's representation.
    fn product_points(&mut self, args: &[Value]) -> Vec<Point> {
        let placement = args
            .get(5)
            .and_then(Value::as_ref)
            .map(|p| self.placement(p, 0))
            .unwrap_or(Transform::IDENTITY);
        let Some(representation) = args.get(6).and_then(Value::as_ref) else {
            return Vec::new();
        };
        let mut raw = Vec::new();
        let mut visited = HashSet::new();
        self.collect_points(representation, 0, &mut raw, &mut visited);
        let mut out: Vec<Point> = Vec::with_capacity(raw.len());
        for p in raw {
            let w = placement.apply(p);
            if out.last().is_none_or(|l| distance(l, &w) > 1e-9) {
                out.push(w);
            }
        }
        out
    }

    fn collect_points(&self, id: u32, depth: u8, out: &mut Vec<Point>, visited: &mut HashSet<u32>) {
        if depth > 12 {
            return;
        }
        let Some(kind) = self.step.entity_type(id) else {
            return;
        };
        let Some(args) = self.step.args(id) else {
            return;
        };
        match kind {
            "IFCCARTESIANPOINT" => {
                if let Some(p) = point_of(&args) {
                    out.push(p);
                }
                return;
            }
            // Geometry definitions carry their own points; placements and contexts do not.
            "IFCAXIS2PLACEMENT3D"
            | "IFCAXIS2PLACEMENT2D"
            | "IFCLOCALPLACEMENT"
            | "IFCGEOMETRICREPRESENTATIONCONTEXT"
            | "IFCGEOMETRICREPRESENTATIONSUBCONTEXT"
            | "IFCDIRECTION"
            | "IFCSURFACE"
            | "IFCPLANE" => return,
            _ => {}
        }
        // Oriented edges reuse an edge; visit the shared edge every time it appears so a
        // loop keeps its sequence, but stop cycles elsewhere.
        if kind != "IFCORIENTEDEDGE" && kind != "IFCEDGE" && !visited.insert(id) {
            return;
        }
        let refs: Vec<u32> = args
            .iter()
            .flat_map(|v| match v {
                Value::Ref(r) => vec![*r],
                Value::List(_) => v.ref_list(),
                _ => Vec::new(),
            })
            .collect();
        for r in refs {
            self.collect_points(r, depth + 1, out, visited);
        }
    }

    fn placement(&mut self, id: u32, depth: u8) -> Transform {
        if let Some(t) = self.placements.get(&id) {
            return *t;
        }
        if depth > 64 {
            return Transform::IDENTITY;
        }
        let Some(args) = self.step.args(id) else {
            return Transform::IDENTITY;
        };
        let local = match self.step.entity_type(id) {
            Some("IFCLOCALPLACEMENT") => {
                let parent = args
                    .first()
                    .and_then(Value::as_ref)
                    .map(|p| self.placement(p, depth + 1))
                    .unwrap_or(Transform::IDENTITY);
                let relative = args
                    .get(1)
                    .and_then(Value::as_ref)
                    .map(|a| self.axis_placement(a))
                    .unwrap_or(Transform::IDENTITY);
                parent.then(&relative)
            }
            Some("IFCAXIS2PLACEMENT3D") | Some("IFCAXIS2PLACEMENT2D") => self.axis_placement(id),
            _ => Transform::IDENTITY,
        };
        self.placements.insert(id, local);
        local
    }

    fn axis_placement(&self, id: u32) -> Transform {
        let Some(args) = self.step.args(id) else {
            return Transform::IDENTITY;
        };
        let location = args
            .first()
            .and_then(Value::as_ref)
            .and_then(|p| self.step.args(p))
            .and_then(|a| point_of(&a))
            .unwrap_or([0.0; 3]);
        let direction = |i: usize| {
            args.get(i)
                .and_then(Value::as_ref)
                .and_then(|d| self.step.args(d))
                .and_then(|a| point_of(&a))
        };
        let z = normalise(direction(1).unwrap_or([0.0, 0.0, 1.0]));
        let mut x = direction(2).unwrap_or([1.0, 0.0, 0.0]);
        // Make x orthogonal to z.
        let dot = x[0] * z[0] + x[1] * z[1] + x[2] * z[2];
        x = normalise([x[0] - dot * z[0], x[1] - dot * z[1], x[2] - dot * z[2]]);
        if x.iter().all(|v| v.abs() < 1e-12) {
            x = if z[0].abs() < 0.9 {
                normalise(cross([1.0, 0.0, 0.0], z).map(|v| -v))
            } else {
                normalise(cross([0.0, 1.0, 0.0], z).map(|v| -v))
            };
        }
        let y = cross(z, x);
        Transform {
            m: [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]],
            t: location,
        }
    }

    fn boundary_condition(&self, id: u32) -> Option<[bool; 6]> {
        let args = self.step.args(id)?;
        let fixed = |v: Option<&Value>| match v {
            Some(Value::Typed(_, inner)) => match inner.as_ref() {
                Value::Enum(e) => e == "T" || e == ".T.",
                Value::Float(f) => *f != 0.0,
                Value::Int(i) => *i != 0,
                _ => false,
            },
            Some(Value::Enum(e)) => e == "T" || e == ".T.",
            Some(Value::Float(f)) => *f != 0.0,
            Some(Value::Int(i)) => *i != 0,
            _ => false,
        };
        Some([
            fixed(args.get(1)),
            fixed(args.get(2)),
            fixed(args.get(3)),
            fixed(args.get(4)),
            fixed(args.get(5)),
            fixed(args.get(6)),
        ])
    }

    /// Material and profile names per product from the association relationships.
    fn associations(&self) -> (HashMap<u32, String>, HashMap<u32, String>) {
        let mut materials = HashMap::new();
        let mut profiles = HashMap::new();
        for &rel in self.step.instances_of("IFCRELASSOCIATESMATERIAL") {
            let Some(args) = self.step.args(rel) else {
                continue;
            };
            let related = args.get(4).map(Value::ref_list).unwrap_or_default();
            let Some(material) = args.get(5).and_then(Value::as_ref) else {
                continue;
            };
            let (name, profile) = self.material_names(material, 0);
            for object in related {
                if let Some(n) = &name {
                    materials.insert(object, n.clone());
                }
                if let Some(p) = &profile {
                    profiles.insert(object, p.clone());
                }
            }
        }
        for &rel in self.step.instances_of("IFCRELASSOCIATESPROFILEPROPERTIES") {
            let Some(args) = self.step.args(rel) else {
                continue;
            };
            let related = args.get(4).map(Value::ref_list).unwrap_or_default();
            let Some(props) = args.get(5).and_then(Value::as_ref) else {
                continue;
            };
            let Some(prop_args) = self.step.args(props) else {
                continue;
            };
            let profile_name = prop_args
                .first()
                .and_then(Value::as_str)
                .map(str::to_owned)
                .or_else(|| {
                    prop_args
                        .get(1)
                        .and_then(Value::as_ref)
                        .and_then(|d| self.profile_name(d))
                });
            if let Some(p) = profile_name {
                for object in related {
                    profiles.entry(object).or_insert(p.clone());
                }
            }
        }
        (materials, profiles)
    }

    fn material_names(&self, id: u32, depth: u8) -> (Option<String>, Option<String>) {
        if depth > 6 {
            return (None, None);
        }
        let Some(args) = self.step.args(id) else {
            return (None, None);
        };
        match self.step.entity_type(id) {
            Some("IFCMATERIAL") => (
                args.first().and_then(Value::as_str).map(str::to_owned),
                None,
            ),
            Some("IFCMATERIALPROFILESETUSAGE") | Some("IFCMATERIALLAYERSETUSAGE") => args
                .first()
                .and_then(Value::as_ref)
                .map(|s| self.material_names(s, depth + 1))
                .unwrap_or((None, None)),
            Some("IFCMATERIALPROFILESET") => {
                let first = args.get(2).map(Value::ref_list).unwrap_or_default();
                first
                    .first()
                    .map(|p| self.material_names(*p, depth + 1))
                    .unwrap_or((None, None))
            }
            Some("IFCMATERIALPROFILE") => {
                let material = args
                    .get(2)
                    .and_then(Value::as_ref)
                    .and_then(|m| self.material_names(m, depth + 1).0);
                let profile = args
                    .get(3)
                    .and_then(Value::as_ref)
                    .and_then(|p| self.profile_name(p))
                    .or_else(|| args.first().and_then(Value::as_str).map(str::to_owned));
                (material, profile)
            }
            Some("IFCMATERIALLAYERSET") => {
                let layers = args.first().map(Value::ref_list).unwrap_or_default();
                layers
                    .first()
                    .map(|l| self.material_names(*l, depth + 1))
                    .unwrap_or((None, None))
            }
            Some("IFCMATERIALLAYER") => args
                .first()
                .and_then(Value::as_ref)
                .map(|m| self.material_names(m, depth + 1))
                .unwrap_or((None, None)),
            Some("IFCMATERIALLIST") => {
                let list = args.first().map(Value::ref_list).unwrap_or_default();
                list.first()
                    .map(|m| self.material_names(*m, depth + 1))
                    .unwrap_or((None, None))
            }
            _ => (None, None),
        }
    }

    fn profile_name(&self, id: u32) -> Option<String> {
        let args = self.step.args(id)?;
        // IfcProfileDef(ProfileType, ProfileName, ...)
        args.get(1)
            .and_then(Value::as_str)
            .filter(|n| !n.trim().is_empty())
            .map(str::to_owned)
    }

    fn loads(&mut self) {
        // Load cases and combinations.
        let mut case_of_activity: HashMap<u32, String> = HashMap::new();
        let mut group_names: HashMap<u32, String> = HashMap::new();
        for type_name in ["IFCSTRUCTURALLOADCASE", "IFCSTRUCTURALLOADGROUP"] {
            for &id in self.step.instances_of(type_name) {
                let Some(args) = self.step.args(id) else {
                    continue;
                };
                let name = args
                    .get(2)
                    .and_then(Value::as_str)
                    .filter(|n| !n.trim().is_empty())
                    .map(str::to_owned)
                    .unwrap_or_else(|| format!("Load group #{id}"));
                let predefined = args.get(5).and_then(Value::as_enum).unwrap_or("");
                group_names.insert(id, name.clone());
                if predefined == "LOAD_COMBINATION" {
                    self.model.combinations.push(Combination {
                        name,
                        kind: "combination".into(),
                        factors: Vec::new(),
                    });
                } else {
                    let source = args.get(7).and_then(Value::as_enum).unwrap_or("");
                    let action = args.get(6).and_then(Value::as_enum).unwrap_or("");
                    let kind = match source {
                        "DEAD_LOAD_G" | "PRESTRESSING_P" | "SETTLEMENT_U" => "dead",
                        "LIVE_LOAD_Q" => "live",
                        "WIND_W" => "wind",
                        "SNOW_S" => "snow",
                        "EARTHQUAKE_E" => "seismic",
                        "TEMPERATURE_T" => "temperature",
                        _ => match action {
                            "PERMANENT_G" => "dead",
                            "VARIABLE_Q" => "live",
                            "EXTRAORDINARY_A" => "accidental",
                            _ => "other",
                        },
                    };
                    self.model.load_cases.push(LoadCase {
                        name,
                        kind: kind.into(),
                    });
                }
            }
        }
        for &rel in self.step.instances_of("IFCRELASSIGNSTOGROUP") {
            if let Some(args) = self.step.args(rel)
                && let Some(group) = args.get(6).and_then(Value::as_ref)
                && let Some(name) = group_names.get(&group)
            {
                for object in args.get(4).map(Value::ref_list).unwrap_or_default() {
                    case_of_activity.insert(object, name.clone());
                }
            }
        }
        for &rel in self.step.instances_of("IFCRELASSIGNSTOGROUPBYFACTOR") {
            if let Some(args) = self.step.args(rel)
                && let Some(group) = args.get(6).and_then(Value::as_ref)
                && let Some(name) = group_names.get(&group)
                && let Some(combo) = self.model.combinations.iter_mut().find(|c| &c.name == name)
            {
                let factor = args.get(7).and_then(Value::as_f64).unwrap_or(1.0);
                for object in args.get(4).map(Value::ref_list).unwrap_or_default() {
                    if let Some(case) = group_names.get(&object) {
                        combo.factors.push(Factor {
                            case: case.clone(),
                            factor,
                        });
                    }
                }
            }
        }

        // Activity → element it acts on.
        let mut target_of: HashMap<u32, u32> = HashMap::new();
        for &rel in self.step.instances_of("IFCRELCONNECTSSTRUCTURALACTIVITY") {
            if let Some(args) = self.step.args(rel)
                && let (Some(element), Some(activity)) = (
                    args.get(4).and_then(Value::as_ref),
                    args.get(5).and_then(Value::as_ref),
                )
            {
                target_of.insert(activity, element);
            }
        }
        let connection_node: HashMap<u32, String> = self
            .step
            .instances_of("IFCSTRUCTURALPOINTCONNECTION")
            .iter()
            .filter_map(|&id| {
                let args = self.step.args(id)?;
                let p = self.product_points_readonly(&args).into_iter().next()?;
                let key = (
                    (p[0] * 1e6).round() as i64,
                    (p[1] * 1e6).round() as i64,
                    (p[2] * 1e6).round() as i64,
                );
                Some((id, self.node_by_key.get(&key)?.clone()))
            })
            .collect();
        let member_uid: HashMap<u32, String> = self
            .step
            .instances_of("IFCSTRUCTURALCURVEMEMBER")
            .iter()
            .filter_map(|&id| {
                let args = self.step.args(id)?;
                let gid = args.first().and_then(Value::as_str)?;
                Some((id, gid.to_owned()))
            })
            .collect();

        for &id in self.step.instances_of("IFCSTRUCTURALPOINTACTION") {
            let Some(args) = self.step.args(id) else {
                continue;
            };
            let Some(load) = args
                .get(7)
                .and_then(Value::as_ref)
                .and_then(|l| self.step.args(l))
            else {
                continue;
            };
            let Some(node) = target_of.get(&id).and_then(|t| connection_node.get(t)) else {
                continue;
            };
            let f = |i: usize| load.get(i).and_then(Value::as_f64).unwrap_or(0.0);
            self.model.point_loads.push(PointLoad {
                node: node.clone(),
                case: case_of_activity
                    .get(&id)
                    .cloned()
                    .unwrap_or_else(|| "unassigned".into()),
                force: [f(1), f(2), f(3)],
                moment: [f(4), f(5), f(6)],
            });
        }
        for &id in self.step.instances_of("IFCSTRUCTURALLINEARACTION") {
            let Some(args) = self.step.args(id) else {
                continue;
            };
            let Some(load) = args
                .get(7)
                .and_then(Value::as_ref)
                .and_then(|l| self.step.args(l))
            else {
                continue;
            };
            let Some(member) = target_of.get(&id).and_then(|t| member_uid.get(t)) else {
                continue;
            };
            let f = |i: usize| load.get(i).and_then(Value::as_f64).unwrap_or(0.0);
            let components = [f(1), f(2), f(3)];
            let (axis, value) = components
                .iter()
                .enumerate()
                .max_by(|a, b| a.1.abs().total_cmp(&b.1.abs()))
                .map(|(i, v)| (i, *v))
                .unwrap_or((2, 0.0));
            self.model.line_loads.push(LineLoad {
                member: member.clone(),
                case: case_of_activity
                    .get(&id)
                    .cloned()
                    .unwrap_or_else(|| "unassigned".into()),
                direction: ["x", "y", "z"][axis].into(),
                start: value,
                end: value,
                from: 0.0,
                to: 1.0,
            });
        }
    }

    /// Like `product_points` without caching placements (used after the walk).
    fn product_points_readonly(&self, args: &[Value]) -> Vec<Point> {
        let placement = args
            .get(5)
            .and_then(Value::as_ref)
            .and_then(|p| self.placements.get(&p).copied())
            .unwrap_or(Transform::IDENTITY);
        let Some(representation) = args.get(6).and_then(Value::as_ref) else {
            return Vec::new();
        };
        let mut raw = Vec::new();
        let mut visited = HashSet::new();
        self.collect_points(representation, 0, &mut raw, &mut visited);
        raw.into_iter().map(|p| placement.apply(p)).collect()
    }
}

fn point_of(args: &[Value]) -> Option<Point> {
    let list = args.first()?.as_list()?;
    let x = list.first().and_then(Value::as_f64)?;
    let y = list.get(1).and_then(Value::as_f64).unwrap_or(0.0);
    let z = list.get(2).and_then(Value::as_f64).unwrap_or(0.0);
    Some([x, y, z])
}

fn distance(a: &Point, b: &Point) -> f64 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
}

fn normalise(v: Point) -> Point {
    let len = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    if len <= f64::EPSILON {
        [0.0; 3]
    } else {
        [v[0] / len, v[1] / len, v[2] / len]
    }
}

fn cross(a: Point, b: Point) -> Point {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn application_name(step: &StepFile) -> Option<String> {
    let &app = step.instances_of("IFCAPPLICATION").first()?;
    let args = step.args(app)?;
    let name = args.get(2).and_then(Value::as_str)?;
    let version = args.get(1).and_then(Value::as_str).unwrap_or("");
    Some(format!("{name} {version}").trim().to_owned())
}

fn read_units(step: &StepFile) -> Units {
    let mut units = Units::default();
    for &id in step.instances_of("IFCSIUNIT") {
        let Some(args) = step.args(id) else { continue };
        let prefix = args.get(2).and_then(Value::as_enum).unwrap_or("");
        match args.get(1).and_then(Value::as_enum) {
            Some("LENGTHUNIT") => {
                units.length = match prefix {
                    "MILLI" => "mm",
                    "CENTI" => "cm",
                    _ => "m",
                }
                .into();
            }
            Some("FORCEUNIT") => {
                units.force = if prefix == "KILO" { "kN" } else { "N" }.into();
            }
            _ => {}
        }
    }
    for &id in step.instances_of("IFCCONVERSIONBASEDUNIT") {
        let Some(args) = step.args(id) else { continue };
        if args.get(1).and_then(Value::as_enum) == Some("LENGTHUNIT") {
            match args
                .get(2)
                .and_then(Value::as_str)
                .map(str::to_ascii_uppercase)
                .as_deref()
            {
                Some("FOOT") => units.length = "ft".into(),
                Some("INCH") => units.length = "in".into(),
                _ => {}
            }
        }
    }
    units
}
