//! Writing BCF 3.0 archives.

use std::io::{Cursor, Write};

use quick_xml::{
    Writer,
    events::{BytesDecl, BytesEnd, BytesStart, BytesText, Event},
};
use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

use crate::{
    BcfError, Result,
    model::{BcfFile, Camera, Point, Topic, Viewpoint},
};

const XSI: &str = "http://www.w3.org/2001/XMLSchema-instance";

/// Serialises `file` as a BCF 3.0 zip archive.
pub fn write_bcf(file: &BcfFile) -> Result<Vec<u8>> {
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);

    add(&mut zip, "bcf.version", options, &version_xml()?)?;
    if let Some(bytes) = extensions_xml(file)? {
        add(&mut zip, "extensions.xml", options, &bytes)?;
    }
    if let Some(name) = &file.project_name {
        add(&mut zip, "project.bcfp", options, &project_xml(name)?)?;
    }

    for topic in &file.topics {
        let folder = format!("{}/", topic.guid);
        add(
            &mut zip,
            &format!("{folder}markup.bcf"),
            options,
            &markup_xml(topic)?,
        )?;
        for (index, viewpoint) in topic.viewpoints.iter().enumerate() {
            let (viewpoint_file, snapshot_file) = viewpoint_file_names(viewpoint, index);
            add(
                &mut zip,
                &format!("{folder}{viewpoint_file}"),
                options,
                &viewpoint_xml(viewpoint)?,
            )?;
            if let (Some(name), Some((_, bytes))) = (snapshot_file, &viewpoint.snapshot) {
                add(&mut zip, &format!("{folder}{name}"), stored, bytes)?;
            }
        }
    }

    let cursor = zip.finish().map_err(|e| BcfError::Zip(e.to_string()))?;
    Ok(cursor.into_inner())
}

/// First viewpoint uses the conventional names; later ones are named by guid.
fn viewpoint_file_names(viewpoint: &Viewpoint, index: usize) -> (String, Option<String>) {
    let extension = viewpoint.snapshot.as_ref().map(|(ext, _)| ext.as_str());
    if index == 0 {
        (
            "viewpoint.bcfv".to_owned(),
            extension.map(|e| format!("snapshot.{e}")),
        )
    } else {
        (
            format!("{}.bcfv", viewpoint.guid),
            extension.map(|e| format!("{}.{e}", viewpoint.guid)),
        )
    }
}

fn add<W: Write + std::io::Seek>(
    zip: &mut ZipWriter<W>,
    name: &str,
    options: SimpleFileOptions,
    bytes: &[u8],
) -> Result<()> {
    zip.start_file(name, options)
        .map_err(|e| BcfError::Zip(e.to_string()))?;
    zip.write_all(bytes)
        .map_err(|e| BcfError::Zip(e.to_string()))?;
    Ok(())
}

struct Xml {
    writer: Writer<Vec<u8>>,
}

impl Xml {
    fn new() -> Result<Self> {
        let mut writer = Writer::new_with_indent(Vec::new(), b' ', 2);
        writer
            .write_event(Event::Decl(BytesDecl::new("1.0", Some("UTF-8"), None)))
            .map_err(|e| BcfError::Xml(e.to_string()))?;
        Ok(Self { writer })
    }

    fn open(&mut self, name: &str, attributes: &[(&str, &str)]) -> Result<()> {
        let mut start = BytesStart::new(name);
        for (key, value) in attributes {
            start.push_attribute((*key, *value));
        }
        self.writer
            .write_event(Event::Start(start))
            .map_err(|e| BcfError::Xml(e.to_string()))
    }

    fn close(&mut self, name: &str) -> Result<()> {
        self.writer
            .write_event(Event::End(BytesEnd::new(name)))
            .map_err(|e| BcfError::Xml(e.to_string()))
    }

    fn empty(&mut self, name: &str, attributes: &[(&str, &str)]) -> Result<()> {
        let mut start = BytesStart::new(name);
        for (key, value) in attributes {
            start.push_attribute((*key, *value));
        }
        self.writer
            .write_event(Event::Empty(start))
            .map_err(|e| BcfError::Xml(e.to_string()))
    }

    fn text(&mut self, name: &str, value: &str) -> Result<()> {
        self.open(name, &[])?;
        self.writer
            .write_event(Event::Text(BytesText::new(value)))
            .map_err(|e| BcfError::Xml(e.to_string()))?;
        self.close(name)
    }

    fn optional(&mut self, name: &str, value: Option<&str>) -> Result<()> {
        match value {
            Some(v) if !v.is_empty() => self.text(name, v),
            _ => Ok(()),
        }
    }

