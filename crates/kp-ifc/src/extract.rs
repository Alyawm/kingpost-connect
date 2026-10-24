//! Semantic extraction from an indexed STEP file.
//!
//! The reader does not carry the EXPRESS schema. Instead it recognises rooted entities by
//! shape (a 22-character GlobalId followed by the owner history slot) and classifies their
//! types by name, which works across IFC2X3, IFC4 and IFC4X3 without a type table and
//! degrades gracefully on types it has never seen: an unknown rooted type with placement
//! and representation slots is simply a product.

use std::{collections::HashMap, time::Instant};

use crate::{
    model::{Element, IfcModel, ParseStats, Property, Units},
    step::{StepFile, Value},
};

#[derive(Clone, Copy, PartialEq, Eq)]
enum TypeClass {
    Product,
    Spatial,
    TypeObject,
    PropertySet,
    ElementQuantity,
    Aggregates,
    ContainedInSpatialStructure,
    DefinesByProperties,
    DefinesByType,
    AssociatesMaterial,
    Other,
}

const SPATIAL_TYPES: &[&str] = &[
    "IFCPROJECT",
    "IFCSITE",
    "IFCBUILDING",
    "IFCBUILDINGSTOREY",
    "IFCSPACE",
    "IFCFACILITY",
    "IFCFACILITYPART",
    "IFCBRIDGE",
    "IFCBRIDGEPART",
    "IFCROAD",
    "IFCROADPART",
    "IFCRAILWAY",
    "IFCRAILWAYPART",
    "IFCMARINEFACILITY",
    "IFCMARINEPART",
    "IFCEXTERNALSPATIALELEMENT",
    "IFCSPATIALZONE",
];

fn classify(step: &StepFile, type_id: u16, name: &str) -> TypeClass {
    match name {
        "IFCRELAGGREGATES" => return TypeClass::Aggregates,
        "IFCRELCONTAINEDINSPATIALSTRUCTURE" => return TypeClass::ContainedInSpatialStructure,
        "IFCRELDEFINESBYPROPERTIES" => return TypeClass::DefinesByProperties,
        "IFCRELDEFINESBYTYPE" => return TypeClass::DefinesByType,
        "IFCRELASSOCIATESMATERIAL" => return TypeClass::AssociatesMaterial,
        "IFCPROPERTYSET" => return TypeClass::PropertySet,
        "IFCELEMENTQUANTITY" => return TypeClass::ElementQuantity,
        _ => {}
    }
    if name.starts_with("IFCREL") || !name.starts_with("IFC") {
        return TypeClass::Other;
    }
    let Some(&first) = step.instances(type_id).first() else {
        return TypeClass::Other;
    };
    let Some(args) = step.args(first) else {
        return TypeClass::Other;
    };
    let rooted = args.len() >= 4
        && matches!(&args[0], Value::Str(s) if s.len() == 22)
        && matches!(args[1], Value::Ref(_) | Value::Null);
    if !rooted {
        return TypeClass::Other;
    }
    if SPATIAL_TYPES.contains(&name) {
        return TypeClass::Spatial;
    }
    if name.ends_with("TYPE") || name.ends_with("STYLE") {
        return TypeClass::TypeObject;
    }
    if name.ends_with("TEMPLATE") {
        return TypeClass::Other;
    }
    // IfcProduct carries ObjectPlacement and Representation after the IfcObject slots;
    // groups, systems, processes and actors stop at ObjectType.
    if args.len() >= 7 {
        TypeClass::Product
    } else {
        TypeClass::Other
    }
}

struct PropertySetData {
    name: String,
    values: Vec<PropertyValue>,
}

struct PropertyValue {
    name: String,
    value_text: Option<String>,
    value_num: Option<f64>,
    unit: Option<String>,
    kind: &'static str,
}

