//! Revision comparison.
//!
//! Two revisions of the same file are compared by IFC GlobalId, which authoring tools
//! keep stable across exports. An element present only in the newer revision is *added*,
//! only in the older one *removed*; one present in both is *modified* when its identity
//! fields (name, tag, type, material, storey, IFC type) or any property or quantity
//! differ. Numbers compare with a relative tolerance so re-exports that only shuffle the
//! last digits do not count as changes.

use std::collections::{BTreeMap, HashMap, HashSet};

use kp_store::{DiffItemRow, ElementSummary, PropertyFact, Store};
use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum DiffError {
    #[error(transparent)]
    Store(#[from] kp_store::StoreError),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, DiffError>;

/// Relative tolerance for numeric property comparison.
pub const NUMERIC_TOLERANCE: f64 = 1e-6;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FieldChange {
    /// `pset/name` for properties; `name`, `tag`, `type_name`, `material`, `storey`,
    /// `ifc_type` for identity fields.
    pub field: String,
    pub from: Option<String>,
    pub to: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ItemDetail {
    pub ifc_type: String,
    pub name: Option<String>,
    pub storey: Option<String>,
    pub type_name: Option<String>,
    #[serde(default)]
    pub changes: Vec<FieldChange>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DiffItem {
    pub global_id: String,
    pub change: Change,
    pub detail: ItemDetail,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Change {
    Added,
    Removed,
    Modified,
}

impl Change {
    pub fn as_str(self) -> &'static str {
        match self {
            Change::Added => "added",
            Change::Removed => "removed",
            Change::Modified => "modified",
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Summary {
    pub from_elements: usize,
    pub to_elements: usize,
    pub added: usize,
    pub removed: usize,
    pub modified: usize,
    pub unchanged: usize,
    /// Counts of added/removed/modified per IFC type, for the overview table.
    pub by_type: BTreeMap<String, [usize; 3]>,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Diff {
    pub summary: Summary,
    pub items: Vec<DiffItem>,
}

/// Compares two revisions already in the store. Spatial elements are ignored.
pub fn compare(store: &Store, from_revision: i64, to_revision: i64) -> Result<Diff> {
    let started = std::time::Instant::now();
    let from_elements = store.elements(from_revision)?;
    let to_elements = store.elements(to_revision)?;
    let from_props = group_properties(store.properties_of_revision(from_revision)?);
    let to_props = group_properties(store.properties_of_revision(to_revision)?);
    let mut diff = compare_sets(&from_elements, &to_elements, &from_props, &to_props);
    diff.summary.elapsed_ms = started.elapsed().as_millis() as u64;
    Ok(diff)
}

type PropertyMap = HashMap<String, BTreeMap<String, PropertyFact>>;

fn group_properties(facts: Vec<PropertyFact>) -> PropertyMap {
    let mut map: PropertyMap = HashMap::new();
    for fact in facts {
        let key = format!("{}/{}", fact.pset, fact.name);
        map.entry(fact.global_id.clone())
            .or_default()
            .insert(key, fact);
    }
    map
}

/// The pure comparison, separated from storage so it can be tested with plain values.
pub fn compare_sets(
    from_elements: &[ElementSummary],
    to_elements: &[ElementSummary],
    from_props: &PropertyMap,
    to_props: &PropertyMap,
) -> Diff {
    let from: HashMap<&str, &ElementSummary> = from_elements
        .iter()
        .filter(|e| !e.is_spatial)
        .map(|e| (e.global_id.as_str(), e))
        .collect();
    let to: HashMap<&str, &ElementSummary> = to_elements
        .iter()
        .filter(|e| !e.is_spatial)
        .map(|e| (e.global_id.as_str(), e))
        .collect();

    let mut items = Vec::new();
    let mut summary = Summary {
        from_elements: from.len(),
        to_elements: to.len(),
        ..Summary::default()
    };
    let mut bump = |ifc_type: &str, change: Change| {
        let entry = summary.by_type.entry(ifc_type.to_owned()).or_insert([0; 3]);
        entry[change as usize] += 1;
    };

    let mut seen: HashSet<&str> = HashSet::new();
    for (global_id, new) in &to {
        seen.insert(global_id);
        match from.get(global_id) {
            None => {
                bump(&new.ifc_type, Change::Added);
                items.push(DiffItem {
                    global_id: (*global_id).to_owned(),
                    change: Change::Added,
                    detail: detail_of(new, vec![]),
                });
            }
            Some(old) => {
                let empty = BTreeMap::new();
                let changes = element_changes(
                    old,
                    new,
                    from_props.get(*global_id).unwrap_or(&empty),
                    to_props.get(*global_id).unwrap_or(&empty),
                );
                if changes.is_empty() {
                    continue;
                }
                bump(&new.ifc_type, Change::Modified);
                items.push(DiffItem {
                    global_id: (*global_id).to_owned(),
                    change: Change::Modified,
                    detail: detail_of(new, changes),
                });
            }
        }
    }
    for (global_id, old) in &from {
        if !seen.contains(global_id) {
            bump(&old.ifc_type, Change::Removed);
            items.push(DiffItem {
                global_id: (*global_id).to_owned(),
                change: Change::Removed,
                detail: detail_of(old, vec![]),
            });
        }
    }

    summary.added = items.iter().filter(|i| i.change == Change::Added).count();
    summary.removed = items.iter().filter(|i| i.change == Change::Removed).count();
    summary.modified = items
        .iter()
        .filter(|i| i.change == Change::Modified)
        .count();
    summary.unchanged = to.len() - summary.added - summary.modified;
    items.sort_by(|a, b| (a.change as u8, &a.global_id).cmp(&(b.change as u8, &b.global_id)));
    Diff { summary, items }
}

fn detail_of(element: &ElementSummary, changes: Vec<FieldChange>) -> ItemDetail {
    ItemDetail {
        ifc_type: element.ifc_type.clone(),
        name: element.name.clone(),
        storey: element.storey.clone(),
        type_name: element.type_name.clone(),
        changes,
    }
}

fn element_changes(
    old: &ElementSummary,
    new: &ElementSummary,
    old_props: &BTreeMap<String, PropertyFact>,
    new_props: &BTreeMap<String, PropertyFact>,
) -> Vec<FieldChange> {
    let mut changes = Vec::new();
    let mut field = |name: &str, a: Option<&str>, b: Option<&str>| {
        if a != b {
            changes.push(FieldChange {
                field: name.to_owned(),
                from: a.map(str::to_owned),
                to: b.map(str::to_owned),
            });
        }
    };
    field("ifc_type", Some(&old.ifc_type), Some(&new.ifc_type));
    field("name", old.name.as_deref(), new.name.as_deref());
    field("tag", old.tag.as_deref(), new.tag.as_deref());
    field(
        "type_name",
        old.type_name.as_deref(),
        new.type_name.as_deref(),
    );
    field("material", old.material.as_deref(), new.material.as_deref());
    field("storey", old.storey.as_deref(), new.storey.as_deref());

    for (key, after) in new_props {
        match old_props.get(key) {
            None => changes.push(FieldChange {
                field: key.clone(),
                from: None,
                to: Some(display(after)),
            }),
            Some(before) if !same_value(before, after) => changes.push(FieldChange {
                field: key.clone(),
                from: Some(display(before)),
                to: Some(display(after)),
            }),
            Some(_) => {}
        }
    }
    for (key, before) in old_props {
        if !new_props.contains_key(key) {
            changes.push(FieldChange {
                field: key.clone(),
                from: Some(display(before)),
                to: None,
            });
        }
    }
    changes
}

fn same_value(a: &PropertyFact, b: &PropertyFact) -> bool {
    match (a.value_num, b.value_num) {
        (Some(x), Some(y)) => {
            let scale = x.abs().max(y.abs()).max(1.0);
            (x - y).abs() <= NUMERIC_TOLERANCE * scale && a.value_text == b.value_text
        }
        _ => a.value_text == b.value_text && a.value_num == b.value_num,
    }
}

fn display(fact: &PropertyFact) -> String {
    match (&fact.value_text, fact.value_num) {
        (Some(text), _) if fact.kind == "text" || fact.kind == "bool" => text.clone(),
        (_, Some(num)) => match &fact.unit {
            Some(unit) => format!("{} {unit}", trim_number(num)),
            None => trim_number(num),
        },
        (Some(text), None) => text.clone(),
        (None, None) => String::new(),
    }
}

fn trim_number(value: f64) -> String {
    let text = format!("{value:.4}");
    let text = text.trim_end_matches('0').trim_end_matches('.');
    if text.is_empty() || text == "-" {
        "0".to_owned()
    } else {
        text.to_owned()
    }
}

/// Stores a computed diff; returns the diff id.
pub fn save(store: &Store, from_revision: i64, to_revision: i64, diff: &Diff) -> Result<i64> {
    let rows: Vec<DiffItemRow> = diff
        .items
        .iter()
        .map(|item| {
            Ok(DiffItemRow {
                global_id: item.global_id.clone(),
                change: item.change.as_str().to_owned(),
                detail_json: serde_json::to_string(&item.detail)?,
            })
        })
        .collect::<Result<_>>()?;
    Ok(store.save_diff(
        from_revision,
        to_revision,
        &serde_json::to_string(&diff.summary)?,
        &rows,
    )?)
}

/// Loads a stored diff back into typed values.
pub fn load(store: &Store, diff_id: i64, summary_json: &str) -> Result<Diff> {
    let summary: Summary = serde_json::from_str(summary_json)?;
    let items = store
        .diff_items(diff_id)?
        .into_iter()
        .map(|row| {
            let change = match row.change.as_str() {
                "added" => Change::Added,
                "removed" => Change::Removed,
                _ => Change::Modified,
            };
            let detail: ItemDetail = serde_json::from_str(&row.detail_json).unwrap_or_default();
            DiffItem {
                global_id: row.global_id,
                change,
                detail,
            }
        })
        .collect();
    Ok(Diff { summary, items })
}

/// CSV with one line per changed element and one per changed field.
pub fn to_csv(diff: &Diff) -> String {
    let mut out = String::from("change,global_id,ifc_type,name,storey,field,from,to\n");
    for item in &diff.items {
        let base = format!(
            "{},{},{},{},{}",
            item.change.as_str(),
            csv(&item.global_id),
            csv(&item.detail.ifc_type),
            csv(item.detail.name.as_deref().unwrap_or("")),
            csv(item.detail.storey.as_deref().unwrap_or("")),
        );
        if item.detail.changes.is_empty() {
            out.push_str(&base);
            out.push_str(",,,\n");
        }
        for change in &item.detail.changes {
            out.push_str(&base);
            out.push(',');
            out.push_str(&csv(&change.field));
            out.push(',');
            out.push_str(&csv(change.from.as_deref().unwrap_or("")));
            out.push(',');
            out.push_str(&csv(change.to.as_deref().unwrap_or("")));
            out.push('\n');
        }
    }
    out
}

fn csv(value: &str) -> String {
    if value.contains([',', '"', '\n']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn element(
        global_id: &str,
        ifc_type: &str,
        name: &str,
        type_name: Option<&str>,
    ) -> ElementSummary {
        ElementSummary {
            express_id: 0,
            global_id: global_id.into(),
            ifc_type: ifc_type.into(),
            name: Some(name.into()),
            tag: None,
            storey: Some("L1".into()),
            type_name: type_name.map(str::to_owned),
            material: Some("S355".into()),
            parent_express_id: None,
            has_geometry: true,
            is_spatial: false,
        }
    }

    fn fact(
        global_id: &str,
        pset: &str,
        name: &str,
        num: Option<f64>,
        text: Option<&str>,
    ) -> PropertyFact {
        PropertyFact {
            global_id: global_id.into(),
            pset: pset.into(),
            name: name.into(),
            value_text: text.map(str::to_owned),
            value_num: num,
            unit: num.map(|_| "mm".to_owned()),
            kind: if num.is_some() {
                "length".into()
            } else {
                "text".into()
            },
        }
    }

    #[test]
    fn classifies_added_removed_modified_and_unchanged() {
        let from = vec![
            element("A", "IFCBEAM", "B1", Some("UB 406x178x54")),
            element("B", "IFCBEAM", "B2", Some("UB 406x178x54")),
            element("C", "IFCCOLUMN", "C1", None),
        ];
        let to = vec![
            element("A", "IFCBEAM", "B1", Some("UB 406x178x60")),
            element("B", "IFCBEAM", "B2", Some("UB 406x178x54")),
            element("D", "IFCCOLUMN", "C2", None),
        ];
        let from_props = group_properties(vec![
            fact("A", "Qto", "Length", Some(6000.0), None),
            fact("B", "Qto", "Length", Some(6000.0), None),
            fact("B", "Pset", "Reference", None, Some("x")),
        ]);
        let to_props = group_properties(vec![
            fact("A", "Qto", "Length", Some(6000.0000001), None),
            fact("B", "Qto", "Length", Some(6000.0), None),
            fact("B", "Pset", "Reference", None, Some("x")),
        ]);
        let diff = compare_sets(&from, &to, &from_props, &to_props);
        assert_eq!(
            (
                diff.summary.added,
                diff.summary.removed,
                diff.summary.modified,
                diff.summary.unchanged
            ),
            (1, 1, 1, 1)
        );
        let modified = diff.items.iter().find(|i| i.global_id == "A").unwrap();
        assert_eq!(modified.change, Change::Modified);
        assert_eq!(
            modified.detail.changes.len(),
            1,
            "length within tolerance is not a change"
        );
        assert_eq!(modified.detail.changes[0].field, "type_name");
        assert_eq!(
            modified.detail.changes[0].to.as_deref(),
            Some("UB 406x178x60")
        );
        assert_eq!(diff.summary.by_type["IFCCOLUMN"], [1, 1, 0]);
        assert!(
            diff.items
                .iter()
                .any(|i| i.global_id == "D" && i.change == Change::Added)
        );
        assert!(
            diff.items
                .iter()
                .any(|i| i.global_id == "C" && i.change == Change::Removed)
        );
    }

    #[test]
    fn property_additions_removals_and_value_changes_are_listed() {
        let from = vec![element("A", "IFCSLAB", "S1", None)];
        let to = vec![element("A", "IFCSLAB", "S1", None)];
        let from_props = group_properties(vec![
            fact("A", "Qto", "Thickness", Some(200.0), None),
            fact("A", "Pset", "Old", None, Some("gone")),
        ]);
        let to_props = group_properties(vec![
            fact("A", "Qto", "Thickness", Some(250.0), None),
            fact("A", "Pset", "New", None, Some("here")),
        ]);
        let diff = compare_sets(&from, &to, &from_props, &to_props);
        let changes = &diff.items[0].detail.changes;
        let fields: Vec<&str> = changes.iter().map(|c| c.field.as_str()).collect();
        assert_eq!(fields, vec!["Pset/New", "Qto/Thickness", "Pset/Old"]);
        assert_eq!(changes[1].from.as_deref(), Some("200 mm"));
        assert_eq!(changes[1].to.as_deref(), Some("250 mm"));
        let csv = to_csv(&diff);
        assert!(
            csv.lines().count() == 4,
            "header + three field lines: {csv}"
        );
        assert!(csv.contains("modified,A,IFCSLAB,S1,L1,Qto/Thickness,200 mm,250 mm"));
    }

    #[test]
    fn stores_and_reloads_through_the_database() {
        let store = Store::open_in_memory().unwrap();
        let diff = Diff {
            summary: Summary {
                added: 1,
                ..Summary::default()
            },
            items: vec![DiffItem {
                global_id: "X".into(),
                change: Change::Added,
                detail: ItemDetail {
                    ifc_type: "IFCBEAM".into(),
                    ..ItemDetail::default()
                },
            }],
        };
        let file = store.upsert_file("a.ifc", "ifc", None, None, None).unwrap();
        let (r1, _) = store.create_revision(file, "s1", None, "{}", None).unwrap();
        let (r2, _) = store.create_revision(file, "s2", None, "{}", None).unwrap();
        let id = save(&store, r1, r2, &diff).unwrap();
        let found = store.find_diff(r1, r2).unwrap().unwrap();
        assert_eq!(found.id, id);
        let loaded = load(&store, id, &found.summary_json).unwrap();
        assert_eq!(loaded, diff);
        // Saving again replaces the earlier result instead of adding a second one.
        let smaller = Diff {
            summary: Summary::default(),
            items: vec![],
        };
        let id2 = save(&store, r1, r2, &smaller).unwrap();
        let found = store.find_diff(r1, r2).unwrap().unwrap();
        assert_eq!(found.id, id2);
        assert_eq!(store.diff_items(id2).unwrap().len(), 0);
        let count: i64 = store
            .connection()
            .query_row("SELECT COUNT(*) FROM diff_result", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }
}
