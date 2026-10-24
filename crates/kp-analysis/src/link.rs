//! Matching physical elements (IFC products) to analysis members.
//!
//! The interface supplies each physical element's axis — the two ends of its longest
//! bounding-box dimension, in IFC world metres — because only it has the geometry. Members
//! come from the analysis model, scaled to metres and shifted by a user offset. Matching is
//! by name first, then by nearest axis within a tolerance, one to one. Sections and
//! materials of matched pairs are compared by the numbers in their names and dimensions,
//! which survive the different naming of authoring and analysis programs
//! ("800 x 700mm" against "B800X700").

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::model::{AnalysisModel, MemberKind};

/// A physical element's axis in IFC world metres, as the interface measures it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PhysicalAxis {
    pub global_id: String,
    pub ifc_type: String,
    pub name: Option<String>,
    pub tag: Option<String>,
    pub type_name: Option<String>,
    pub material: Option<String>,
    pub storey: Option<String>,
    pub start: [f64; 3],
    pub end: [f64; 3],
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MatchSettings {
    /// Largest end-to-end distance that still counts as the same axis, in metres.
    pub tolerance: f64,
    /// Added to analysis coordinates (after unit scaling) before comparing, in metres.
    pub offset: [f64; 3],
    /// Only match beams with beams and columns with columns.
    pub same_kind: bool,
}

