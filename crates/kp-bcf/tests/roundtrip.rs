//! Write a BCF 3.0 archive, read it back, and read a hand-written 2.1 archive.

use std::io::{Cursor, Write};

use kp_bcf::{
    BcfFile, Camera, ClippingPlane, Coloring, Comment, Extensions, Line, Point, Topic, Viewpoint,
    read_bcf, write_bcf,
};
use zip::{ZipWriter, write::SimpleFileOptions};

fn sample() -> BcfFile {
    BcfFile {
        version: "3.0".into(),
        project_name: Some("Workshop".into()),
        extensions: Extensions {
            topic_types: vec!["Issue".into(), "Request".into()],
            topic_statuses: vec!["open".into(), "closed".into()],
            priorities: vec!["high".into()],
            users: vec!["maria@example.com".into()],
            stages: vec![],
            labels: vec!["steel".into()],
        },
        topics: vec![Topic {
            guid: "3f1b0c3e-5a7d-4c9e-9d2a-1c2b3d4e5f60".into(),
            topic_type: Some("Issue".into()),
            status: Some("open".into()),
            title: "Beam B12 clashes with duct & tray".into(),
            priority: Some("high".into()),
            index: Some(1),
            labels: vec!["steel".into(), "MEP".into()],
            creation_date: "2026-10-24T10:00:00Z".into(),
            creation_author: "maria@example.com".into(),
            modified_date: Some("2026-10-24T11:00:00Z".into()),
            modified_author: Some("omar@example.com".into()),
            due_date: Some("2026-11-01T00:00:00Z".into()),
            assigned_to: Some("omar@example.com".into()),
            stage: Some("Design".into()),
            description: Some("Lower the duct by 150 mm <or> move the beam.".into()),
            comments: vec![Comment {
                guid: "6a0d2b1c-1111-4222-8333-444455556666".into(),
                date: "2026-10-24T10:05:00Z".into(),
                author: "maria@example.com".into(),
                comment: "See viewpoint.".into(),
                viewpoint_guid: Some("7b1e3c2d-2222-4333-8444-555566667777".into()),
                modified_date: None,
                modified_author: None,
            }],
            viewpoints: vec![
                Viewpoint {
                    guid: "7b1e3c2d-2222-4333-8444-555566667777".into(),
                    index: Some(0),
                    camera: Some(Camera::Perspective {
                        view_point: Point::new(12.5, -8.0, 6.25),
                        direction: Point::new(-0.577, 0.577, -0.577),
                        up: Point::new(0.0, 0.0, 1.0),
                        field_of_view: 50.0,
                        aspect_ratio: 1.6,
                    }),
                    selection: vec!["2RKhRBx5LB1gUyWiWNrYcb".into()],
                    default_visibility: true,
                    visibility_exceptions: vec!["0gA9j6E5P0bAxh1pJ6V9rS".into()],
                    coloring: vec![Coloring {
                        color: "FFFFB020".into(),
                        ifc_guids: vec!["2RKhRBx5LB1gUyWiWNrYcb".into()],
                    }],
                    lines: vec![Line {
                        start: Point::new(0.0, 0.0, 0.0),
                        end: Point::new(1.0, 2.0, 3.0),
                    }],
                    clipping_planes: vec![ClippingPlane {
                        location: Point::new(0.0, 0.0, 4.0),
                        direction: Point::new(0.0, 0.0, 1.0),
                    }],
                    snapshot: Some(("jpg".into(), vec![0xFF, 0xD8, 0xFF, 0xD9])),
                },
                Viewpoint {
                    guid: "8c2f4d3e-3333-4444-8555-666677778888".into(),
                    index: Some(1),
                    camera: Some(Camera::Orthogonal {
                        view_point: Point::new(0.0, 0.0, 100.0),
                        direction: Point::new(0.0, 0.0, -1.0),
                        up: Point::new(0.0, 1.0, 0.0),
                        view_to_world_scale: 0.02,
                        aspect_ratio: 1.0,
                    }),
                    default_visibility: true,
                    ..Viewpoint::default()
                },
            ],
        }],
    }
}

