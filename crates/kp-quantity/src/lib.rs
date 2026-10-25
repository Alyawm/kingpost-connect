//! Quantity schedules.
//!
//! A schedule is a definition (which elements, which columns, how to group and total)
//! evaluated over one revision: element fields, property values, and quantities derived
//! from the geometry when the model carries none (length, volume, area, and mass as
//! volume times an editable material density). The result is a flat list of rows with
//! group headers and totals, ready for a grid or an export.

use std::collections::{BTreeMap, HashMap};

use kp_store::{DensityRow, ElementSummary, GeometryQuantity, PropertyFact, Store};
use serde::{Deserialize, Serialize};

pub mod export;
pub mod formula;
pub mod presets;

#[derive(Debug, thiserror::Error)]
pub enum QuantityError {
    #[error(transparent)]
    Store(#[from] kp_store::StoreError),
    #[error("{0}")]
    Export(String),
}

pub type Result<T> = std::result::Result<T, QuantityError>;

/// Where a column's value comes from.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ColumnKey {
    /// `ifc_type`, `name`, `tag`, `storey`, `type_name`, `material`, `global_id`.
    Field { field: String },
    /// A property; `pset` of `*` matches the first pset carrying `name`.
    Property { pset: String, name: String },
    /// A quantity from base quantities, else from the geometry: `length`, `volume`,
    /// `area`, `mass`, `count`.
    Derived { quantity: String },
    /// Arithmetic over other columns, by letter (`C / B`) or label (`[Mass] / [Length]`).
    Formula { expr: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Aggregate {
    #[default]
    None,
    Sum,
    Count,
    Avg,
    Min,
    Max,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Column {
    pub key: ColumnKey,
    pub label: String,
    #[serde(default)]
    pub aggregate: Aggregate,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Filter {
    /// Keep these IFC types only; empty keeps all.
    #[serde(default)]
    pub ifc_types: Vec<String>,
    #[serde(default)]
    pub storeys: Vec<String>,
    /// Case-insensitive text that name, tag, type name or material must contain.
    #[serde(default)]
    pub text: String,
    /// Leave out spatial elements and elements without geometry.
    #[serde(default = "default_true")]
    pub physical_only: bool,
}

fn default_true() -> bool {
    true
}

impl Default for Filter {
    fn default() -> Self {
        Self {
            ifc_types: Vec::new(),
            storeys: Vec::new(),
            text: String::new(),
            physical_only: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Definition {
    pub name: String,
    pub columns: Vec<Column>,
    /// Columns (by key) to group by, outermost first.
    #[serde(default)]
    pub group_by: Vec<ColumnKey>,
    #[serde(default)]
    pub filter: Filter,
    /// Sort element rows by this column index, ascending unless `sort_desc`.
    #[serde(default)]
    pub sort_by: Option<usize>,
    #[serde(default)]
    pub sort_desc: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct Cell {
    pub text: String,
    pub num: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RowKind {
    Group,
    Element,
    Subtotal,
    Total,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Row {
    pub kind: RowKind,
    /// Nesting depth: 0 for the outermost group.
    pub depth: usize,
    /// Group value for group and subtotal rows.
    pub label: String,
    pub express_id: Option<i64>,
    pub global_id: Option<String>,
    pub cells: Vec<Cell>,
    /// Elements under this row (1 for an element row).
    pub count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Table {
    pub definition: Definition,
    pub columns: Vec<String>,
    pub rows: Vec<Row>,
    pub element_count: usize,
    /// Elements whose mass needed a density that is not in the table, by material.
    pub missing_densities: Vec<String>,
    /// Formula columns that could not be read, as "label: reason".
    #[serde(default)]
    pub formula_errors: Vec<String>,
}

/// Factors that turn the model's own length, area and volume units into metres, square
/// metres and cubic metres, read from the revision's unit assignment. `None` when the
/// model does not say, in which case lengths fall back to the "over 50 is millimetres" rule.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct UnitScales {
    pub length: Option<f64>,
    pub area: Option<f64>,
    pub volume: Option<f64>,
}

impl UnitScales {
    /// From a revision's `units_json` (`{"length":"mm","area":"m²",...}`).
    pub fn from_units_json(json: &str) -> Self {
        let value: serde_json::Value = serde_json::from_str(json).unwrap_or_default();
        let get = |k: &str| value.get(k).and_then(|v| v.as_str()).map(str::to_owned);
        let length = get("length").and_then(|u| length_factor(&u));
        Self {
            length,
            area: get("area")
                .and_then(|u| length_factor(u.trim_end_matches(['²', '2'])))
                .map(|f| f * f),
            volume: get("volume")
                .and_then(|u| length_factor(u.trim_end_matches(['³', '3'])))
                .map(|f| f * f * f),
        }
    }
}

fn length_factor(unit: &str) -> Option<f64> {
    Some(match unit.trim() {
        "m" => 1.0,
        "mm" => 0.001,
        "cm" => 0.01,
        "dm" => 0.1,
        "km" => 1000.0,
        "in" => 0.0254,
        "ft" => 0.3048,
        _ => return None,
    })
}

/// Default densities in kg/m³, used when the project's table has no entry.
pub const DEFAULT_DENSITIES: &[(&str, f64)] = &[
    ("steel", 7850.0),
    ("s235", 7850.0),
    ("s275", 7850.0),
    ("s355", 7850.0),
    ("s460", 7850.0),
    ("concrete", 2400.0),
    ("c20", 2400.0),
    ("c25", 2400.0),
    ("c30", 2400.0),
    ("c35", 2400.0),
    ("c40", 2400.0),
    ("c45", 2400.0),
    ("c50", 2400.0),
    ("reinforc", 7850.0),
    ("rebar", 7850.0),
    ("timber", 500.0),
    ("wood", 500.0),
    ("aluminium", 2700.0),
    ("aluminum", 2700.0),
    ("masonry", 1900.0),
    ("brick", 1900.0),
    ("glass", 2500.0),
];

struct Context<'a> {
    properties: HashMap<&'a str, Vec<&'a PropertyFact>>,
    geometry: &'a HashMap<i64, GeometryQuantity>,
    densities: &'a [DensityRow],
    scales: UnitScales,
}

impl Context<'_> {
    fn property(&self, global_id: &str, pset: &str, name: &str) -> Option<&PropertyFact> {
        let list = self.properties.get(global_id)?;
        if pset == "*" {
            list.iter()
                .find(|p| p.name.eq_ignore_ascii_case(name))
                .copied()
        } else {
            list.iter()
                .find(|p| p.pset == pset && p.name.eq_ignore_ascii_case(name))
                .copied()
        }
    }

    /// First numeric property whose name is one of `names`, in a quantity set when possible.
    fn quantity_property(&self, global_id: &str, names: &[&str]) -> Option<f64> {
        let list = self.properties.get(global_id)?;
        let mut best: Option<(bool, f64)> = None;
        for p in list {
            if p.value_num.is_none() || !names.iter().any(|n| p.name.eq_ignore_ascii_case(n)) {
                continue;
            }
            let in_qto = p.pset.starts_with("Qto_")
                || p.pset.contains("Quantit")
                || p.pset == "BaseQuantities";
            if best.is_none_or(|(q, _)| in_qto && !q) {
                best = Some((in_qto, p.value_num.unwrap_or(0.0)));
            }
        }
        best.map(|(_, v)| v)
    }

    fn density(&self, material: Option<&str>, missing: &mut Vec<String>) -> Option<f64> {
        let material = material?.trim();
        if material.is_empty() {
            return None;
        }
        if let Some(row) = self
            .densities
            .iter()
            .find(|d| d.material.eq_ignore_ascii_case(material))
        {
            return Some(row.density);
        }
        let lower = material.to_ascii_lowercase();
        if let Some(row) = self
            .densities
            .iter()
            .find(|d| lower.contains(&d.material.to_ascii_lowercase()))
        {
            return Some(row.density);
        }
        if let Some((_, d)) = DEFAULT_DENSITIES.iter().find(|(k, _)| lower.contains(k)) {
            return Some(*d);
        }
        if !missing.contains(&material.to_owned()) {
            missing.push(material.to_owned());
        }
        None
    }
}

/// Evaluates `definition` over `revision_id`.
pub fn evaluate(store: &Store, revision_id: i64, definition: &Definition) -> Result<Table> {
    let elements = store.elements(revision_id)?;
    let facts = store.properties_of_revision(revision_id)?;
    let geometry = store.geometry_quantities(revision_id)?;
    let densities = store.densities()?;
    let scales = store
        .revisions(None)?
        .into_iter()
        .find(|r| r.id == revision_id)
        .map(|r| UnitScales::from_units_json(&r.units_json))
        .unwrap_or_default();
    Ok(evaluate_with(
        definition, &elements, &facts, &geometry, &densities, scales,
    ))
}

/// The pure part, for tests and for callers that already hold the data.
pub fn evaluate_with(
    definition: &Definition,
    elements: &[ElementSummary],
    facts: &[PropertyFact],
    geometry: &HashMap<i64, GeometryQuantity>,
    densities: &[DensityRow],
    scales: UnitScales,
) -> Table {
    let mut properties: HashMap<&str, Vec<&PropertyFact>> = HashMap::new();
    for f in facts {
        properties.entry(f.global_id.as_str()).or_default().push(f);
    }
    let context = Context {
        properties,
        geometry,
        densities,
        scales,
    };
    let mut missing = Vec::new();

    // Formulas are parsed once against the column labels; bad ones are reported.
    let labels: Vec<String> = definition.columns.iter().map(|c| c.label.clone()).collect();
    let mut formula_errors = Vec::new();
    let formulas: Vec<Option<formula::Expr>> = definition
        .columns
        .iter()
        .map(|c| match &c.key {
            ColumnKey::Formula { expr } => match formula::parse(expr, &labels) {
                Ok(parsed) => Some(parsed),
                Err(error) => {
                    formula_errors.push(format!("{}: {error}", c.label));
                    None
                }
            },
            _ => None,
        })
        .collect();

    let filter = &definition.filter;
    let text = filter.text.trim().to_ascii_lowercase();
    let selected: Vec<&ElementSummary> = elements
        .iter()
        .filter(|e| !filter.physical_only || (e.has_geometry && !e.is_spatial))
        .filter(|e| {
            filter.ifc_types.is_empty()
                || filter
                    .ifc_types
                    .iter()
                    .any(|t| t.eq_ignore_ascii_case(&e.ifc_type))
        })
        .filter(|e| {
            filter.storeys.is_empty()
                || e.storey
                    .as_deref()
                    .is_some_and(|s| filter.storeys.iter().any(|f| f == s))
        })
        .filter(|e| {
            text.is_empty()
                || [&e.name, &e.tag, &e.type_name, &e.material]
                    .iter()
                    .any(|v| {
                        v.as_deref()
                            .is_some_and(|v| v.to_ascii_lowercase().contains(&text))
                    })
        })
        .collect();

    // Element rows.
    let mut element_rows: Vec<(Vec<String>, Row)> = selected
        .iter()
        .map(|e| {
            let mut cells: Vec<Cell> = definition
                .columns
                .iter()
                .map(|c| value_of(&context, e, &c.key, &mut missing))
                .collect();
            apply_formulas(&formulas, &mut cells);
            let keys: Vec<String> = definition
                .group_by
                .iter()
                .map(|k| value_of(&context, e, k, &mut missing).text)
                .collect();
            (
                keys,
                Row {
                    kind: RowKind::Element,
                    depth: definition.group_by.len(),
                    label: e
                        .name
                        .clone()
                        .or_else(|| e.tag.clone())
                        .unwrap_or_else(|| format!("#{}", e.express_id)),
                    express_id: Some(e.express_id),
                    global_id: Some(e.global_id.clone()),
                    cells,
                    count: 1,
                },
            )
        })
        .collect();
    if let Some(index) = definition.sort_by.filter(|i| *i < definition.columns.len()) {
        element_rows.sort_by(|a, b| {
            let (x, y) = (&a.1.cells[index], &b.1.cells[index]);
            let order = match (x.num, y.num) {
                (Some(p), Some(q)) => p.total_cmp(&q),
                _ => natural_cmp(&x.text, &y.text),
            };
            if definition.sort_desc {
                order.reverse()
            } else {
                order
            }
        });
    }

    // Group tree, keys in natural order per level.
    let mut rows = Vec::new();
    build_groups(&element_rows, 0, definition, &mut rows);
    let total = aggregate_rows(
        definition,
        element_rows.iter().map(|(_, r)| r),
        "Total",
        RowKind::Total,
        0,
    );
    rows.push(total);

    Table {
        definition: definition.clone(),
        columns: definition.columns.iter().map(|c| c.label.clone()).collect(),
        rows,
        element_count: selected.len(),
        missing_densities: missing,
        formula_errors,
    }
}

/// Fills formula cells from the row's other cells. Formulas may read formulas; a few
/// passes settle any order of columns, and a cycle simply stays empty.
fn apply_formulas(formulas: &[Option<formula::Expr>], cells: &mut [Cell]) {
    if formulas.iter().all(Option::is_none) {
        return;
    }
    for _ in 0..formulas.len() {
        let mut changed = false;
        for (i, expr) in formulas.iter().enumerate() {
            let Some(expr) = expr else { continue };
            let num = formula::evaluate(expr, &|j| {
                if j == i {
                    None
                } else {
                    cells.get(j).and_then(|c| c.num)
                }
            });
            if num != cells[i].num {
                cells[i] = Cell {
                    text: num.map(format_number).unwrap_or_default(),
                    num,
                };
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
}

fn build_groups(
    items: &[(Vec<String>, Row)],
    level: usize,
    definition: &Definition,
    out: &mut Vec<Row>,
) {
    if level >= definition.group_by.len() {
        for (_, row) in items {
            out.push(row.clone());
        }
        return;
    }
    let mut groups: BTreeMap<NaturalKey, Vec<&(Vec<String>, Row)>> = BTreeMap::new();
    for item in items {
        let key = item.0.get(level).cloned().unwrap_or_default();
        groups.entry(NaturalKey(key)).or_default().push(item);
    }
    for (key, members) in groups {
        let label = if key.0.is_empty() {
            "—".to_owned()
        } else {
            key.0.clone()
        };
        let owned: Vec<(Vec<String>, Row)> = members.iter().map(|m| (*m).clone()).collect();
        let mut header = aggregate_rows(
            definition,
            owned.iter().map(|(_, r)| r),
            &label,
            RowKind::Group,
            level,
        );
        header.count = owned.len();
        out.push(header);
        build_groups(&owned, level + 1, definition, out);
        if definition.group_by.len() > 1 || level + 1 < definition.group_by.len() {
            let mut subtotal = aggregate_rows(
                definition,
                owned.iter().map(|(_, r)| r),
                &format!("{label} total"),
                RowKind::Subtotal,
                level,
            );
            subtotal.count = owned.len();
            out.push(subtotal);
        }
    }
}

fn aggregate_rows<'a>(
    definition: &Definition,
    rows: impl Iterator<Item = &'a Row> + Clone,
    label: &str,
    kind: RowKind,
    depth: usize,
) -> Row {
    let count = rows.clone().count();
    let cells = definition
        .columns
        .iter()
        .enumerate()
        .map(|(i, column)| {
            let values: Vec<f64> = rows
                .clone()
                .filter_map(|r| r.cells.get(i).and_then(|c| c.num))
                .collect();
            let num = match column.aggregate {
                Aggregate::None => None,
                Aggregate::Sum => Some(values.iter().sum()),
                Aggregate::Count => Some(count as f64),
                Aggregate::Avg => {
                    (!values.is_empty()).then(|| values.iter().sum::<f64>() / values.len() as f64)
                }
                Aggregate::Min => values.iter().copied().reduce(f64::min),
                Aggregate::Max => values.iter().copied().reduce(f64::max),
            };
            Cell {
                text: num.map(format_number).unwrap_or_default(),
                num,
            }
        })
        .collect();
    Row {
        kind,
        depth,
        label: label.to_owned(),
        express_id: None,
        global_id: None,
        cells,
        count,
    }
}

fn value_of(
    context: &Context,
    e: &ElementSummary,
    key: &ColumnKey,
    missing: &mut Vec<String>,
) -> Cell {
    match key {
        ColumnKey::Field { field } => {
            let text = match field.as_str() {
                "ifc_type" => e.ifc_type.trim_start_matches("IFC").to_owned(),
                "name" => e.name.clone().unwrap_or_default(),
                "tag" => e.tag.clone().unwrap_or_default(),
                "storey" => e.storey.clone().unwrap_or_default(),
                "type_name" => e.type_name.clone().unwrap_or_default(),
                "material" => e.material.clone().unwrap_or_default(),
                "global_id" => e.global_id.clone(),
                "express_id" => e.express_id.to_string(),
                _ => String::new(),
            };
            Cell { text, num: None }
        }
        ColumnKey::Property { pset, name } => match context.property(&e.global_id, pset, name) {
            Some(p) => Cell {
                text: p
                    .value_text
                    .clone()
                    .or_else(|| p.value_num.map(format_number))
                    .unwrap_or_default(),
                num: p.value_num,
            },
            None => Cell::default(),
        },
        ColumnKey::Derived { quantity } => {
            let num = match quantity.as_str() {
                "count" => Some(1.0),
                "length" => context
                    .quantity_property(&e.global_id, &["Length", "NetLength"])
                    .map(|v| match context.scales.length {
                        Some(factor) => v * factor,
                        None => to_metres_if_mm(v),
                    })
                    .or_else(|| context.geometry.get(&e.express_id).and_then(|g| g.length)),
                "volume" => context
                    .quantity_property(&e.global_id, &["NetVolume", "GrossVolume", "Volume"])
                    .map(|v| v * context.scales.volume.unwrap_or(1.0))
                    .or_else(|| context.geometry.get(&e.express_id).and_then(|g| g.volume)),
                "area" => context
                    .quantity_property(
                        &e.global_id,
                        &[
                            "NetArea",
                            "GrossArea",
                            "Area",
                            "NetSurfaceArea",
                            "OuterSurfaceArea",
                        ],
                    )
                    .map(|v| v * context.scales.area.unwrap_or(1.0))
                    .or_else(|| {
                        context
                            .geometry
                            .get(&e.express_id)
                            .and_then(|g| g.surface_area)
                    }),
                "mass" => {
                    let from_model = context.quantity_property(
                        &e.global_id,
                        &["NetWeight", "GrossWeight", "Mass", "Weight"],
                    );
                    from_model.or_else(|| {
                        let volume = context
                            .quantity_property(
                                &e.global_id,
                                &["NetVolume", "GrossVolume", "Volume"],
                            )
                            .map(|v| v * context.scales.volume.unwrap_or(1.0))
                            .or_else(|| {
                                context.geometry.get(&e.express_id).and_then(|g| g.volume)
                            })?;
                        let density = context.density(e.material.as_deref(), missing)?;
                        Some(volume * density)
                    })
                }
                _ => None,
            };
            Cell {
                text: num.map(format_number).unwrap_or_default(),
                num,
            }
        }
        // Filled in after the other columns of the row (see `apply_formulas`).
        ColumnKey::Formula { .. } => Cell::default(),
    }
}

/// Base quantities in millimetre models come as millimetres; lengths over 50 are read as
/// mm and converted. (A 50 m member in a metre model is rarer than a 50 mm length.)
fn to_metres_if_mm(value: f64) -> f64 {
    if value > 50.0 { value / 1000.0 } else { value }
}

pub fn format_number(v: f64) -> String {
    if v == v.trunc() && v.abs() < 1e12 {
        format!("{}", v as i64)
    } else if v.abs() >= 100.0 {
        format!("{v:.1}")
    } else {
        let s = format!("{v:.3}");
        s.trim_end_matches('0').trim_end_matches('.').to_owned()
    }
}

/// Orders "Level 2" before "Level 10".
fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let mut x = a.chars().peekable();
    let mut y = b.chars().peekable();
    loop {
        match (x.peek().copied(), y.peek().copied()) {
            (None, None) => return std::cmp::Ordering::Equal,
            (None, _) => return std::cmp::Ordering::Less,
            (_, None) => return std::cmp::Ordering::Greater,
            (Some(p), Some(q)) if p.is_ascii_digit() && q.is_ascii_digit() => {
                let mut n1 = 0u64;
                while let Some(d) = x.peek().copied().filter(char::is_ascii_digit) {
                    n1 = n1 * 10 + d.to_digit(10).unwrap_or(0) as u64;
                    x.next();
                }
                let mut n2 = 0u64;
                while let Some(d) = y.peek().copied().filter(char::is_ascii_digit) {
                    n2 = n2 * 10 + d.to_digit(10).unwrap_or(0) as u64;
                    y.next();
                }
                if n1 != n2 {
                    return n1.cmp(&n2);
                }
            }
            (Some(p), Some(q)) => {
                let (lp, lq) = (p.to_ascii_lowercase(), q.to_ascii_lowercase());
                if lp != lq {
                    return lp.cmp(&lq);
                }
                x.next();
                y.next();
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct NaturalKey(String);

impl PartialOrd for NaturalKey {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for NaturalKey {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        natural_cmp(&self.0, &other.0).then_with(|| self.0.cmp(&other.0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn element(
        id: i64,
        ifc_type: &str,
        name: &str,
        storey: &str,
        material: &str,
    ) -> ElementSummary {
        ElementSummary {
            express_id: id,
            global_id: format!("G{id}"),
            ifc_type: ifc_type.into(),
            name: Some(name.into()),
            tag: None,
            storey: Some(storey.into()),
            type_name: None,
            material: Some(material.into()),
            parent_express_id: None,
            has_geometry: true,
            is_spatial: false,
        }
    }

    fn fact(id: i64, pset: &str, name: &str, num: f64) -> PropertyFact {
        PropertyFact {
            global_id: format!("G{id}"),
            pset: pset.into(),
            name: name.into(),
            value_text: None,
            value_num: Some(num),
            unit: None,
            kind: "length".into(),
        }
    }

    fn steel_schedule() -> Definition {
        Definition {
            name: "Steel".into(),
            columns: vec![
                Column {
                    key: ColumnKey::Field {
                        field: "name".into(),
                    },
                    label: "Mark".into(),
                    aggregate: Aggregate::None,
                },
                Column {
                    key: ColumnKey::Derived {
                        quantity: "length".into(),
                    },
                    label: "Length".into(),
                    aggregate: Aggregate::Sum,
                },
                Column {
                    key: ColumnKey::Derived {
                        quantity: "mass".into(),
                    },
                    label: "Mass".into(),
                    aggregate: Aggregate::Sum,
                },
                Column {
                    key: ColumnKey::Derived {
                        quantity: "count".into(),
                    },
                    label: "N".into(),
                    aggregate: Aggregate::Count,
                },
            ],
            group_by: vec![ColumnKey::Field {
                field: "storey".into(),
            }],
            filter: Filter {
                ifc_types: vec!["IFCBEAM".into()],
                ..Default::default()
            },
            sort_by: Some(1),
            sort_desc: true,
        }
    }

    #[test]
    fn groups_totals_and_derives_mass_from_volume_and_density() {
        let elements = vec![
            element(1, "IFCBEAM", "B1", "Level 2", "S355"),
            element(2, "IFCBEAM", "B2", "Level 10", "S355"),
            element(3, "IFCBEAM", "B3", "Level 2", "Mystery alloy"),
            element(4, "IFCCOLUMN", "C1", "Level 2", "S355"),
        ];
        let facts = vec![
            fact(1, "Qto_BeamBaseQuantities", "Length", 6000.0),
            fact(1, "Qto_BeamBaseQuantities", "NetVolume", 0.0414),
            fact(2, "Qto_BeamBaseQuantities", "Length", 4.0),
            fact(2, "Pset_Other", "NetWeight", 300.0),
        ];
        let mut geometry = HashMap::new();
        geometry.insert(
            3,
            GeometryQuantity {
                express_id: 3,
                volume: Some(0.02),
                surface_area: None,
                length: Some(3.0),
                bbox_min: [0.0; 3],
                bbox_max: [0.0; 3],
            },
        );
        let table = evaluate_with(
            &steel_schedule(),
            &elements,
            &facts,
            &geometry,
            &[],
            UnitScales::default(),
        );

        assert_eq!(table.element_count, 3, "the column is filtered out");
        assert_eq!(table.missing_densities, vec!["Mystery alloy".to_owned()]);
        let kinds: Vec<(RowKind, &str)> = table
            .rows
            .iter()
            .map(|r| (r.kind, r.label.as_str()))
            .collect();
        assert_eq!(
            kinds,
            vec![
                (RowKind::Group, "Level 2"),
                (RowKind::Element, "B1"),
                (RowKind::Element, "B3"),
                (RowKind::Group, "Level 10"),
                (RowKind::Element, "B2"),
                (RowKind::Total, "Total"),
            ],
            "natural storey order, B1 before B3 by descending length"
        );
        let b1 = &table.rows[1];
        assert_eq!(b1.cells[1].num, Some(6.0), "6000 mm read as metres");
        assert!(
            (b1.cells[2].num.unwrap() - 0.0414 * 7850.0).abs() < 1e-6,
            "S355 density by default"
        );
        let b2 = &table.rows[4];
        assert_eq!(
            b2.cells[2].num,
            Some(300.0),
            "a weight property wins over derivation"
        );
        let level2 = &table.rows[0];
        assert_eq!(level2.count, 2);
        assert_eq!(level2.cells[3].num, Some(2.0));
        let total = table.rows.last().unwrap();
        assert!((total.cells[1].num.unwrap() - 13.0).abs() < 1e-9);
        assert!((total.cells[2].num.unwrap() - (0.0414 * 7850.0 + 300.0)).abs() < 1e-6);
    }

    #[test]
    fn project_densities_override_defaults() {
        let elements = vec![element(1, "IFCBEAM", "B1", "L1", "S355")];
        let facts = vec![fact(1, "Qto_BeamBaseQuantities", "NetVolume", 1.0)];
        let densities = vec![DensityRow {
            material: "S355".into(),
            density: 8000.0,
            note: None,
        }];
        let definition = Definition {
            group_by: vec![],
            ..steel_schedule()
        };
        let table = evaluate_with(
            &definition,
            &elements,
            &facts,
            &HashMap::new(),
            &densities,
            UnitScales::default(),
        );
        assert_eq!(table.rows[0].cells[2].num, Some(8000.0));
    }

    #[test]
    fn numbers_and_names_sort_naturally() {
        assert_eq!(natural_cmp("Level 2", "Level 10"), std::cmp::Ordering::Less);
        assert_eq!(natural_cmp("b", "A"), std::cmp::Ordering::Greater);
        assert_eq!(format_number(6.0), "6");
        assert_eq!(format_number(324.9), "324.9");
        assert_eq!(format_number(0.0414), "0.041");
    }

    #[test]
    fn formula_columns_compute_per_row_and_total() {
        let elements = vec![
            element(1, "IFCBEAM", "B1", "L1", "S355"),
            element(2, "IFCBEAM", "B2", "L1", "S355"),
        ];
        let facts = vec![
            fact(1, "Qto_BeamBaseQuantities", "Length", 6.0),
            fact(1, "Qto_BeamBaseQuantities", "NetVolume", 0.0414),
            fact(2, "Qto_BeamBaseQuantities", "Length", 4.0),
            fact(2, "Qto_BeamBaseQuantities", "NetVolume", 0.0276),
        ];
        let mut definition = Definition {
            group_by: vec![],
            sort_by: None,
            ..steel_schedule()
        };
        definition.columns.push(Column {
            key: ColumnKey::Formula {
                expr: "[Mass] / B".into(),
            },
            label: "kg/m".into(),
            aggregate: Aggregate::Avg,
        });
        // A formula that reads a later formula still settles.
        definition.columns.push(Column {
            key: ColumnKey::Formula {
                expr: "[kg/m] * 1000".into(),
            },
            label: "g/m".into(),
            aggregate: Aggregate::None,
        });
        definition.columns.push(Column {
            key: ColumnKey::Formula {
                expr: "[Width] * 2".into(),
            },
            label: "Broken".into(),
            aggregate: Aggregate::None,
        });
        let table = evaluate_with(
            &definition,
            &elements,
            &facts,
            &HashMap::new(),
            &[],
            UnitScales::default(),
        );
        let b1 = &table.rows[0];
        assert!((b1.cells[4].num.unwrap() - 0.0414 * 7850.0 / 6.0).abs() < 1e-9);
        assert!((b1.cells[5].num.unwrap() - 0.0414 * 7850.0 / 6.0 * 1000.0).abs() < 1e-6);
        assert_eq!(b1.cells[6].num, None);
        assert_eq!(table.formula_errors.len(), 1);
        assert!(table.formula_errors[0].starts_with("Broken: "));
        let total = table.rows.last().unwrap();
        assert!((total.cells[4].num.unwrap() - 0.0414 * 7850.0 / 6.0).abs() < 1e-6);
    }

    #[test]
    fn model_units_replace_the_millimetre_guess() {
        let scales = UnitScales::from_units_json(r#"{"length":"mm","area":"mm²","volume":"m³"}"#);
        assert_eq!(scales.length, Some(0.001));
        assert!((scales.area.unwrap() - 1e-6).abs() < 1e-15);
        assert_eq!(scales.volume, Some(1.0));
        assert_eq!(UnitScales::from_units_json("{}"), UnitScales::default());
        assert_eq!(
            UnitScales::from_units_json(r#"{"length":"ft"}"#).length,
            Some(0.3048)
        );

        // A 30 mm plate thickness in a millimetre model: the guess would keep 30 m.
        let elements = vec![element(1, "IFCBEAM", "P1", "L1", "S355")];
        let facts = vec![fact(1, "Qto_BeamBaseQuantities", "Length", 30.0)];
        let definition = Definition {
            group_by: vec![],
            ..steel_schedule()
        };
        let guessed = evaluate_with(
            &definition,
            &elements,
            &facts,
            &HashMap::new(),
            &[],
            UnitScales::default(),
        );
        assert_eq!(guessed.rows[0].cells[1].num, Some(30.0));
        let known = evaluate_with(&definition, &elements, &facts, &HashMap::new(), &[], scales);
        assert_eq!(known.rows[0].cells[1].num, Some(0.03));
    }
}
