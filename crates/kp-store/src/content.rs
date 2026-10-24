//! Tracked files, revisions and the elements and properties an import writes.

use std::collections::HashMap;

use rusqlite::{OptionalExtension, params};
use serde::Serialize;

use crate::{Result, Store};

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct FileRow {
    pub id: i64,
    pub rel_path: String,
    pub kind: String,
    pub sha256: Option<String>,
    pub size: Option<i64>,
    pub mtime: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RevisionRow {
    pub id: i64,
    pub file_id: i64,
    pub idx: i64,
    pub imported_at: String,
    pub source_sha256: String,
    pub note: Option<String>,
    pub schema: Option<String>,
    pub units_json: String,
    pub element_count: i64,
}

/// An element as an import hands it over; `parent_express_id` is resolved to a row id here.
#[derive(Debug, Clone, PartialEq)]
pub struct ElementRow {
    pub express_id: i64,
    pub global_id: String,
    pub ifc_type: String,
    pub name: Option<String>,
    pub tag: Option<String>,
    pub storey: Option<String>,
    pub type_name: Option<String>,
    pub material: Option<String>,
    pub parent_express_id: Option<i64>,
    pub has_geometry: bool,
    pub is_spatial: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PropertyRow {
    pub element_express_id: i64,
    pub pset: String,
    pub name: String,
    pub value_text: Option<String>,
    pub value_num: Option<f64>,
    pub unit: Option<String>,
    pub kind: String,
}

/// What the interface needs to build trees and lists; properties are fetched per element.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ElementSummary {
    pub express_id: i64,
    pub global_id: String,
    pub ifc_type: String,
    pub name: Option<String>,
    pub tag: Option<String>,
    pub storey: Option<String>,
    pub type_name: Option<String>,
    pub material: Option<String>,
    pub parent_express_id: Option<i64>,
    pub has_geometry: bool,
    pub is_spatial: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PropertyOut {
    pub pset: String,
    pub name: String,
    pub value_text: Option<String>,
    pub value_num: Option<f64>,
    pub unit: Option<String>,
    pub kind: String,
}

const SUMMARY_COLUMNS: &str = "e.express_id, e.global_id, e.ifc_type, e.name, e.tag, e.storey, \
     e.type_name, e.material, p.express_id, e.has_geometry, e.is_spatial";

fn summary_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ElementSummary> {
    Ok(ElementSummary {
        express_id: row.get(0)?,
        global_id: row.get(1)?,
        ifc_type: row.get(2)?,
        name: row.get(3)?,
        tag: row.get(4)?,
        storey: row.get(5)?,
        type_name: row.get(6)?,
        material: row.get(7)?,
        parent_express_id: row.get(8)?,
        has_geometry: row.get::<_, i64>(9)? != 0,
        is_spatial: row.get::<_, i64>(10)? != 0,
    })
}

impl Store {
    /// Records a file by its path relative to the project root; returns its id.
    pub fn upsert_file(
        &self,
        rel_path: &str,
        kind: &str,
        sha256: Option<&str>,
        size: Option<i64>,
        mtime: Option<&str>,
    ) -> Result<i64> {
        self.conn.execute(
            "INSERT INTO file (rel_path, kind, sha256, size, mtime) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(rel_path) DO UPDATE SET
               kind = excluded.kind, sha256 = excluded.sha256,
               size = excluded.size, mtime = excluded.mtime",
            params![rel_path, kind, sha256, size, mtime],
        )?;
        Ok(self.conn.query_row(
            "SELECT id FROM file WHERE rel_path = ?1",
            [rel_path],
            |row| row.get(0),
        )?)
    }

    pub fn files(&self) -> Result<Vec<FileRow>> {
        let mut statement = self.conn.prepare(
            "SELECT id, rel_path, kind, sha256, size, mtime FROM file ORDER BY rel_path",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(FileRow {
                id: row.get(0)?,
                rel_path: row.get(1)?,
                kind: row.get(2)?,
                sha256: row.get(3)?,
                size: row.get(4)?,
                mtime: row.get(5)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn file_by_path(&self, rel_path: &str) -> Result<Option<FileRow>> {
        Ok(self
            .conn
            .query_row(
                "SELECT id, rel_path, kind, sha256, size, mtime FROM file WHERE rel_path = ?1",
                [rel_path],
                |row| {
                    Ok(FileRow {
                        id: row.get(0)?,
                        rel_path: row.get(1)?,
                        kind: row.get(2)?,
                        sha256: row.get(3)?,
                        size: row.get(4)?,
                        mtime: row.get(5)?,
                    })
                },
            )
            .optional()?)
    }

    /// Creates the next revision of a file. Returns (revision id, index within the file).
    pub fn create_revision(
        &self,
        file_id: i64,
        source_sha256: &str,
        schema: Option<&str>,
        units_json: &str,
        note: Option<&str>,
    ) -> Result<(i64, i64)> {
        let idx: i64 = self.conn.query_row(
            "SELECT COALESCE(MAX(idx), 0) + 1 FROM revision WHERE file_id = ?1",
            [file_id],
            |row| row.get(0),
        )?;
        self.conn.execute(
            "INSERT INTO revision (file_id, idx, source_sha256, note, schema, units_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![file_id, idx, source_sha256, note, schema, units_json],
        )?;
        Ok((self.conn.last_insert_rowid(), idx))
    }

    pub fn revisions(&self, file_id: Option<i64>) -> Result<Vec<RevisionRow>> {
        let mut statement = self.conn.prepare(
            "SELECT id, file_id, idx, imported_at, source_sha256, note, schema, units_json, element_count
             FROM revision WHERE (?1 IS NULL OR file_id = ?1) ORDER BY file_id, idx",
        )?;
        let rows = statement.query_map([file_id], |row| {
            Ok(RevisionRow {
                id: row.get(0)?,
                file_id: row.get(1)?,
                idx: row.get(2)?,
                imported_at: row.get(3)?,
                source_sha256: row.get(4)?,
                note: row.get(5)?,
                schema: row.get(6)?,
                units_json: row.get(7)?,
                element_count: row.get(8)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Writes the elements and properties of a revision in one transaction.
    pub fn write_revision_content(
        &self,
        revision_id: i64,
        elements: &[ElementRow],
        properties: &[PropertyRow],
    ) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        let mut row_ids: HashMap<i64, i64> = HashMap::with_capacity(elements.len());
        {
            let mut insert = tx.prepare_cached(
                "INSERT INTO element (revision_id, express_id, global_id, ifc_type, name, tag, storey,
                   type_name, material, has_geometry, is_spatial)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            )?;
            for e in elements {
                insert.execute(params![
                    revision_id,
                    e.express_id,
                    e.global_id,
                    e.ifc_type,
                    e.name,
                    e.tag,
                    e.storey,
                    e.type_name,
                    e.material,
                    e.has_geometry as i64,
                    e.is_spatial as i64,
                ])?;
                row_ids.insert(e.express_id, tx.last_insert_rowid());
            }
            let mut set_parent =
                tx.prepare_cached("UPDATE element SET parent_id = ?1 WHERE id = ?2")?;
            for e in elements {
                let parent_row = e.parent_express_id.and_then(|p| row_ids.get(&p));
                if let (Some(parent_row), Some(row)) = (parent_row, row_ids.get(&e.express_id)) {
                    set_parent.execute(params![parent_row, row])?;
                }
            }
            let mut insert_property = tx.prepare_cached(
                "INSERT OR REPLACE INTO property (element_id, pset, name, value_text, value_num, unit, kind)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )?;
            for p in properties {
                let Some(row) = row_ids.get(&p.element_express_id) else {
                    continue;
                };
                insert_property.execute(params![
                    row,
                    p.pset,
                    p.name,
                    p.value_text,
                    p.value_num,
                    p.unit,
                    p.kind
                ])?;
            }
            tx.execute(
                "UPDATE revision SET element_count = ?1 WHERE id = ?2",
                params![elements.len() as i64, revision_id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn elements(&self, revision_id: i64) -> Result<Vec<ElementSummary>> {
        let sql = format!(
            "SELECT {SUMMARY_COLUMNS} FROM element e LEFT JOIN element p ON p.id = e.parent_id
             WHERE e.revision_id = ?1 ORDER BY e.id"
        );
        let mut statement = self.conn.prepare(&sql)?;
        let rows = statement.query_map([revision_id], summary_from_row)?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn element(&self, revision_id: i64, express_id: i64) -> Result<Option<ElementSummary>> {
        let sql = format!(
            "SELECT {SUMMARY_COLUMNS} FROM element e LEFT JOIN element p ON p.id = e.parent_id
             WHERE e.revision_id = ?1 AND e.express_id = ?2"
        );
        Ok(self
            .conn
            .query_row(&sql, params![revision_id, express_id], summary_from_row)
            .optional()?)
    }

    pub fn element_properties(
        &self,
        revision_id: i64,
        express_id: i64,
    ) -> Result<Vec<PropertyOut>> {
        let mut statement = self.conn.prepare(
            "SELECT pr.pset, pr.name, pr.value_text, pr.value_num, pr.unit, pr.kind
             FROM property pr JOIN element e ON e.id = pr.element_id
             WHERE e.revision_id = ?1 AND e.express_id = ?2
             ORDER BY pr.pset, pr.name",
        )?;
        let rows = statement.query_map(params![revision_id, express_id], |row| {
            Ok(PropertyOut {
                pset: row.get(0)?,
                name: row.get(1)?,
                value_text: row.get(2)?,
                value_num: row.get(3)?,
                unit: row.get(4)?,
                kind: row.get(5)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Case-insensitive substring search over name, tag, type, GlobalId and type name.
    pub fn search_elements(
        &self,
        revision_id: i64,
        query: &str,
        limit: usize,
    ) -> Result<Vec<ElementSummary>> {
        let pattern = format!("%{}%", query.trim().replace('%', "\\%").replace('_', "\\_"));
        let sql = format!(
            "SELECT {SUMMARY_COLUMNS} FROM element e LEFT JOIN element p ON p.id = e.parent_id
             WHERE e.revision_id = ?1 AND (
               e.name LIKE ?2 ESCAPE '\\' OR e.tag LIKE ?2 ESCAPE '\\' OR e.ifc_type LIKE ?2 ESCAPE '\\'
               OR e.global_id LIKE ?2 ESCAPE '\\' OR e.type_name LIKE ?2 ESCAPE '\\')
             ORDER BY e.id LIMIT ?3"
        );
        let mut statement = self.conn.prepare(&sql)?;
        let rows = statement.query_map(
            params![revision_id, pattern, limit as i64],
            summary_from_row,
        )?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }
}