pub fn extract(step: &StepFile, scan_ms: u64) -> IfcModel {
    let started = Instant::now();

    let classes: Vec<TypeClass> = step
        .types()
        .map(|(id, name)| classify(step, id, name))
        .collect();
    let of_class = |wanted: TypeClass| {
        classes
            .iter()
            .enumerate()
            .filter(move |(_, c)| **c == wanted)
            .flat_map(|(id, _)| step.instances(id as u16).iter().copied())
    };

    let units = read_units(step);

    // Elements and spatial structure.
    let mut elements: Vec<Element> = Vec::new();
    let mut index: HashMap<u32, usize> = HashMap::new();
    let mut storey_elevations: Vec<(u32, f64)> = Vec::new();
    for (class, is_spatial) in [(TypeClass::Spatial, true), (TypeClass::Product, false)] {
        for id in of_class(class) {
            let Some(args) = step.args(id) else { continue };
            let Some(ifc_type) = step.entity_type(id) else {
                continue;
            };
            let name = args.get(2).and_then(Value::as_str).map(str::to_owned);
            let long_name = args.get(7).and_then(Value::as_str).map(str::to_owned);
            let element = Element {
                express_id: id,
                global_id: args
                    .first()
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                ifc_type: ifc_type.to_owned(),
                name: if is_spatial {
                    name.or(long_name.clone())
                } else {
                    name
                },
                tag: if is_spatial {
                    None
                } else {
                    args.get(7).and_then(Value::as_str).map(str::to_owned)
                },
                storey: None,
                type_name: None,
                material: None,
                parent: None,
                has_geometry: args.get(6).and_then(Value::as_ref).is_some(),
                is_spatial,
            };
            if ifc_type == "IFCBUILDINGSTOREY"
                && let Some(elevation) = args.get(9).and_then(Value::as_f64)
            {
                storey_elevations.push((id, elevation));
            }
            index.insert(id, elements.len());
            elements.push(element);
        }
    }

    // Aggregation: spatial hierarchy and element assemblies.
    for id in of_class(TypeClass::Aggregates) {
        let Some(args) = step.args(id) else { continue };
        let (Some(parent), Some(children)) = (args.get(4).and_then(Value::as_ref), args.get(5))
        else {
            continue;
        };
        for child in children.ref_list() {
            if let Some(&i) = index.get(&child) {
                elements[i].parent = Some(parent);
            }
        }
    }

    // Spatial containment: which storey (or other container) holds each element.
    let mut container: HashMap<u32, u32> = HashMap::new();
    for id in of_class(TypeClass::ContainedInSpatialStructure) {
        let Some(args) = step.args(id) else { continue };
        let (Some(related), Some(structure)) = (args.get(4), args.get(5).and_then(Value::as_ref))
        else {
            continue;
        };
        for element in related.ref_list() {
            container.insert(element, structure);
        }
    }
    // The storey a container belongs to: a storey is itself; a space (or any other
    // spatial element) walks up its aggregation chain; the top of the chain names itself.
    let spatial_name = |container: u32| -> Option<String> {
        let mut id = container;
        for _ in 0..8 {
            let element = &elements[*index.get(&id)?];
            if element.ifc_type == "IFCBUILDINGSTOREY" {
                return element.name.clone();
            }
            match element.parent {
                Some(parent) if parent != id && index.contains_key(&parent) => id = parent,
                _ => return element.name.clone(),
            }
        }
        None
    };
    let resolved: Vec<Option<String>> = elements
        .iter()
        .map(|element| {
            if element.is_spatial {
                return if element.ifc_type == "IFCBUILDINGSTOREY" {
                    element.name.clone()
                } else {
                    None
                };
            }
            // Walk up assemblies until a contained element is found.
            let mut current = element.express_id;
            for _ in 0..16 {
                if let Some(&structure) = container.get(&current) {
                    return spatial_name(structure);
                }
                match index.get(&current).and_then(|&i| elements[i].parent) {
                    Some(parent) if parent != current => current = parent,
                    _ => break,
                }
            }
            None
        })
        .collect();
    for (element, storey) in elements.iter_mut().zip(resolved) {
        element.storey = storey;
    }

    // Type objects.
    let mut type_names: HashMap<u32, String> = HashMap::new();
    for id in of_class(TypeClass::TypeObject) {
        if let Some(name) = step
            .args(id)
            .and_then(|a| a.get(2).and_then(Value::as_str).map(str::to_owned))
        {
            type_names.insert(id, name);
        }
    }
    for id in of_class(TypeClass::DefinesByType) {
        let Some(args) = step.args(id) else { continue };
        let (Some(related), Some(type_id)) = (args.get(4), args.get(5).and_then(Value::as_ref))
        else {
            continue;
        };
        let Some(type_name) = type_names.get(&type_id) else {
            continue;
        };
        for element in related.ref_list() {
            if let Some(&i) = index.get(&element) {
                elements[i].type_name = Some(type_name.clone());
            }
        }
    }

    // Materials.
    let mut material_cache: HashMap<u32, Option<String>> = HashMap::new();
    for id in of_class(TypeClass::AssociatesMaterial) {
        let Some(args) = step.args(id) else { continue };
        let (Some(related), Some(material)) = (args.get(4), args.get(5).and_then(Value::as_ref))
        else {
            continue;
        };
        let name = material_cache
            .entry(material)
            .or_insert_with(|| material_name(step, material, 0))
            .clone();
        let Some(name) = name else { continue };
        for element in related.ref_list() {
            if let Some(&i) = index.get(&element) {
                elements[i].material = Some(name.clone());
            }
        }
    }

    // Property sets and quantity sets, decoded once each.
    let mut sets: HashMap<u32, PropertySetData> = HashMap::new();
    let mut property_sets = 0;
    let mut quantity_sets = 0;
    for id in of_class(TypeClass::PropertySet) {
        let Some(args) = step.args(id) else { continue };
        let name = args
            .get(2)
            .and_then(Value::as_str)
            .unwrap_or("Pset")
            .to_owned();
        let values = args
            .get(4)
            .map(Value::ref_list)
            .unwrap_or_default()
            .into_iter()
            .filter_map(|prop| read_property(step, prop, &units))
            .collect();
        sets.insert(id, PropertySetData { name, values });
        property_sets += 1;
    }
    for id in of_class(TypeClass::ElementQuantity) {
        let Some(args) = step.args(id) else { continue };
        let name = args
            .get(2)
            .and_then(Value::as_str)
            .unwrap_or("Qto")
            .to_owned();
        let values = args
            .get(5)
            .map(Value::ref_list)
            .unwrap_or_default()
            .into_iter()
            .filter_map(|quantity| read_quantity(step, quantity, &units))
            .collect();
        sets.insert(id, PropertySetData { name, values });
        quantity_sets += 1;
    }

    let mut properties: Vec<Property> = Vec::new();
    for id in of_class(TypeClass::DefinesByProperties) {
        let Some(args) = step.args(id) else { continue };
        let Some(related) = args.get(4) else { continue };
        // IFC2X3 and IFC4 carry one definition; IFC4X3 allows a list.
        let definitions: Vec<u32> = match args.get(5) {
            Some(Value::Ref(id)) => vec![*id],
            Some(list @ Value::List(_)) => list.ref_list(),
            _ => continue,
        };
        for element in related.ref_list() {
            if !index.contains_key(&element) {
                continue;
            }
            for definition in &definitions {
                let Some(set) = sets.get(definition) else {
                    continue;
                };
                for value in &set.values {
                    properties.push(Property {
                        element,
                        pset: set.name.clone(),
                        name: value.name.clone(),
                        value_text: value.value_text.clone(),
                        value_num: value.value_num,
                        unit: value.unit.clone(),
                        kind: value.kind,
                    });
                }
            }
        }
    }
    for (storey, elevation) in storey_elevations {
        properties.push(Property {
            element: storey,
            pset: "Storey".into(),
            name: "Elevation".into(),
            value_text: None,
            value_num: Some(elevation),
            unit: units.length.clone(),
            kind: "length",
        });
    }

    let spatial = elements.iter().filter(|e| e.is_spatial).count();
    let stats = ParseStats {
        entities: step.entity_count(),
        types: step.type_count(),
        elements: elements.len() - spatial,
        spatial,
        property_sets,
        quantity_sets,
        properties: properties.len(),
        scan_ms,
        extract_ms: started.elapsed().as_millis() as u64,
    };

    IfcModel {
        schema: step.schema().to_owned(),
        units,
        elements,
        properties,
        stats,
    }
}

