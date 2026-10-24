//! Reader for STEP Part 21 (ISO 10303-21) files as written for IFC.
//!
//! The whole file is scanned once to index every entity instance (`#id=TYPE(...);`) by
//! express id and by type. Attribute lists are decoded lazily and only for the entities
//! the extraction asks about, so the tens of thousands of geometry entities in a typical
//! model cost one pass of byte scanning and nothing more.

use std::{collections::HashMap, ops::Range};

#[derive(Debug, thiserror::Error)]
pub enum StepError {
    #[error("not a STEP file: the ISO-10303-21 header is missing")]
    NotStep,
    #[error("no DATA section")]
    NoData,
    #[error("malformed entity near byte {0}")]
    Malformed(usize),
    #[error("express id #{0} is beyond the supported range")]
    IdTooLarge(u64),
}

/// A decoded attribute value.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Derived,
    Int(i64),
    Float(f64),
    Str(String),
    Enum(String),
    Ref(u32),
    List(Vec<Value>),
    /// A typed value such as `IFCLENGTHMEASURE(3.5)`.
    Typed(String, Box<Value>),
}

impl Value {
    pub fn as_ref(&self) -> Option<u32> {
        match self {
            Value::Ref(id) => Some(*id),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Value::Str(s) => Some(s),
            Value::Typed(_, inner) => inner.as_str(),
            _ => None,
        }
    }

    pub fn as_enum(&self) -> Option<&str> {
        match self {
            Value::Enum(s) => Some(s),
            Value::Typed(_, inner) => inner.as_enum(),
            _ => None,
        }
    }

    pub fn as_f64(&self) -> Option<f64> {
        match self {
            Value::Int(i) => Some(*i as f64),
            Value::Float(f) => Some(*f),
            Value::Typed(_, inner) => inner.as_f64(),
            _ => None,
        }
    }

    pub fn as_list(&self) -> Option<&[Value]> {
        match self {
            Value::List(items) => Some(items),
            _ => None,
        }
    }

    /// References in a list, ignoring anything that is not a reference.
    pub fn ref_list(&self) -> Vec<u32> {
        self.as_list()
            .map(|items| items.iter().filter_map(Value::as_ref).collect())
            .unwrap_or_default()
    }
}

#[derive(Clone, Copy)]
struct Entity {
    type_id: u16,
    /// Byte range of the attribute list, between the outer parentheses.
    args_start: usize,
    args_end: usize,
}

impl Entity {
    fn args(&self) -> Range<usize> {
        self.args_start..self.args_end
    }
}

pub struct StepFile<'a> {
    data: &'a [u8],
    schema: String,
    types: Vec<String>,
    entities: Vec<Option<Entity>>,
    by_type: Vec<Vec<u32>>,
    entity_count: usize,
}

const MAX_EXPRESS_ID: u64 = 200_000_000;