    fn point(&mut self, name: &str, point: Point) -> Result<()> {
        self.open(name, &[])?;
        self.text("X", &number(point.x))?;
        self.text("Y", &number(point.y))?;
        self.text("Z", &number(point.z))?;
        self.close(name)
    }

    fn finish(self) -> Vec<u8> {
        self.writer.into_inner()
    }
}

fn number(value: f64) -> String {
    let mut text = format!("{value:.6}");
    if text.contains('.') {
        while text.ends_with('0') {
            text.pop();
        }
        if text.ends_with('.') {
            text.push('0');
        }
    }
    text
}

fn version_xml() -> Result<Vec<u8>> {
    let mut xml = Xml::new()?;
    xml.empty("Version", &[("VersionId", "3.0"), ("xmlns:xsi", XSI)])?;
    Ok(xml.finish())
}

fn project_xml(name: &str) -> Result<Vec<u8>> {
    let mut xml = Xml::new()?;
    xml.open("ProjectInfo", &[("xmlns:xsi", XSI)])?;
    xml.open("Project", &[])?;
    xml.text("Name", name)?;
    xml.close("Project")?;
    xml.close("ProjectInfo")?;
    Ok(xml.finish())
}

fn extensions_xml(file: &BcfFile) -> Result<Option<Vec<u8>>> {
    let e = &file.extensions;
    let groups: [(&str, &str, &Vec<String>); 6] = [
        ("TopicTypes", "TopicType", &e.topic_types),
        ("TopicStatuses", "TopicStatus", &e.topic_statuses),
        ("Priorities", "Priority", &e.priorities),
        ("TopicLabels", "TopicLabel", &e.labels),
        ("Users", "User", &e.users),
        ("Stages", "Stage", &e.stages),
    ];
    if groups.iter().all(|(_, _, values)| values.is_empty()) {
        return Ok(None);
    }
    let mut xml = Xml::new()?;
    xml.open("Extensions", &[("xmlns:xsi", XSI)])?;
    for (container, item, values) in groups {
        if values.is_empty() {
            continue;
        }
        xml.open(container, &[])?;
        for value in values {
            xml.text(item, value)?;
        }
        xml.close(container)?;
    }
    xml.close("Extensions")?;
    Ok(Some(xml.finish()))
}

fn markup_xml(topic: &Topic) -> Result<Vec<u8>> {
    let mut xml = Xml::new()?;
    xml.open("Markup", &[("xmlns:xsi", XSI)])?;
    xml.open("Header", &[])?;
    xml.close("Header")?;

    let mut attributes: Vec<(&str, &str)> = vec![("Guid", &topic.guid)];
    if let Some(topic_type) = &topic.topic_type {
        attributes.push(("TopicType", topic_type));
    }
    if let Some(status) = &topic.status {
        attributes.push(("TopicStatus", status));
    }
    xml.open("Topic", &attributes)?;
    // Element order follows the 3.0 schema sequence.
    xml.text("Title", &topic.title)?;
    xml.optional("Priority", topic.priority.as_deref())?;
    if let Some(index) = topic.index {
        xml.text("Index", &index.to_string())?;
    }
    if !topic.labels.is_empty() {
        xml.open("Labels", &[])?;
        for label in &topic.labels {
            xml.text("Label", label)?;
        }
        xml.close("Labels")?;
    }
    xml.text("CreationDate", &topic.creation_date)?;
    xml.text("CreationAuthor", &topic.creation_author)?;
    xml.optional("ModifiedDate", topic.modified_date.as_deref())?;
    xml.optional("ModifiedAuthor", topic.modified_author.as_deref())?;
    xml.optional("DueDate", topic.due_date.as_deref())?;
    xml.optional("AssignedTo", topic.assigned_to.as_deref())?;
    xml.optional("Stage", topic.stage.as_deref())?;
    xml.optional("Description", topic.description.as_deref())?;

    if !topic.comments.is_empty() {
        xml.open("Comments", &[])?;
        for comment in &topic.comments {
            xml.open("Comment", &[("Guid", &comment.guid)])?;
            xml.text("Date", &comment.date)?;
            xml.text("Author", &comment.author)?;
            xml.text("Comment", &comment.comment)?;
            if let Some(guid) = &comment.viewpoint_guid {
                xml.empty("Viewpoint", &[("Guid", guid)])?;
            }
            xml.optional("ModifiedDate", comment.modified_date.as_deref())?;
            xml.optional("ModifiedAuthor", comment.modified_author.as_deref())?;
            xml.close("Comment")?;
        }
        xml.close("Comments")?;
    }

    if !topic.viewpoints.is_empty() {
        xml.open("Viewpoints", &[])?;
        for (index, viewpoint) in topic.viewpoints.iter().enumerate() {
            let (viewpoint_file, snapshot_file) = viewpoint_file_names(viewpoint, index);
            xml.open("ViewPoint", &[("Guid", &viewpoint.guid)])?;
            xml.text("Viewpoint", &viewpoint_file)?;
            if let Some(name) = snapshot_file {
                xml.text("Snapshot", &name)?;
            }
            xml.text(
                "Index",
                &viewpoint.index.unwrap_or(index as i64).to_string(),
            )?;
            xml.close("ViewPoint")?;
        }
        xml.close("Viewpoints")?;
    }

    xml.close("Topic")?;
    xml.close("Markup")?;
    Ok(xml.finish())
}

