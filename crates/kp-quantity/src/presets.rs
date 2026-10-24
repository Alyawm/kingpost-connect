//! Built-in schedules a structural engineer reaches for first. Saved presets in the
//! project come on top of these.

use crate::{Aggregate, Column, ColumnKey, Definition, Filter};

fn field(field: &str, label: &str) -> Column {
    Column {
        key: ColumnKey::Field {
            field: field.into(),
        },
        label: label.into(),
        aggregate: Aggregate::None,
    }
}

fn derived(quantity: &str, label: &str, aggregate: Aggregate) -> Column {
    Column {
        key: ColumnKey::Derived {
            quantity: quantity.into(),
        },
        label: label.into(),
        aggregate,
    }
}

fn property(name: &str, label: &str, aggregate: Aggregate) -> Column {
    Column {
        key: ColumnKey::Property {
            pset: "*".into(),
            name: name.into(),
        },
        label: label.into(),
        aggregate,
    }
}

pub fn builtin() -> Vec<Definition> {
    vec![
        Definition {
            name: "Steel members".into(),
            columns: vec![
                field("name", "Mark"),
                field("type_name", "Section"),
                field("material", "Grade"),
                derived("length", "Length (m)", Aggregate::Sum),
                derived("mass", "Mass (kg)", Aggregate::Sum),
                derived("count", "Count", Aggregate::Count),
            ],
            group_by: vec![
                ColumnKey::Field {
                    field: "storey".into(),
                },
                ColumnKey::Field {
                    field: "type_name".into(),
                },
            ],
            filter: Filter {
                ifc_types: vec![
                    "IFCBEAM".into(),
                    "IFCCOLUMN".into(),
                    "IFCMEMBER".into(),
                    "IFCPLATE".into(),
                ],
                text: String::new(),
                ..Default::default()
            },
            sort_by: Some(3),
            sort_desc: true,
        },
        Definition {
            name: "Concrete elements".into(),
            columns: vec![
                field("name", "Element"),
                field("ifc_type", "Type"),
                field("material", "Grade"),
                derived("volume", "Volume (m³)", Aggregate::Sum),
                derived("area", "Formwork area (m²)", Aggregate::Sum),
                derived("count", "Count", Aggregate::Count),
            ],
            group_by: vec![
                ColumnKey::Field {
                    field: "storey".into(),
                },
                ColumnKey::Field {
                    field: "ifc_type".into(),
                },
            ],
            filter: Filter {
                ifc_types: vec![
                    "IFCBEAM".into(),
                    "IFCCOLUMN".into(),
                    "IFCSLAB".into(),
                    "IFCWALL".into(),
                    "IFCWALLSTANDARDCASE".into(),
                    "IFCFOOTING".into(),
                    "IFCPILE".into(),
                ],
                text: "concrete".into(),
                ..Default::default()
            },
            sort_by: Some(3),
            sort_desc: true,
        },
        Definition {
            name: "Reinforcement".into(),
            columns: vec![
                field("name", "Bar"),
                property("NominalDiameter", "Ø (mm)", Aggregate::None),
                property("BarLength", "Bar length", Aggregate::Sum),
                derived("length", "Length (m)", Aggregate::Sum),
                derived("mass", "Mass (kg)", Aggregate::Sum),
                derived("count", "Count", Aggregate::Count),
            ],
            group_by: vec![
                ColumnKey::Field {
                    field: "storey".into(),
                },
                ColumnKey::Property {
                    pset: "*".into(),
                    name: "NominalDiameter".into(),
                },
            ],
            filter: Filter {
                ifc_types: vec!["IFCREINFORCINGBAR".into(), "IFCREINFORCINGMESH".into()],
                ..Default::default()
            },
            sort_by: None,
            sort_desc: false,
        },
        Definition {
            name: "Foundations".into(),
            columns: vec![
                field("name", "Element"),
                field("ifc_type", "Type"),
                field("material", "Material"),
                derived("volume", "Volume (m³)", Aggregate::Sum),
                derived("mass", "Mass (kg)", Aggregate::Sum),
                derived("count", "Count", Aggregate::Count),
            ],
            group_by: vec![ColumnKey::Field {
                field: "ifc_type".into(),
            }],
            filter: Filter {
                ifc_types: vec!["IFCFOOTING".into(), "IFCPILE".into(), "IFCSLAB".into()],
                text: String::new(),
                ..Default::default()
            },
            sort_by: Some(3),
            sort_desc: true,
        },
        Definition {
            name: "All elements by type".into(),
            columns: vec![
                field("name", "Element"),
                field("storey", "Storey"),
                field("material", "Material"),
                derived("volume", "Volume (m³)", Aggregate::Sum),
                derived("count", "Count", Aggregate::Count),
            ],
            group_by: vec![ColumnKey::Field {
                field: "ifc_type".into(),
            }],
            filter: Filter::default(),
            sort_by: None,
            sort_desc: false,
        },
    ]
}