fn read_property(step: &StepFile, id: u32, units: &Units) -> Option<PropertyValue> {
    let args = step.args(id)?;
    let name = args.first()?.as_str()?.to_owned();
    match step.entity_type(id)? {
        "IFCPROPERTYSINGLEVALUE" => {
            let value = args.get(2)?;
            let unit = args
                .get(3)
                .and_then(Value::as_ref)
                .and_then(|u| unit_symbol(step, u));
            let (value_text, value_num, kind) = decode_value(value);
            let unit = unit.or_else(|| units.for_kind(kind).map(str::to_owned));
            Some(PropertyValue {
                name,
                value_text,
                value_num,
                unit,
                kind,
            })
        }
        "IFCPROPERTYENUMERATEDVALUE" | "IFCPROPERTYLISTVALUE" => {
            let items = args.get(2)?.as_list()?;
            let text = items
                .iter()
                .filter_map(|v| {
                    v.as_str()
                        .map(str::to_owned)
                        .or_else(|| v.as_enum().map(str::to_owned))
                        .or_else(|| v.as_f64().map(|n| n.to_string()))
                })
                .collect::<Vec<_>>()
                .join(", ");
            Some(PropertyValue {
                name,
                value_text: Some(text),
                value_num: None,
                unit: None,
                kind: "text",
            })
        }
        "IFCPROPERTYBOUNDEDVALUE" => {
            let upper = args.get(2).and_then(Value::as_f64);
            let lower = args.get(3).and_then(Value::as_f64);
            let text = match (lower, upper) {
                (Some(l), Some(u)) => format!("{l} – {u}"),
                (Some(l), None) => format!("≥ {l}"),
                (None, Some(u)) => format!("≤ {u}"),
                (None, None) => return None,
            };
            Some(PropertyValue {
                name,
                value_text: Some(text),
                value_num: None,
                unit: None,
                kind: "text",
            })
        }
        _ => None,
    }
}