fn viewpoint_xml(viewpoint: &Viewpoint) -> Result<Vec<u8>> {
    let mut xml = Xml::new()?;
    xml.open(
        "VisualizationInfo",
        &[("Guid", &viewpoint.guid), ("xmlns:xsi", XSI)],
    )?;

    let has_components = !viewpoint.selection.is_empty()
        || !viewpoint.visibility_exceptions.is_empty()
        || !viewpoint.coloring.is_empty()
        || !viewpoint.default_visibility;
    if has_components {
        xml.open("Components", &[])?;
        if !viewpoint.selection.is_empty() {
            xml.open("Selection", &[])?;
            for guid in &viewpoint.selection {
                xml.empty("Component", &[("IfcGuid", guid)])?;
            }
            xml.close("Selection")?;
        }
        xml.open(
            "Visibility",
            &[(
                "DefaultVisibility",
                if viewpoint.default_visibility {
                    "true"
                } else {
                    "false"
                },
            )],
        )?;
        if !viewpoint.visibility_exceptions.is_empty() {
            xml.open("Exceptions", &[])?;
            for guid in &viewpoint.visibility_exceptions {
                xml.empty("Component", &[("IfcGuid", guid)])?;
            }
            xml.close("Exceptions")?;
        }
        xml.close("Visibility")?;
        if !viewpoint.coloring.is_empty() {
            xml.open("Coloring", &[])?;
            for coloring in &viewpoint.coloring {
                xml.open("Color", &[("Color", &coloring.color)])?;
                for guid in &coloring.ifc_guids {
                    xml.empty("Component", &[("IfcGuid", guid)])?;
                }
                xml.close("Color")?;
            }
            xml.close("Coloring")?;
        }
        xml.close("Components")?;
    }

    match &viewpoint.camera {
        Some(Camera::Perspective {
            view_point,
            direction,
            up,
            field_of_view,
            aspect_ratio,
        }) => {
            xml.open("PerspectiveCamera", &[])?;
            xml.point("CameraViewPoint", *view_point)?;
            xml.point("CameraDirection", *direction)?;
            xml.point("CameraUpVector", *up)?;
            xml.text("FieldOfView", &number(*field_of_view))?;
            xml.text("AspectRatio", &number(*aspect_ratio))?;
            xml.close("PerspectiveCamera")?;
        }
        Some(Camera::Orthogonal {
            view_point,
            direction,
            up,
            view_to_world_scale,
            aspect_ratio,
        }) => {
            xml.open("OrthogonalCamera", &[])?;
            xml.point("CameraViewPoint", *view_point)?;
            xml.point("CameraDirection", *direction)?;
            xml.point("CameraUpVector", *up)?;
            xml.text("ViewToWorldScale", &number(*view_to_world_scale))?;
            xml.text("AspectRatio", &number(*aspect_ratio))?;
            xml.close("OrthogonalCamera")?;
        }
        None => {}
    }

    if !viewpoint.lines.is_empty() {
        xml.open("Lines", &[])?;
        for line in &viewpoint.lines {
            xml.open("Line", &[])?;
            xml.point("StartPoint", line.start)?;
            xml.point("EndPoint", line.end)?;
            xml.close("Line")?;
        }
        xml.close("Lines")?;
    }
    if !viewpoint.clipping_planes.is_empty() {
        xml.open("ClippingPlanes", &[])?;
        for plane in &viewpoint.clipping_planes {
            xml.open("ClippingPlane", &[])?;
            xml.point("Location", plane.location)?;
            xml.point("Direction", plane.direction)?;
            xml.close("ClippingPlane")?;
        }
        xml.close("ClippingPlanes")?;
    }

    xml.close("VisualizationInfo")?;
    Ok(xml.finish())
}
