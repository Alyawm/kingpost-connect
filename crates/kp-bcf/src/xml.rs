//! A small element tree over quick-xml, enough to read BCF documents of either version
//! without committing to one schema's nesting.

use quick_xml::{Reader, events::Event};

use crate::BcfError;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Node {
    pub name: String,
    pub attributes: Vec<(String, String)>,
    pub children: Vec<Node>,
    pub text: String,
}

impl Node {
    pub fn attr(&self, name: &str) -> Option<&str> {
        self.attributes
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }

    /// First direct child with this local name (namespace prefixes ignored).
    pub fn child(&self, name: &str) -> Option<&Node> {
        self.children
            .iter()
            .find(|c| c.name.eq_ignore_ascii_case(name))
    }

    pub fn children_named<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a Node> + 'a {
        self.children
            .iter()
            .filter(move |c| c.name.eq_ignore_ascii_case(name))
    }

    /// Text of a direct child, trimmed; None when absent or empty.
    pub fn child_text(&self, name: &str) -> Option<String> {
        self.child(name)
            .map(|c| c.text.trim().to_owned())
            .filter(|t| !t.is_empty())
    }

    /// Every descendant with this local name, depth first.
    pub fn descendants<'a>(&'a self, name: &'a str) -> Vec<&'a Node> {
        let mut out = Vec::new();
        for child in &self.children {
            if child.name.eq_ignore_ascii_case(name) {
                out.push(child);
            }
            out.extend(child.descendants(name));
        }
        out
    }
}

pub fn parse(bytes: &[u8]) -> Result<Node, BcfError> {
    let mut reader = Reader::from_reader(bytes);
    reader.config_mut().trim_text(false);
    let mut stack: Vec<Node> = vec![Node {
        name: "#document".into(),
        ..Node::default()
    }];
    let mut buf = Vec::new();
    loop {
        match reader
            .read_event_into(&mut buf)
            .map_err(|e| BcfError::Xml(e.to_string()))?
        {
            Event::Start(start) => {
                stack.push(node_from(&start)?);
            }
            Event::Empty(start) => {
                let node = node_from(&start)?;
                stack.last_mut().expect("document root").children.push(node);
            }
            Event::Text(text) => {
                let value =
                    quick_xml::escape::unescape(&text).map_err(|e| BcfError::Xml(e.to_string()))?;
                stack
                    .last_mut()
                    .expect("document root")
                    .text
                    .push_str(&value);
            }
            Event::CData(data) => {
                let value = data.into_inner().into_owned();
                stack
                    .last_mut()
                    .expect("document root")
                    .text
                    .push_str(&value);
            }
            Event::End(_) => {
                let node = stack.pop().expect("balanced element");
                stack.last_mut().expect("document root").children.push(node);
            }
            Event::GeneralRef(reference) => {
                let value = resolve_reference(&reference.into_inner())?;
                stack
                    .last_mut()
                    .expect("document root")
                    .text
                    .push_str(&value);
            }
            Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }
    let mut document = stack
        .pop()
        .ok_or_else(|| BcfError::Xml("empty document".into()))?;
    if !stack.is_empty() {
        return Err(BcfError::Xml("unclosed element".into()));
    }
    document
        .children
        .drain(..)
        .find(|c| !c.name.starts_with('#'))
        .ok_or_else(|| BcfError::Xml("no root element".into()))
}

/// `&amp;`, `&#38;` and `&#x26;` in text arrive as their own events; this turns one back
/// into the character(s) it stands for.
fn resolve_reference(reference: &str) -> Result<String, BcfError> {
    let name = reference.trim_start_matches('&').trim_end_matches(';');
    if let Some(number) = name.strip_prefix('#') {
        let code = match number.strip_prefix(['x', 'X']) {
            Some(hex) => u32::from_str_radix(hex, 16),
            None => number.parse::<u32>(),
        };
        return code
            .ok()
            .and_then(char::from_u32)
            .map(String::from)
            .ok_or_else(|| BcfError::Xml(format!("bad character reference &{name};")));
    }
    quick_xml::escape::resolve_predefined_entity(name)
        .map(str::to_owned)
        .ok_or_else(|| BcfError::Xml(format!("unknown entity &{name};")))
}

fn node_from(start: &quick_xml::events::BytesStart<'_>) -> Result<Node, BcfError> {
    let full = start.name().as_ref().to_owned();
    let name = full.rsplit(':').next().unwrap_or(&full).to_owned();
    let mut attributes = Vec::new();
    for attribute in start.attributes() {
        let attribute = attribute.map_err(|e| BcfError::Xml(e.to_string()))?;
        let key = attribute.key.as_ref().to_owned();
        let key = key.rsplit(':').next().unwrap_or(&key).to_owned();
        let value = quick_xml::escape::unescape(&attribute.value)
            .map_err(|e| BcfError::Xml(e.to_string()))?
            .into_owned();
        attributes.push((key, value));
    }
    Ok(Node {
        name,
        attributes,
        children: Vec::new(),
        text: String::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_a_tree_with_text_and_attributes() {
        let root = parse(
            br#"<?xml version="1.0"?><Markup xmlns:xsi="x"><Topic Guid="g" TopicType="Issue"><Title>A &amp; B</Title><Labels><Label>one</Label><Label>two</Label></Labels><Empty/></Topic></Markup>"#,
        )
        .unwrap();
        assert_eq!(root.name, "Markup");
        let topic = root.child("Topic").unwrap();
        assert_eq!(topic.attr("guid"), Some("g"));
        assert_eq!(topic.child_text("Title").as_deref(), Some("A & B"));
        assert_eq!(root.descendants("Label").len(), 2);
        assert!(topic.child("Empty").is_some());
        assert_eq!(topic.child_text("Missing"), None);
    }
}