impl<'a> StepFile<'a> {
    pub fn parse(data: &'a [u8]) -> Result<Self, StepError> {
        if !data.starts_with(b"ISO-10303-21") {
            return Err(StepError::NotStep);
        }
        let data_start = find(data, b"DATA;", 0).ok_or(StepError::NoData)? + "DATA;".len();
        let schema = header_schema(&data[..data_start]).unwrap_or_default();

        let mut types: Vec<String> = Vec::new();
        let mut type_ids: HashMap<&'a [u8], u16> = HashMap::new();
        let mut entities: Vec<Option<Entity>> = Vec::new();
        let mut by_type: Vec<Vec<u32>> = Vec::new();
        let mut entity_count = 0usize;

        let mut pos = data_start;
        loop {
            pos = skip_blank(data, pos);
            if pos >= data.len() || data[pos..].starts_with(b"ENDSEC") {
                break;
            }
            if data[pos] != b'#' {
                return Err(StepError::Malformed(pos));
            }
            let (id, next) = parse_u64(data, pos + 1).ok_or(StepError::Malformed(pos))?;
            if id > MAX_EXPRESS_ID {
                return Err(StepError::IdTooLarge(id));
            }
            let id = id as u32;
            pos = skip_blank(data, next);
            if data.get(pos) != Some(&b'=') {
                return Err(StepError::Malformed(pos));
            }
            pos = skip_blank(data, pos + 1);

            let type_slice: &'a [u8];
            let args: Range<usize>;
            if data.get(pos) == Some(&b'(') {
                // Complex entity instance, e.g. derived units. Kept opaque.
                let end = match_paren(data, pos).ok_or(StepError::Malformed(pos))?;
                type_slice = b"COMPLEX";
                args = pos + 1..end;
                pos = end + 1;
            } else {
                let start = pos;
                while pos < data.len() && is_ident(data[pos]) {
                    pos += 1;
                }
                if pos == start {
                    return Err(StepError::Malformed(pos));
                }
                type_slice = &data[start..pos];
                pos = skip_blank(data, pos);
                if data.get(pos) != Some(&b'(') {
                    return Err(StepError::Malformed(pos));
                }
                let end = match_paren(data, pos).ok_or(StepError::Malformed(pos))?;
                args = pos + 1..end;
                pos = end + 1;
            }
            pos = skip_blank(data, pos);
            if data.get(pos) != Some(&b';') {
                return Err(StepError::Malformed(pos));
            }
            pos += 1;

            let type_id = match type_ids.get(type_slice) {
                Some(id) => *id,
                None => {
                    let id = types.len() as u16;
                    types.push(String::from_utf8_lossy(type_slice).to_ascii_uppercase());
                    type_ids.insert(type_slice, id);
                    by_type.push(Vec::new());
                    id
                }
            };

            let index = id as usize;
            if entities.len() <= index {
                entities.resize(index + 1, None);
            }
            if entities[index].is_none() {
                entity_count += 1;
            }
            entities[index] = Some(Entity {
                type_id,
                args_start: args.start,
                args_end: args.end,
            });
            by_type[type_id as usize].push(id);
        }

        Ok(Self {
            data,
            schema,
            types,
            entities,
            by_type,
            entity_count,
        })
    }

    /// Schema name from the header, e.g. `IFC2X3` or `IFC4`.
    pub fn schema(&self) -> &str {
        &self.schema
    }

    pub fn entity_count(&self) -> usize {
        self.entity_count
    }

    pub fn type_count(&self) -> usize {
        self.types.len()
    }

    pub fn types(&self) -> impl Iterator<Item = (u16, &str)> {
        self.types
            .iter()
            .enumerate()
            .map(|(i, name)| (i as u16, name.as_str()))
    }

    pub fn type_name(&self, type_id: u16) -> &str {
        &self.types[type_id as usize]
    }

    pub fn type_id(&self, name: &str) -> Option<u16> {
        self.types.iter().position(|t| t == name).map(|i| i as u16)
    }

    /// Express ids of every instance of a type, in file order.
    pub fn instances(&self, type_id: u16) -> &[u32] {
        &self.by_type[type_id as usize]
    }

    pub fn instances_of(&self, name: &str) -> &[u32] {
        self.type_id(name)
            .map(|id| self.instances(id))
            .unwrap_or(&[])
    }

    pub fn entity_type_id(&self, id: u32) -> Option<u16> {
        self.entities
            .get(id as usize)
            .copied()
            .flatten()
            .map(|e| e.type_id)
    }

    pub fn entity_type(&self, id: u32) -> Option<&str> {
        self.entity_type_id(id).map(|t| self.type_name(t))
    }

    /// Decodes the attribute list of one entity. None when the id is unused.
    pub fn args(&self, id: u32) -> Option<Vec<Value>> {
        let entity = self.entities.get(id as usize).copied().flatten()?;
        Some(
            ArgParser {
                data: &self.data[entity.args()],
                pos: 0,
            }
            .parse_all(),
        )
    }
}

fn header_schema(header: &[u8]) -> Option<String> {
    let at = find(header, b"FILE_SCHEMA", 0)?;
    let open = header[at..].iter().position(|&b| b == b'\'')? + at + 1;
    let close = header[open..].iter().position(|&b| b == b'\'')? + open;
    Some(String::from_utf8_lossy(&header[open..close]).to_ascii_uppercase())
}

