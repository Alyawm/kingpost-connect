//! Drawing sheets (pages of a PDF revision), their links to elements and saved views, and
//! markups drawn on them.

use rusqlite::{OptionalExtension, params};
use serde::Serialize;

use crate::{Result, Store};

/// A page as the interface registers it after rendering the PDF.
#[derive(Debug, Clone, PartialEq)]
pub struct NewSheet {
    pub page: i64,
    pub number: Option<String>,
    pub title: Option<String>,
    pub scale: Option<String>,
    pub width: f64,
    pub height: f64,
    pub text: String,
    pub thumbnail: Option<Vec<u8>>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SheetRow {
    pub id: i64,
    pub revision_id: i64,
    pub file_id: i64,
    pub rel_path: String,
    pub revision_idx: i64,
    pub page: i64,
    pub number: Option<String>,
    pub title: Option<String>,
    pub scale: Option<String>,
    pub width: f64,
    pub height: f64,
    pub has_thumbnail: bool,
    pub link_count: i64,
    pub markup_count: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SheetHit {
    pub sheet_id: i64,
    pub rel_path: String,
    pub revision_idx: i64,
    pub page: i64,
    pub number: Option<String>,
    pub title: Option<String>,
    /// A little of the page text around the first match.
    pub excerpt: String,
}

/// A link as the interface creates it.
#[derive(Debug, Clone, PartialEq)]
pub struct NewSheetLink {
    pub id: String,
    pub sheet_id: i64,
    pub region_json: String,
    pub element_global_id: Option<String>,
    pub view_id: Option<String>,
    pub label: Option<String>,
    pub created_by: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SheetLinkRow {
    pub id: String,
    pub sheet_id: i64,
    pub region_json: String,
    pub element_global_id: Option<String>,
    pub view_id: Option<String>,
    pub label: Option<String>,
    pub created_by: String,
    pub created_at: String,
}

/// A link seen from an element: which sheet it is on.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ElementSheetLink {
    pub link: SheetLinkRow,
    pub rel_path: String,
    pub revision_id: i64,
    pub revision_idx: i64,
    pub page: i64,
    pub number: Option<String>,
    pub title: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SheetMarkupRow {
    pub id: String,
    pub sheet_id: i64,
    pub author: String,
    pub kind: String,
    pub geometry_json: String,
    pub text: Option<String>,
    pub created_at: String,
}

const SHEET_COLUMNS: &str = "s.id, s.revision_id, f.id, f.rel_path, r.idx, s.page, s.number, s.title, s.scale, \
     s.width, s.height, s.thumbnail IS NOT NULL, \
     (SELECT COUNT(*) FROM sheet_link l WHERE l.sheet_id = s.id), \
     (SELECT COUNT(*) FROM sheet_markup m WHERE m.sheet_id = s.id)";

fn sheet_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SheetRow> {
    Ok(SheetRow {
        id: row.get(0)?,
        revision_id: row.get(1)?,
        file_id: row.get(2)?,
        rel_path: row.get(3)?,
        revision_idx: row.get(4)?,
        page: row.get(5)?,
        number: row.get(6)?,
        title: row.get(7)?,
        scale: row.get(8)?,
        width: row.get(9)?,
        height: row.get(10)?,
        has_thumbnail: row.get::<_, i64>(11)? != 0,
        link_count: row.get(12)?,
        markup_count: row.get(13)?,
    })
}

fn link_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SheetLinkRow> {
    Ok(SheetLinkRow {
        id: row.get(0)?,
        sheet_id: row.get(1)?,
        region_json: row.get(2)?,
        element_global_id: row.get(3)?,
        view_id: row.get(4)?,
        label: row.get(5)?,
        created_by: row.get(6)?,
        created_at: row.get(7)?,
    })
}

impl Store {
    /// Replaces the sheets of a revision with the given pages (links and markups of the
    /// replaced sheets go with them; call this once per import).
    pub fn register_sheets(&self, revision_id: i64, sheets: &[NewSheet]) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("DELETE FROM sheet WHERE revision_id = ?1", [revision_id])?;
        {
            let mut insert = tx.prepare_cached(
                "INSERT INTO sheet (revision_id, page, number, title, scale, width, height, text, thumbnail)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            )?;
            for s in sheets {
                insert.execute(params![
                    revision_id,
                    s.page,
                    s.number,
                    s.title,
                    s.scale,
                    s.width,
                    s.height,
                    s.text,
                    s.thumbnail
                ])?;
            }
            tx.execute(
                "UPDATE revision SET element_count = ?1 WHERE id = ?2",
                params![sheets.len() as i64, revision_id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Copies the links of the previous revision's sheets onto the new revision's sheets
    /// with the same number (or page when numbers are missing). Returns how many moved.
    pub fn carry_links_forward(&self, from_revision_id: i64, to_revision_id: i64) -> Result<usize> {
        let mut pairs = self.conn.prepare(
            "SELECT a.id, b.id FROM sheet a JOIN sheet b
               ON b.revision_id = ?2
              AND ((a.number IS NOT NULL AND a.number = b.number)
                   OR (a.number IS NULL AND b.number IS NULL AND a.page = b.page))
             WHERE a.revision_id = ?1",
        )?;
        let pairs: Vec<(i64, i64)> = pairs
            .query_map(params![from_revision_id, to_revision_id], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })?
            .collect::<rusqlite::Result<_>>()?;
        let mut moved = 0;
        for (from, to) in pairs {
            moved += self.conn.execute(
                "INSERT INTO sheet_link (id, sheet_id, region_json, element_global_id, view_id, label, created_by, created_at)
                 SELECT lower(hex(randomblob(16))), ?2, region_json, element_global_id, view_id, label, created_by, created_at
                 FROM sheet_link WHERE sheet_id = ?1",
                params![from, to],
            )?;
        }
        Ok(moved)
    }

    pub fn sheets(&self, revision_id: Option<i64>) -> Result<Vec<SheetRow>> {
        let mut statement = self.conn.prepare(&format!(
            "SELECT {SHEET_COLUMNS} FROM sheet s
             JOIN revision r ON r.id = s.revision_id JOIN file f ON f.id = r.file_id
             WHERE (?1 IS NULL OR s.revision_id = ?1)
             ORDER BY f.rel_path, r.idx, s.page"
        ))?;
        let rows = statement.query_map([revision_id], sheet_row)?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn sheet(&self, id: i64) -> Result<Option<SheetRow>> {
        Ok(self
            .conn
            .query_row(
                &format!(
                    "SELECT {SHEET_COLUMNS} FROM sheet s
                     JOIN revision r ON r.id = s.revision_id JOIN file f ON f.id = r.file_id
                     WHERE s.id = ?1"
                ),
                [id],
                sheet_row,
            )
            .optional()?)
    }

    pub fn sheet_thumbnail(&self, id: i64) -> Result<Option<Vec<u8>>> {
        Ok(self
            .conn
            .query_row("SELECT thumbnail FROM sheet WHERE id = ?1", [id], |r| {
                r.get(0)
            })
            .optional()?
            .flatten())
    }

    pub fn update_sheet(
        &self,
        id: i64,
        number: Option<&str>,
        title: Option<&str>,
        scale: Option<&str>,
    ) -> Result<bool> {
        Ok(self.conn.execute(
            "UPDATE sheet SET number = ?2, title = ?3, scale = ?4 WHERE id = ?1",
            params![id, number, title, scale],
        )? > 0)
    }

    /// Case-insensitive text search over sheet numbers, titles and page text.
    pub fn search_sheets(&self, query: &str, limit: usize) -> Result<Vec<SheetHit>> {
        let needle = query.trim().to_lowercase();
        if needle.is_empty() {
            return Ok(Vec::new());
        }
        let pattern = format!("%{}%", needle.replace('%', "\\%").replace('_', "\\_"));
        let mut statement = self.conn.prepare(
            "SELECT s.id, f.rel_path, r.idx, s.page, s.number, s.title, s.text
             FROM sheet s JOIN revision r ON r.id = s.revision_id JOIN file f ON f.id = r.file_id
             WHERE lower(COALESCE(s.number, '')) LIKE ?1 ESCAPE '\\'
                OR lower(COALESCE(s.title, '')) LIKE ?1 ESCAPE '\\'
                OR lower(s.text) LIKE ?1 ESCAPE '\\'
             ORDER BY f.rel_path, r.idx DESC, s.page
             LIMIT ?2",
        )?;
        let rows = statement.query_map(params![pattern, limit as i64], |row| {
            let text: String = row.get(6)?;
            Ok(SheetHit {
                sheet_id: row.get(0)?,
                rel_path: row.get(1)?,
                revision_idx: row.get(2)?,
                page: row.get(3)?,
                number: row.get(4)?,
                title: row.get(5)?,
                excerpt: excerpt(&text, &needle),
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn sheet_links(&self, sheet_id: i64) -> Result<Vec<SheetLinkRow>> {
        let mut statement = self.conn.prepare(
            "SELECT id, sheet_id, region_json, element_global_id, view_id, label, created_by, created_at
             FROM sheet_link WHERE sheet_id = ?1 ORDER BY created_at",
        )?;
        let rows = statement.query_map([sheet_id], link_row)?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Every link that points at one of the given elements, newest revision first.
    pub fn element_sheet_links(&self, global_ids: &[String]) -> Result<Vec<ElementSheetLink>> {
        let mut out = Vec::new();
        let mut statement = self.conn.prepare(
            "SELECT l.id, l.sheet_id, l.region_json, l.element_global_id, l.view_id, l.label,
                    l.created_by, l.created_at, f.rel_path, r.id, r.idx, s.page, s.number, s.title
             FROM sheet_link l JOIN sheet s ON s.id = l.sheet_id
             JOIN revision r ON r.id = s.revision_id JOIN file f ON f.id = r.file_id
             WHERE l.element_global_id = ?1
             ORDER BY f.rel_path, r.idx DESC, s.page",
        )?;
        for global_id in global_ids {
            let rows = statement.query_map([global_id], |row| {
                Ok(ElementSheetLink {
                    link: link_row(row)?,
                    rel_path: row.get(8)?,
                    revision_id: row.get(9)?,
                    revision_idx: row.get(10)?,
                    page: row.get(11)?,
                    number: row.get(12)?,
                    title: row.get(13)?,
                })
            })?;
            out.extend(rows.collect::<rusqlite::Result<Vec<_>>>()?);
        }
        Ok(out)
    }

    pub fn insert_sheet_link(&self, link: &NewSheetLink) -> Result<()> {
        self.conn.execute(
            "INSERT INTO sheet_link (id, sheet_id, region_json, element_global_id, view_id, label, created_by)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                link.id,
                link.sheet_id,
                link.region_json,
                link.element_global_id,
                link.view_id,
                link.label,
                link.created_by
            ],
        )?;
        Ok(())
    }

    pub fn delete_sheet_link(&self, id: &str) -> Result<bool> {
        Ok(self
            .conn
            .execute("DELETE FROM sheet_link WHERE id = ?1", [id])?
            > 0)
    }

    pub fn sheet_markups(&self, sheet_id: i64) -> Result<Vec<SheetMarkupRow>> {
        let mut statement = self.conn.prepare(
            "SELECT id, sheet_id, author, kind, geometry_json, text, created_at
             FROM sheet_markup WHERE sheet_id = ?1 ORDER BY created_at",
        )?;
        let rows = statement.query_map([sheet_id], |row| {
            Ok(SheetMarkupRow {
                id: row.get(0)?,
                sheet_id: row.get(1)?,
                author: row.get(2)?,
                kind: row.get(3)?,
                geometry_json: row.get(4)?,
                text: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn insert_sheet_markup(
        &self,
        id: &str,
        sheet_id: i64,
        author: &str,
        kind: &str,
        geometry_json: &str,
        text: Option<&str>,
    ) -> Result<()> {
        self.conn.execute(
            "INSERT INTO sheet_markup (id, sheet_id, author, kind, geometry_json, text)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, sheet_id, author, kind, geometry_json, text],
        )?;
        Ok(())
    }

    pub fn delete_sheet_markup(&self, id: &str) -> Result<bool> {
        Ok(self
            .conn
            .execute("DELETE FROM sheet_markup WHERE id = ?1", [id])?
            > 0)
    }
}

/// Up to ~120 characters of `text` around the first occurrence of `needle`.
fn excerpt(text: &str, needle: &str) -> String {
    let lower = text.to_lowercase();
    let Some(at) = lower.find(needle) else {
        return String::new();
    };
    let start = text[..at]
        .char_indices()
        .rev()
        .nth(50)
        .map(|(i, _)| i)
        .unwrap_or(0);
    let end = text[at..]
        .char_indices()
        .nth(needle.len() + 70)
        .map(|(i, _)| at + i)
        .unwrap_or(text.len());
    let mut out = String::new();
    if start > 0 {
        out.push('…');
    }
    out.push_str(text[start..end].trim());
    if end < text.len() {
        out.push('…');
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sheet(page: i64, number: &str, title: &str, text: &str) -> NewSheet {
        NewSheet {
            page,
            number: Some(number.into()),
            title: Some(title.into()),
            scale: None,
            width: 841.0,
            height: 594.0,
            text: text.into(),
            thumbnail: Some(vec![1, 2, 3]),
        }
    }

    #[test]
    fn sheets_links_markups_and_search_round_trip() {
        let store = Store::open_in_memory().unwrap();
        let file = store
            .upsert_file("drawings/GA.pdf", "pdf", None, None, None)
            .unwrap();
        let (rev1, _) = store.create_revision(file, "a", None, "{}", None).unwrap();
        store
            .register_sheets(
                rev1,
                &[
                    sheet(1, "S-100", "COVER", "cover sheet index"),
                    sheet(
                        2,
                        "S-101",
                        "GROUND FLOOR FRAMING PLAN",
                        "beam B1 800x700 grid A",
                    ),
                ],
            )
            .unwrap();
        let sheets = store.sheets(Some(rev1)).unwrap();
        assert_eq!(sheets.len(), 2);
        assert_eq!(sheets[1].number.as_deref(), Some("S-101"));
        assert!(sheets[1].has_thumbnail);
        assert_eq!(
            store.sheet_thumbnail(sheets[1].id).unwrap(),
            Some(vec![1, 2, 3])
        );
        assert!(
            store
                .update_sheet(sheets[0].id, Some("S-000"), Some("Cover"), Some("NTS"))
                .unwrap()
        );
        assert_eq!(
            store.sheet(sheets[0].id).unwrap().unwrap().scale.as_deref(),
            Some("NTS")
        );

        let plan = sheets[1].id;
        store
            .insert_sheet_link(&NewSheetLink {
                id: "l1".into(),
                sheet_id: plan,
                region_json: "{\"x\":0.1}".into(),
                element_global_id: Some("GID-1".into()),
                view_id: None,
                label: Some("B1".into()),
                created_by: "maria".into(),
            })
            .unwrap();
        store
            .insert_sheet_markup(
                "m1",
                plan,
                "maria",
                "rect",
                "{\"x\":0}",
                Some("check depth"),
            )
            .unwrap();
        assert_eq!(store.sheet_links(plan).unwrap().len(), 1);
        assert_eq!(
            store.sheet_markups(plan).unwrap()[0].text.as_deref(),
            Some("check depth")
        );
        assert_eq!(store.sheet(plan).unwrap().unwrap().link_count, 1);
        let by_element = store.element_sheet_links(&["GID-1".into()]).unwrap();
        assert_eq!(by_element.len(), 1);
        assert_eq!(by_element[0].number.as_deref(), Some("S-101"));

        let hits = store.search_sheets("b1 800", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert!(hits[0].excerpt.contains("B1 800x700"));
        assert!(store.search_sheets("   ", 10).unwrap().is_empty());

        // A new revision: links follow the sheet number.
        let (rev2, _) = store.create_revision(file, "b", None, "{}", None).unwrap();
        store
            .register_sheets(
                rev2,
                &[
                    sheet(1, "S-101", "GROUND FLOOR FRAMING PLAN", "beam B1 800x750"),
                    sheet(2, "S-102", "FIRST FLOOR", ""),
                ],
            )
            .unwrap();
        assert_eq!(store.carry_links_forward(rev1, rev2).unwrap(), 1);
        let new_plan = store.sheets(Some(rev2)).unwrap()[0].id;
        let carried = store.sheet_links(new_plan).unwrap();
        assert_eq!(carried.len(), 1);
        assert_ne!(carried[0].id, "l1");
        assert_eq!(carried[0].element_global_id.as_deref(), Some("GID-1"));
        assert_eq!(
            store.element_sheet_links(&["GID-1".into()]).unwrap().len(),
            2
        );

        assert!(store.delete_sheet_link("l1").unwrap());
        assert!(store.delete_sheet_markup("m1").unwrap());
        assert_eq!(store.sheet(plan).unwrap().unwrap().markup_count, 0);
    }
}
