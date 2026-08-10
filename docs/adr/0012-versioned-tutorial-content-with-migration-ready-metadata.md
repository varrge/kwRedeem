# Keep tutorial content versioned in the project with migration-ready metadata

Status: accepted.

The first Tutorial Center release keeps Tutorial Content in versioned KaWang project files while defining Tutorial Metadata separately from each article body. This gives the public Sub2api embed reviewable releases and safe rollback without adding an admin editor or database dependency; the metadata boundary leaves room to migrate authoring to a database later without changing the user-facing tutorial model.