impl Default for MatchSettings {
    fn default() -> Self {
        Self {
            tolerance: 0.5,
            offset: [0.0; 3],
            same_kind: true,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LinkMethod {
    Name,
    Position,
    Manual,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Link {
    pub global_id: String,
    pub member_uid: String,
    pub method: LinkMethod,
    /// End-to-end distance in metres (0 for name and manual links).
    pub distance: f64,
    pub physical_section: Option<String>,
    pub analysis_section: Option<String>,
    /// `None` when either side has no comparable section.
    pub section_ok: Option<bool>,
    pub physical_material: Option<String>,
    pub analysis_material: Option<String>,
    pub material_ok: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct LinkReport {
    pub links: Vec<Link>,
    pub unmatched_physical: Vec<String>,
    pub unmatched_members: Vec<String>,
    pub physical_count: usize,
    pub member_count: usize,
    pub section_mismatches: usize,
    pub material_mismatches: usize,
}

impl LinkReport {
    pub fn link_for(&self, global_id: &str) -> Option<&Link> {
        self.links.iter().find(|l| l.global_id == global_id)
    }

    /// Replaces or removes the link of one element by hand and refreshes the lists.
    pub fn set_manual(
        &mut self,
        model: &AnalysisModel,
        axis: Option<&PhysicalAxis>,
        global_id: &str,
        member_uid: Option<&str>,
    ) {
        self.links.retain(|l| l.global_id != global_id);
        if let Some(uid) = member_uid {
            self.links.retain(|l| l.member_uid != uid);
            let member = model.member(uid);
            let section = member.and_then(|m| m.section.clone());
            let material = member.and_then(|m| m.material.clone());
            let physical_section = axis.and_then(physical_section_text);
            let physical_material = axis.and_then(|a| a.material.clone());
            self.links.push(Link {
                global_id: global_id.to_owned(),
                member_uid: uid.to_owned(),
                method: LinkMethod::Manual,
                distance: 0.0,
                section_ok: compare_sections(
                    physical_section.as_deref(),
                    section.as_deref(),
                    member
                        .and_then(|m| m.section.as_deref())
                        .and_then(|s| model.section(s)),
                    model.units.length_to_m(),
                ),
                physical_section,
                analysis_section: section,
                material_ok: compare_materials(physical_material.as_deref(), material.as_deref()),
                physical_material,
                analysis_material: material,
            });
        }
        self.refresh_lists(model);
    }

    fn refresh_lists(&mut self, model: &AnalysisModel) {
        let linked_members: HashSet<&str> =
            self.links.iter().map(|l| l.member_uid.as_str()).collect();
        let linked_physical: HashSet<&str> =
            self.links.iter().map(|l| l.global_id.as_str()).collect();
        self.unmatched_members = model
            .members
            .iter()
            .filter(|m| !linked_members.contains(m.uid.as_str()))
            .map(|m| m.uid.clone())
            .collect();
        self.unmatched_physical
            .retain(|g| !linked_physical.contains(g.as_str()));
        self.section_mismatches = self
            .links
            .iter()
            .filter(|l| l.section_ok == Some(false))
            .count();
        self.material_mismatches = self
            .links
            .iter()
            .filter(|l| l.material_ok == Some(false))
            .count();
    }
}

/// Matches `physical` against the members of `model`.
pub fn match_members(
    model: &AnalysisModel,
    physical: &[PhysicalAxis],
    settings: &MatchSettings,
) -> LinkReport {
    let scale = model.units.length_to_m();
    let shift = settings.offset;
    let members: Vec<(usize, [f64; 3], [f64; 3], MemberKind)> = model
        .members
        .iter()
        .enumerate()
        .filter_map(|(i, m)| {
            let (a, b) = model.member_axis(m)?;
            let to_m = |p: [f64; 3]| {
                [
                    p[0] * scale + shift[0],
                    p[1] * scale + shift[1],
                    p[2] * scale + shift[2],
                ]
            };
            Some((i, to_m(a), to_m(b), m.kind))
        })
        .collect();

    let mut links: Vec<Link> = Vec::new();
    let mut used_members: HashSet<usize> = HashSet::new();
    let mut used_physical: HashSet<usize> = HashSet::new();

    // 1. Names: an element whose tag or name equals a member's uid or name.
    let mut by_name: HashMap<String, usize> = HashMap::new();
    for (i, m) in model.members.iter().enumerate() {
        by_name.entry(normalise(&m.uid)).or_insert(i);
        by_name.entry(normalise(&m.name)).or_insert(i);
    }
    for (p, axis) in physical.iter().enumerate() {
        let candidates = [axis.tag.as_deref(), axis.name.as_deref()];
        for candidate in candidates.into_iter().flatten() {
            let key = normalise(candidate);
            if key.is_empty() {
                continue;
            }
            if let Some(&i) = by_name.get(&key)
                && !used_members.contains(&i)
            {
                used_members.insert(i);
                used_physical.insert(p);
                links.push(make_link(model, axis, i, LinkMethod::Name, 0.0, scale));
                break;
            }
        }
    }

    // 2. Position: every remaining pair within tolerance, closest first, one to one.
    let mut candidates: Vec<(f64, usize, usize)> = Vec::new();
    for (p, axis) in physical.iter().enumerate() {
        if used_physical.contains(&p) {
            continue;
        }
        let physical_kind = MemberKind::from_axis(
            axis.end[0] - axis.start[0],
            axis.end[1] - axis.start[1],
            axis.end[2] - axis.start[2],
        );
        for (i, a, b, kind) in &members {
            if used_members.contains(i) {
                continue;
            }
            if settings.same_kind && !kinds_compatible(physical_kind, *kind) {
                continue;
            }
            let d = axis_distance(&axis.start, &axis.end, a, b);
            if d <= settings.tolerance {
                candidates.push((d, p, *i));
            }
        }
    }
    candidates.sort_by(|x, y| x.0.total_cmp(&y.0));
    for (d, p, i) in candidates {
        if used_physical.contains(&p) || used_members.contains(&i) {
            continue;
        }
        used_physical.insert(p);
        used_members.insert(i);
        links.push(make_link(
            model,
            &physical[p],
            i,
            LinkMethod::Position,
            d,
            scale,
        ));
    }

    let mut report = LinkReport {
        physical_count: physical.len(),
        member_count: model.members.len(),
        unmatched_physical: physical
            .iter()
            .enumerate()
            .filter(|(p, _)| !used_physical.contains(p))
            .map(|(_, a)| a.global_id.clone())
            .collect(),
        ..Default::default()
    };
    report.links = links;
    report.refresh_lists(model);
    report
}

fn make_link(
    model: &AnalysisModel,
    axis: &PhysicalAxis,
    member_index: usize,
    method: LinkMethod,
    distance: f64,
    scale: f64,
) -> Link {
    let member = &model.members[member_index];
    let physical_section = physical_section_text(axis);
    let section = member.section.as_deref().and_then(|s| model.section(s));
    Link {
        global_id: axis.global_id.clone(),
        member_uid: member.uid.clone(),
        method,
        distance,
        section_ok: compare_sections(
            physical_section.as_deref(),
            member.section.as_deref(),
            section,
            scale,
        ),
        physical_section,
        analysis_section: member.section.clone(),
        material_ok: compare_materials(axis.material.as_deref(), member.material.as_deref()),
        physical_material: axis.material.clone(),
        analysis_material: member.material.clone(),
    }
}

/// The text that names a physical element's section: its type name, else its name
/// without a trailing instance number ("…:800 x 700mm:527274").
fn physical_section_text(axis: &PhysicalAxis) -> Option<String> {
    if let Some(t) = axis.type_name.as_deref().filter(|t| !t.trim().is_empty()) {
        return Some(t.to_owned());
    }
    let name = axis.name.as_deref()?.trim();
    if name.is_empty() {
        return None;
    }
    let trimmed = match name.rsplit_once(':') {
        Some((head, tail)) if tail.chars().all(|c| c.is_ascii_digit()) => head,
        _ => name,
    };
    Some(trimmed.to_owned())
}

fn kinds_compatible(a: MemberKind, b: MemberKind) -> bool {
    a == b || a == MemberKind::Other || b == MemberKind::Other
}

/// Largest end-to-end distance over the better of the two orientations.
pub fn axis_distance(p0: &[f64; 3], p1: &[f64; 3], a: &[f64; 3], b: &[f64; 3]) -> f64 {
    let d = |x: &[f64; 3], y: &[f64; 3]| {
        ((x[0] - y[0]).powi(2) + (x[1] - y[1]).powi(2) + (x[2] - y[2]).powi(2)).sqrt()
    };
    let straight = d(p0, a).max(d(p1, b));
    let flipped = d(p0, b).max(d(p1, a));
    straight.min(flipped)
}

fn normalise(text: &str) -> String {
    text.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect()
}

/// Whole-millimetre numbers found in a section name: "UB 406x178x54" → [54, 178, 406].
pub fn section_numbers(text: &str) -> Vec<i64> {
    let mut out = Vec::new();
    let mut current = String::new();
    for c in text.chars().chain(std::iter::once(' ')) {
        if c.is_ascii_digit() || (c == '.' && !current.is_empty()) {
            current.push(c);
        } else if !current.is_empty() {
            if let Ok(v) = current.trim_end_matches('.').parse::<f64>()
                && v > 0.0
            {
                out.push(v.round() as i64);
            }
            current.clear();
        }
    }
    out.sort_unstable();
    out
}

/// Numbers of an analysis section as millimetres: those in its name and, when it has
/// dimensions, those too (steel names carry nominal sizes, dimensions the actual ones).
fn analysis_section_numbers(
    name: Option<&str>,
    section: Option<&crate::model::Section>,
    scale_to_m: f64,
) -> Vec<i64> {
    let mut out = name.map(section_numbers).unwrap_or_default();
    if let Some(section) = section {
        // Dimensions add the sizes the name does not already carry; a size the name has
        // (within tolerance) is not repeated, so "800 x 800" keeps both of its 800s.
        for value in section
            .dimensions
            .iter()
            .map(|d| (d.value * scale_to_m * 1000.0).round() as i64)
            .filter(|v| *v > 0)
        {
            if !out.iter().any(|existing| close(*existing, value)) {
                out.push(value);
            }
        }
    }
    out.sort_unstable();
    out
}

/// Two sizes agree within 2 % or 2 mm, whichever is larger.
fn close(a: i64, b: i64) -> bool {
    let tolerance = ((a.max(b) as f64) * 0.02).max(2.0);
    ((a - b).abs() as f64) <= tolerance
}

/// Every number of `needles` has a close partner in `haystack`, each used once.
fn covered(needles: &[i64], haystack: &[i64]) -> bool {
    let mut free: Vec<i64> = haystack.to_vec();
    needles
        .iter()
        .all(|n| match free.iter().position(|h| close(*n, *h)) {
            Some(i) => {
                free.swap_remove(i);
                true
            }
            None => false,
        })
}

/// `Some(true)` when the sections agree, `Some(false)` when they differ, `None` when one
/// side carries nothing comparable. Agreement means the same normalised name, or every size
/// in the physical section name appearing in the analysis section (name or dimensions);
/// a steel section name often carries its mass per metre, which the analysis side may not.
pub fn compare_sections(
    physical: Option<&str>,
    analysis_name: Option<&str>,
    analysis: Option<&crate::model::Section>,
    scale_to_m: f64,
) -> Option<bool> {
    let physical = physical?.trim();
    let analysis_name = analysis_name?.trim();
    if physical.is_empty() || analysis_name.is_empty() {
        return None;
    }
    let (np, na) = (normalise(physical), normalise(analysis_name));
    if np == na {
        return Some(true);
    }
    let p = section_numbers(physical);
    let a = analysis_section_numbers(Some(analysis_name), analysis, scale_to_m);
    if p.len() < 2 || a.len() < 2 {
        // Not a dimensioned name on both sides: only a name containment counts.
        return (np.contains(&na) || na.contains(&np)).then_some(true);
    }
    Some(covered(&p, &a) || covered(&a, &p))
}

/// Materials agree when their normalised names contain each other or share their leading
/// number ("C30/37" against "C30"). A side without a number ("Concrete - Cast-in-Place")
/// cannot be compared with a grade, so that is `None`, not a difference.
pub fn compare_materials(physical: Option<&str>, analysis: Option<&str>) -> Option<bool> {
    let p = physical?.trim();
    let a = analysis?.trim();
    if p.is_empty() || a.is_empty() {
        return None;
    }
    let (np, na) = (normalise(p), normalise(a));
    if np == na || np.contains(&na) || na.contains(&np) {
        return Some(true);
    }
    let pn = section_numbers(p);
    let an = section_numbers(a);
    match (pn.first(), an.first()) {
        (Some(x), Some(y)) => Some(x == y),
        _ => None,
    }
}
