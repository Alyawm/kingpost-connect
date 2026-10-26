//! Reading `.bcf` / `.bcfzip` archives of version 2.1 or 3.0.
//!
//! The two versions differ mainly in where comments and viewpoints sit (beside the topic
//! in 2.1, inside it in 3.0); the reader looks for the element names wherever they are.

use std::{
    collections::HashMap,
    io::{Read, Seek},
};

use zip::ZipArchive;

use crate::{
    BcfError, Result,
    model::{BcfFile, Camera, ClippingPlane, Coloring, Comment, Line, Point, Topic, Viewpoint},
    xml::{self, Node},
};

pub fn read_bcf<R: Read + Seek>(reader: R) -> Result<BcfFile> {
    let mut archive = ZipArchive::new(reader).map_err(|e| BcfError::Zip(e.to_string()))?;
    let names: Vec<String> = archive
        .file_names()
        .map(|name| name.map(|n| n.into_owned()))
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| BcfError::Zip(e.to_string()))?;
    let mut files: HashMap<String, Vec<u8>> = HashMap::new();
    for name in &names {
        let mut entry = archive
            .by_name(name)
            .map_err(|e| BcfError::Zip(e.to_string()))?;
        if entry.is_dir() {
            continue;
        }
        let mut bytes = Vec::with_capacity(entry.size() as usize);
        entry
            .read_to_end(&mut bytes)
            .map_err(|e| BcfError::Zip(e.to_string()))?;
        files.insert(name.replace('\\', "/"), bytes);
    }

    let version = files
        .get("bcf.version")
        .and_then(|bytes| xml::parse(bytes).ok())
        .and_then(|root| root.attr("VersionId").map(str::to_owned))
        .unwrap_or_else(|| "unknown".to_owned());

    let mut project_name = None;
    if let Some(bytes) = files.get("project.bcfp")
        && let Ok(root) = xml::parse(bytes)
    {
        project_name = root
            .descendants("Name")
            .first()
            .map(|n| n.text.trim().to_owned());
    }

    let mut extensions = crate::model::Extensions::default();
    if let Some(bytes) = files.get("extensions.xml")
        && let Ok(root) = xml::parse(bytes)
    {
        let list = |container: &str, item: &str| -> Vec<String> {
            root.descendants(container)
                .first()
                .map(|c| {
                    c.children_named(item)
                        .map(|n| n.text.trim().to_owned())
                        .collect()
                })
                .unwrap_or_default()
        };
        extensions.topic_types = list("TopicTypes", "TopicType");
        extensions.topic_statuses = list("TopicStatuses", "TopicStatus");
        extensions.priorities = list("Priorities", "Priority");
        extensions.users = list("Users", "User");
        extensions.stages = list("Stages", "Stage");
        extensions.labels = list("TopicLabels", "TopicLabel");
    }

    let mut topics = Vec::new();
    let mut markup_names: Vec<&String> = names
        .iter()
        .filter(|n| n.to_ascii_lowercase().ends_with("/markup.bcf"))
        .collect();
    markup_names.sort();
    for name in markup_names {
        let folder = &name[..name.len() - "markup.bcf".len()];
        let bytes = &files[name];
        let root = xml::parse(bytes)?;
        topics.push(read_topic(&root, folder, &files)?);
    }

    Ok(BcfFile {
        version,
        project_name,
        topics,
        extensions,
    })
}