fn read_quantity(step: &StepFile, id: u32, units: &Units) -> Option<PropertyValue> {
    let args = step.args(id)?;
    let name = args.first()?.as_str()?.to_owned();
    let kind = match step.entity_type(id)? {
        "IFCQUANTITYLENGTH" => "length",
        "IFCQUANTITYAREA" => "area",
        "IFCQUANTITYVOLUME" => "volume",
        "IFCQUANTITYWEIGHT" => "mass",
        "IFCQUANTITYCOUNT" => "count",
        "IFCQUANTITYTIME" => "number",
        _ => return None,
    };
    let value_num = args.get(3).and_then(Value::as_f64)?;
    let unit = args
        .get(2)
        .and_then(Value::as_ref)
        .and_then(|u| unit_symbol(step, u))
        .or_else(|| units.for_kind(kind).map(str::to_owned));
    Some(PropertyValue {
        name,
        value_text: None,
        value_num: Some(value_num),
        unit,
        kind,
    })
}

/// Splits a nominal value into display text, numeric value and kind.
fn decode_value(value: &Value) -> (Option<String>, Option<f64>, &'static str) {
    let (type_name, inner) = match value {
        Value::Typed(name, inner) => (name.as_str(), inner.as_ref()),
        other => ("", other),
    };
    let kind = kind_of(type_name, inner);
    match inner {
        Value::Str(s) => (Some(s.clone()), None, kind),
        Value::Enum(e) if kind == "bool" => {
            let truthy = e == "T" || e == "TRUE";
            (
                Some(if truthy { "true" } else { "false" }.to_owned()),
                Some(truthy as u8 as f64),
                kind,
            )
        }
        Value::Enum(e) => (Some(e.clone()), None, kind),
        Value::Int(i) => (None, Some(*i as f64), kind),
        Value::Float(f) => (None, Some(*f), kind),
        _ => (None, None, kind),
    }
}

fn kind_of(type_name: &str, inner: &Value) -> &'static str {
    match type_name {
        "IFCLENGTHMEASURE" | "IFCPOSITIVELENGTHMEASURE" | "IFCNONNEGATIVELENGTHMEASURE" => "length",
        "IFCAREAMEASURE" => "area",
        "IFCVOLUMEMEASURE" => "volume",
        "IFCMASSMEASURE" => "mass",
        "IFCMASSDENSITYMEASURE" => "density",
        "IFCCOUNTMEASURE" | "IFCINTEGER" => "count",
        "IFCBOOLEAN" | "IFCLOGICAL" => "bool",
        "IFCLABEL" | "IFCTEXT" | "IFCIDENTIFIER" => "text",
        "IFCPLANEANGLEMEASURE" => "angle",
        "IFCFORCEMEASURE" => "force",
        "IFCPRESSUREMEASURE" | "IFCMODULUSOFELASTICITYMEASURE" => "pressure",
        "IFCDATE" | "IFCDATETIME" | "IFCTIMESTAMP" => "date",
        _ => match inner {
            Value::Int(_) | Value::Float(_) => "number",
            Value::Enum(e) if e == "T" || e == "F" || e == "TRUE" || e == "FALSE" || e == "U" => {
                "bool"
            }
            _ => "text",
        },
    }
}