#[test]
fn writes_then_reads_the_same_content() {
    let original = sample();
    let bytes = write_bcf(&original).unwrap();
    let read = read_bcf(Cursor::new(bytes)).unwrap();

    assert_eq!(read.version, "3.0");
    assert_eq!(read.project_name.as_deref(), Some("Workshop"));
    assert_eq!(read.extensions.topic_types, original.extensions.topic_types);
    assert_eq!(read.extensions.labels, vec!["steel"]);
    assert_eq!(read.topics.len(), 1);

    let topic = &read.topics[0];
    let expected = &original.topics[0];
    assert_eq!(topic.guid, expected.guid);
    assert_eq!(topic.title, expected.title, "ampersand survives escaping");
    assert_eq!(
        topic.description, expected.description,
        "angle brackets survive escaping"
    );
    assert_eq!(topic.labels, expected.labels);
    assert_eq!(topic.assigned_to, expected.assigned_to);
    assert_eq!(topic.index, Some(1));
    assert_eq!(topic.comments, expected.comments);
    assert_eq!(topic.viewpoints.len(), 2);

    let viewpoint = &topic.viewpoints[0];
    assert_eq!(viewpoint.guid, expected.viewpoints[0].guid);
    assert_eq!(viewpoint.selection, expected.viewpoints[0].selection);
    assert_eq!(
        viewpoint.visibility_exceptions,
        expected.viewpoints[0].visibility_exceptions
    );
    assert_eq!(viewpoint.coloring, expected.viewpoints[0].coloring);
    assert_eq!(viewpoint.lines, expected.viewpoints[0].lines);
    assert_eq!(
        viewpoint.clipping_planes,
        expected.viewpoints[0].clipping_planes
    );
    assert_eq!(viewpoint.snapshot, expected.viewpoints[0].snapshot);
    match (&viewpoint.camera, &expected.viewpoints[0].camera) {
        (
            Some(Camera::Perspective {
                view_point,
                field_of_view,
                aspect_ratio,
                ..
            }),
            Some(Camera::Perspective {
                view_point: e_point,
                field_of_view: e_fov,
                aspect_ratio: e_ar,
                ..
            }),
        ) => {
            assert_eq!(view_point, e_point);
            assert_eq!(field_of_view, e_fov);
            assert_eq!(aspect_ratio, e_ar);
        }
        other => panic!("unexpected cameras: {other:?}"),
    }
    assert!(matches!(
        topic.viewpoints[1].camera,
        Some(Camera::Orthogonal { .. })
    ));
    assert_eq!(topic.viewpoints[1].snapshot, None);
}