fn read_topic(markup: &Node, folder: &str, files: &HashMap<String, Vec<u8>>) -> Result<Topic> {
    let topic_node = markup
        .child("Topic")
        .ok_or_else(|| BcfError::Malformed(format!("{folder}markup.bcf has no Topic")))?;
    let mut topic = Topic {
        guid: topic_node.attr("Guid").unwrap_or_default().to_owned(),
        topic_type: topic_node.attr("TopicType").map(str::to_owned),
        status: topic_node.attr("TopicStatus").map(str::to_owned),
        title: topic_node.child_text("Title").unwrap_or_default(),
        priority: topic_node.child_text("Priority"),
        index: topic_node.child_text("Index").and_then(|i| i.parse().ok()),
        // 3.0 nests <Label> elements in <Labels>; 2.1 repeats <Labels> with bare text.
        labels: topic_node
            .children_named("Labels")
            .flat_map(|l| {
                let nested: Vec<String> = l
                    .children_named("Label")
                    .map(|n| n.text.trim().to_owned())
                    .collect();
                if nested.is_empty() {
                    vec![l.text.trim().to_owned()]
                } else {
                    nested
                }
            })
            .filter(|l| !l.is_empty())
            .collect(),
        creation_date: topic_node.child_text("CreationDate").unwrap_or_default(),
        creation_author: topic_node.child_text("CreationAuthor").unwrap_or_default(),
        modified_date: topic_node.child_text("ModifiedDate"),
        modified_author: topic_node.child_text("ModifiedAuthor"),
        due_date: topic_node.child_text("DueDate"),
        assigned_to: topic_node.child_text("AssignedTo"),
        stage: topic_node.child_text("Stage"),
        description: topic_node.child_text("Description"),
        comments: Vec::new(),
        viewpoints: Vec::new(),
    };

    // Comments: 3.0 nests them in Topic/Comments; 2.1 puts them beside Topic.
    for node in markup.descendants("Comment") {
        if node.child("Author").is_none() && node.child("Date").is_none() {
            continue; // the <Comment> text element inside a comment, not a comment itself
        }
        topic.comments.push(Comment {
            guid: node.attr("Guid").unwrap_or_default().to_owned(),
            date: node.child_text("Date").unwrap_or_default(),
            author: node.child_text("Author").unwrap_or_default(),
            comment: node.child_text("Comment").unwrap_or_default(),
            viewpoint_guid: node
                .child("Viewpoint")
                .and_then(|v| v.attr("Guid"))
                .map(str::to_owned),
            modified_date: node.child_text("ModifiedDate"),
            modified_author: node.child_text("ModifiedAuthor"),
        });
    }

    // Viewpoint references: 3.0 `ViewPoint`, 2.1 `Viewpoints`. Name matching ignores case, so
    // the file-name element inside a reference and a comment's `<Viewpoint Guid/>` link
    // would match too; a reference is the node that carries a Guid and names a file.
    let references: Vec<&Node> = markup
        .descendants("ViewPoint")
        .into_iter()
        .chain(markup.descendants("Viewpoints"))
        .filter(|n| n.attr("Guid").is_some() && n.child("Viewpoint").is_some())
        .collect();
    for reference in references {
        let guid = reference.attr("Guid").unwrap_or_default().to_owned();
        let viewpoint_file = reference
            .child_text("Viewpoint")
            .unwrap_or_else(|| "viewpoint.bcfv".into());
        let snapshot_file = reference.child_text("Snapshot");
        let index = reference.child_text("Index").and_then(|i| i.parse().ok());
        let mut viewpoint = files
            .get(&format!("{folder}{viewpoint_file}"))
            .map(|bytes| xml::parse(bytes).map(|root| read_viewpoint(&root)))
            .transpose()?
            .unwrap_or_default();
        if viewpoint.guid.is_empty() {
            viewpoint.guid = guid;
        }
        viewpoint.index = index;
        if let Some(snapshot_file) = snapshot_file
            && let Some(bytes) = files.get(&format!("{folder}{snapshot_file}"))
        {
            let extension = snapshot_file
                .rsplit('.')
                .next()
                .unwrap_or("png")
                .to_ascii_lowercase();
            viewpoint.snapshot = Some((extension, bytes.clone()));
        }
        topic.viewpoints.push(viewpoint);
    }

    Ok(topic)
}

fn read_viewpoint(root: &Node) -> Viewpoint {
    let mut viewpoint = Viewpoint {
        guid: root.attr("Guid").unwrap_or_default().to_owned(),
        default_visibility: true,
        ..Viewpoint::default()
    };
    if let Some(components) = root.child("Components") {
        viewpoint.selection = guids_of(components.child("Selection"));
        if let Some(visibility) = components.child("Visibility") {
            viewpoint.default_visibility = visibility
                .attr("DefaultVisibility")
                .map(|v| v != "false")
                .unwrap_or(true);
            viewpoint.visibility_exceptions = guids_of(visibility.child("Exceptions"));
        }
        if let Some(coloring) = components.child("Coloring") {
            viewpoint.coloring = coloring
                .children_named("Color")
                .map(|color| Coloring {
                    color: color.attr("Color").unwrap_or_default().to_owned(),
                    ifc_guids: guids_of(Some(color)),
                })
                .collect();
        }
    }
    if let Some(camera) = root.child("PerspectiveCamera") {
        viewpoint.camera = Some(Camera::Perspective {
            view_point: point_of(camera.child("CameraViewPoint")),
            direction: point_of(camera.child("CameraDirection")),
            up: point_of(camera.child("CameraUpVector")),
            field_of_view: camera
                .child_text("FieldOfView")
                .and_then(|v| v.parse().ok())
                .unwrap_or(60.0),
            aspect_ratio: camera
                .child_text("AspectRatio")
                .and_then(|v| v.parse().ok())
                .unwrap_or(1.0),
        });
    } else if let Some(camera) = root.child("OrthogonalCamera") {
        viewpoint.camera = Some(Camera::Orthogonal {
            view_point: point_of(camera.child("CameraViewPoint")),
            direction: point_of(camera.child("CameraDirection")),
            up: point_of(camera.child("CameraUpVector")),
            view_to_world_scale: camera
                .child_text("ViewToWorldScale")
                .and_then(|v| v.parse().ok())
                .unwrap_or(1.0),
            aspect_ratio: camera
                .child_text("AspectRatio")
                .and_then(|v| v.parse().ok())
                .unwrap_or(1.0),
        });
    }
    if let Some(lines) = root.child("Lines") {
        viewpoint.lines = lines
            .children_named("Line")
            .map(|line| Line {
                start: point_of(line.child("StartPoint")),
                end: point_of(line.child("EndPoint")),
            })
            .collect();
    }
    if let Some(planes) = root.child("ClippingPlanes") {
        viewpoint.clipping_planes = planes
            .children_named("ClippingPlane")
            .map(|plane| ClippingPlane {
                location: point_of(plane.child("Location")),
                direction: point_of(plane.child("Direction")),
            })
            .collect();
    }
    viewpoint
}

fn guids_of(node: Option<&Node>) -> Vec<String> {
    node.map(|n| {
        n.children_named("Component")
            .filter_map(|c| c.attr("IfcGuid").map(str::to_owned))
            .collect()
    })
    .unwrap_or_default()
}

fn point_of(node: Option<&Node>) -> Point {
    let read = |name: &str| -> f64 {
        node.and_then(|n| n.child_text(name))
            .and_then(|v| v.parse().ok())
            .unwrap_or(0.0)
    };
    Point::new(read("X"), read("Y"), read("Z"))
}