fn find(haystack: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    haystack[from..]
        .windows(needle.len())
        .position(|w| w == needle)
        .map(|p| p + from)
}

fn is_ident(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

fn parse_u64(data: &[u8], mut pos: usize) -> Option<(u64, usize)> {
    let start = pos;
    let mut value: u64 = 0;
    while pos < data.len() && data[pos].is_ascii_digit() {
        value = value
            .checked_mul(10)?
            .checked_add((data[pos] - b'0') as u64)?;
        pos += 1;
    }
    (pos > start).then_some((value, pos))
}

/// Skips whitespace and `/* */` comments.
fn skip_blank(data: &[u8], mut pos: usize) -> usize {
    loop {
        while pos < data.len() && data[pos].is_ascii_whitespace() {
            pos += 1;
        }
        if data[pos..].starts_with(b"/*") {
            match find(data, b"*/", pos + 2) {
                Some(end) => pos = end + 2,
                None => return data.len(),
            }
        } else {
            return pos;
        }
    }
}

/// Given the position of `(`, returns the position of its matching `)`.
/// Strings are skipped so parentheses inside them do not count.
fn match_paren(data: &[u8], open: usize) -> Option<usize> {
    let mut depth = 0usize;
    let mut pos = open;
    while pos < data.len() {
        match data[pos] {
            b'(' => depth += 1,
            b')' => {
                depth -= 1;
                if depth == 0 {
                    return Some(pos);
                }
            }
            b'\'' => pos = skip_string(data, pos)?,
            _ => {}
        }
        pos += 1;
    }
    None
}

/// Given the position of an opening quote, returns the position of the closing quote.
fn skip_string(data: &[u8], open: usize) -> Option<usize> {
    let mut pos = open + 1;
    while pos < data.len() {
        if data[pos] == b'\'' {
            if data.get(pos + 1) == Some(&b'\'') {
                pos += 2;
                continue;
            }
            return Some(pos);
        }
        pos += 1;
    }
    None
}

struct ArgParser<'d> {
    data: &'d [u8],
    pos: usize,
}

impl ArgParser<'_> {
    fn parse_all(mut self) -> Vec<Value> {
        let mut values = Vec::new();
        loop {
            self.skip_ws();
            if self.pos >= self.data.len() {
                break;
            }
            values.push(self.parse_value());
            self.skip_ws();
            if self.peek() == Some(b',') {
                self.pos += 1;
            }
        }
        values
    }

    fn peek(&self) -> Option<u8> {
        self.data.get(self.pos).copied()
    }

    fn skip_ws(&mut self) {
        while self.pos < self.data.len() && self.data[self.pos].is_ascii_whitespace() {
            self.pos += 1;
        }
    }

    fn parse_value(&mut self) -> Value {
        self.skip_ws();
        match self.peek() {
            None => Value::Null,
            Some(b'$') => {
                self.pos += 1;
                Value::Null
            }
            Some(b'*') => {
                self.pos += 1;
                Value::Derived
            }
            Some(b'#') => {
                let (id, next) = parse_u64(self.data, self.pos + 1).unwrap_or((0, self.pos + 1));
                self.pos = next;
                Value::Ref(id.min(u32::MAX as u64) as u32)
            }
            Some(b'\'') => self.parse_string(),
            Some(b'.') => {
                let start = self.pos + 1;
                let mut end = start;
                while end < self.data.len() && self.data[end] != b'.' {
                    end += 1;
                }
                self.pos = (end + 1).min(self.data.len());
                Value::Enum(String::from_utf8_lossy(&self.data[start..end]).into_owned())
            }
            Some(b'(') => {
                self.pos += 1;
                let mut items = Vec::new();
                loop {
                    self.skip_ws();
                    match self.peek() {
                        None => break,
                        Some(b')') => {
                            self.pos += 1;
                            break;
                        }
                        Some(b',') => self.pos += 1,
                        _ => items.push(self.parse_value()),
                    }
                }
                Value::List(items)
            }
            Some(b) if b == b'-' || b == b'+' || b.is_ascii_digit() => self.parse_number(),
            Some(b) if is_ident(b) => {
                let start = self.pos;
                while self.pos < self.data.len() && is_ident(self.data[self.pos]) {
                    self.pos += 1;
                }
                let name =
                    String::from_utf8_lossy(&self.data[start..self.pos]).to_ascii_uppercase();
                self.skip_ws();
                if self.peek() == Some(b'(') {
                    self.pos += 1;
                    let inner = self.parse_value();
                    self.skip_ws();
                    if self.peek() == Some(b')') {
                        self.pos += 1;
                    }
                    Value::Typed(name, Box::new(inner))
                } else {
                    Value::Enum(name)
                }
            }
            Some(_) => {
                // Unknown byte: consume it so parsing always makes progress.
                self.pos += 1;
                Value::Null
            }
        }
    }

    fn parse_number(&mut self) -> Value {
        let start = self.pos;
        let mut is_float = false;
        while self.pos < self.data.len() {
            match self.data[self.pos] {
                b'0'..=b'9' | b'-' | b'+' => {}
                b'.' | b'E' | b'e' => is_float = true,
                _ => break,
            }
            self.pos += 1;
        }
        let text = String::from_utf8_lossy(&self.data[start..self.pos]);
        if !is_float && let Ok(i) = text.parse::<i64>() {
            return Value::Int(i);
        }
        Value::Float(text.parse::<f64>().unwrap_or(f64::NAN))
    }

    fn parse_string(&mut self) -> Value {
        let open = self.pos;
        let close = skip_string(self.data, open).unwrap_or(self.data.len());
        self.pos = (close + 1).min(self.data.len());
        Value::Str(decode_string(&self.data[open + 1..close]))
    }
}