#[test]
fn archive_layout_follows_the_specification() {
    let bytes = write_bcf(&sample()).unwrap();
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
    let names: Vec<String> = archive.file_names().map(str::to_owned).collect();
    let guid = "3f1b0c3e-5a7d-4c9e-9d2a-1c2b3d4e5f60";
    for expected in [
        "bcf.version",
        "extensions.xml",
        "project.bcfp",
        &format!("{guid}/markup.bcf"),
        &format!("{guid}/viewpoint.bcfv"),
        &format!("{guid}/snapshot.jpg"),
        &format!("{guid}/8c2f4d3e-3333-4444-8555-666677778888.bcfv"),
    ] {
        assert!(
            names.iter().any(|n| n == expected),
            "missing {expected} in {names:?}"
        );
    }
    let mut version = String::new();
    std::io::Read::read_to_string(&mut archive.by_name("bcf.version").unwrap(), &mut version)
        .unwrap();
    assert!(version.contains(r#"VersionId="3.0""#));
}

#[test]
fn reads_a_version_2_1_archive() {
    let markup = r#"<?xml version="1.0" encoding="UTF-8"?>
<Markup>
  <Topic Guid="aaaa-1" TopicType="Clash" TopicStatus="Active">
    <Title>Old style topic</Title>
    <Labels>Structure</Labels>
    <CreationDate>2020-01-02T03:04:05Z</CreationDate>
    <CreationAuthor>legacy@example.com</CreationAuthor>
    <AssignedTo>eng@example.com</AssignedTo>
  </Topic>
  <Comment Guid="cccc-1">
    <Date>2020-01-02T04:00:00Z</Date>
    <Author>legacy@example.com</Author>
    <Comment>Still relevant</Comment>
    <Viewpoint Guid="vvvv-1"/>
  </Comment>
  <Viewpoints Guid="vvvv-1">
    <Viewpoint>viewpoint.bcfv</Viewpoint>
    <Snapshot>snapshot.png</Snapshot>
  </Viewpoints>
</Markup>"#;
    let viewpoint = r#"<?xml version="1.0" encoding="UTF-8"?>
<VisualizationInfo Guid="vvvv-1">
  <Components>
    <Selection><Component IfcGuid="1kTvXnbbzCWw8lcMd1dR4o"/></Selection>
    <Visibility DefaultVisibility="false"><Exceptions><Component IfcGuid="1kTvXnbbzCWw8lcMd1dR4o"/></Exceptions></Visibility>
  </Components>
  <PerspectiveCamera>
    <CameraViewPoint><X>1</X><Y>2</Y><Z>3</Z></CameraViewPoint>
    <CameraDirection><X>0</X><Y>1</Y><Z>0</Z></CameraDirection>
    <CameraUpVector><X>0</X><Y>0</Y><Z>1</Z></CameraUpVector>
    <FieldOfView>45</FieldOfView>
  </PerspectiveCamera>
</VisualizationInfo>"#;

    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default();
    zip.start_file("bcf.version", options).unwrap();
    zip.write_all(br#"<?xml version="1.0"?><Version VersionId="2.1"><DetailedVersion>2.1</DetailedVersion></Version>"#).unwrap();
    zip.start_file("aaaa-1/markup.bcf", options).unwrap();
    zip.write_all(markup.as_bytes()).unwrap();
    zip.start_file("aaaa-1/viewpoint.bcfv", options).unwrap();
    zip.write_all(viewpoint.as_bytes()).unwrap();
    zip.start_file("aaaa-1/snapshot.png", options).unwrap();
    zip.write_all(&[0x89, b'P', b'N', b'G']).unwrap();
    let bytes = zip.finish().unwrap().into_inner();

    let file = read_bcf(Cursor::new(bytes)).unwrap();
    assert_eq!(file.version, "2.1");
    let topic = &file.topics[0];
    assert_eq!(topic.title, "Old style topic");
    assert_eq!(topic.topic_type.as_deref(), Some("Clash"));
    assert_eq!(topic.status.as_deref(), Some("Active"));
    assert_eq!(
        topic.labels,
        vec!["Structure"],
        "2.1 writes labels as bare <Labels> text"
    );
    assert_eq!(topic.comments.len(), 1);
    assert_eq!(topic.comments[0].viewpoint_guid.as_deref(), Some("vvvv-1"));
    assert_eq!(topic.viewpoints.len(), 1);
    let viewpoint = &topic.viewpoints[0];
    assert_eq!(viewpoint.guid, "vvvv-1");
    assert_eq!(viewpoint.selection, vec!["1kTvXnbbzCWw8lcMd1dR4o"]);
    assert!(!viewpoint.default_visibility);
    assert_eq!(
        viewpoint
            .snapshot
            .as_ref()
            .map(|(e, b)| (e.as_str(), b.len())),
        Some(("png", 4))
    );
    assert!(
        matches!(viewpoint.camera, Some(Camera::Perspective { field_of_view, .. }) if field_of_view == 45.0)
    );
}
