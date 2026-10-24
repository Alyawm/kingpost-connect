//! Geometry-derived quantities, material densities, saved presets and the property
//! catalogue a schedule editor offers.

use std::collections::HashMap;

use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::{Result, Store};

/// Quantities the interface measures from an element's mesh, in metres.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GeometryQuantity {
    pub express_id: i64,
    pub volume: Option<f64>,
    pub surface_area: Option<f64>,
    pub length: Option<f64>,
    pub bbox_min: [f64; 3],
    pub bbox_max: [f64; 3],
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DensityRow {
    pub material: String,
    /// kg/m³
    pub density: f64,
    pub note: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PresetRow {
    pub id: String,
    pub scope: String,
    pub kind: String,
    pub name: String,
    pub definition_json: String,
    pub created_at: String,
}

/// A property as it occurs in a revision, with how many elements carry it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CatalogueEntry {
    pub pset: String,
    pub name: String,
    pub kind: String,
    pub unit: Option<String>,
    pub count: i64,
}

impl Store {
    pub fn save_geometry_quantities(
        &self,
        revision_id: i64,
        rows: &[GeometryQuantity],
    ) -> Result<usize> {
        let tx = self.conn.unchecked_transaction()?;
        let mut written = 0;
        {
            let mut upsert = tx.prepare_cached(
                "INSERT OR REPLACE INTO geometry_ref (element_id, fragment_id, bbox_min_x, bbox_min_y,
                   bbox_min_z, bbox_max_x, bbox_max_y, bbox_max_z, volume, surface_area, length)
                 SELECT id, 'mesh', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11
                 FROM element WHERE revision_id = ?1 AND express_id = ?2",
            )?;
            for r in rows {
                written += upsert.execute(params![
                    revision_id,
                    r.express_id,
                    r.bbox_min[0],
                    r.bbox_min[1],
                    r.bbox_min[2],
                    r.bbox_max[0],
                    r.bbox_max[1],
                    r.bbox_max[2],
                    r.volume,
                    r.surface_area,
                    r.length
                ])?;
            }
        }
        tx.commit()?;
        Ok(written)
    }

    /// Geometry quantities of a revision keyed by express id.
    pub fn geometry_quantities(&self, revision_id: i64) -> Result<HashMap<i64, GeometryQuantity>> {
        let mut statement = self.conn.prepare(
            "SELECT e.express_id, g.volume, g.surface_area, g.length,
                    g.bbox_min_x, g.bbox_min_y, g.bbox_min_z, g.bbox_max_x, g.bbox_max_y, g.bbox_max_z
             FROM geometry_ref g JOIN element e ON e.id = g.element_id
             WHERE e.revision_id = ?1",
        )?;
        let rows = statement.query_map([revision_id], |row| {
            Ok(GeometryQuantity {
                express_id: row.get(0)?,
                volume: row.get(1)?,
                surface_area: row.get(2)?,
                length: row.get(3)?,
                bbox_min: [
                    row.get::<_, Option<f64>>(4)?.unwrap_or(0.0),
                    row.get::<_, Option<f64>>(5)?.unwrap_or(0.0),
                    row.get::<_, Option<f64>>(6)?.unwrap_or(0.0),
                ],
                bbox_max: [
                    row.get::<_, Option<f64>>(7)?.unwrap_or(0.0),
                    row.get::<_, Option<f64>>(8)?.unwrap_or(0.0),
                    row.get::<_, Option<f64>>(9)?.unwrap_or(0.0),
                ],
            })
        })?;
        let mut map = HashMap::new();
        for row in rows {
            let row = row?;
            map.insert(row.express_id, row);
        }
        Ok(map)
    }

    pub fn geometry_quantity_count(&self, revision_id: i64) -> Result<i64> {
        Ok(self.conn.query_row(
            "SELECT COUNT(*) FROM geometry_ref g JOIN element e ON e.id = g.element_id WHERE e.revision_id = ?1",
            [revision_id],
            |r| r.get(0),
        )?)
    }

    pub fn densities(&self) -> Result<Vec<DensityRow>> {
        let mut statement = self
            .conn
            .prepare("SELECT material, density, note FROM material_density ORDER BY material")?;
        let rows = statement.query_map([], |row| {
            Ok(DensityRow {
                material: row.get(0)?,
                density: row.get(1)?,
                note: row.get(2)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn set_density(&self, material: &str, density: f64, note: Option<&str>) -> Result<()> {
        self.conn.execute(
            "INSERT INTO material_density (material, density, note) VALUES (?1, ?2, ?3)
             ON CONFLICT(material) DO UPDATE SET density = excluded.density, note = excluded.note",
            params![material, density, note],
        )?;
        Ok(())
    }

    pub fn remove_density(&self, material: &str) -> Result<bool> {
        Ok(self.conn.execute(
            "DELETE FROM material_density WHERE material = ?1",
            [material],
        )? > 0)
    }

    pub fn presets(&self, kind: &str) -> Result<Vec<PresetRow>> {
        let mut statement = self.conn.prepare(
            "SELECT id, scope, kind, name, definition_json, created_at FROM preset
             WHERE kind = ?1 ORDER BY name",
        )?;
        let rows = statement.query_map([kind], |row| {
            Ok(PresetRow {
                id: row.get(0)?,
                scope: row.get(1)?,
                kind: row.get(2)?,
                name: row.get(3)?,
                definition_json: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn save_preset(
        &self,
        id: &str,
        scope: &str,
        kind: &str,
        name: &str,
        definition_json: &str,
    ) -> Result<()> {
        self.conn.execute(
            "INSERT INTO preset (id, scope, kind, name, definition_json) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, definition_json = excluded.definition_json",
            params![id, scope, kind, name, definition_json],
        )?;
        Ok(())
    }

    pub fn delete_preset(&self, id: &str) -> Result<bool> {
        Ok(self
            .conn
            .execute("DELETE FROM preset WHERE id = ?1", [id])?
            > 0)
    }

    /// Every (pset, property) of a revision with its kind, unit and element count.
    pub fn property_catalogue(&self, revision_id: i64) -> Result<Vec<CatalogueEntry>> {
        let mut statement = self.conn.prepare(
            "SELECT p.pset, p.name, MIN(p.kind), MIN(p.unit), COUNT(*)
             FROM property p JOIN element e ON e.id = p.element_id
             WHERE e.revision_id = ?1
             GROUP BY p.pset, p.name ORDER BY p.pset, p.name",
        )?;
        let rows = statement.query_map([revision_id], |row| {
            Ok(CatalogueEntry {
                pset: row.get(0)?,
                name: row.get(1)?,
                kind: row.get(2)?,
                unit: row.get(3)?,
                count: row.get(4)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ElementRow, PropertyRow};

    #[test]
    fn quantities_densities_presets_and_catalogue_round_trip() {
        let store = Store::open_in_memory().unwrap();
        let file = store.upsert_file("a.ifc", "ifc", None, None, None).unwrap();
        let (rev, _) = store.create_revision(file, "s", None, "{}", None).unwrap();
        store
            .write_revision_content(
                rev,
                &[ElementRow {
                    express_id: 7,
                    global_id: "G7".into(),
                    ifc_type: "IFCBEAM".into(),
                    name: Some("B1".into()),
                    tag: None,
                    storey: None,
                    type_name: None,
                    material: Some("S355".into()),
                    parent_express_id: None,
                    has_geometry: true,
                    is_spatial: false,
                }],
                &[PropertyRow {
                    element_express_id: 7,
                    pset: "Qto_BeamBaseQuantities".into(),
                    name: "Length".into(),
                    value_text: None,
                    value_num: Some(6.0),
                    unit: Some("m".into()),
                    kind: "length".into(),
                }],
            )
            .unwrap();
        assert_eq!(store.geometry_quantity_count(rev).unwrap(), 0);
        let written = store
            .save_geometry_quantities(
                rev,
                &[GeometryQuantity {
                    express_id: 7,
                    volume: Some(0.04),
                    surface_area: Some(9.0),
                    length: Some(6.0),
                    bbox_min: [0.0, 0.0, 0.0],
                    bbox_max: [6.0, 0.2, 0.4],
                }],
            )
            .unwrap();
        assert_eq!(written, 1);
        let map = store.geometry_quantities(rev).unwrap();
        assert_eq!(map[&7].volume, Some(0.04));
        assert_eq!(map[&7].bbox_max, [6.0, 0.2, 0.4]);

        store.set_density("S355", 7850.0, Some("steel")).unwrap();
        store.set_density("S355", 7850.5, None).unwrap();
        assert_eq!(store.densities().unwrap()[0].density, 7850.5);
        assert!(store.remove_density("S355").unwrap());

        store
            .save_preset("p1", "project", "schedule", "Steel", "{}")
            .unwrap();
        store
            .save_preset("p1", "project", "schedule", "Steel members", "{\"a\":1}")
            .unwrap();
        let presets = store.presets("schedule").unwrap();
        assert_eq!(presets.len(), 1);
        assert_eq!(presets[0].name, "Steel members");
        assert!(store.presets("density").unwrap().is_empty());
        assert!(store.delete_preset("p1").unwrap());

        let catalogue = store.property_catalogue(rev).unwrap();
        assert_eq!(catalogue.len(), 1);
        assert_eq!(catalogue[0].name, "Length");
        assert_eq!(catalogue[0].count, 1);
    }
}