/// Display name for an `IfcMaterialSelect` target, following usages and sets to the
/// `IfcMaterial` names beneath them.
fn material_name(step: &StepFile, id: u32, depth: u8) -> Option<String> {
    if depth > 6 {
        return None;
    }
    let args = step.args(id)?;
    let names_of = |ids: Vec<u32>| -> Option<String> {
        let mut names: Vec<String> = Vec::new();
        for id in ids {
            if let Some(name) = material_name(step, id, depth + 1)
                && !names.contains(&name)
            {
                names.push(name);
            }
        }
        (!names.is_empty()).then(|| names.join(" | "))
    };
    match step.entity_type(id)? {
        "IFCMATERIAL" => args.first()?.as_str().map(str::to_owned),
        "IFCMATERIALLAYERSETUSAGE" | "IFCMATERIALPROFILESETUSAGE" => {
            material_name(step, args.first()?.as_ref()?, depth + 1)
        }
        "IFCMATERIALLAYERSET" => names_of(args.first()?.ref_list()),
        "IFCMATERIALLAYER" => material_name(step, args.first()?.as_ref()?, depth + 1),
        "IFCMATERIALPROFILESET" => names_of(args.get(2)?.ref_list()),
        "IFCMATERIALPROFILE" => material_name(step, args.get(2)?.as_ref()?, depth + 1),
        "IFCMATERIALCONSTITUENTSET" => names_of(args.get(2)?.ref_list()),
        "IFCMATERIALCONSTITUENT" => material_name(step, args.get(2)?.as_ref()?, depth + 1),
        "IFCMATERIALLIST" => names_of(args.first()?.ref_list()),
        _ => None,
    }
}

fn read_units(step: &StepFile) -> Units {
    let mut units = Units::default();
    let Some(&project) = step.instances_of("IFCPROJECT").first() else {
        return units;
    };
    let Some(assignment) = step
        .args(project)
        .and_then(|a| a.get(8).and_then(Value::as_ref))
    else {
        return units;
    };
    let Some(list) = step
        .args(assignment)
        .and_then(|a| a.first().map(Value::ref_list))
    else {
        return units;
    };
    for unit in list {
        let Some(args) = step.args(unit) else {
            continue;
        };
        let Some(unit_type) = args.get(1).and_then(Value::as_enum) else {
            continue;
        };
        let Some(symbol) = unit_symbol(step, unit) else {
            continue;
        };
        match unit_type {
            "LENGTHUNIT" => units.length = Some(symbol),
            "AREAUNIT" => units.area = Some(symbol),
            "VOLUMEUNIT" => units.volume = Some(symbol),
            "MASSUNIT" => units.mass = Some(symbol),
            "PLANEANGLEUNIT" => units.angle = Some(symbol),
            _ => {}
        }
    }
    units
}

fn unit_symbol(step: &StepFile, id: u32) -> Option<String> {
    let args = step.args(id)?;
    match step.entity_type(id)? {
        "IFCSIUNIT" => {
            let prefix = args
                .get(2)
                .and_then(Value::as_enum)
                .map(si_prefix)
                .unwrap_or("");
            let name = args.get(3).and_then(Value::as_enum)?;
            Some(format!("{prefix}{}", si_name(name)))
        }
        "IFCCONVERSIONBASEDUNIT" => {
            args.get(2)
                .and_then(Value::as_str)
                .map(|n| match n.to_ascii_uppercase().as_str() {
                    "INCH" => "in".to_owned(),
                    "FOOT" => "ft".to_owned(),
                    "SQUARE FOOT" | "SQUARE_FOOT" => "ft²".to_owned(),
                    "CUBIC FOOT" | "CUBIC_FOOT" => "ft³".to_owned(),
                    "DEGREE" => "°".to_owned(),
                    "POUND" => "lb".to_owned(),
                    _ => n.to_owned(),
                })
        }
        _ => None,
    }
}

fn si_prefix(prefix: &str) -> &'static str {
    match prefix {
        "MILLI" => "m",
        "CENTI" => "c",
        "DECI" => "d",
        "KILO" => "k",
        "MEGA" => "M",
        "GIGA" => "G",
        "MICRO" => "µ",
        _ => "",
    }
}

fn si_name(name: &str) -> &'static str {
    match name {
        "METRE" => "m",
        "SQUARE_METRE" => "m²",
        "CUBIC_METRE" => "m³",
        "GRAM" => "g",
        "RADIAN" => "rad",
        "DEGREE_CELSIUS" => "°C",
        "KELVIN" => "K",
        "NEWTON" => "N",
        "PASCAL" => "Pa",
        "SECOND" => "s",
        _ => "",
    }
}
