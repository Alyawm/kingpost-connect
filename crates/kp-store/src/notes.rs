//! Notes placed in the model and links from elements to web pages or files.

use rusqlite::params;
use serde::Serialize;

use crate::{Result, Store};

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NoteRow {
    pub id: String,
    /// The element the note was placed on, when it was placed on one.
    pub global_id: Option<String>,
    /// `[x, y, z]` in IFC world coordinates.
    pub point_json: String,
    pub text: String,
    pub author: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ElementLinkRow {
    pub id: String,
    pub global_id: String,
    /// `url` or `file`.
    pub kind: String,
    pub target: String,
    pub label: String,
    pub created_at: String,
}

impl Store {
    pub fn notes(&self) -> Result<Vec<NoteRow>> {
        let mut statement = self.conn.prepare(
            "SELECT id, global_id, point_json, text, author, created_at
             FROM note ORDER BY created_at, id",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(NoteRow {
                id: row.get(0)?,
                global_id: row.get(1)?,
                point_json: row.get(2)?,
                text: row.get(3)?,
                author: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn add_note(
        &self,
        id: &str,
        global_id: Option<&str>,
        point_json: &str,
        text: &str,
        author: &str,
    ) -> Result<()> {
        self.conn.execute(
            "INSERT INTO note (id, global_id, point_json, text, author) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, global_id, point_json, text, author],
        )?;
        Ok(())
    }

    pub fn update_note(&self, id: &str, text: &str) -> Result<bool> {
        Ok(self
            .conn
            .execute("UPDATE note SET text = ?2 WHERE id = ?1", params![id, text])?
            > 0)
    }

    pub fn delete_note(&self, id: &str) -> Result<bool> {
        Ok(self.conn.execute("DELETE FROM note WHERE id = ?1", [id])? > 0)
    }

    /// Links of one element, or of every element when `global_id` is `None`.
    pub fn element_links(&self, global_id: Option<&str>) -> Result<Vec<ElementLinkRow>> {
        let mut statement = self.conn.prepare(
            "SELECT id, global_id, kind, target, label, created_at FROM element_link
             WHERE ?1 IS NULL OR global_id = ?1 ORDER BY created_at, id",
        )?;
        let rows = statement.query_map([global_id], |row| {
            Ok(ElementLinkRow {
                id: row.get(0)?,
                global_id: row.get(1)?,
                kind: row.get(2)?,
                target: row.get(3)?,
                label: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn add_element_link(
        &self,
        id: &str,
        global_id: &str,
        kind: &str,
        target: &str,
        label: &str,
    ) -> Result<()> {
        self.conn.execute(
            "INSERT INTO element_link (id, global_id, kind, target, label) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, global_id, kind, target, label],
        )?;
        Ok(())
    }

    pub fn delete_element_link(&self, id: &str) -> Result<bool> {
        Ok(self
            .conn
            .execute("DELETE FROM element_link WHERE id = ?1", [id])?
            > 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notes_round_trip() {
        let store = Store::open_in_memory().unwrap();
        store
            .add_note("n1", Some("G1"), "[1,2,3]", "Check bearing", "Ana")
            .unwrap();
        store
            .add_note("n2", None, "[0,0,0]", "Site office", "")
            .unwrap();
        let notes = store.notes().unwrap();
        assert_eq!(notes.len(), 2);
        assert_eq!(notes[0].global_id.as_deref(), Some("G1"));
        assert!(store.update_note("n1", "Bearing OK").unwrap());
        assert_eq!(store.notes().unwrap()[0].text, "Bearing OK");
        assert!(store.delete_note("n2").unwrap());
        assert!(!store.delete_note("n2").unwrap());
        assert_eq!(store.notes().unwrap().len(), 1);
    }

    #[test]
    fn links_round_trip_and_check_kind() {
        let store = Store::open_in_memory().unwrap();
        store
            .add_element_link("l1", "G1", "url", "https://example.com/spec", "Spec")
            .unwrap();
        store
            .add_element_link("l2", "G2", "file", "drawings/GA.pdf", "")
            .unwrap();
        assert!(store.add_element_link("l3", "G1", "ftp", "x", "").is_err());
        assert_eq!(store.element_links(Some("G1")).unwrap().len(), 1);
        assert_eq!(store.element_links(None).unwrap().len(), 2);
        assert!(store.delete_element_link("l1").unwrap());
        assert!(store.element_links(Some("G1")).unwrap().is_empty());
    }
}