/// Decodes a STEP string body: doubled quotes and the `\X2\`, `\X4\`, `\X\` and `\S\`
/// escape forms used for characters outside ASCII.
pub fn decode_string(raw: &[u8]) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut i = 0;
    while i < raw.len() {
        let b = raw[i];
        if b == b'\'' && raw.get(i + 1) == Some(&b'\'') {
            out.push('\'');
            i += 2;
        } else if b == b'\\' {
            if raw[i..].starts_with(b"\\X2\\") {
                i += 4;
                let mut units = Vec::new();
                while !raw[i..].starts_with(b"\\X0\\") && i + 4 <= raw.len() {
                    if let Ok(unit) =
                        u16::from_str_radix(&String::from_utf8_lossy(&raw[i..i + 4]), 16)
                    {
                        units.push(unit);
                    }
                    i += 4;
                }
                out.push_str(&String::from_utf16_lossy(&units));
                i += 4;
            } else if raw[i..].starts_with(b"\\X4\\") {
                i += 4;
                while !raw[i..].starts_with(b"\\X0\\") && i + 8 <= raw.len() {
                    if let Some(c) =
                        u32::from_str_radix(&String::from_utf8_lossy(&raw[i..i + 8]), 16)
                            .ok()
                            .and_then(char::from_u32)
                    {
                        out.push(c);
                    }
                    i += 8;
                }
                i += 4;
            } else if raw[i..].starts_with(b"\\X\\") && i + 5 <= raw.len() {
                if let Ok(c) = u8::from_str_radix(&String::from_utf8_lossy(&raw[i + 3..i + 5]), 16)
                {
                    out.push(c as char);
                }
                i += 5;
            } else if raw[i..].starts_with(b"\\S\\") && i + 4 <= raw.len() {
                out.push((raw[i + 3].wrapping_add(128)) as char);
                i += 4;
            } else if raw[i..].starts_with(b"\\\\") {
                out.push('\\');
                i += 2;
            } else if raw[i..].starts_with(b"\\P") && raw.get(i + 3) == Some(&b'\\') {
                // Code page directive: no effect on the characters we decode.
                i += 4;
            } else {
                out.push('\\');
                i += 1;
            }
        } else {
            // Bytes outside ASCII are taken as UTF-8 when valid; some writers emit it directly.
            let start = i;
            while i < raw.len() && raw[i] != b'\\' && raw[i] != b'\'' {
                i += 1;
            }
            out.push_str(&String::from_utf8_lossy(&raw[start..i]));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &[u8] = b"ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');
FILE_NAME('x.ifc','2026-01-01T00:00:00',(''),(''),'','','');
FILE_SCHEMA(('IFC2X3'));
ENDSEC;
DATA;
#1=IFCORGANIZATION($,'Acme (Pty)',$,$,$);
#2=IFCPROPERTYSINGLEVALUE('Width',$,IFCLENGTHMEASURE(0.3),$);
#3=IFCPROPERTYSINGLEVALUE('LoadBearing','it''s',IFCBOOLEAN(.T.),$);
#4=IFCPROPERTYSET('0Z1ovKxDj3jBaIy4_FAWeA',#5,'Pset_BeamCommon',$,(#2,#3));
#5=IFCOWNERHISTORY(#6,#7,$,.NOCHANGE.,$,$,$,0);
#8=IFCPROPERTYSINGLEVALUE('Name',$,IFCLABEL('Caf\\X2\\00E9\\X0\\ \\S\\e'),$);
#9=(IFCNAMEDUNIT(*,.LENGTHUNIT.)IFCSIUNIT(.MILLI.,.METRE.));
ENDSEC;
END-ISO-10303-21;
";

    #[test]
    fn indexes_entities_and_schema() {
        let step = StepFile::parse(SAMPLE).unwrap();
        assert_eq!(step.schema(), "IFC2X3");
        assert_eq!(step.entity_count(), 7);
        assert_eq!(step.entity_type(4), Some("IFCPROPERTYSET"));
        assert_eq!(step.instances_of("IFCPROPERTYSINGLEVALUE"), &[2, 3, 8]);
        assert_eq!(step.entity_type(9), Some("COMPLEX"));
        assert_eq!(step.entity_type(6), None);
    }

    #[test]
    fn decodes_attribute_values() {
        let step = StepFile::parse(SAMPLE).unwrap();
        let args = step.args(4).unwrap();
        assert_eq!(args[0], Value::Str("0Z1ovKxDj3jBaIy4_FAWeA".into()));
        assert_eq!(args[1], Value::Ref(5));
        assert_eq!(args[2].as_str(), Some("Pset_BeamCommon"));
        assert_eq!(args[3], Value::Null);
        assert_eq!(args[4].ref_list(), vec![2, 3]);

        let width = step.args(2).unwrap();
        assert_eq!(
            width[2],
            Value::Typed("IFCLENGTHMEASURE".into(), Box::new(Value::Float(0.3)))
        );
        assert_eq!(width[2].as_f64(), Some(0.3));

        let load_bearing = step.args(3).unwrap();
        assert_eq!(load_bearing[1].as_str(), Some("it's"));
        assert_eq!(load_bearing[2].as_enum(), Some("T"));

        let org = step.args(1).unwrap();
        assert_eq!(org[1].as_str(), Some("Acme (Pty)"));

        let history = step.args(5).unwrap();
        assert_eq!(history[3], Value::Enum("NOCHANGE".into()));
        assert_eq!(history[7], Value::Int(0));
    }

    #[test]
    fn decodes_string_escapes() {
        let step = StepFile::parse(SAMPLE).unwrap();
        let args = step.args(8).unwrap();
        assert_eq!(args[2].as_str(), Some("Caf\u{e9} \u{e5}"));
        assert_eq!(decode_string(b"a''b\\\\c"), "a'b\\c");
        assert_eq!(decode_string(b"\\X4\\0001F600\\X0\\"), "\u{1F600}");
    }

    #[test]
    fn rejects_non_step_input() {
        assert!(matches!(StepFile::parse(b"hello"), Err(StepError::NotStep)));
        assert!(matches!(
            StepFile::parse(b"ISO-10303-21;\nHEADER;\nENDSEC;\n"),
            Err(StepError::NoData)
        ));
    }
}
